import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { env } from "../config/env";

const KEY_INFO = "triven-magic-link-otp-v1";
const IV_BYTES = 12;
const TOKEN_BYTES = 32;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = scryptSync(env.JWT_SECRET, KEY_INFO, 32);
  }
  return cachedKey;
}

export function encryptVerificationCode(code: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);

  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptVerificationCode(payload: string | null | undefined): string | null {
  if (!payload) return null;

  try {
    const [ivHex, authTagHex, cipherHex] = payload.split(":");
    if (!ivHex || !authTagHex || !cipherHex) return null;

    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, "hex")),
      decipher.final()
    ]);

    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

export function hashMagicLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createMagicLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashMagicLinkToken(token) };
}

export function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}
