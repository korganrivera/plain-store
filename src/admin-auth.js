import crypto from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scryptParams = {
  keyLength: 64,
  N: 16384,
  r: 8,
  p: 1,
};

function safeEqualHex(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashAdminPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto
    .scryptSync(password, salt, scryptParams.keyLength, {
      N: scryptParams.N,
      r: scryptParams.r,
      p: scryptParams.p,
    })
    .toString("hex");

  return ["scrypt", scryptParams.N, scryptParams.r, scryptParams.p, scryptParams.keyLength, salt, hash].join("$");
}

export function verifyAdminPassword(password, encodedHash) {
  const parts = String(encodedHash || "").split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nValue, rValue, pValue, keyLengthValue, salt, expectedHash] = parts;
  const N = Number.parseInt(nValue, 10);
  const r = Number.parseInt(rValue, 10);
  const p = Number.parseInt(pValue, 10);
  const keyLength = Number.parseInt(keyLengthValue, 10);
  if (![N, r, p, keyLength].every(Number.isFinite)) {
    return false;
  }

  try {
    const actualHash = crypto.scryptSync(password, salt, keyLength, { N, r, p }).toString("hex");
    return safeEqualHex(actualHash, expectedHash);
  } catch {
    return false;
  }
}

export function verifyPlainPassword(password, expectedPassword) {
  const actual = Buffer.from(String(password));
  const expected = Buffer.from(String(expectedPassword));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: node src/admin-auth.js <password>");
    process.exit(1);
  }
  console.log(hashAdminPassword(password));
}
