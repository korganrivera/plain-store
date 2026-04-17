import { plainMultiline, plainText } from "./utils.js";

export function parsePositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseMoneyToCents(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  return Math.round(Number(normalized) * 100);
}

export function requireCheckoutFields(body) {
  const email = plainText(body.email, 200).toLowerCase();
  const fullName = plainText(body.fullName, 120);
  const addressLine1 = plainText(body.addressLine1, 160);
  const addressLine2 = plainText(body.addressLine2, 160);
  const city = plainText(body.city, 120);
  const state = plainText(body.state, 60);
  const postalCode = plainText(body.postalCode, 20);
  const notes = plainMultiline(body.notes, 500);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (fullName.length < 2) {
    return { error: "Enter your full name." };
  }
  if (addressLine1.length < 5) {
    return { error: "Enter a street address." };
  }
  if (city.length < 2) {
    return { error: "Enter a city." };
  }
  if (state.length < 2) {
    return { error: "Enter a state." };
  }
  if (postalCode.length < 3) {
    return { error: "Enter a postal code." };
  }

  const shippingAddress = [addressLine1, addressLine2, `${city}, ${state} ${postalCode}`]
    .filter(Boolean)
    .join("\n");

  return { value: { email, fullName, shippingAddress, postalCode, notes } };
}

export function requireAdminProductFields(body) {
  const name = plainText(body.name, 120);
  const sku = plainText(body.sku, 40).toUpperCase();
  const description = plainMultiline(body.description, 1000);
  const imagePath = plainText(body.imagePath, 200);
  const inventoryCount = parsePositiveInt(body.inventoryCount, 0);
  const priceCents = parseMoneyToCents(body.price);
  const status = ["active", "draft", "archived"].includes(body.status) ? body.status : null;
  const categoryId = Number.parseInt(String(body.categoryId ?? ""), 10);

  if (!name) {
    return { error: "Product name is required." };
  }
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return { error: "Choose a category." };
  }
  if (priceCents === null) {
    return { error: "Enter a valid price." };
  }
  if (!status) {
    return { error: "Choose a product status." };
  }

  return {
    value: {
      id: body.id || null,
      name,
      sku,
      description,
      imagePath,
      inventoryCount,
      priceCents,
      status,
      categoryId,
    },
  };
}
