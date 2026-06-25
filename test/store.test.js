import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-store-test-"));
process.chdir(tempDir);
process.env.DB_PATH = path.join(tempDir, "data", "store.db");
process.env.COOKIE_SECRET = "test-cookie-secret";

const store = await import(pathToFileURL(path.join(repoRoot, "src/store.js")));
const { db } = await import(pathToFileURL(path.join(repoRoot, "src/db.js")));

function resetOperationalData() {
  db.exec(`
    DELETE FROM back_in_stock_requests;
    DELETE FROM pending_back_in_stock_confirmations;
    DELETE FROM pending_order_confirmations;
    DELETE FROM verified_contacts;
    DELETE FROM order_items;
    DELETE FROM orders;
    UPDATE products
    SET inventory_count = 4, status = 'active'
    WHERE id = 1;
  `);
}

function firstProduct() {
  return db.prepare("SELECT id, name, price_cents, inventory_count, status FROM products WHERE id = 1").get();
}

function setFirstProductOutOfStock() {
  db.exec("UPDATE products SET inventory_count = 0, status = 'active' WHERE id = 1;");
}

function openBackInStockRequests(email) {
  return db
    .prepare("SELECT product_id, email, notified_at FROM back_in_stock_requests WHERE email = ? ORDER BY id")
    .all(email.toLowerCase());
}

function orderInput(quantity = 1) {
  return {
    email: "buyer@example.com",
    fullName: "Test Buyer",
    pickupDetails: "Pickup: flexible",
    postalCode: "",
    notes: "test order",
    items: [{ productId: 1, quantity }],
  };
}

test("seed catalog starts with the live egg product", () => {
  const products = store.listProducts();
  assert.equal(products.length, 1);
  assert.equal(products[0].slug, "fresh-eggs-1-dozen");
  assert.equal(products[0].name, "Fresh Eggs - 1 dozen");
  assert.equal(products[0].price_cents, 400);
  assert.equal(products[0].inventory_count, 4);
});

test("createOrder reserves inventory and records order items", () => {
  resetOperationalData();

  const order = store.createOrder(orderInput(2));
  const product = firstProduct();

  assert.equal(order.status, "requested");
  assert.match(order.status_token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(order.total_cents, 800);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].quantity, 2);
  assert.equal(store.getOrderByStatusToken(order.status_token).order_number, order.order_number);
  assert.equal(store.getOrderByNumber(order.order_number).status_token, undefined);
  assert.equal(product.inventory_count, 2);
});

test("createOrder rejects insufficient stock without changing inventory", () => {
  resetOperationalData();

  assert.throws(() => store.createOrder(orderInput(5)), /Insufficient stock/);
  assert.equal(firstProduct().inventory_count, 4);
  assert.equal(store.listOrders().length, 0);
});

test("pending confirmation creates order once and verifies contact", () => {
  resetOperationalData();

  const pending = store.createPendingOrderConfirmation({
    ...orderInput(1),
    requestIp: "127.0.0.1",
  });
  const order = store.confirmPendingOrder(pending.token);

  assert.equal(order.email, "buyer@example.com");
  assert.match(order.status_token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(store.getOrderByStatusToken(order.status_token).order_number, order.order_number);
  assert.equal(firstProduct().inventory_count, 3);
  assert.equal(store.isContactVerified("buyer@example.com"), true);
  assert.throws(() => store.confirmPendingOrder(pending.token), /invalid or expired/);
});

test("back-in-stock requests require confirmation before unverified emails enter the queue", () => {
  resetOperationalData();
  setFirstProductOutOfStock();

  const pending = store.createPendingBackInStockConfirmation({
    productId: 1,
    email: "notify@example.com",
    requestIp: "127.0.0.1",
  });

  assert.equal(pending.email, "notify@example.com");
  assert.equal(pending.product.slug, "fresh-eggs-1-dozen");
  assert.deepEqual(openBackInStockRequests("notify@example.com"), []);

  const request = store.confirmPendingBackInStockNotification(pending.token);

  assert.equal(request.created, true);
  assert.equal(request.product.slug, "fresh-eggs-1-dozen");
  assert.equal(store.isContactVerified("notify@example.com"), true);
  assert.equal(openBackInStockRequests("notify@example.com").length, 1);
  assert.throws(() => store.confirmPendingBackInStockNotification(pending.token), /invalid or expired/);
});

test("verified contacts can join the back-in-stock queue directly", () => {
  resetOperationalData();
  setFirstProductOutOfStock();
  store.recordContactOrder("verified@example.com");

  assert.equal(store.isContactVerified("verified@example.com"), true);
  const request = store.requestBackInStockNotification(1, "verified@example.com");

  assert.equal(request.created, true);
  assert.equal(openBackInStockRequests("verified@example.com").length, 1);
});

test("releaseOrderInventory restores inventory once", () => {
  resetOperationalData();
  const order = store.createOrder(orderInput(2));

  const firstRelease = store.releaseOrderInventory(order.order_number);
  const secondRelease = store.releaseOrderInventory(order.order_number);

  assert.equal(firstRelease.restoredCount, 2);
  assert.equal(secondRelease.alreadyReleased, true);
  assert.equal(firstProduct().inventory_count, 4);
});

test("archive and unarchive only affect completed terminal orders", () => {
  resetOperationalData();
  const order = store.createOrder(orderInput(1));

  store.archiveOrder(order.order_number);
  assert.equal(store.getOrderByNumber(order.order_number).archived_at, null);

  store.updateOrderStatus(order.order_number, "cancelled");
  store.archiveOrder(order.order_number);
  assert.notEqual(store.getOrderByNumber(order.order_number).archived_at, null);
  assert.equal(store.listOrders().length, 0);

  store.unarchiveOrder(order.order_number);
  assert.equal(store.getOrderByNumber(order.order_number).archived_at, null);
  assert.equal(store.listOrders().length, 1);
});

test("backup command writes a readable SQLite backup", async () => {
  resetOperationalData();
  store.createOrder(orderInput(1));

  await import(pathToFileURL(path.join(repoRoot, "src/backup.js")));

  const backups = fs
    .readdirSync(path.join(tempDir, "backups"))
    .filter((file) => /^store-.*\.db$/.test(file))
    .sort();
  assert.equal(backups.length, 1);

  const backup = new DatabaseSync(path.join(tempDir, "backups", backups[0]), { readOnly: true });
  try {
    assert.equal(backup.prepare("SELECT COUNT(*) AS count FROM products").get().count, 1);
    assert.equal(backup.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 1);
  } finally {
    backup.close();
  }
});
