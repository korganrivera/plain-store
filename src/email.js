import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { formatCurrency } from "./utils.js";

const outboxDir = path.resolve("data", "email_outbox");

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function storeName() {
  return process.env.STORE_NAME || "Plain Store";
}

function storeEmailFrom() {
  return process.env.MAIL_FROM || `"${storeName()}" <orders@example.invalid>`;
}

function storeOwnerEmail() {
  return process.env.STORE_OWNER_EMAIL || "";
}

function normalizeEmail(value) {
  const match = String(value || "").match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

function publicStoreUrl() {
  return (process.env.PUBLIC_STORE_URL || "").replace(/\/+$/, "");
}

function pickupLocation() {
  return process.env.PICKUP_LOCATION || "Pickup location will be confirmed before pickup.";
}

function pickupInstructions() {
  return process.env.PICKUP_INSTRUCTIONS || "Pickup timing will be coordinated with your order.";
}

function configuredForSmtp() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

function createTransport() {
  if (!configuredForSmtp()) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT || "587", 10),
    secure: envFlag("SMTP_SECURE", false),
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || "",
        }
      : undefined,
  });
}

function orderUrl(order) {
  const baseUrl = publicStoreUrl();
  return baseUrl ? `${baseUrl}/order/${order.order_number}` : `/order/${order.order_number}`;
}

function productUrl(product) {
  const baseUrl = publicStoreUrl();
  return baseUrl ? `${baseUrl}/p/${product.slug}` : `/p/${product.slug}`;
}

function confirmationUrl(token) {
  const baseUrl = publicStoreUrl();
  return baseUrl ? `${baseUrl}/order/confirm/${token}` : `/order/confirm/${token}`;
}

function orderItemsText(order) {
  return order.items
    .map(
      (item) =>
        `- ${item.product_name} x ${item.quantity}: ${formatCurrency(item.line_total_cents)}`,
    )
    .join("\n");
}

function orderSummaryText(order) {
  return [
    `Order: ${order.order_number}`,
    `Name: ${order.full_name}`,
    `Total due at pickup: ${formatCurrency(order.total_cents)}`,
    "",
    "Items:",
    orderItemsText(order),
    "",
    "Pickup details:",
    order.shipping_address,
    order.notes ? `\nNotes:\n${order.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function storePickupText() {
  return ["Pickup location:", pickupLocation(), "", "Pickup instructions:", pickupInstructions()].join("\n");
}

async function writeOutbox(message) {
  fs.mkdirSync(outboxDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTo = String(message.to).replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
  const filename = `${timestamp}-${safeTo || "message"}.json`;
  const filepath = path.join(outboxDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(message, null, 2), "utf8");
  return { outbox: filepath };
}

export async function sendMail(message) {
  const payload = {
    from: storeEmailFrom(),
    ...message,
  };

  const transport = createTransport();
  if (!transport) {
    const result = await writeOutbox(payload);
    console.warn(`Email SMTP is not configured; wrote message to ${result.outbox}`);
    return result;
  }

  return transport.sendMail(payload);
}

export async function sendOrderSubmittedEmails(order) {
  const customerText = [
    `Thanks for your order from ${storeName()}.`,
    "",
    "It was submitted successfully.",
    "No online payment was taken. We will confirm the order and pickup details, then contact you again when it is ready for pickup. Pay when you pick up.",
    "",
    orderSummaryText(order),
    "",
    storePickupText(),
    "",
    `Check status: ${orderUrl(order)}`,
  ].join("\n");

  await sendMail({
    to: order.email,
    subject: `Pickup order received: ${order.order_number}`,
    text: customerText,
  });

  const ownerEmail = storeOwnerEmail();
  if (ownerEmail && normalizeEmail(ownerEmail) !== normalizeEmail(order.email)) {
    await sendMail({
      to: ownerEmail,
      subject: `New pickup order: ${order.order_number}`,
      text: [
        `New pickup order submitted.`,
        "",
        orderSummaryText(order),
        "",
        storePickupText(),
        "",
        `Admin/order link: ${orderUrl(order)}`,
      ].join("\n"),
    });
  }
}

export async function sendOrderConfirmationEmail(pending) {
  const text = [
    `Please confirm your ${storeName()} pickup request.`,
    "",
    "No online payment has been taken. Inventory is not reserved until this email is confirmed.",
    pending.summaryText ? `\n${pending.summaryText}` : "",
    "",
    `Confirm request: ${confirmationUrl(pending.token)}`,
    "",
    `This link expires in ${pending.expiresMinutes} minutes.`,
  ].join("\n");

  return sendMail({
    to: pending.email,
    subject: `Confirm your ${storeName()} pickup request`,
    text,
  });
}

export async function sendBackInStockEmail(product, request) {
  const text = [
    `${product.name} is back in stock at ${storeName()}.`,
    "",
    "Availability is first-come, first-served. This message does not reserve the item.",
    "",
    `View item: ${productUrl(product)}`,
  ].join("\n");

  return sendMail({
    to: request.email,
    subject: `Back in stock: ${product.name}`,
    text,
  });
}

export async function sendOrderReadyEmail(order) {
  const text = [
    `Your ${storeName()} order is ready for pickup.`,
    "",
    "No online payment was taken. Pay when you pick up.",
    "",
    storePickupText(),
    "",
    orderSummaryText(order),
    "",
    `Check status: ${orderUrl(order)}`,
  ].join("\n");

  return sendMail({
    to: order.email,
    subject: `Ready for pickup: ${order.order_number}`,
    text,
  });
}

export async function sendOrderPickedUpEmail(order) {
  const text = [
    `Thanks again for your order from ${storeName()}.`,
    "",
    "We have marked it picked up and paid.",
    "",
    storePickupText(),
    "",
    orderSummaryText(order),
  ].join("\n");

  return sendMail({
    to: order.email,
    subject: `Thank you for your order: ${order.order_number}`,
    text,
  });
}
