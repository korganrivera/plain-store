import crypto from "node:crypto";

const secret = process.env.COOKIE_SECRET || "dev-cookie-secret-change-me";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatCurrency(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function readCookies(header = "") {
  const cookies = {};
  for (const part of header.split(/;\s*/)) {
    if (!part) {
      continue;
    }
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = decodeURIComponent(part.slice(0, eqIndex));
    const value = decodeURIComponent(part.slice(eqIndex + 1));
    cookies[key] = value;
  }
  return cookies;
}

export function sign(value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function encodeSignedJson(value) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function decodeSignedJson(value, fallback) {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) {
    return fallback;
  }
  if (sign(encoded) !== signature) {
    return fallback;
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return fallback;
  }
}

export function randomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function setCookie(
  res,
  name,
  value,
  { maxAge = 60 * 60 * 24 * 14, httpOnly = true, secure = false } = {},
) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
  ];
  if (httpOnly) {
    attributes.push("HttpOnly");
  }
  if (secure) {
    attributes.push("Secure");
  }
  res.append("Set-Cookie", attributes.join("; "));
}

export function clearCookie(res, name, { secure = false } = {}) {
  const attributes = [`${name}=`, "Path=/", "Max-Age=0", "SameSite=Lax"];
  if (secure) {
    attributes.push("Secure");
  }
  res.append("Set-Cookie", attributes.join("; "));
}

export function plainText(value, maxLength = 200) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function plainMultiline(value, maxLength = 1000) {
  return String(value ?? "").trim().replace(/\r/g, "").slice(0, maxLength);
}
