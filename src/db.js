import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = path.resolve("data");
const dbPath = path.join(dataDir, "store.db");
let transactionDepth = 0;

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function seedIfEmpty(db) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
  if (count > 0) {
    return;
  }

  const insertCategory = db.prepare(
    "INSERT OR IGNORE INTO categories (slug, name, description, sort_order) VALUES (?, ?, ?, ?)",
  );
  const readCategoryId = db.prepare("SELECT id FROM categories WHERE slug = ?");
  const insertProduct = db.prepare(`
    INSERT INTO products (
      category_id, slug, name, sku, description, price_cents, inventory_count, status, image_path
    ) VALUES (
      @category_id, @slug, @name, @sku, @description, @price_cents, @inventory_count, @status, @image_path
    )
  `);

  const categories = [
    ["desk-tools", "Desk Tools", "Compact tools and accessories for focused work.", 1],
    ["carry", "Carry", "Simple, durable everyday carry goods.", 2],
    ["paper", "Paper", "Paper goods that stay out of the way.", 3],
  ];

  const categoryIds = new Map();
  for (const category of categories) {
    insertCategory.run(...category);
    categoryIds.set(category[0], readCategoryId.get(category[0]).id);
  }

  const products = [
    {
      category_id: categoryIds.get("desk-tools"),
      slug: "aluminum-ruler",
      name: "Aluminum Ruler",
      sku: "DST-001",
      description: "Solid 30 cm ruler with etched markings and a matte finish.",
      price_cents: 1800,
      inventory_count: 42,
      status: "active",
      image_path: "/images/aluminum-ruler.svg",
    },
    {
      category_id: categoryIds.get("desk-tools"),
      slug: "brass-bookmark",
      name: "Brass Bookmark",
      sku: "DST-002",
      description: "Thin brass bookmark that ages well and does one job cleanly.",
      price_cents: 1200,
      inventory_count: 65,
      status: "active",
      image_path: "/images/brass-bookmark.svg",
    },
    {
      category_id: categoryIds.get("carry"),
      slug: "utility-pouch",
      name: "Utility Pouch",
      sku: "CAR-001",
      description: "Waxed canvas pouch sized for cables, tools, and notebooks.",
      price_cents: 3400,
      inventory_count: 18,
      status: "active",
      image_path: "/images/utility-pouch.svg",
    },
    {
      category_id: categoryIds.get("paper"),
      slug: "grid-notebook",
      name: "Grid Notebook",
      sku: "PPR-001",
      description: "A5 notebook with stitched binding and quiet grid pages.",
      price_cents: 1400,
      inventory_count: 90,
      status: "active",
      image_path: "/images/grid-notebook.svg",
    },
  ];

  runInTransaction(() => {
    for (const row of products) {
      insertProduct.run(row);
    }
  });
}

function applySchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      inventory_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
      image_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'ready', 'picked_up', 'cancelled', 'no_show')),
      archived_at TEXT,
      inventory_released_at TEXT,
      subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
      shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
    );

    CREATE TABLE IF NOT EXISTS verified_contacts (
      email TEXT PRIMARY KEY,
      first_verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_order_at TEXT,
      order_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pending_order_confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      postal_code TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL,
      request_ip TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS back_in_stock_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notified_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pending_order_confirmations_email_created_at ON pending_order_confirmations(email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pending_order_confirmations_expires_at ON pending_order_confirmations(expires_at);
    CREATE INDEX IF NOT EXISTS idx_back_in_stock_requests_product_pending ON back_in_stock_requests(product_id, notified_at, requested_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_back_in_stock_requests_open_email ON back_in_stock_requests(product_id, email) WHERE notified_at IS NULL;

    CREATE TRIGGER IF NOT EXISTS products_updated_at
    AFTER UPDATE ON products
    FOR EACH ROW
    BEGIN
      UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;
  `);

  const ordersColumns = db.prepare("PRAGMA table_info(orders)").all();
  if (!ordersColumns.some((column) => column.name === "archived_at")) {
    db.exec("ALTER TABLE orders ADD COLUMN archived_at TEXT;");
  }
  if (!ordersColumns.some((column) => column.name === "inventory_released_at")) {
    db.exec("ALTER TABLE orders ADD COLUMN inventory_released_at TEXT;");
  }
  migrateOrderStatuses(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_orders_archived_at ON orders(archived_at);");
}

function migrateOrderStatuses(db) {
  const ordersSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'")
    .get();

  if (
    !ordersSchema?.sql ||
    (!ordersSchema.sql.includes("'packed'") &&
      !ordersSchema.sql.includes("'shipped'") &&
      !ordersSchema.sql.includes("'paid'"))
  ) {
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;

    ALTER TABLE orders RENAME TO orders_old_status_migration;
    ALTER TABLE order_items RENAME TO order_items_old_status_migration;

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'ready', 'picked_up', 'cancelled', 'no_show')),
      archived_at TEXT,
      inventory_released_at TEXT,
      subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
      shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
    );

    INSERT INTO orders (
      id, order_number, email, full_name, shipping_address, postal_code, status,
      archived_at, inventory_released_at, subtotal_cents, shipping_cents, total_cents, notes, created_at
    )
    SELECT
      id,
      order_number,
      email,
      full_name,
      shipping_address,
      postal_code,
      CASE status
        WHEN 'paid' THEN 'picked_up'
        WHEN 'packed' THEN 'ready'
        WHEN 'shipped' THEN 'picked_up'
        ELSE status
      END,
      archived_at,
      NULL,
      subtotal_cents,
      shipping_cents,
      total_cents,
      notes,
      created_at
    FROM orders_old_status_migration;

    INSERT INTO order_items (
      id, order_id, product_id, product_name, sku, quantity, unit_price_cents, line_total_cents
    )
    SELECT
      id, order_id, product_id, product_name, sku, quantity, unit_price_cents, line_total_cents
    FROM order_items_old_status_migration;

    DROP TABLE order_items_old_status_migration;
    DROP TABLE orders_old_status_migration;

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

ensureDataDir();
const db = new DatabaseSync(dbPath);
applySchema(db);
seedIfEmpty(db);

export function runInTransaction(work) {
  if (transactionDepth > 0) {
    return work();
  }

  transactionDepth += 1;
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    transactionDepth -= 1;
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    transactionDepth -= 1;
    throw error;
  }
}

export { db, dbPath };
