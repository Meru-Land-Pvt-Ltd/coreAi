import crypto from "crypto";
import { env } from "../config/env";

function getEncryptionKey() {
  if (/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY)) {
    return Buffer.from(env.ENCRYPTION_KEY, "hex");
  }

  return crypto.createHash("sha256").update(env.ENCRYPTION_KEY).digest();
}

export function encryptSecret(value: string) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function decryptSecret(value: string) {
  const [ivRaw, authTagRaw, encryptedRaw] = value.split(".");

  if (!ivRaw || !authTagRaw || !encryptedRaw) {
    throw new Error("Invalid encrypted secret");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivRaw, "base64url");
  const authTag = Buffer.from(authTagRaw, "base64url");
  const encrypted = Buffer.from(encryptedRaw, "base64url");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString("utf8");
}