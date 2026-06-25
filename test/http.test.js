import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-store-http-test-"));
const port = 3217;
const base = `http://127.0.0.1:${port}`;
const uploadedTestImages = new Set();

process.env.COOKIE_SECRET = "http-test-cookie-secret";
const { encodeSignedJson, randomToken } = await import(pathToFileURL(path.join(repoRoot, "src/utils.js")));

let server;

function setCookies(headers) {
  if (headers.getSetCookie) {
    return headers.getSetCookie().map((value) => value.split(";")[0]);
  }
  const cookie = headers.get("set-cookie");
  return cookie ? [cookie.split(";")[0]] : [];
}

function firstCookie(headers) {
  return setCookies(headers)[0] || "";
}

function csrfFromHtml(html) {
  return (html.match(/name="csrfToken" value="([^"]+)/) || [])[1] || "";
}

function emailOutboxDir() {
  return path.join(tempDir, "email_outbox");
}

function listOutboxFiles() {
  const outboxDir = emailOutboxDir();
  return fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
}

async function contactFormSession() {
  const contact = await fetch(`${base}/contact`);
  const cookies = [firstCookie(contact.headers)].filter(Boolean);
  const html = await contact.text();

  assert.equal(contact.status, 200);
  return { cookies, csrfToken: csrfFromHtml(html), html };
}

async function postContact({ cookies, csrfToken, fields, headers = {} }) {
  return fetch(`${base}/contact`, {
    method: "POST",
    headers: {
      cookie: cookies.join("; "),
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams({
      csrfToken,
      name: "Route Tester",
      email: "question@example.com",
      subject: "Cookie pickup question",
      message: "Can I ask about a pickup time before ordering?",
      website: "",
      ...fields,
    }),
    redirect: "manual",
  });
}

function statusTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createPrivateStatusOrder({ orderNumber = "ORD-PRIVATE1", email = "private@example.com" } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const db = new DatabaseSync(path.join(tempDir, "data", "store.db"));
  try {
    const orderResult = db
      .prepare(`
        INSERT INTO orders (
          order_number, status_token_hash, email, full_name, shipping_address, postal_code,
          status, subtotal_cents, shipping_cents, total_cents, notes
        ) VALUES (
          @order_number, @status_token_hash, @email, @full_name, @shipping_address, '',
          'requested', 400, 0, 400, ''
        )
      `)
      .run({
        order_number: orderNumber,
        status_token_hash: statusTokenHash(token),
        email,
        full_name: "Private Route Buyer",
        shipping_address: "Friday after 4",
      });
    db.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, sku, quantity, unit_price_cents, line_total_cents
      ) VALUES (?, 1, 'Fresh Eggs - 1 dozen', 'EGG-001', 1, 400, 400)
    `).run(orderResult.lastInsertRowid);
  } finally {
    db.close();
  }
  return { orderNumber, email, token };
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the child process binds the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start.");
}

async function getCart(cookies) {
  const response = await fetch(`${base}/cart`, { headers: { cookie: cookies.join("; ") } });
  return {
    response,
    text: await response.text(),
    cookies: [...cookies, ...setCookies(response.headers)].filter(Boolean),
  };
}

async function adminLogin() {
  const login = await fetch(`${base}/admin/login`);
  let cookies = [firstCookie(login.headers)].filter(Boolean);
  const loginHtml = await login.text();
  const csrfToken = csrfFromHtml(loginHtml);

  const response = await fetch(`${base}/admin/login`, {
    method: "POST",
    headers: { cookie: cookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, password: "test-admin-password" }),
    redirect: "manual",
  });
  cookies = [...cookies, ...setCookies(response.headers)].filter(Boolean);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/catalog");
  return cookies;
}

before(async () => {
  server = spawn(process.execPath, ["--import", "./src/load-env.js", "src/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ADMIN_PASSWORD: "test-admin-password",
      DB_PATH: path.join(tempDir, "data", "store.db"),
      HOST: "127.0.0.1",
      PORT: String(port),
      COOKIE_SECRET: process.env.COOKIE_SECRET,
      COOKIE_SECURE: "false",
      EMAIL_OUTBOX_DIR: path.join(tempDir, "email_outbox"),
      STORE_OWNER_EMAIL: "owner@example.com",
      SMTP_HOST: "",
      MAIL_FROM: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.resume();
  server.stderr.resume();
  await waitForServer();
});

after(() => {
  server?.kill();
  for (const imagePath of uploadedTestImages) {
    fs.rmSync(imagePath, { force: true });
  }
});

test("category and product pages show breadcrumb navigation", async () => {
  const category = await fetch(`${base}/c/eggs`);
  const categoryHtml = await category.text();

  assert.equal(category.status, 200);
  assert.match(categoryHtml, /<nav class="breadcrumbs" aria-label="Breadcrumb">/);
  assert.match(categoryHtml, /<a href="\/">Home<\/a>/);
  assert.match(categoryHtml, /<span aria-current="page">Eggs<\/span>/);
  assert.doesNotMatch(categoryHtml, /<p class="eyebrow">Category<\/p>/);
  assert.doesNotMatch(categoryHtml, /<h1>Eggs<\/h1>/);

  const product = await fetch(`${base}/p/fresh-eggs-1-dozen`);
  const productHtml = await product.text();

  assert.equal(product.status, 200);
  assert.match(productHtml, /<nav class="breadcrumbs" aria-label="Breadcrumb">/);
  assert.match(productHtml, /<a href="\/">Home<\/a>/);
  assert.match(productHtml, /<a href="\/c\/eggs">Eggs<\/a>/);
  assert.match(productHtml, /<span aria-current="page">Fresh Eggs - 1 dozen<\/span>/);
  assert.ok(productHtml.indexOf('<nav class="breadcrumbs"') < productHtml.indexOf('<article class="product-layout">'));
});

test("cart add clamps requested quantity and explains available stock", async () => {
  const product = await fetch(`${base}/p/fresh-eggs-1-dozen`);
  let cookies = [firstCookie(product.headers)].filter(Boolean);
  const productHtml = await product.text();
  const csrfToken = csrfFromHtml(productHtml);

  const add = await fetch(`${base}/cart/add`, {
    method: "POST",
    headers: { cookie: cookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, productId: "1", quantity: "99" }),
    redirect: "manual",
  });
  cookies = [...cookies, ...setCookies(add.headers)].filter(Boolean);

  const cart = await getCart(cookies);

  assert.equal(add.status, 302);
  assert.match(cart.text, /Only 4 items are available, so your basket now has 4\./);
  assert.match(cart.text, /value="4"/);
  assert.match(cart.text, /Basket \(4\)/);
});

test("cart update clamps requested quantity and explains available stock", async () => {
  const product = await fetch(`${base}/p/fresh-eggs-1-dozen`);
  let cookies = [firstCookie(product.headers)].filter(Boolean);
  let html = await product.text();
  let csrfToken = csrfFromHtml(html);

  const add = await fetch(`${base}/cart/add`, {
    method: "POST",
    headers: { cookie: cookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, productId: "1", quantity: "1" }),
    redirect: "manual",
  });
  cookies = [...cookies, ...setCookies(add.headers)].filter(Boolean);
  const cartBefore = await getCart(cookies);
  csrfToken = csrfFromHtml(cartBefore.text);

  const update = await fetch(`${base}/cart/update`, {
    method: "POST",
    headers: { cookie: cartBefore.cookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, productId: "1", quantity: "99" }),
    redirect: "manual",
  });
  const cartAfter = await getCart([...cartBefore.cookies, ...setCookies(update.headers)].filter(Boolean));

  assert.equal(update.status, 302);
  assert.match(cartAfter.text, /Only 4 items are available, so Fresh Eggs - 1 dozen was set to 4\./);
  assert.match(cartAfter.text, /value="4"/);
});

test("checkout redirects stale overstocked baskets back to cart with explanation", async () => {
  const csrfToken = randomToken();
  const cartCookie = encodeSignedJson([{ productId: 1, quantity: 99 }]);
  let cookies = [`csrf=${encodeURIComponent(csrfToken)}`, `cart=${encodeURIComponent(cartCookie)}`];

  const checkout = await fetch(`${base}/checkout`, { headers: { cookie: cookies.join("; ") }, redirect: "manual" });
  cookies = [...cookies, ...setCookies(checkout.headers)].filter(Boolean);
  const cart = await getCart(cookies);

  assert.equal(checkout.status, 302);
  assert.equal(checkout.headers.get("location"), "/cart");
  assert.match(cart.text, /Fresh Eggs - 1 dozen was reduced to 4 because only 4 items are available\./);
  assert.match(cart.text, /value="4"/);
});

test("basket removes unavailable stale items with a clear message", async () => {
  const cartCookie = encodeSignedJson([{ productId: 9999, quantity: 1 }]);
  const cart = await getCart([`cart=${encodeURIComponent(cartCookie)}`]);

  assert.match(cart.text, /An item was removed from your basket because it is no longer available\./);
  assert.match(cart.text, /Your basket is empty\./);
  assert.match(cart.text, /Basket \(0\)/);
});

test("private order status token replaces public order-number details", async () => {
  const { orderNumber, email, token } = createPrivateStatusOrder();

  const privateStatus = await fetch(`${base}/order/status/${token}`);
  const privateHtml = await privateStatus.text();

  assert.equal(privateStatus.status, 200);
  assert.match(privateHtml, new RegExp(`Order ${orderNumber}`));
  assert.match(privateHtml, /Private Route Buyer/);
  assert.match(privateHtml, /private@example\.com/);
  assert.match(privateHtml, /Friday after 4/);

  const publicOrder = await fetch(`${base}/order/${orderNumber}`, { redirect: "manual" });
  const publicText = await publicOrder.text();

  assert.equal(publicOrder.status, 302);
  assert.equal(publicOrder.headers.get("location"), "/order-lookup");
  assert.doesNotMatch(publicText, /Private Route Buyer/);
  assert.doesNotMatch(publicText, /private@example\.com/);

  const lookup = await fetch(`${base}/order-lookup`);
  const lookupCookies = [firstCookie(lookup.headers)].filter(Boolean);
  const lookupCsrf = csrfFromHtml(await lookup.text());
  const lookupResponse = await fetch(`${base}/order-lookup`, {
    method: "POST",
    headers: { cookie: lookupCookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: lookupCsrf, orderNumber, email }),
  });
  const lookupHtml = await lookupResponse.text();

  assert.equal(lookupResponse.status, 200);
  assert.match(lookupHtml, /Private Route Buyer/);
  assert.match(lookupHtml, /private@example\.com/);

  for (let index = 0; index < 6; index += 1) {
    const response = await fetch(`${base}/order-lookup`, {
      method: "POST",
      headers: { cookie: lookupCookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken: lookupCsrf, orderNumber: "ORD-MISSING", email: "missing@example.com" }),
    });
    assert.equal(response.status, 200);
  }

  const blocked = await fetch(`${base}/order-lookup`, {
    method: "POST",
    headers: { cookie: lookupCookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: lookupCsrf, orderNumber: "ORD-MISSING", email: "missing@example.com" }),
  });
  const blockedHtml = await blocked.text();

  assert.equal(blocked.status, 429);
  assert.match(blockedHtml, /Too many order lookup attempts\. Please try again in/);
});

test("contact form rate limits repeated messages by visitor IP", async () => {
  const { cookies, csrfToken } = await contactFormSession();
  const beforeFiles = new Set(listOutboxFiles());
  const headers = { "x-forwarded-for": "198.51.100.25" };

  for (let index = 0; index < 10; index += 1) {
    const response = await postContact({
      cookies,
      csrfToken,
      headers,
      fields: { email: `contact-ip-limit-${index}@example.com` },
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/contact");
  }

  const blocked = await postContact({
    cookies,
    csrfToken,
    headers,
    fields: { email: "contact-ip-limit-blocked@example.com" },
  });
  const blockedHtml = await blocked.text();

  assert.equal(blocked.status, 429);
  assert.match(blockedHtml, /Too many messages\. Please try again in/);
  assert.ok(listOutboxFiles().filter((filename) => !beforeFiles.has(filename)).length > 0);
});

test("contact form sends a message to the store owner", async () => {
  const contact = await fetch(`${base}/contact`);
  let cookies = [firstCookie(contact.headers)].filter(Boolean);
  const contactHtml = await contact.text();
  const csrfToken = csrfFromHtml(contactHtml);
  const outboxDir = path.join(tempDir, "email_outbox");
  const beforeFiles = fs.existsSync(outboxDir) ? new Set(fs.readdirSync(outboxDir)) : new Set();

  assert.equal(contact.status, 200);
  assert.match(contactHtml, /<h1>Ask a question<\/h1>/);
  assert.match(contactHtml, /href="\/contact" aria-current="page"/);

  const response = await fetch(`${base}/contact`, {
    method: "POST",
    headers: { cookie: cookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken,
      name: "Route Tester",
      email: "question@example.com",
      subject: "Cookie pickup question",
      message: "Can I ask about a pickup time before ordering?",
      website: "",
    }),
    redirect: "manual",
  });
  cookies = [...cookies, ...setCookies(response.headers)].filter(Boolean);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/contact");

  const createdFiles = fs.readdirSync(outboxDir).filter((filename) => !beforeFiles.has(filename));
  assert.equal(createdFiles.length, 1);
  const outbox = JSON.parse(fs.readFileSync(path.join(outboxDir, createdFiles[0]), "utf8"));

  assert.equal(outbox.to, "owner@example.com");
  assert.equal(outbox.replyTo, "question@example.com");
  assert.equal(outbox.subject, "Store question: Cookie pickup question");
  assert.match(outbox.text, /Name: Route Tester/);
  assert.match(outbox.text, /Email: question@example\.com/);
  assert.match(outbox.text, /Can I ask about a pickup time before ordering\?/);
});

test("contact form accepts honeypot submissions without sending mail", async () => {
  const { cookies, csrfToken } = await contactFormSession();
  const beforeFiles = new Set(listOutboxFiles());

  const response = await postContact({
    cookies,
    csrfToken,
    fields: {
      email: "honeypot@example.com",
      website: "https://spam.example",
    },
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/contact");
  assert.equal(listOutboxFiles().filter((filename) => !beforeFiles.has(filename)).length, 0);
});

test("admin can edit a product and the public product page reflects the update", async () => {
  const cookies = await adminLogin();
  const editPage = await fetch(`${base}/admin/catalog?product=1`, { headers: { cookie: cookies.join("; ") } });
  const editHtml = await editPage.text();
  const csrfToken = csrfFromHtml(editHtml);
  const description = [
    "One dozen fresh eggs for route-test coverage.",
    "This longer second paragraph should appear on the product page only.",
    "This third paragraph should also stay off the catalog page.",
  ].join("\n\n");

  const update = await fetch(`${base}/admin/products`, {
    method: "POST",
    headers: { cookie: cookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken,
      id: "1",
      name: "Fresh Eggs Test Dozen",
      sku: "EGG-001",
      categoryId: "1",
      price: "4.50",
      inventoryCount: "7",
      status: "active",
      imagePath: "/images/eggs.jpg",
      description,
    }),
    redirect: "manual",
  });

  assert.equal(update.status, 302);
  assert.equal(update.headers.get("location"), "/admin/catalog");

  const db = new DatabaseSync(path.join(tempDir, "data", "store.db"), { readOnly: true });
  try {
    const product = db
      .prepare("SELECT slug, name, price_cents, inventory_count, status, description FROM products WHERE id = 1")
      .get();

    assert.deepEqual({ ...product }, {
      slug: "fresh-eggs-test-dozen",
      name: "Fresh Eggs Test Dozen",
      price_cents: 450,
      inventory_count: 7,
      status: "active",
      description,
    });
  } finally {
    db.close();
  }

  const publicPage = await fetch(`${base}/p/fresh-eggs-test-dozen`);
  const publicHtml = await publicPage.text();

  assert.equal(publicPage.status, 200);
  assert.match(publicHtml, /Fresh Eggs Test Dozen/);
  assert.match(publicHtml, /\$4\.50/);
  assert.match(publicHtml, /7 available/);
  assert.match(publicHtml, /This longer second paragraph should appear on the product page only\./);
  assert.match(publicHtml, /This third paragraph should also stay off the catalog page\./);

  const homePage = await fetch(`${base}/`);
  const homeHtml = await homePage.text();

  assert.equal(homePage.status, 200);
  assert.match(homeHtml, /One dozen fresh eggs for route-test coverage\./);
  assert.doesNotMatch(homeHtml, /This longer second paragraph should appear on the product page only\./);
  assert.doesNotMatch(homeHtml, /This third paragraph should also stay off the catalog page\./);
});

test("admin can upload a product image and choose it in the product form", async () => {
  const cookies = await adminLogin();
  const catalog = await fetch(`${base}/admin/catalog`, { headers: { cookie: cookies.join("; ") } });
  const catalogHtml = await catalog.text();
  const csrfToken = csrfFromHtml(catalogHtml);
  const imageDir = path.join(repoRoot, "public/images");
  const beforeFiles = new Set(fs.readdirSync(imageDir));
  const testImage = fs.readFileSync(path.join(repoRoot, "public/images/tablet.jpg"));
  const form = new FormData();
  form.set("csrfToken", csrfToken);
  form.set("image", new Blob([testImage], { type: "image/jpeg" }), "Kitchen Tablet.jpg");

  const upload = await fetch(`${base}/admin/images`, {
    method: "POST",
    headers: { cookie: cookies.join("; ") },
    body: form,
    redirect: "manual",
  });

  assert.equal(upload.status, 302);
  assert.equal(upload.headers.get("location"), "/admin/catalog");
  const uploadCookies = [...cookies, ...setCookies(upload.headers)].filter(Boolean);

  const createdFiles = fs
    .readdirSync(imageDir)
    .filter((filename) => !beforeFiles.has(filename) && /^kitchen-tablet-[a-z0-9]+-[a-f0-9]{6}\.jpg$/.test(filename));

  assert.equal(createdFiles.length, 1);
  uploadedTestImages.add(path.join(imageDir, createdFiles[0]));

  const refreshed = await fetch(`${base}/admin/catalog`, { headers: { cookie: uploadCookies.join("; ") } });
  const refreshedHtml = await refreshed.text();

  assert.match(refreshedHtml, /Image uploaded: \/images\/kitchen-tablet-/);
  assert.match(refreshedHtml, /<input id="admin-image-upload" type="file" name="image" accept="image\/\*" required>/);
  assert.match(refreshedHtml, /Max 5 MB\. Large photos are resized automatically; originals are not kept\./);
  assert.match(refreshedHtml, /Uploads are automatically resized and saved as web JPEGs\./);
  assert.doesNotMatch(refreshedHtml, /data-file-picker-target/);
  assert.ok(refreshedHtml.includes(`<option value="/images/${createdFiles[0]}"`));
  assert.ok(refreshedHtml.includes(`<img src="/images/${createdFiles[0]}" alt="">`));
  assert.ok(refreshedHtml.includes(`name="imagePath" value="/images/${createdFiles[0]}"`));

  const refreshedCsrfToken = csrfFromHtml(refreshedHtml);
  const deleteUpload = await fetch(`${base}/admin/images/delete`, {
    method: "POST",
    headers: { cookie: uploadCookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: refreshedCsrfToken, imagePath: `/images/${createdFiles[0]}` }),
    redirect: "manual",
  });

  assert.equal(deleteUpload.status, 302);
  assert.equal(deleteUpload.headers.get("location"), "/admin/catalog");
  assert.equal(fs.existsSync(path.join(imageDir, createdFiles[0])), false);
  uploadedTestImages.delete(path.join(imageDir, createdFiles[0]));

  const afterDelete = await fetch(`${base}/admin/catalog`, {
    headers: { cookie: [...uploadCookies, ...setCookies(deleteUpload.headers)].filter(Boolean).join("; ") },
  });
  const afterDeleteHtml = await afterDelete.text();

  assert.match(afterDeleteHtml, /Image deleted: \/images\/kitchen-tablet-/);
  assert.ok(!afterDeleteHtml.includes(`<option value="/images/${createdFiles[0]}"`));
});

test("admin cannot delete an image that is assigned to a product", async () => {
  const cookies = await adminLogin();
  const catalog = await fetch(`${base}/admin/catalog`, { headers: { cookie: cookies.join("; ") } });
  const catalogHtml = await catalog.text();
  const csrfToken = csrfFromHtml(catalogHtml);
  const imagePath = path.join(repoRoot, "public/images/eggs.jpg");

  assert.equal(fs.existsSync(imagePath), true);

  const response = await fetch(`${base}/admin/images/delete`, {
    method: "POST",
    headers: { cookie: cookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, imagePath: "/images/eggs.jpg" }),
    redirect: "manual",
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/catalog");
  assert.equal(fs.existsSync(imagePath), true);

  const refreshed = await fetch(`${base}/admin/catalog`, {
    headers: { cookie: [...cookies, ...setCookies(response.headers)].filter(Boolean).join("; ") },
  });
  const refreshedHtml = await refreshed.text();

  assert.match(refreshedHtml, /Image is still used by:/);
  assert.match(refreshedHtml, /Fresh Eggs/);
});

test("unverified back-in-stock requests send confirmation before queueing", async () => {
  const db = new DatabaseSync(path.join(tempDir, "data", "store.db"));
  try {
    db.exec(`
      DELETE FROM pending_back_in_stock_confirmations;
      DELETE FROM back_in_stock_requests;
      DELETE FROM verified_contacts WHERE email = 'notify-route@example.com';
      UPDATE products
      SET slug = 'fresh-eggs-route-test', name = 'Fresh Eggs Route Test', inventory_count = 0, status = 'active'
      WHERE id = 1;
    `);
  } finally {
    db.close();
  }

  const product = await fetch(`${base}/p/fresh-eggs-route-test`);
  let cookies = [firstCookie(product.headers)].filter(Boolean);
  const productHtml = await product.text();
  const csrfToken = csrfFromHtml(productHtml);
  const outboxDir = path.join(tempDir, "email_outbox");
  const beforeFiles = fs.existsSync(outboxDir) ? new Set(fs.readdirSync(outboxDir)) : new Set();

  assert.match(productHtml, /Back in stock alerts/);
  assert.match(productHtml, /placeholder="Notify me when these are back in stock"/);
  assert.match(productHtml, /aria-label="Submit back in stock notification"/);
  assert.doesNotMatch(productHtml, />Notify me when these are back in stock<\/button>/);
  assert.match(productHtml, /Pickup only\. Pay at pickup\./);

  const response = await fetch(`${base}/back-in-stock`, {
    method: "POST",
    headers: { cookie: cookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, productId: "1", email: "notify-route@example.com" }),
    redirect: "manual",
  });
  cookies = [...cookies, ...setCookies(response.headers)].filter(Boolean);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/p/fresh-eggs-route-test");

  const readDb = new DatabaseSync(path.join(tempDir, "data", "store.db"), { readOnly: true });
  try {
    assert.equal(readDb.prepare("SELECT COUNT(*) AS count FROM back_in_stock_requests").get().count, 0);
    assert.equal(readDb.prepare("SELECT COUNT(*) AS count FROM pending_back_in_stock_confirmations").get().count, 1);
  } finally {
    readDb.close();
  }

  const createdFiles = fs.readdirSync(outboxDir).filter((filename) => !beforeFiles.has(filename));
  assert.equal(createdFiles.length, 1);
  const outbox = JSON.parse(fs.readFileSync(path.join(outboxDir, createdFiles[0]), "utf8"));
  assert.equal(outbox.to, "notify-route@example.com");
  assert.match(outbox.text, /Confirm notification request: .*\/back-in-stock\/confirm\//);
});

test("verified contacts can join the back-in-stock queue without confirmation", async () => {
  const db = new DatabaseSync(path.join(tempDir, "data", "store.db"));
  try {
    db.exec(`
      DELETE FROM pending_back_in_stock_confirmations;
      DELETE FROM back_in_stock_requests;
      INSERT INTO verified_contacts (email, first_verified_at, last_verified_at)
      VALUES ('verified-route@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(email) DO UPDATE SET last_verified_at = CURRENT_TIMESTAMP;
      UPDATE products
      SET slug = 'fresh-eggs-route-test', name = 'Fresh Eggs Route Test', inventory_count = 0, status = 'active'
      WHERE id = 1;
    `);
  } finally {
    db.close();
  }

  const product = await fetch(`${base}/p/fresh-eggs-route-test`);
  const cookies = [firstCookie(product.headers)].filter(Boolean);
  const csrfToken = csrfFromHtml(await product.text());

  const response = await fetch(`${base}/back-in-stock`, {
    method: "POST",
    headers: { cookie: cookies.join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, productId: "1", email: "verified-route@example.com" }),
    redirect: "manual",
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/p/fresh-eggs-route-test");

  const readDb = new DatabaseSync(path.join(tempDir, "data", "store.db"), { readOnly: true });
  try {
    assert.equal(readDb.prepare("SELECT COUNT(*) AS count FROM back_in_stock_requests").get().count, 1);
    assert.equal(readDb.prepare("SELECT COUNT(*) AS count FROM pending_back_in_stock_confirmations").get().count, 0);
  } finally {
    readDb.close();
  }
});
