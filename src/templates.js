import { escapeHtml, formatCurrency } from "./utils.js";

const assetVersion = process.env.ASSET_VERSION || "2026-06-25-4";

function nav(currentPath, cartCount, headerSearch = "") {
  const links = [
    ["/contact", "Contact"],
    ["/order-lookup", "Check Pickup Order"],
  ];
  return `
    <header class="site-header">
      <div class="wrap header-row">
        <a href="/" class="wordmark">Plain Store</a>
        ${headerSearch}
        <nav class="nav" aria-label="Primary">
          ${links
            .map(
              ([href, label]) =>
                `<a href="${href}"${currentPath === href ? ' aria-current="page"' : ""}>${label}</a>`,
            )
            .join("")}
          <a href="/cart"${currentPath === "/cart" ? ' aria-current="page"' : ""}>Basket (${cartCount})</a>
        </nav>
      </div>
    </header>
  `;
}

function footer(currentPath) {
  return `
    <footer class="site-footer">
      <div class="wrap footer-row">
        <a href="/admin" class="footer-admin-link"${currentPath === "/admin" ? ' aria-current="page"' : ""}>Admin</a>
      </div>
    </footer>
  `;
}

function flashHtml(flash) {
  if (!flash) {
    return "";
  }
  return `<div class="flash ${escapeHtml(flash.type)}">${escapeHtml(flash.message)}</div>`;
}

function descriptionParagraphs(description) {
  return String(description || "")
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function shortDescription(description) {
  return descriptionParagraphs(description)[0] || "";
}

function productDescriptionHtml(description) {
  const paragraphs = descriptionParagraphs(description);
  if (paragraphs.length === 0) {
    return "";
  }

  return `
    <div class="product-description muted">
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
    </div>
  `;
}

export function layout({
  title,
  currentPath,
  cartCount,
  content,
  flash = null,
  headerSearch = "",
  bodyClass = "",
  mainClass = "wrap stack",
}) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(title)} | Plain Store</title>
      <link rel="stylesheet" href="/styles.css?v=${assetVersion}">
      <script src="/app.js?v=${assetVersion}" defer></script>
    </head>
    <body${bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ""}>
      ${nav(currentPath, cartCount, headerSearch)}
      <main class="${escapeHtml(mainClass)}">
        ${flashHtml(flash)}
        ${content}
      </main>
      ${footer(currentPath)}
    </body>
  </html>`;
}

export function homePage({ categories, products, search, cartCount, flash = null }) {
  const showCategories = categories.length > 1;
  const headerSearch = `
    <form action="/search" method="get" class="header-search" role="search">
      <label for="header-search" class="sr-only">Search products</label>
      <div class="header-search-field">
        <input
          id="header-search"
          name="q"
          type="search"
          value="${escapeHtml(search)}"
          placeholder="Search products"
        >
        <button type="submit" class="header-search-button" aria-label="Search products">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M13.5 12.1l4.2 4.2-1.4 1.4-4.2-4.2a6 6 0 1 1 1.4-1.4zM8.5 13a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z"/>
          </svg>
        </button>
      </div>
    </form>
  `;
  return layout({
    title: "Catalog",
    currentPath: "/",
    cartCount,
    flash,
    headerSearch,
    content: `
      ${
        showCategories
          ? `
            <section class="stack-tight" id="categories">
              <div class="section-heading">
                <h2>Categories</h2>
              </div>
              <div class="category-grid">
                ${categories
                  .map(
                    (category) => `
                      <a class="category-card" href="/c/${escapeHtml(category.slug)}">
                        <strong>${escapeHtml(category.name)}</strong>
                        <span>${escapeHtml(category.description)}</span>
                      </a>
                    `,
                  )
                  .join("")}
              </div>
            </section>
          `
          : ""
      }
      <section class="stack-tight" id="catalog">
        <div class="section-heading">
          <h2>${search ? `Results for "${escapeHtml(search)}"` : "Products"}</h2>
          <span>${products.length} items</span>
        </div>
        ${productGrid(products)}
      </section>
    `,
  });
}

export function categoryPage({ category, products, cartCount, flash = null }) {
  return layout({
    title: category.name,
    currentPath: "",
    cartCount,
    flash,
    content: `
      <section class="section-heading">
        <div>
          <p class="eyebrow">Category</p>
          <h1>${escapeHtml(category.name)}</h1>
        </div>
        <p class="muted">${escapeHtml(category.description)}</p>
      </section>
      ${productGrid(products)}
    `,
  });
}

function productGrid(products) {
  if (products.length === 0) {
    return `<p class="empty-state">No products found.</p>`;
  }
  return `
    <div class="product-grid">
      ${products
        .map(
          (product) => `
            <article class="product-card">
              <a href="/p/${escapeHtml(product.slug)}" class="product-image-wrap">
                <img src="${escapeHtml(product.image_path || "/images/placeholder.svg")}" alt="" class="product-image">
              </a>
              <div class="product-meta">
                <p class="eyebrow">${escapeHtml(product.category_name)}</p>
                <h3><a href="/p/${escapeHtml(product.slug)}">${escapeHtml(product.name)}</a></h3>
                <p class="muted">${escapeHtml(shortDescription(product.description))}</p>
              </div>
              <div class="product-footer">
                <strong>${formatCurrency(product.price_cents)}</strong>
                <span>${product.inventory_count > 0 ? `${product.inventory_count} in stock` : "Out of stock"}</span>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

const pickupNotice = `
  <p class="pickup-note">
    Pickup only. Pay at pickup.
  </p>
`;

const orderStatusLabels = {
  requested: "Pickup requested",
  ready: "Ready for pickup",
  picked_up: "Picked up/paid",
  cancelled: "Cancelled",
  no_show: "No-show",
};

function orderStatusLabel(status) {
  return orderStatusLabels[status] || status;
}

function inventoryReleaseControl(order) {
  if (order.status === "cancelled" || order.status === "no_show") {
    return order.inventory_released_at
      ? '<p class="muted inventory-release-note">Inventory returned to stock.</p>'
      : "";
  }

  return `
    <label class="inventory-release-control">
      <input type="checkbox" name="returnInventory" checked>
      <span>Return items to stock if cancelled/no-show</span>
    </label>
  `;
}

function orderItemCount(order) {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

function orderItemsList(order) {
  return order.items
    .map(
      (item) =>
        `<li><span>${escapeHtml(item.product_name)} x ${item.quantity}</span><strong>${formatCurrency(
          item.line_total_cents,
        )}</strong></li>`,
    )
    .join("");
}

function orderStatusOptions(statuses, labels, currentStatus) {
  return statuses
    .map(
      (option) =>
        `<option value="${option}"${option === currentStatus ? " selected" : ""}>${labels[option]}</option>`,
    )
    .join("");
}

function orderArchiveForm(order, csrfToken) {
  if (!(order.status === "picked_up" || order.status === "cancelled" || order.status === "no_show")) {
    return "";
  }

  return `
    <form action="/admin/orders/archive" method="post" class="orders-card-actions orders-card-actions-secondary">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="orderNumber" value="${escapeHtml(order.order_number)}">
      <button type="submit" class="button-link">Archive</button>
    </form>
  `;
}

const lowStockThreshold = 5;

function stockState(product) {
  if (product.status !== "active") {
    return { className: "inactive", label: "Inactive", warning: false };
  }
  if (product.inventory_count <= 0) {
    return { className: "out", label: "Out", warning: true };
  }
  if (product.inventory_count <= lowStockThreshold) {
    return { className: "low", label: "Low", warning: true };
  }
  return { className: "ok", label: "OK", warning: false };
}

function adminInventoryWarnings(products) {
  const warnings = products
    .filter((product) => product.status === "active" && product.inventory_count <= lowStockThreshold)
    .sort((a, b) => a.inventory_count - b.inventory_count || a.name.localeCompare(b.name));

  if (warnings.length === 0) {
    return "";
  }

  return `
    <div class="inventory-warnings" aria-label="Inventory warnings">
      <div>
        <p class="eyebrow">Inventory warnings</p>
        <strong>${warnings.length} active product${warnings.length === 1 ? "" : "s"} need attention</strong>
      </div>
      <ul>
        ${warnings
          .map((product) => {
            const state = stockState(product);
            return `
              <li>
                <span>${escapeHtml(product.name)}</span>
                <span class="stock-badge stock-${state.className}">
                  ${product.inventory_count <= 0 ? "Out of stock" : `${product.inventory_count} left`}
                </span>
              </li>
            `;
          })
          .join("")}
      </ul>
    </div>
  `;
}

function orderCard(order) {
  return `
    <button type="button" class="orders-card status-${escapeHtml(order.status)}" data-order-target="${order.id}">
      <span class="orders-card-header">
        <span>
          <strong>${escapeHtml(order.order_number)}</strong>
          <span class="muted">${escapeHtml(order.full_name)}</span>
        </span>
        <span class="orders-card-pill">${formatCurrency(order.total_cents)}</span>
      </span>
      <span class="orders-card-summary compact">
        <span>${orderItemCount(order)} item${orderItemCount(order) === 1 ? "" : "s"}</span>
        ${order.inventory_released_at ? "<span>Inventory returned</span>" : ""}
      </span>
    </button>
  `;
}

function orderDetailPanel(order, statuses, labels, csrfToken) {
  return `
    <article class="order-detail-panel" data-order-detail="${order.id}" hidden>
      <div class="order-detail-heading">
        <p class="eyebrow">Order ${escapeHtml(order.order_number)}</p>
        <h3>${escapeHtml(order.full_name)}</h3>
        <span class="orders-card-pill">${formatCurrency(order.total_cents)}</span>
      </div>
      <dl class="orders-detail-list">
        <div><dt>Status</dt><dd>${escapeHtml(orderStatusLabel(order.status))}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(order.email)}</dd></div>
        <div><dt>Created</dt><dd>${escapeHtml(order.created_at)}</dd></div>
        <div><dt>Items</dt><dd>${orderItemCount(order)}</dd></div>
        ${
          order.inventory_released_at
            ? `<div><dt>Inventory</dt><dd>Returned ${escapeHtml(order.inventory_released_at)}</dd></div>`
            : ""
        }
      </dl>
      <section class="orders-card-block">
        <div class="eyebrow">Pickup details</div>
        <p class="muted preserve">${escapeHtml(order.shipping_address)}</p>
      </section>
      <section class="orders-card-block">
        <div class="eyebrow">Items</div>
        <ul class="summary-items compact-list">${orderItemsList(order)}</ul>
      </section>
      ${
        order.notes
          ? `<section class="orders-card-block"><div class="eyebrow">Notes</div><p class="muted preserve">${escapeHtml(order.notes)}</p></section>`
          : ""
      }
      <form action="/admin/orders" method="post" class="orders-card-actions order-detail-actions">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
        <input type="hidden" name="orderNumber" value="${escapeHtml(order.order_number)}">
        <label>Status
          <select name="status" aria-label="Order status">
            ${orderStatusOptions(statuses, labels, order.status)}
          </select>
        </label>
        <button type="submit" class="orders-action-button">Update</button>
        ${inventoryReleaseControl(order)}
      </form>
      ${orderArchiveForm(order, csrfToken)}
    </article>
  `;
}

function orderConfirmationMessage(order) {
  if (order.status !== "requested") {
    return `
      <p class="pickup-note">
        This pickup order is currently marked ${escapeHtml(orderStatusLabel(order.status))}.
      </p>
    `;
  }

  return `
    <div class="pickup-note">
      <strong>Thanks for your order. It was submitted successfully.</strong>
      <p>
        No online payment was taken. We will confirm the order and pickup details,
        then contact you again when it is ready for pickup. Pay when you pick up.
      </p>
    </div>
  `;
}

export function productPage({ product, cartCount, csrfToken, flash = null }) {
  const backInStockForm =
    product.inventory_count === 0
      ? `
          <section class="notify-panel" aria-labelledby="notify-heading">
            <h2 id="notify-heading">Back in stock alerts</h2>
            <form action="/back-in-stock" method="post" class="notify-form">
              <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
              <input type="hidden" name="productId" value="${product.id}">
              <label class="sr-only" for="notify-email-${product.id}">Email</label>
              <div class="notify-control">
                <input
                  id="notify-email-${product.id}"
                  type="email"
                  name="email"
                  required
                  placeholder="Notify me when these are back in stock"
                >
                <button type="submit" aria-label="Submit back in stock notification">&#10003;</button>
              </div>
            </form>
          </section>
        `
      : "";

  return layout({
    title: product.name,
    currentPath: "",
    cartCount,
    flash,
    content: `
      <article class="product-layout">
        <div class="product-stage">
          <img src="${escapeHtml(product.image_path || "/images/placeholder.svg")}" alt="" class="product-image product-image-large">
        </div>
        <div class="stack-tight">
          <p class="eyebrow"><a href="/c/${escapeHtml(product.category_slug)}">${escapeHtml(product.category_name)}</a></p>
          <p class="muted product-sku">SKU ${escapeHtml(product.sku)}</p>
          <h1>${escapeHtml(product.name)}</h1>
          ${productDescriptionHtml(product.description)}
          <p class="price">${formatCurrency(product.price_cents)}</p>
          ${pickupNotice}
          <p>${product.inventory_count} available</p>
          <form action="/cart/add" method="post" class="cart-form">
            <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
            <input type="hidden" name="productId" value="${product.id}">
            <label>
              Quantity
              <input type="number" name="quantity" min="1" max="${Math.max(product.inventory_count, 1)}" value="1">
            </label>
            <button type="submit"${product.inventory_count === 0 ? " disabled" : ""}>Add to basket</button>
          </form>
          ${backInStockForm}
        </div>
      </article>
    `,
  });
}

export function cartPage({ items, totals, cartCount, csrfToken, flash = null }) {
  return layout({
    title: "Basket",
    currentPath: "/cart",
    cartCount,
    flash,
    content: `
      <section class="section-heading">
        <h1>Basket</h1>
        <span>${cartCount} items</span>
      </section>
      ${
        items.length === 0
          ? '<p class="empty-state">Your basket is empty.</p>'
          : `
            <div class="cart-layout">
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr><th>Item</th><th>Qty</th><th>Total</th><th></th></tr>
                  </thead>
                  <tbody>
                    ${items
                      .map(
                        (item) => `
                          <tr>
                            <td>
                              <strong><a href="/p/${escapeHtml(item.slug)}">${escapeHtml(item.name)}</a></strong>
                              <div class="muted">${escapeHtml(item.sku)}</div>
                            </td>
                            <td>
                              <form action="/cart/update" method="post" class="inline-form">
                                <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
                                <input type="hidden" name="productId" value="${item.id}">
                                <input type="number" name="quantity" min="0" max="${Math.max(item.inventory_count, 1)}" value="${item.quantity}">
                                <button type="submit">Update</button>
                              </form>
                            </td>
                            <td>${formatCurrency(item.lineTotalCents)}</td>
                            <td>
                              <form action="/cart/remove" method="post">
                                <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
                                <input type="hidden" name="productId" value="${item.id}">
                                <button type="submit" class="button-link">Remove</button>
                              </form>
                            </td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
              <aside class="summary-card">
                <h2>Summary</h2>
                ${pickupNotice}
                <dl class="summary-list">
                  <div><dt>Subtotal</dt><dd>${formatCurrency(totals.subtotalCents)}</dd></div>
                  <div><dt>Total</dt><dd>${formatCurrency(totals.totalCents)}</dd></div>
                </dl>
                <a href="/checkout" class="button-primary">Continue to pickup details</a>
              </aside>
            </div>
          `
      }
    `,
  });
}

export function checkoutPage({ items, totals, values, error, cartCount, csrfToken, flash = null }) {
  return layout({
    title: "Pickup Details",
    currentPath: "",
    cartCount,
    flash: error ? { type: "error", message: error } : flash,
    content: `
      <section class="section-heading">
        <h1>Pickup details</h1>
        <span>${cartCount} items</span>
      </section>
      <div class="checkout-layout">
        <form action="/checkout" method="post" class="stack panel">
          <p class="pickup-note">
            Submit pickup details to reserve these items. First-time emails must
            confirm before inventory is reserved. No online payment is taken.
          </p>
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
          <label>Email<input type="email" name="email" required value="${escapeHtml(values.email || "")}"></label>
          <label>Full name<input type="text" name="fullName" required value="${escapeHtml(values.fullName || "")}"></label>
          <label>Phone <span class="muted">(optional)</span><input type="tel" name="phone" value="${escapeHtml(values.phone || "")}"></label>
          <label>Preferred pickup time<input type="text" name="pickupWindow" required placeholder="e.g. Friday after 4, or flexible" value="${escapeHtml(
            values.pickupWindow || "",
          )}"></label>
          <label>Notes<input type="text" name="notes" placeholder="Anything we should know before pickup?" value="${escapeHtml(values.notes || "")}"></label>
          <button type="submit">Submit pickup order</button>
        </form>
        <aside class="summary-card">
          <h2>Pickup order</h2>
          <ul class="summary-items">
            ${items
              .map(
                (item) =>
                  `<li><span>${escapeHtml(item.name)} × ${item.quantity}</span><strong>${formatCurrency(
                    item.lineTotalCents,
                  )}</strong></li>`,
              )
              .join("")}
          </ul>
          <dl class="summary-list">
            <div><dt>Subtotal</dt><dd>${formatCurrency(totals.subtotalCents)}</dd></div>
            <div><dt>Total</dt><dd>${formatCurrency(totals.totalCents)}</dd></div>
          </dl>
        </aside>
      </div>
    `,
  });
}

export function emailVerificationSentPage({ email, expiresMinutes, cartCount, flash = null }) {
  return layout({
    title: "Confirm Pickup Request",
    currentPath: "",
    cartCount,
    flash,
    content: `
      <section class="section-heading">
        <h1>Confirm your pickup request</h1>
        <p class="muted">Check your email to finish placing this order.</p>
      </section>
      <section class="panel narrow-form">
        <p class="pickup-note">
          We sent a confirmation link to ${escapeHtml(email)}. Inventory is not
          reserved until that link is opened.
        </p>
        <p class="muted">
          The link expires in ${expiresMinutes} minutes. No online payment has
          been taken.
        </p>
      </section>
    `,
  });
}

export function emailVerificationErrorPage({ message, cartCount, flash = null }) {
  return layout({
    title: "Confirmation Failed",
    currentPath: "",
    cartCount,
    flash: flash || { type: "error", message },
    content: `
      <section class="section-heading">
        <h1>Confirmation failed</h1>
        <p class="muted">Please place the pickup request again if the link expired.</p>
      </section>
      <section class="panel narrow-form">
        <a href="/cart" class="button-primary">Return to basket</a>
      </section>
    `,
  });
}

export function orderPage({ order, cartCount, title = "Pickup Order", flash = null }) {
  return layout({
    title,
    currentPath: "",
    cartCount,
    flash,
    content: `
      <section class="section-heading">
        <div>
          <p class="eyebrow">Order ${escapeHtml(order.order_number)}</p>
          <h1>${escapeHtml(title)}</h1>
        </div>
        <span>${escapeHtml(orderStatusLabel(order.status))}</span>
      </section>
      <div class="checkout-layout">
        <section class="panel">
          ${orderConfirmationMessage(order)}
          <h2>Items</h2>
          <ul class="summary-items">
            ${order.items
              .map(
                (item) =>
                  `<li><span>${escapeHtml(item.product_name)} × ${item.quantity}</span><strong>${formatCurrency(
                    item.line_total_cents,
                  )}</strong></li>`,
              )
              .join("")}
          </ul>
        </section>
        <aside class="summary-card">
          <h2>Summary</h2>
          <dl class="summary-list">
            <div><dt>Email</dt><dd>${escapeHtml(order.email)}</dd></div>
            <div><dt>Name</dt><dd>${escapeHtml(order.full_name)}</dd></div>
            <div><dt>Total</dt><dd>${formatCurrency(order.total_cents)}</dd></div>
          </dl>
          <div class="eyebrow">Pickup details</div>
          <p class="muted preserve">${escapeHtml(order.shipping_address)}</p>
        </aside>
      </div>
    `,
  });
}

export function orderLookupPage({ cartCount, csrfToken, values = {}, error = null, flash = null }) {
  return layout({
    title: "Check Pickup Order",
    currentPath: "/order-lookup",
    cartCount,
    flash: error ? { type: "error", message: error } : flash,
    content: `
      <section class="section-heading">
        <h1>Check pickup order</h1>
        <p class="muted">Enter your order number and email to view pickup status.</p>
      </section>
      <form action="/order-lookup" method="post" class="panel narrow-form">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
        <label>Order number<input type="text" name="orderNumber" required placeholder="ORD-1234ABCD" value="${escapeHtml(
          values.orderNumber || "",
        )}"></label>
        <label>Email<input type="email" name="email" required value="${escapeHtml(values.email || "")}"></label>
        <button type="submit">Check order</button>
      </form>
    `,
  });
}

export function contactPage({ cartCount, csrfToken, values = {}, error = null, flash = null }) {
  return layout({
    title: "Contact",
    currentPath: "/contact",
    cartCount,
    flash: error ? { type: "error", message: error } : flash,
    content: `
      <section class="section-heading">
        <div>
          <p class="eyebrow">Contact</p>
          <h1>Ask a question</h1>
        </div>
        <p class="muted">Send a note about products, pickup, or anything else.</p>
      </section>
      <div class="checkout-layout">
        <form action="/contact" method="post" class="stack panel">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
          <label>Name <span class="muted">(optional)</span><input type="text" name="name" autocomplete="name" value="${escapeHtml(values.name || "")}"></label>
          <label>Email<input type="email" name="email" autocomplete="email" required value="${escapeHtml(values.email || "")}"></label>
          <label>Subject<input type="text" name="subject" value="${escapeHtml(values.subject || "")}"></label>
          <label>Message<textarea name="message" rows="7" required>${escapeHtml(values.message || "")}</textarea></label>
          <label class="contact-trap" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
          <button type="submit">Send message</button>
        </form>
        <aside class="summary-card">
          <h2>Local pickup store</h2>
          <p class="muted">Questions go straight to the store owner. Order updates still work best through the pickup order status page.</p>
          <a href="/order-lookup" class="button-secondary">Check pickup order</a>
        </aside>
      </div>
    `,
  });
}

export function adminLoginPage({ cartCount, csrfToken, error = null, flash = null }) {
  return layout({
    title: "Admin Login",
    currentPath: "/admin",
    cartCount,
    flash: error ? { type: "error", message: error } : flash,
    content: `
      <section class="section-heading">
        <h1>Admin</h1>
        <p class="muted">Single-password admin for local operation.</p>
      </section>
      <form action="/admin/login" method="post" class="panel narrow-form">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
        <label>Password<input type="password" name="password" required></label>
        <button type="submit">Sign in</button>
      </form>
    `,
  });
}

function adminSectionNav(currentSection) {
  const links = [
    ["/admin/catalog", "Catalog"],
    ["/admin/orders", "Orders"],
  ];
  return `
    <nav class="admin-section-nav" aria-label="Admin sections">
      ${links
        .map(
          ([href, label]) =>
            `<a href="${href}"${currentSection === href ? ' aria-current="page"' : ""}>${label}</a>`,
        )
        .join("")}
    </nav>
  `;
}

function adminPageFrame({
  title,
  cartCount,
  flash,
  csrfToken,
  currentSection,
  content,
  bodyClass = "",
  mainClass = "wrap stack",
}) {
  return layout({
    title,
    currentPath: "/admin",
    cartCount,
    flash,
    bodyClass,
    mainClass,
    content: `
      <section class="section-heading">
        <div class="stack-tight">
          <h1>Admin</h1>
          ${adminSectionNav(currentSection)}
        </div>
        <form action="/admin/logout" method="post">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
          <button type="submit" class="button-link">Log out</button>
        </form>
      </section>
      ${content}
    `,
  });
}

function productImageOptions(productImages, selectedPath = "") {
  const selectedInList = productImages.some((image) => image.path === selectedPath);
  return `
    <option value=""${selectedPath ? "" : " selected"}>No image</option>
    ${
      selectedPath && !selectedInList
        ? `<option value="${escapeHtml(selectedPath)}" selected>${escapeHtml(selectedPath)} (current)</option>`
        : ""
    }
    ${productImages
      .map(
        (image) =>
          `<option value="${escapeHtml(image.path)}"${selectedPath === image.path ? " selected" : ""}>${escapeHtml(
            image.filename,
          )}</option>`,
      )
      .join("")}
  `;
}

function adminImageLibrary(productImages, csrfToken) {
  if (productImages.length === 0) {
    return '<p class="empty-state">No product images uploaded yet.</p>';
  }

  return `
    <div class="admin-image-grid">
      ${productImages
        .map(
          (image) => `
            <figure class="admin-image-tile">
              <div class="admin-image-preview">
                <img src="${escapeHtml(image.path)}" alt="">
                <form action="/admin/images/delete" method="post" data-confirm="Delete this image? Products using this image must be changed first.">
                  <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
                  <input type="hidden" name="imagePath" value="${escapeHtml(image.path)}">
                  <button type="submit" class="admin-image-delete" aria-label="Delete ${escapeHtml(image.filename)}">x</button>
                </form>
              </div>
              <figcaption>${escapeHtml(image.filename)}</figcaption>
            </figure>
          `,
        )
        .join("")}
    </div>
  `;
}

export function adminCatalogPage({
  cartCount,
  products,
  categories,
  productImages = [],
  imageUploadMaxMegabytes = 5,
  editingProduct,
  editingCategory,
  flash,
  csrfToken,
}) {
  return adminPageFrame({
    title: "Admin Catalog",
    cartCount,
    flash,
    csrfToken,
    currentSection: "/admin/catalog",
    content: `
      <div class="admin-grid">
        <section class="panel admin-products-panel">
          <h2>Products</h2>
          ${adminInventoryWarnings(products)}
          <div class="table-wrap">
            <table class="data-table admin-products-table">
              <thead><tr><th>Name</th><th>SKU</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                ${products
                  .map((product) => {
                    const state = stockState(product);
                    return `
                      <tr>
                        <td class="product-name-cell">${escapeHtml(product.name)}</td>
                        <td class="sku-cell">${escapeHtml(product.sku)}</td>
                        <td class="money-cell">${formatCurrency(product.price_cents)}</td>
                        <td class="stock-table-cell">
                          <span class="stock-cell">
                            <span>${product.inventory_count}</span>
                            ${
                              state.warning
                                ? `<span class="stock-badge stock-${state.className}">${escapeHtml(state.label)}</span>`
                                : ""
                            }
                          </span>
                        </td>
                        <td class="status-cell">${escapeHtml(product.status)}</td>
                        <td class="actions-cell">
                          <div class="admin-actions">
                            <a href="/admin/catalog?product=${product.id}">Edit</a>
                            <form action="/admin/products/delete" method="post" data-confirm="Delete this product?">
                              <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
                              <input type="hidden" name="id" value="${product.id}">
                              <button type="submit" class="button-link">Delete</button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel admin-product-form-panel">
          <div class="section-heading">
            <h2>${editingProduct ? "Edit product" : "New product"}</h2>
            ${editingProduct ? '<a href="/admin/catalog">Create new</a>' : ""}
          </div>
          <form action="/admin/products" method="post" class="stack">
            <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
            <input type="hidden" name="id" value="${escapeHtml(editingProduct?.id || "")}">
            <label>Name<input type="text" name="name" required value="${escapeHtml(editingProduct?.name || "")}"></label>
            ${
              editingProduct
                ? `<label>SKU<input type="text" name="sku" value="${escapeHtml(editingProduct.sku || "")}" readonly></label>`
                : `<div class="field-note">SKU will be assigned automatically when you create the product.</div>`
            }
            <label>Category
              <select name="categoryId" required>
                ${categories
                  .map(
                    (category) =>
                      `<option value="${category.id}"${
                        Number(editingProduct?.category_id) === category.id ? " selected" : ""
                      }>${escapeHtml(category.name)}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label>Price<input type="text" name="price" required value="${
              editingProduct ? (editingProduct.price_cents / 100).toFixed(2) : ""
            }"></label>
            <label>Inventory<input type="number" name="inventoryCount" min="0" required value="${escapeHtml(
              editingProduct?.inventory_count || 0,
            )}"></label>
            <label>Status
              <select name="status">
                ${["active", "draft", "archived"]
                  .map(
                    (status) =>
                      `<option value="${status}"${
                        editingProduct?.status === status ? " selected" : ""
                      }>${status}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label>Image
              <select name="imagePath">
                ${productImageOptions(productImages, editingProduct?.image_path || "")}
              </select>
            </label>
            <p class="muted field-note">Upload product photos below, then choose one here. Uploads are automatically resized and saved as web JPEGs.</p>
            <label>Long description<textarea name="description" rows="6">${escapeHtml(
              editingProduct?.description || "",
            )}</textarea></label>
            <p class="muted field-note">The catalog page uses the first paragraph as the short description. The full text appears on the product page.</p>
            <div class="admin-actions">
              <button type="submit">${editingProduct ? "Update product" : "Create product"}</button>
              ${editingProduct ? '<a href="/admin/catalog" class="button-secondary">Cancel</a>' : ""}
            </div>
          </form>
        </section>
        <section class="panel admin-image-panel">
          <h2>Product images</h2>
          <form action="/admin/images" method="post" enctype="multipart/form-data" class="stack">
            <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
            <div class="file-field">
              <label for="admin-image-upload">Upload image</label>
              <input id="admin-image-upload" type="file" name="image" accept="image/*" required>
            </div>
            <p class="muted field-note">Max ${imageUploadMaxMegabytes} MB. Large photos are resized automatically; originals are not kept.</p>
            <button type="submit">Upload image</button>
          </form>
          ${adminImageLibrary(productImages, csrfToken)}
        </section>
        <section class="panel admin-category-panel">
          <div class="section-heading">
            <h2>${editingCategory ? "Edit category" : "New category"}</h2>
            ${editingCategory ? '<a href="/admin/catalog">Create new</a>' : ""}
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Name</th><th>Slug</th><th>Actions</th></tr></thead>
              <tbody>
                ${categories
                  .map(
                    (category) => `
                      <tr>
                        <td>${escapeHtml(category.name)}</td>
                        <td>${escapeHtml(category.slug)}</td>
                        <td>
                          <div class="admin-actions">
                            <a href="/admin/catalog?category=${category.id}">Edit</a>
                            <form action="/admin/categories/delete" method="post" data-confirm="Delete this category?">
                              <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
                              <input type="hidden" name="id" value="${category.id}">
                              <button type="submit" class="button-link">Delete</button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          <form action="/admin/categories" method="post" class="stack">
            <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
            <input type="hidden" name="id" value="${escapeHtml(editingCategory?.id || "")}">
            <label>Name<input type="text" name="name" required value="${escapeHtml(editingCategory?.name || "")}"></label>
            <label>Description<input type="text" name="description" value="${escapeHtml(
              editingCategory?.description || "",
            )}"></label>
            <div class="admin-actions">
              <button type="submit">${editingCategory ? "Update category" : "Create category"}</button>
              ${editingCategory ? '<a href="/admin/catalog" class="button-secondary">Cancel</a>' : ""}
            </div>
          </form>
        </section>
      </div>
    `,
  });
}

export function adminOrdersPage({ cartCount, orders, archivedOrders, flash, csrfToken }) {
  const statuses = ["requested", "ready", "picked_up", "cancelled", "no_show"];
  const labels = orderStatusLabels;

  return adminPageFrame({
    title: "Admin Orders",
    cartCount,
    flash,
    csrfToken,
    currentSection: "/admin/orders",
    bodyClass: "admin-orders-body",
    mainClass: "admin-orders-main stack",
    content: `
      <section class="stack-tight orders-board-page">
        <div class="section-heading">
          <h2>Orders</h2>
          <span>${orders.length} total</span>
        </div>
        <div class="orders-board-wrap">
        <div class="orders-board">
          ${statuses
            .map((status) => {
              const bucket = orders.filter((order) => order.status === status);
              return `
                <section class="orders-col status-${escapeHtml(status)}">
                  <header class="orders-col-header">
                    <h3>${labels[status]}</h3>
                    <span class="orders-col-count">${bucket.length}</span>
                  </header>
                  <div class="orders-list">
                    ${
                      bucket.length === 0
                        ? '<p class="empty-state">No orders in this stage.</p>'
                        : bucket.map((order) => orderCard(order)).join("")
                    }
                  </div>
                </section>
              `;
            })
            .join("")}
        </div>
        </div>
        <aside id="orderDetailSidebar" class="orders-detail-sidebar" role="dialog" aria-label="Order details" aria-hidden="true">
          <button type="button" class="orders-detail-close" data-order-sidebar-close aria-label="Close order details">x</button>
          <div class="orders-detail-empty">
            <h3>Order details</h3>
            <p class="muted">Select an order card to view details and update status.</p>
          </div>
          ${orders.map((order) => orderDetailPanel(order, statuses, labels, csrfToken)).join("")}
        </aside>
        <section class="panel archived-orders-panel">
          <div class="section-heading">
            <h2>Archived</h2>
            <span>${archivedOrders.length} total</span>
          </div>
          ${
            archivedOrders.length === 0
              ? '<p class="empty-state">No archived orders.</p>'
              : `
                <div class="table-wrap">
                  <table class="data-table">
                    <thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Archived</th><th></th></tr></thead>
                    <tbody>
                      ${archivedOrders
                        .map(
                          (order) => `
                            <tr>
                              <td>
                                <strong>${escapeHtml(order.order_number)}</strong>
                                <div class="muted">${escapeHtml(order.full_name)}</div>
                              </td>
                              <td>${escapeHtml(orderStatusLabel(order.status))}</td>
                              <td>${formatCurrency(order.total_cents)}</td>
                              <td>${escapeHtml(order.archived_at || "")}</td>
                              <td>
                                <form action="/admin/orders/unarchive" method="post">
                                  <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
                                  <input type="hidden" name="orderNumber" value="${escapeHtml(order.order_number)}">
                                  <button type="submit" class="button-link">Restore</button>
                                </form>
                              </td>
                            </tr>
                          `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              `
          }
        </section>
      </section>
    `,
  });
}
