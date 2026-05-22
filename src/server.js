import crypto from "node:crypto";
import express from "express";
import {
  createOrder,
  archiveOrder,
  confirmPendingOrder,
  createPendingOrderConfirmation,
  deleteCategory,
  deleteProduct,
  getCategoryById,
  getCartProducts,
  getCategoryBySlug,
  getOrderByNumber,
  getProductById,
  getProductBySlug,
  isContactVerified,
  listPendingBackInStockRequests,
  listCategories,
  listStorefrontCategories,
  listOrders,
  listProducts,
  lookupOrder,
  markBackInStockRequestNotified,
  recordContactOrder,
  releaseOrderInventory,
  requestBackInStockNotification,
  updateOrderStatus,
  unarchiveOrder,
  upsertCategory,
  upsertProduct,
} from "./store.js";
import {
  adminCatalogPage,
  adminLoginPage,
  adminOrdersPage,
  cartPage,
  categoryPage,
  checkoutPage,
  emailVerificationErrorPage,
  emailVerificationSentPage,
  homePage,
  orderLookupPage,
  orderPage,
  productPage,
} from "./templates.js";
import {
  clearCookie,
  decodeSignedJson,
  encodeSignedJson,
  formatCurrency,
  plainText,
  randomToken,
  readCookies,
  setCookie,
} from "./utils.js";
import { parsePositiveInt, requireAdminProductFields, requireCheckoutFields } from "./validation.js";
import {
  sendBackInStockEmail,
  sendOrderConfirmationEmail,
  sendOrderPickedUpEmail,
  sendOrderReadyEmail,
  sendOrderSubmittedEmails,
} from "./email.js";
import { checkRateLimit, formatRetryAfter } from "./rate-limit.js";

const app = express();
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const forceSecureCookies = process.env.COOKIE_SECURE === "true";
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public", { extensions: ["html"], maxAge: "1d" }));

app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  next();
});

app.use((req, res, next) => {
  const start = performance.now();
  res.on("finish", () => {
    const duration = (performance.now() - start).toFixed(1);
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

app.use((req, res, next) => {
  req.cookies = readCookies(req.headers.cookie);
  req.cart = decodeSignedJson(req.cookies.cart, []);
  req.flash = decodeSignedJson(req.cookies.flash, null);
  req.csrfToken = req.cookies.csrf || randomToken();
  req.adminSession = decodeSignedJson(req.cookies.admin, null);

  setCookie(res, "csrf", req.csrfToken, { httpOnly: false, secure: forceSecureCookies || req.secure });
  if (req.flash) {
    clearCookie(res, "flash", { secure: forceSecureCookies || req.secure });
  }
  next();
});

function setFlash(res, type, message) {
  setCookie(res, "flash", encodeSignedJson({ type, message }), {
    maxAge: 30,
    secure: forceSecureCookies || res.req.secure,
  });
}

function cartCount(req) {
  return req.cart.reduce((sum, item) => sum + item.quantity, 0);
}

function hydrateCart(req) {
  const products = getCartProducts(req.cart.map((item) => item.productId));
  const byId = new Map(products.map((product) => [product.id, product]));
  const items = [];
  for (const entry of req.cart) {
    const product = byId.get(entry.productId);
    if (!product || product.status !== "active") {
      continue;
    }
    const quantity = Math.min(entry.quantity, product.inventory_count);
    if (quantity <= 0) {
      continue;
    }
    items.push({
      ...product,
      quantity,
      lineTotalCents: quantity * product.price_cents,
    });
  }
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const shippingCents = 0;
  return {
    items,
    totals: {
      subtotalCents,
      shippingCents,
      totalCents: subtotalCents + shippingCents,
    },
  };
}

function saveCart(res, items) {
  setCookie(res, "cart", encodeSignedJson(items), { secure: forceSecureCookies || res.req.secure });
}

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function checkoutLimitError(req, email, verified) {
  const limits = [
    [`checkout:ip:${clientIp(req)}`, { max: 20, windowMs: hourMs }],
    [`checkout:email:${email}`, { max: verified ? 10 : 4, windowMs: hourMs }],
  ];

  if (verified) {
    limits.push([`order:email:${email}`, { max: 12, windowMs: dayMs }]);
  } else {
    limits.push([`pending:email:${email}`, { max: 3, windowMs: hourMs }]);
  }

  for (const [key, options] of limits) {
    const result = checkRateLimit(key, options);
    if (!result.allowed) {
      return `Too many pickup requests. Please try again in ${formatRetryAfter(result.retryAfterSeconds)}.`;
    }
  }

  return null;
}

function pendingOrderSummary(items, totals) {
  return [
    "Request summary:",
    ...items.map((item) => `- ${item.name} x ${item.quantity}: ${formatCurrency(item.lineTotalCents)}`),
    `Total due at pickup: ${formatCurrency(totals.totalCents)}`,
  ].join("\n");
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sendBackInStockEmailsForProduct(product) {
  const requests = listPendingBackInStockRequests(product.id).slice(0, product.inventory_count);
  let sentCount = 0;
  let failedCount = 0;

  for (const request of requests) {
    try {
      await sendBackInStockEmail(product, request);
      markBackInStockRequestNotified(request.id);
      sentCount += 1;
    } catch (emailError) {
      console.error("Failed to send back-in-stock email:", emailError);
      failedCount += 1;
    }
  }

  return { sentCount, failedCount };
}

async function sendBackInStockEmailsForProducts(products) {
  let sentCount = 0;
  let failedCount = 0;
  for (const product of products) {
    const result = await sendBackInStockEmailsForProduct(product);
    sentCount += result.sentCount;
    failedCount += result.failedCount;
  }
  return { sentCount, failedCount };
}

function requireCsrf(req, res, next) {
  if (req.body.csrfToken !== req.csrfToken) {
    return res.status(403).send("CSRF check failed.");
  }
  next();
}

function adminSignedValue() {
  return crypto.createHash("sha256").update(adminPassword).digest("hex");
}

function requireAdmin(req, res, next) {
  if (req.adminSession?.token !== adminSignedValue()) {
    return res.redirect("/admin/login");
  }
  next();
}

app.get("/", (req, res) => {
  const html = homePage({
    categories: listStorefrontCategories(),
    products: listProducts(),
    search: "",
    cartCount: cartCount(req),
    flash: req.flash,
  });
  res.send(html);
});

app.get("/search", (req, res) => {
  const search = plainText(req.query.q, 80);
  const html = homePage({
    categories: listStorefrontCategories(),
    products: listProducts({ search }),
    search,
    cartCount: cartCount(req),
    flash: req.flash,
  });
  res.send(html);
});

app.get("/c/:slug", (req, res) => {
  const category = getCategoryBySlug(req.params.slug);
  if (!category) {
    return res.status(404).send("Category not found.");
  }
  res.send(
    categoryPage({
      category,
      products: listProducts({ categorySlug: category.slug }),
      cartCount: cartCount(req),
      flash: req.flash,
    }),
  );
});

app.get("/p/:slug", (req, res) => {
  const product = getProductBySlug(req.params.slug);
  if (!product) {
    return res.status(404).send("Product not found.");
  }
  res.send(productPage({ product, cartCount: cartCount(req), csrfToken: req.csrfToken, flash: req.flash }));
});

app.post("/cart/add", requireCsrf, (req, res) => {
  const product = getProductById(Number(req.body.productId));
  const quantity = parsePositiveInt(req.body.quantity, 1);
  if (!product || product.status !== "active" || product.inventory_count <= 0) {
    setFlash(res, "error", "That product is unavailable.");
    return res.redirect("/cart");
  }

  const nextCart = [...req.cart];
  const existing = nextCart.find((item) => item.productId === product.id);
  if (existing) {
    existing.quantity = Math.min(existing.quantity + quantity, product.inventory_count);
  } else {
    nextCart.push({ productId: product.id, quantity: Math.min(quantity, product.inventory_count) });
  }

  saveCart(res, nextCart);
  setFlash(res, "success", `${product.name} added to basket.`);
  res.redirect("/cart");
});

app.get("/cart", (req, res) => {
  const { items, totals } = hydrateCart(req);
  saveCart(
    res,
    items.map((item) => ({ productId: item.id, quantity: item.quantity })),
  );
  res.send(cartPage({ items, totals, cartCount: cartCount(req), csrfToken: req.csrfToken, flash: req.flash }));
});

app.post("/cart/update", requireCsrf, (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = Number.parseInt(String(req.body.quantity ?? ""), 10);
  const product = getProductById(productId);
  if (!product) {
    return res.redirect("/cart");
  }
  const nextCart = req.cart.filter((item) => item.productId !== productId);
  if (Number.isFinite(quantity) && quantity > 0) {
    nextCart.push({ productId, quantity: Math.min(quantity, product.inventory_count) });
  }
  saveCart(res, nextCart);
  res.redirect("/cart");
});

app.post("/cart/remove", requireCsrf, (req, res) => {
  saveCart(
    res,
    req.cart.filter((item) => item.productId !== Number(req.body.productId)),
  );
  res.redirect("/cart");
});

app.post("/back-in-stock", requireCsrf, (req, res) => {
  const productId = Number.parseInt(String(req.body.productId ?? ""), 10);
  const email = plainText(req.body.email, 200).toLowerCase();
  const product = Number.isInteger(productId) ? getProductById(productId) : null;
  const redirectPath = product?.slug ? `/p/${product.slug}` : "/";

  if (!product || product.status !== "active") {
    setFlash(res, "error", "That product is unavailable.");
    return res.redirect("/");
  }
  if (!validEmail(email)) {
    setFlash(res, "error", "Enter a valid email address.");
    return res.redirect(redirectPath);
  }

  const limits = [
    [`back-in-stock:ip:${clientIp(req)}`, { max: 20, windowMs: hourMs }],
    [`back-in-stock:email:${email}`, { max: 5, windowMs: hourMs }],
  ];
  for (const [key, options] of limits) {
    const result = checkRateLimit(key, options);
    if (!result.allowed) {
      setFlash(res, "error", `Too many notification requests. Please try again in ${formatRetryAfter(result.retryAfterSeconds)}.`);
      return res.redirect(redirectPath);
    }
  }

  try {
    const request = requestBackInStockNotification(product.id, email);
    setFlash(
      res,
      "success",
      request.created
        ? "We will email you when this item is back in stock."
        : "You are already on the notification list for this item.",
    );
  } catch (error) {
    setFlash(res, "error", error.message);
  }
  res.redirect(redirectPath);
});

app.get("/checkout", (req, res) => {
  const { items, totals } = hydrateCart(req);
  if (items.length === 0) {
    setFlash(res, "error", "Your basket is empty.");
    return res.redirect("/cart");
  }
  res.send(
    checkoutPage({
      items,
      totals,
      values: {},
      error: null,
      cartCount: cartCount(req),
      csrfToken: req.csrfToken,
      flash: req.flash,
    }),
  );
});

app.post("/checkout", requireCsrf, async (req, res) => {
  const { items, totals } = hydrateCart(req);
  if (items.length === 0) {
    setFlash(res, "error", "Your basket is empty.");
    return res.redirect("/cart");
  }
  const validated = requireCheckoutFields(req.body);
  if (validated.error) {
    return res.send(
      checkoutPage({
        items,
        totals,
        values: req.body,
        error: validated.error,
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        flash: req.flash,
      }),
    );
  }

  const verifiedContact = isContactVerified(validated.value.email);
  const limitError = checkoutLimitError(req, validated.value.email, verifiedContact);
  if (limitError) {
    return res.status(429).send(
      checkoutPage({
        items,
        totals,
        values: req.body,
        error: limitError,
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        flash: req.flash,
      }),
    );
  }

  try {
    if (!verifiedContact) {
      const pending = createPendingOrderConfirmation({
        ...validated.value,
        items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
        requestIp: clientIp(req),
      });
      try {
        await sendOrderConfirmationEmail({
          ...pending,
          summaryText: pendingOrderSummary(items, totals),
        });
      } catch (emailError) {
        console.error("Failed to send order-confirmation email:", emailError);
        return res.send(
          checkoutPage({
            items,
            totals,
            values: req.body,
            error: "We could not send the confirmation email. Please try again.",
            cartCount: cartCount(req),
            csrfToken: req.csrfToken,
            flash: req.flash,
          }),
        );
      }
      clearCookie(res, "cart", { secure: forceSecureCookies || req.secure });
      return res.send(
        emailVerificationSentPage({
          email: pending.email,
          expiresMinutes: pending.expiresMinutes,
          cartCount: 0,
          flash: { type: "success", message: "Check your email to confirm this pickup request." },
        }),
      );
    }

    const order = createOrder({
      ...validated.value,
      items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
    });
    recordContactOrder(order.email);
    try {
      await sendOrderSubmittedEmails(order);
    } catch (emailError) {
      console.error("Failed to send order-submitted email:", emailError);
    }
    clearCookie(res, "cart", { secure: forceSecureCookies || req.secure });
    return res.redirect(`/order/${order.order_number}`);
  } catch (error) {
    return res.send(
      checkoutPage({
        items,
        totals,
        values: req.body,
        error: error.message,
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        flash: req.flash,
      }),
    );
  }
});

app.get("/order/confirm/:token", async (req, res) => {
  const token = plainText(req.params.token, 120);
  let order;
  try {
    order = confirmPendingOrder(token);
  } catch (error) {
    return res.status(400).send(
      emailVerificationErrorPage({
        message: error.message,
        cartCount: cartCount(req),
      }),
    );
  }

  try {
    await sendOrderSubmittedEmails(order);
  } catch (emailError) {
    console.error("Failed to send order-submitted email after confirmation:", emailError);
  }

  clearCookie(res, "cart", { secure: forceSecureCookies || req.secure });
  setFlash(res, "success", "Email confirmed. Your pickup order was submitted.");
  res.redirect(`/order/${order.order_number}`);
});

app.get("/order/:orderNumber", (req, res) => {
  const order = getOrderByNumber(plainText(req.params.orderNumber, 20));
  if (!order) {
    return res.status(404).send("Order not found.");
  }
  res.send(orderPage({ order, cartCount: cartCount(req), flash: req.flash }));
});

app.get("/order-lookup", (req, res) => {
  res.send(orderLookupPage({ cartCount: cartCount(req), csrfToken: req.csrfToken, flash: req.flash }));
});

app.post("/order-lookup", requireCsrf, (req, res) => {
  const orderNumber = plainText(req.body.orderNumber, 20).toUpperCase();
  const email = plainText(req.body.email, 200).toLowerCase();
  const order = lookupOrder(orderNumber, email);
  if (!order) {
    return res.send(
      orderLookupPage({
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        values: { orderNumber, email },
        error: "No matching order found.",
      }),
    );
  }
  res.send(orderPage({ order, cartCount: cartCount(req), title: "Pickup Order Status", flash: req.flash }));
});

app.get("/admin", requireAdmin, (req, res) => {
  res.redirect("/admin/catalog");
});

app.get("/admin/catalog", requireAdmin, (req, res) => {
  const editingProductId = Number.parseInt(String(req.query.product ?? ""), 10);
  const editingCategoryId = Number.parseInt(String(req.query.category ?? ""), 10);
  const editingProduct = Number.isInteger(editingProductId) ? getProductById(editingProductId) : null;
  const editingCategory = Number.isInteger(editingCategoryId) ? getCategoryById(editingCategoryId) : null;
  res.send(
    adminCatalogPage({
      cartCount: cartCount(req),
      products: listProducts({ includeInactive: true }),
      categories: listCategories(),
      editingProduct,
      editingCategory,
      flash: req.flash,
      csrfToken: req.csrfToken,
    }),
  );
});

app.get("/admin/orders", requireAdmin, (req, res) => {
  res.send(
    adminOrdersPage({
      cartCount: cartCount(req),
      orders: listOrders(),
      archivedOrders: listOrders({ includeArchived: true }).filter((order) => order.archived_at),
      flash: req.flash,
      csrfToken: req.csrfToken,
    }),
  );
});

app.get("/admin/login", (req, res) => {
  res.send(adminLoginPage({ cartCount: cartCount(req), csrfToken: req.csrfToken, flash: req.flash }));
});

app.post("/admin/login", requireCsrf, (req, res) => {
  if (req.body.password !== adminPassword) {
    return res.send(
      adminLoginPage({
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        error: "Incorrect password.",
      }),
    );
  }
  setCookie(res, "admin", encodeSignedJson({ token: adminSignedValue() }), {
    secure: forceSecureCookies || req.secure,
  });
  res.redirect("/admin/catalog");
});

app.post("/admin/logout", requireCsrf, (req, res) => {
  clearCookie(res, "admin", { secure: forceSecureCookies || req.secure });
  res.redirect("/admin/login");
});

app.post("/admin/categories", requireCsrf, requireAdmin, (req, res) => {
  try {
    upsertCategory({
      id: Number.parseInt(String(req.body.id ?? ""), 10) || null,
      name: plainText(req.body.name, 80),
      description: plainText(req.body.description, 200),
    });
    setFlash(res, "success", "Category saved.");
  } catch (error) {
    setFlash(res, "error", error.message);
  }
  res.redirect("/admin/catalog");
});

app.post("/admin/categories/delete", requireCsrf, requireAdmin, (req, res) => {
  const categoryId = Number.parseInt(String(req.body.id ?? ""), 10);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    setFlash(res, "error", "Invalid category.");
    return res.redirect("/admin");
  }

  try {
    deleteCategory(categoryId);
    setFlash(res, "success", "Category deleted.");
  } catch (error) {
    setFlash(res, "error", error.message);
  }
  res.redirect("/admin/catalog");
});

app.post("/admin/products", requireCsrf, requireAdmin, async (req, res) => {
  const validated = requireAdminProductFields(req.body);
  if (validated.error) {
    setFlash(res, "error", validated.error);
    return res.redirect("/admin/catalog");
  }
  try {
    const productId = Number.parseInt(String(validated.value.id ?? ""), 10);
    const previousProduct = Number.isInteger(productId) ? getProductById(productId) : null;
    const savedProductId = upsertProduct(validated.value);
    const savedProduct = getProductById(savedProductId);
    const cameBackInStock =
      savedProduct?.status === "active" &&
      savedProduct.inventory_count > 0 &&
      previousProduct &&
      previousProduct.inventory_count <= 0;

    if (cameBackInStock) {
      const { sentCount, failedCount } = await sendBackInStockEmailsForProduct(savedProduct);
      if (failedCount > 0) {
        setFlash(res, "error", `Product saved. Sent ${sentCount} back-in-stock emails; ${failedCount} failed.`);
      } else if (sentCount > 0) {
        setFlash(res, "success", `Product saved. Sent ${sentCount} back-in-stock emails.`);
      } else {
        setFlash(res, "success", "Product saved.");
      }
    } else {
      setFlash(res, "success", "Product saved.");
    }
  } catch (error) {
    setFlash(res, "error", error.message);
  }
  res.redirect("/admin/catalog");
});

app.post("/admin/products/delete", requireCsrf, requireAdmin, (req, res) => {
  const productId = Number.parseInt(String(req.body.id ?? ""), 10);
  if (!Number.isInteger(productId) || productId <= 0) {
    setFlash(res, "error", "Invalid product.");
    return res.redirect("/admin/catalog");
  }

  try {
    deleteProduct(productId);
    setFlash(res, "success", "Product deleted.");
  } catch (error) {
    setFlash(res, "error", error.message);
  }
  res.redirect("/admin/catalog");
});

app.post("/admin/orders", requireCsrf, requireAdmin, async (req, res) => {
  const status = ["requested", "ready", "picked_up", "cancelled", "no_show"].includes(req.body.status)
    ? req.body.status
    : null;
  if (!status) {
    setFlash(res, "error", "Invalid order status.");
    return res.redirect("/admin/orders");
  }
  const orderNumber = plainText(req.body.orderNumber, 20);
  const previousOrder = getOrderByNumber(orderNumber);
  updateOrderStatus(orderNumber, status);
  const updatedOrder = getOrderByNumber(orderNumber);
  const shouldReleaseInventory =
    (status === "cancelled" || status === "no_show") && req.body.returnInventory === "on";
  let releaseResult = null;
  let notificationResult = null;

  if (updatedOrder && shouldReleaseInventory) {
    try {
      releaseResult = releaseOrderInventory(orderNumber);
      notificationResult = await sendBackInStockEmailsForProducts(releaseResult.products);
    } catch (error) {
      console.error("Failed to release order inventory:", error);
      setFlash(res, "error", "Order updated, but inventory could not be returned to stock.");
      return res.redirect("/admin/orders");
    }
  }

  if (status === "ready" && previousOrder?.status !== "ready" && updatedOrder) {
    try {
      await sendOrderReadyEmail(updatedOrder);
    } catch (emailError) {
      console.error("Failed to send ready-for-pickup email:", emailError);
      setFlash(res, "error", "Order updated, but the ready-for-pickup email failed.");
      return res.redirect("/admin/orders");
    }
  }

  if (status === "picked_up" && previousOrder?.status !== "picked_up" && updatedOrder) {
    try {
      await sendOrderPickedUpEmail(updatedOrder);
    } catch (emailError) {
      console.error("Failed to send picked-up thank-you email:", emailError);
      setFlash(res, "error", "Order updated, but the thank-you email failed.");
      return res.redirect("/admin/orders");
    }
  }

  const messages = ["Order updated."];
  if (releaseResult?.alreadyReleased) {
    messages.push("Inventory was already returned.");
  } else if (releaseResult?.restoredCount > 0) {
    messages.push(`Returned ${releaseResult.restoredCount} item${releaseResult.restoredCount === 1 ? "" : "s"} to stock.`);
  }
  if (notificationResult?.sentCount > 0) {
    messages.push(`Sent ${notificationResult.sentCount} back-in-stock email${notificationResult.sentCount === 1 ? "" : "s"}.`);
  }
  if (notificationResult?.failedCount > 0) {
    messages.push(`${notificationResult.failedCount} back-in-stock email${notificationResult.failedCount === 1 ? "" : "s"} failed.`);
  }
  setFlash(res, notificationResult?.failedCount > 0 ? "error" : "success", messages.join(" "));
  res.redirect("/admin/orders");
});

app.post("/admin/orders/archive", requireCsrf, requireAdmin, (req, res) => {
  archiveOrder(plainText(req.body.orderNumber, 20));
  setFlash(res, "success", "Order archived.");
  res.redirect("/admin/orders");
});

app.post("/admin/orders/unarchive", requireCsrf, requireAdmin, (req, res) => {
  unarchiveOrder(plainText(req.body.orderNumber, 20));
  setFlash(res, "success", "Order restored.");
  res.redirect("/admin/orders");
});

app.get("/healthz", (req, res) => {
  res.type("text/plain").send("ok");
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).send("Internal server error.");
});

const port = Number.parseInt(process.env.PORT || "3001", 10);
const host = process.env.HOST || "0.0.0.0";

app.listen(port, host, () => {
  console.log(`Plain Store listening on http://${host}:${port}`);
});
