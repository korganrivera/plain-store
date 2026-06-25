import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  archiveOrder,
  confirmPendingBackInStockNotification,
  confirmPendingOrder,
  createOrder,
  createPendingBackInStockConfirmation,
  createPendingOrderConfirmation,
  deleteCategory,
  deleteProduct,
  getCategoryById,
  getCartProducts,
  getCategoryBySlug,
  getOrderByNumber,
  getOrderByStatusToken,
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
  contactPage,
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
import { parsePositiveInt, requireAdminProductFields, requireCheckoutFields, requireContactFields } from "./validation.js";
import {
  sendBackInStockEmail,
  sendBackInStockConfirmationEmail,
  sendContactMessageEmail,
  sendOrderConfirmationEmail,
  sendOrderPickedUpEmail,
  sendOrderReadyEmail,
  sendOrderSubmittedEmails,
} from "./email.js";
import { checkRateLimit, formatRetryAfter } from "./rate-limit.js";
import { verifyAdminPassword, verifyPlainPassword } from "./admin-auth.js";

const app = express();
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || "";
const forceSecureCookies = process.env.COOKIE_SECURE === "true";
const trustProxy = process.env.TRUST_PROXY || "loopback";
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const adminSessionSeconds = 60 * 60 * 12;
const publicImagesDir = path.resolve("public/images");
const uploadMaxMegabytes = 5;
const uploadMaxBytes = uploadMaxMegabytes * 1024 * 1024;
const listedImagePattern = /\.(gif|jpe?g|png|svg|webp)$/i;

app.set("trust proxy", trustProxy);
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

function listProductImages() {
  try {
    return fs
      .readdirSync(publicImagesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && listedImagePattern.test(entry.name))
      .map((entry) => ({
        filename: entry.name,
        path: `/images/${entry.name}`,
      }))
      .sort((a, b) => a.filename.localeCompare(b.filename));
  } catch (error) {
    console.error("Failed to list product images:", error);
    return [];
  }
}

function parseMultipartForm(maxBytes) {
  return (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    const boundary = contentType.match(/multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i)?.[1]
      || contentType.match(/multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
    if (!boundary) {
      return res.status(400).send("Expected multipart form data.");
    }

    const chunks = [];
    let byteCount = 0;
    let tooLarge = false;

    req.on("data", (chunk) => {
      byteCount += chunk.length;
      if (byteCount > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });

    req.on("error", next);

    req.on("end", () => {
      if (tooLarge) {
        return res.status(413).send("Uploaded image is too large.");
      }

      try {
        const body = Buffer.concat(chunks).toString("latin1");
        const delimiter = `--${boundary}`;
        const parts = body.split(delimiter).slice(1, -1);
        req.body = {};
        req.files = {};

        for (let part of parts) {
          part = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd === -1) {
            continue;
          }
          const rawHeaders = part.slice(0, headerEnd);
          const content = part.slice(headerEnd + 4);
          const disposition = rawHeaders.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
          const name = disposition.match(/name="([^"]+)"/)?.[1];
          if (!name) {
            continue;
          }

          const filename = disposition.match(/filename="([^"]*)"/)?.[1];
          if (filename !== undefined) {
            req.files[name] = {
              filename,
              mimeType: rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || "",
              buffer: Buffer.from(content, "latin1"),
            };
          } else {
            req.body[name] = Buffer.from(content, "latin1").toString("utf8");
          }
        }
        next();
      } catch (error) {
        next(error);
      }
    });
  };
}

function uploadedImageExtension(file) {
  const { buffer, mimeType } = file;
  if (mimeType === "image/jpeg" && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  if (
    mimeType === "image/png" &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (
    mimeType === "image/webp" &&
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (
    mimeType === "image/gif" &&
    buffer.length >= 6 &&
    (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return "gif";
  }
  return null;
}

function safeImageBaseName(filename) {
  const parsed = path.parse(path.basename(filename || "image"));
  const safe = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return safe || "image";
}

async function optimizedProductImageBuffer(file) {
  return sharp(file.buffer)
    .rotate()
    .resize({
      width: 900,
      height: 900,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#fffdf8" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

async function saveUploadedProductImage(file) {
  if (!file || file.buffer.length === 0) {
    throw new Error("Choose an image to upload.");
  }

  const extension = uploadedImageExtension(file);
  if (!extension) {
    throw new Error("Upload a JPEG, PNG, WebP, or GIF image.");
  }

  const optimizedBuffer = await optimizedProductImageBuffer(file);
  fs.mkdirSync(publicImagesDir, { recursive: true });
  const baseName = safeImageBaseName(file.filename);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    const filename = `${baseName}-${suffix}.jpg`;
    const targetPath = path.join(publicImagesDir, filename);
    try {
      fs.writeFileSync(targetPath, optimizedBuffer, { flag: "wx" });
      return `/images/${filename}`;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error("Could not create a unique image filename.");
}

function productImageFile(imagePath) {
  const normalizedPath = plainText(imagePath, 200);
  if (!normalizedPath.startsWith("/images/")) {
    throw new Error("Invalid image path.");
  }

  const filename = path.basename(normalizedPath);
  if (`/images/${filename}` !== normalizedPath || !listedImagePattern.test(filename) || filename === "placeholder.svg") {
    throw new Error("Invalid image path.");
  }

  const filepath = path.join(publicImagesDir, filename);
  const relativePath = path.relative(publicImagesDir, filepath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid image path.");
  }

  return { filename, path: normalizedPath, filepath };
}

function deleteProductImage(imagePath) {
  const image = productImageFile(imagePath);
  if (!fs.existsSync(image.filepath)) {
    throw new Error("Image not found.");
  }

  const productsUsingImage = listProducts({ includeInactive: true }).filter((product) => product.image_path === image.path);
  if (productsUsingImage.length > 0) {
    const names = productsUsingImage.map((product) => product.name).join(", ");
    throw new Error(`Image is still used by: ${names}. Remove it from those products first.`);
  }

  fs.unlinkSync(image.filepath);
  return image;
}

function cartCount(req) {
  return req.cart.reduce((sum, item) => sum + item.quantity, 0);
}

function cartItemsCookie(items) {
  return items.map((item) => ({ productId: item.id, quantity: item.quantity }));
}

function cartItemsCount(items) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function stockUnitLabel(quantity) {
  return quantity === 1 ? "item is" : "items are";
}

function cartNoticeFlash(notices, fallback = null) {
  if (notices.length === 0) {
    return fallback;
  }
  return { type: "error", message: notices.join(" ") };
}

function hydrateCart(req) {
  const products = getCartProducts(req.cart.map((item) => item.productId));
  const byId = new Map(products.map((product) => [product.id, product]));
  const items = [];
  const notices = [];
  for (const entry of req.cart) {
    const product = byId.get(entry.productId);
    if (!product) {
      notices.push("An item was removed from your basket because it is no longer available.");
      continue;
    }
    if (product.status !== "active") {
      notices.push(`${product.name} was removed from your basket because it is no longer available.`);
      continue;
    }
    const quantity = Math.min(entry.quantity, product.inventory_count);
    if (quantity <= 0) {
      notices.push(`${product.name} is now out of stock and was removed from your basket.`);
      continue;
    }
    if (quantity < entry.quantity) {
      notices.push(`${product.name} was reduced to ${quantity} because only ${quantity} ${stockUnitLabel(quantity)} available.`);
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
    notices,
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

function orderLookupLimitError(req, orderNumber, email) {
  const limits = [
    [`order-lookup:ip:${clientIp(req)}`, { max: 20, windowMs: hourMs }],
    [`order-lookup:key:${orderNumber}:${email}`, { max: 6, windowMs: hourMs }],
  ];

  for (const [key, options] of limits) {
    const result = checkRateLimit(key, options);
    if (!result.allowed) {
      return `Too many order lookup attempts. Please try again in ${formatRetryAfter(result.retryAfterSeconds)}.`;
    }
  }

  return null;
}

function confirmationLimitError(req, kind) {
  const result = checkRateLimit(`${kind}-confirm:ip:${clientIp(req)}`, { max: 30, windowMs: hourMs });
  if (!result.allowed) {
    return `Too many confirmation attempts. Please try again in ${formatRetryAfter(result.retryAfterSeconds)}.`;
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
  return crypto.createHash("sha256").update(adminPasswordHash || adminPassword).digest("hex");
}

function verifyAdminLogin(password) {
  if (adminPasswordHash) {
    return verifyAdminPassword(password, adminPasswordHash);
  }
  return verifyPlainPassword(password, adminPassword);
}

function requireAdmin(req, res, next) {
  if (req.adminSession?.token !== adminSignedValue() || req.adminSession?.expiresAt < Date.now()) {
    clearCookie(res, "admin", { secure: forceSecureCookies || req.secure });
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

app.get("/contact", (req, res) => {
  res.send(contactPage({ cartCount: cartCount(req), csrfToken: req.csrfToken, flash: req.flash }));
});

app.post("/contact", requireCsrf, async (req, res) => {
  const validated = requireContactFields(req.body);
  if (validated.error) {
    return res.status(400).send(
      contactPage({
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        values: req.body,
        error: validated.error,
      }),
    );
  }

  if (validated.value.spam) {
    setFlash(res, "success", "Thanks. Your message was sent.");
    return res.redirect("/contact");
  }

  const limits = [
    [`contact:ip:${clientIp(req)}`, { max: 10, windowMs: hourMs }],
    [`contact:email:${validated.value.email}`, { max: 4, windowMs: hourMs }],
  ];
  for (const [key, options] of limits) {
    const result = checkRateLimit(key, options);
    if (!result.allowed) {
      return res.status(429).send(
        contactPage({
          cartCount: cartCount(req),
          csrfToken: req.csrfToken,
          values: req.body,
          error: `Too many messages. Please try again in ${formatRetryAfter(result.retryAfterSeconds)}.`,
        }),
      );
    }
  }

  try {
    await sendContactMessageEmail(validated.value);
  } catch (emailError) {
    console.error("Failed to send contact message email:", emailError);
    return res.status(500).send(
      contactPage({
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        values: req.body,
        error: "We could not send the message. Please try again.",
      }),
    );
  }

  setFlash(res, "success", "Thanks. Your message was sent.");
  return res.redirect("/contact");
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
  const previousQuantity = existing?.quantity || 0;
  let nextQuantity = Math.min(quantity, product.inventory_count);
  if (existing) {
    nextQuantity = Math.min(previousQuantity + quantity, product.inventory_count);
    existing.quantity = nextQuantity;
  } else {
    nextCart.push({ productId: product.id, quantity: nextQuantity });
  }

  saveCart(res, nextCart);
  if (previousQuantity + quantity > product.inventory_count) {
    setFlash(res, "error", `Only ${product.inventory_count} ${stockUnitLabel(product.inventory_count)} available, so your basket now has ${nextQuantity}.`);
  } else {
    setFlash(res, "success", `${product.name} added to basket.`);
  }
  res.redirect("/cart");
});

app.get("/cart", (req, res) => {
  const { items, totals, notices } = hydrateCart(req);
  saveCart(res, cartItemsCookie(items));
  res.send(
    cartPage({
      items,
      totals,
      cartCount: cartItemsCount(items),
      csrfToken: req.csrfToken,
      flash: cartNoticeFlash(notices, req.flash),
    }),
  );
});

app.post("/cart/update", requireCsrf, (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = Number.parseInt(String(req.body.quantity ?? ""), 10);
  const product = getProductById(productId);
  if (!product || product.status !== "active") {
    saveCart(
      res,
      req.cart.filter((item) => item.productId !== productId),
    );
    setFlash(res, "error", "That item is no longer available and was removed from your basket.");
    return res.redirect("/cart");
  }
  const nextCart = req.cart.filter((item) => item.productId !== productId);
  if (Number.isFinite(quantity) && quantity > 0) {
    const nextQuantity = Math.min(quantity, product.inventory_count);
    if (nextQuantity > 0) {
      nextCart.push({ productId, quantity: nextQuantity });
    }
    if (nextQuantity < quantity) {
      setFlash(
        res,
        "error",
        nextQuantity > 0
          ? `Only ${product.inventory_count} ${stockUnitLabel(product.inventory_count)} available, so ${product.name} was set to ${nextQuantity}.`
          : `${product.name} is now out of stock and was removed from your basket.`,
      );
    }
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

app.post("/back-in-stock", requireCsrf, async (req, res) => {
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
    if (!isContactVerified(email)) {
      const pending = createPendingBackInStockConfirmation({
        productId: product.id,
        email,
        requestIp: clientIp(req),
      });
      try {
        await sendBackInStockConfirmationEmail(pending);
      } catch (emailError) {
        console.error("Failed to send back-in-stock confirmation email:", emailError);
        setFlash(res, "error", "We could not send the confirmation email. Please try again.");
        return res.redirect(redirectPath);
      }
      setFlash(res, "success", "Check your email to confirm this back-in-stock notification request.");
      return res.redirect(redirectPath);
    }

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

app.get("/back-in-stock/confirm/:token", (req, res) => {
  const limitError = confirmationLimitError(req, "back-in-stock");
  if (limitError) {
    setFlash(res, "error", limitError);
    return res.redirect("/");
  }

  const token = plainText(req.params.token, 120);
  let request;
  try {
    request = confirmPendingBackInStockNotification(token);
  } catch (error) {
    setFlash(res, "error", error.message);
    return res.redirect("/");
  }

  setFlash(
    res,
    "success",
    request.created
      ? `Email confirmed. We will email you when ${request.product.name} is back in stock.`
      : "Email confirmed. You are already on the notification list for this item.",
  );
  res.redirect(`/p/${request.product.slug}`);
});

app.get("/checkout", (req, res) => {
  const { items, totals, notices } = hydrateCart(req);
  if (notices.length > 0) {
    saveCart(res, cartItemsCookie(items));
    setFlash(res, "error", notices.join(" "));
    return res.redirect("/cart");
  }
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
  const { items, totals, notices } = hydrateCart(req);
  if (notices.length > 0) {
    saveCart(res, cartItemsCookie(items));
    setFlash(res, "error", notices.join(" "));
    return res.redirect("/cart");
  }
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
    return res.redirect(`/order/status/${order.status_token}`);
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
  const limitError = confirmationLimitError(req, "order");
  if (limitError) {
    return res.status(429).send(
      emailVerificationErrorPage({
        message: limitError,
        cartCount: cartCount(req),
      }),
    );
  }

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
  res.redirect(`/order/status/${order.status_token}`);
});

app.get("/order/status/:token", (req, res) => {
  const order = getOrderByStatusToken(plainText(req.params.token, 120));
  if (!order) {
    return res.status(404).send("Order not found.");
  }
  res.send(orderPage({ order, cartCount: cartCount(req), flash: req.flash }));
});

app.get("/order/:orderNumber", (req, res) => {
  setFlash(res, "error", "Use order lookup to view pickup order details.");
  res.redirect("/order-lookup");
});

app.get("/order-lookup", (req, res) => {
  res.send(orderLookupPage({ cartCount: cartCount(req), csrfToken: req.csrfToken, flash: req.flash }));
});

app.post("/order-lookup", requireCsrf, (req, res) => {
  const orderNumber = plainText(req.body.orderNumber, 20).toUpperCase();
  const email = plainText(req.body.email, 200).toLowerCase();
  const limitError = orderLookupLimitError(req, orderNumber, email);
  if (limitError) {
    return res.status(429).send(
      orderLookupPage({
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        values: { orderNumber, email },
        error: limitError,
      }),
    );
  }

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
      productImages: listProductImages(),
      imageUploadMaxMegabytes: uploadMaxMegabytes,
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
  const limit = checkRateLimit(`admin-login:ip:${clientIp(req)}`, { max: 8, windowMs: hourMs });
  if (!limit.allowed) {
    return res.status(429).send(
      adminLoginPage({
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        error: `Too many admin login attempts. Please try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`,
      }),
    );
  }

  if (!verifyAdminLogin(req.body.password || "")) {
    return res.send(
      adminLoginPage({
        cartCount: cartCount(req),
        csrfToken: req.csrfToken,
        error: "Incorrect password.",
      }),
    );
  }
  setCookie(res, "admin", encodeSignedJson({ token: adminSignedValue(), expiresAt: Date.now() + adminSessionSeconds * 1000 }), {
    maxAge: adminSessionSeconds,
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

app.post("/admin/images", requireAdmin, parseMultipartForm(uploadMaxBytes), requireCsrf, async (req, res) => {
  try {
    const imagePath = await saveUploadedProductImage(req.files?.image);
    setFlash(res, "success", `Image uploaded: ${imagePath}`);
  } catch (error) {
    setFlash(res, "error", error.message);
  }
  res.redirect("/admin/catalog");
});

app.post("/admin/images/delete", requireCsrf, requireAdmin, (req, res) => {
  try {
    const image = deleteProductImage(req.body.imagePath);
    setFlash(res, "success", `Image deleted: ${image.path}`);
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
