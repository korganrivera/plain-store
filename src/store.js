import crypto from "node:crypto";
import { db, runInTransaction } from "./db.js";

function positiveIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const contactVerificationDays = positiveIntEnv("CONTACT_VERIFICATION_DAYS", 90);
const orderConfirmationMinutes = positiveIntEnv("ORDER_CONFIRMATION_MINUTES", 30);

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sqliteDateTimeFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function sqliteDateTimeToMs(value) {
  return new Date(`${String(value).replace(" ", "T")}Z`).getTime();
}

function toSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function skuPrefixForCategory(categoryId) {
  const category = db.prepare("SELECT slug FROM categories WHERE id = ?").get(categoryId);
  if (!category) {
    throw new Error("Choose a valid category.");
  }

  const letters = category.slug.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (letters.slice(0, 3) || "PRD").padEnd(3, "X");
}

function generateSku(categoryId) {
  const prefix = skuPrefixForCategory(categoryId);
  const rows = db
    .prepare("SELECT sku FROM products WHERE sku LIKE ? ORDER BY sku")
    .all(`${prefix}-%`);

  let maxSequence = 0;
  for (const row of rows) {
    const match = /^([A-Z0-9]{3})-(\d+)$/.exec(row.sku);
    if (match && match[1] === prefix) {
      maxSequence = Math.max(maxSequence, Number.parseInt(match[2], 10));
    }
  }

  return `${prefix}-${String(maxSequence + 1).padStart(3, "0")}`;
}

export function listCategories() {
  return db
    .prepare("SELECT id, slug, name, description FROM categories ORDER BY sort_order, name")
    .all();
}

export function listStorefrontCategories() {
  return db
    .prepare(`
      SELECT c.id, c.slug, c.name, c.description
      FROM categories c
      WHERE EXISTS (
        SELECT 1
        FROM products p
        WHERE p.category_id = c.id
          AND p.status = 'active'
      )
      ORDER BY c.sort_order, c.name
    `)
    .all();
}

export function getCategoryBySlug(slug) {
  return db
    .prepare("SELECT id, slug, name, description FROM categories WHERE slug = ?")
    .get(slug);
}

export function getCategoryById(id) {
  return db
    .prepare("SELECT id, slug, name, description FROM categories WHERE id = ?")
    .get(id);
}

export function listProducts({ categorySlug = null, search = "", includeInactive = false } = {}) {
  const filters = [];
  const params = {};
  if (!includeInactive) {
    filters.push("p.status = 'active'");
  }
  if (categorySlug) {
    filters.push("c.slug = @categorySlug");
    params.categorySlug = categorySlug;
  }
  if (search) {
    filters.push("(p.name LIKE @search OR p.description LIKE @search OR p.sku LIKE @search)");
    params.search = `%${search}%`;
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return db
    .prepare(`
      SELECT
        p.id,
        p.slug,
        p.name,
        p.sku,
        p.description,
        p.price_cents,
        p.inventory_count,
        p.status,
        p.image_path,
        c.slug AS category_slug,
        c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      ${where}
      ORDER BY c.sort_order, p.name
    `)
    .all(params);
}

export function getProductBySlug(slug, { includeInactive = false } = {}) {
  const statusClause = includeInactive ? "" : "AND p.status = 'active'";
  return db
    .prepare(`
      SELECT
        p.id,
        p.slug,
        p.name,
        p.sku,
        p.description,
        p.price_cents,
        p.inventory_count,
        p.status,
        p.image_path,
        c.id AS category_id,
        c.slug AS category_slug,
        c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.slug = ? ${statusClause}
    `)
    .get(slug);
}

export function getProductById(id) {
  return db
    .prepare(`
      SELECT
        p.id,
        p.slug,
        p.name,
        p.sku,
        p.description,
        p.price_cents,
        p.inventory_count,
        p.status,
        p.image_path,
        p.category_id,
        c.slug AS category_slug,
        c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
    `)
    .get(id);
}

export function getCartProducts(productIds) {
  if (productIds.length === 0) {
    return [];
  }
  const placeholders = productIds.map(() => "?").join(", ");
  return db
    .prepare(`
      SELECT id, slug, name, sku, price_cents, inventory_count, image_path, status
      FROM products
      WHERE id IN (${placeholders})
    `)
    .all(...productIds);
}

export function createOrder({ email, fullName, pickupDetails, postalCode, notes, items }) {
  const readProduct = db.prepare(
    "SELECT id, name, sku, price_cents, inventory_count, status FROM products WHERE id = ?",
  );
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      order_number, email, full_name, shipping_address, postal_code, status,
      subtotal_cents, shipping_cents, total_cents, notes
    ) VALUES (
      @order_number, @email, @full_name, @shipping_address, @postal_code, 'requested',
      @subtotal_cents, @shipping_cents, @total_cents, @notes
    )
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (
      order_id, product_id, product_name, sku, quantity, unit_price_cents, line_total_cents
    ) VALUES (
      @order_id, @product_id, @product_name, @sku, @quantity, @unit_price_cents, @line_total_cents
    )
  `);
  const updateInventory = db.prepare(
    "UPDATE products SET inventory_count = inventory_count - @quantity WHERE id = @product_id",
  );

  return runInTransaction(() => {
    const expandedItems = [];
    let subtotalCents = 0;

    for (const item of items) {
      const product = readProduct.get(item.productId);
      if (!product || product.status !== "active") {
        throw new Error("One or more items are unavailable.");
      }
      if (product.inventory_count < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}.`);
      }
      const lineTotal = product.price_cents * item.quantity;
      subtotalCents += lineTotal;
      expandedItems.push({
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unit_price_cents: product.price_cents,
        line_total_cents: lineTotal,
      });
    }

    const shippingCents = 0;
    const totalCents = subtotalCents + shippingCents;
    const orderNumber = `ORD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const orderResult = insertOrder.run({
      order_number: orderNumber,
      email,
      full_name: fullName,
      shipping_address: pickupDetails,
      postal_code: postalCode,
      subtotal_cents: subtotalCents,
      shipping_cents: shippingCents,
      total_cents: totalCents,
      notes,
    });

    for (const item of expandedItems) {
      insertItem.run({ order_id: orderResult.lastInsertRowid, ...item });
      updateInventory.run({ product_id: item.product_id, quantity: item.quantity });
    }

    return getOrderByNumber(orderNumber);
  });
}

export function isContactVerified(email) {
  const contact = db
    .prepare("SELECT last_verified_at, last_order_at FROM verified_contacts WHERE email = ?")
    .get(email.toLowerCase());
  if (!contact?.last_verified_at) {
    return false;
  }

  const verifiedAt = sqliteDateTimeToMs(contact.last_verified_at);
  const orderedAt = contact.last_order_at ? sqliteDateTimeToMs(contact.last_order_at) : 0;
  if (!Number.isFinite(verifiedAt)) {
    return false;
  }
  const latestKnownActivity = Number.isFinite(orderedAt) ? Math.max(verifiedAt, orderedAt) : verifiedAt;

  return Date.now() - latestKnownActivity <= contactVerificationDays * 24 * 60 * 60 * 1000;
}

export function recordContactOrder(email) {
  db.prepare(`
    INSERT INTO verified_contacts (email, first_verified_at, last_verified_at, last_order_at, order_count)
    VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
    ON CONFLICT(email) DO UPDATE SET
      last_order_at = CURRENT_TIMESTAMP,
      order_count = order_count + 1
  `).run(email.toLowerCase());
}

export function createPendingOrderConfirmation({
  email,
  fullName,
  pickupDetails,
  postalCode,
  notes,
  items,
  requestIp = "",
}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = sqliteDateTimeFromNow(orderConfirmationMinutes);
  db.prepare("DELETE FROM pending_order_confirmations WHERE expires_at < CURRENT_TIMESTAMP OR used_at IS NOT NULL").run();
  db.prepare(`
    INSERT INTO pending_order_confirmations (
      token_hash, email, full_name, shipping_address, postal_code, notes,
      items_json, request_ip, expires_at
    ) VALUES (
      @token_hash, @email, @full_name, @shipping_address, @postal_code, @notes,
      @items_json, @request_ip, @expires_at
    )
  `).run({
    token_hash: tokenHash(token),
    email: email.toLowerCase(),
    full_name: fullName,
    shipping_address: pickupDetails,
    postal_code: postalCode,
    notes,
    items_json: JSON.stringify(items),
    request_ip: requestIp,
    expires_at: expiresAt,
  });

  return {
    token,
    email: email.toLowerCase(),
    full_name: fullName,
    shipping_address: pickupDetails,
    notes,
    expires_at: expiresAt,
    expiresMinutes: orderConfirmationMinutes,
  };
}

export function confirmPendingOrder(token) {
  const hash = tokenHash(token);
  return runInTransaction(() => {
    const pending = db
      .prepare(`
        SELECT id, email, full_name, shipping_address, postal_code, notes, items_json
        FROM pending_order_confirmations
        WHERE token_hash = ?
          AND used_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
      `)
      .get(hash);

    if (!pending) {
      throw new Error("This confirmation link is invalid or expired.");
    }

    let items;
    try {
      items = JSON.parse(pending.items_json);
    } catch {
      throw new Error("This confirmation link could not be read. Please place the pickup request again.");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("This confirmation link has no items. Please place the pickup request again.");
    }

    const order = createOrder({
      email: pending.email,
      fullName: pending.full_name,
      pickupDetails: pending.shipping_address,
      postalCode: pending.postal_code,
      notes: pending.notes,
      items,
    });

    db.prepare("UPDATE pending_order_confirmations SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(pending.id);
    db.prepare(`
      INSERT INTO verified_contacts (email, first_verified_at, last_verified_at, last_order_at, order_count)
      VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
      ON CONFLICT(email) DO UPDATE SET
        last_verified_at = CURRENT_TIMESTAMP,
        last_order_at = CURRENT_TIMESTAMP,
        order_count = order_count + 1
    `).run(pending.email);

    return order;
  });
}

export function getOrderByNumber(orderNumber) {
  const order = db
    .prepare(`
      SELECT
        id, order_number, email, full_name, shipping_address, postal_code, status, archived_at,
        subtotal_cents, shipping_cents, total_cents, notes, created_at
      FROM orders
      WHERE order_number = ?
    `)
    .get(orderNumber);

  if (!order) {
    return null;
  }

  const items = db
    .prepare(`
      SELECT product_id, product_name, sku, quantity, unit_price_cents, line_total_cents
      FROM order_items
      WHERE order_id = ?
      ORDER BY id
    `)
    .all(order.id);

  return { ...order, items };
}

export function lookupOrder(orderNumber, email) {
  const order = getOrderByNumber(orderNumber);
  if (!order) {
    return null;
  }
  return order.email.toLowerCase() === email.toLowerCase() ? order : null;
}

export function listOrders({ includeArchived = false } = {}) {
  const archiveClause = includeArchived ? "" : "WHERE archived_at IS NULL";
  const orders = db
    .prepare(`
      SELECT
        id,
        order_number,
        email,
        full_name,
        shipping_address,
        postal_code,
        status,
        archived_at,
        subtotal_cents,
        shipping_cents,
        total_cents,
        notes,
        created_at
      FROM orders
      ${archiveClause}
      ORDER BY created_at DESC, id DESC
    `)
    .all();

  if (orders.length === 0) {
    return [];
  }

  const items = db
    .prepare(`
      SELECT
        order_id,
        product_name,
        sku,
        quantity,
        line_total_cents
      FROM order_items
      WHERE order_id IN (${orders.map(() => "?").join(", ")})
      ORDER BY order_id, id
    `)
    .all(...orders.map((order) => order.id));

  const itemsByOrderId = new Map();
  for (const item of items) {
    const bucket = itemsByOrderId.get(item.order_id) || [];
    bucket.push(item);
    itemsByOrderId.set(item.order_id, bucket);
  }

  return orders.map((order) => ({
    ...order,
    items: itemsByOrderId.get(order.id) || [],
  }));
}

export function upsertCategory({ id = null, name, description }) {
  const slug = toSlug(name);
  if (!slug) {
    throw new Error("Category name is required.");
  }

  if (id) {
    db.prepare("UPDATE categories SET name = ?, slug = ?, description = ? WHERE id = ?").run(
      name,
      slug,
      description,
      id,
    );
    return id;
  }

  const result = db
    .prepare("INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)")
    .run(name, slug, description);
  return result.lastInsertRowid;
}

export function deleteCategory(id) {
  const existing = db.prepare("SELECT id FROM categories WHERE id = ?").get(id);
  if (!existing) {
    throw new Error("Category not found.");
  }

  const productUsage = db
    .prepare("SELECT COUNT(*) AS count FROM products WHERE category_id = ?")
    .get(id);
  if (productUsage.count > 0) {
    throw new Error("This category still has products. Move or delete those products first.");
  }

  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
}

export function upsertProduct(input) {
  const slug = toSlug(input.name);
  if (!slug) {
    throw new Error("Product name is required.");
  }
  const categoryId = Number(input.categoryId);
  const generatedSku = generateSku(categoryId);
  const payload = {
    category_id: categoryId,
    slug,
    name: input.name,
    sku: input.sku || generatedSku,
    description: input.description,
    price_cents: Number(input.priceCents),
    inventory_count: Number(input.inventoryCount),
    status: input.status,
    image_path: input.imagePath,
  };

  if (input.id) {
    const existing = db.prepare("SELECT sku FROM products WHERE id = ?").get(Number(input.id));
    if (!existing) {
      throw new Error("Product not found.");
    }
    payload.sku = input.sku || existing.sku;
    db.prepare(`
      UPDATE products
      SET category_id = @category_id, slug = @slug, name = @name, sku = @sku,
          description = @description, price_cents = @price_cents,
          inventory_count = @inventory_count, status = @status, image_path = @image_path
      WHERE id = @id
    `).run({ ...payload, id: Number(input.id) });
    return Number(input.id);
  }

  const result = db.prepare(`
    INSERT INTO products (
      category_id, slug, name, sku, description, price_cents, inventory_count, status, image_path
    ) VALUES (
      @category_id, @slug, @name, @sku, @description, @price_cents, @inventory_count, @status, @image_path
    )
  `).run(payload);
  return result.lastInsertRowid;
}

export function deleteProduct(id) {
  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
  if (!existing) {
    throw new Error("Product not found.");
  }

  const orderUsage = db
    .prepare("SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?")
    .get(id);
  if (orderUsage.count > 0) {
    throw new Error("This product is already referenced by orders. Change its status instead of deleting it.");
  }

  db.prepare("DELETE FROM products WHERE id = ?").run(id);
}

export function updateOrderStatus(orderNumber, status) {
  db.prepare("UPDATE orders SET status = ? WHERE order_number = ?").run(status, orderNumber);
}

export function archiveOrder(orderNumber) {
  db.prepare(`
    UPDATE orders
    SET archived_at = CURRENT_TIMESTAMP
    WHERE order_number = ? AND status IN ('cancelled', 'no_show')
  `).run(orderNumber);
}

export function unarchiveOrder(orderNumber) {
  db.prepare("UPDATE orders SET archived_at = NULL WHERE order_number = ?").run(orderNumber);
}
