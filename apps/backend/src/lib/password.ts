import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");

  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, originalHash] = storedHash.split(":");

  if (!salt || !originalHash) {
    return false;
  }

  const originalHashBuffer = Buffer.from(originalHash, "hex");
  const currentHashBuffer = scryptSync(password, salt, KEY_LENGTH);

  if (originalHashBuffer.length !== currentHashBuffer.length) {
    return false;
  }

  return timingSafeEqual(originalHashBuffer, currentHashBuffer);
}