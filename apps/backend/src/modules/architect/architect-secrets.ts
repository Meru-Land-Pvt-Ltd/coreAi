/**
 * "My Keys" — per-architect encrypted secret locker + the platform YouTube key
 * pool.
 *
 * An architect stores an API key once, under a human label, and references it by
 * name from an API Call node. The value is encrypted at rest with the shared
 * AES-256-GCM helper (the same one behind the Telegram/Calendly tokens) and is
 * decrypted ONLY at call time, inside {@link getArchitectSecretValue}. It is
 * never returned to the browser, never written to run logs/context/output, and
 * never logged here — list/create responses carry a fixed mask only.
 *
 * This module imports only leaf libraries (crypto, prisma, env), so the API Call
 * runtime in the workflow-runner can import it with no dependency cycle.
 */
import { encryptSecret, decryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { env } from "../../config/env";

/** Fixed mask returned in place of any stored value. Reveals nothing. */
export const SECRET_MASK = "••••••••";

export const SECRET_NAME_MAX_LENGTH = 64;
export const SECRET_VALUE_MAX_LENGTH = 8192;

/** A stored key as it is safe to show an architect — never the value itself. */
export interface ArchitectSecretSummary {
  id: string;
  name: string;
  /** Always {@link SECRET_MASK}; the real value is never returned. */
  maskedValue: string;
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(row: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}): ArchitectSecretSummary {
  return {
    id: row.id,
    name: row.name,
    maskedValue: SECRET_MASK,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/** Normalize and validate a key name. Throws AppError(422) on invalid input. */
export function normalizeSecretName(rawName: string): string {
  const name = (rawName ?? "").trim();
  if (!name) {
    throw new AppError("Give this key a name so you can reference it later.", 422, "SECRET_NAME_REQUIRED");
  }
  if (name.length > SECRET_NAME_MAX_LENGTH) {
    throw new AppError(
      `Key names must be ${SECRET_NAME_MAX_LENGTH} characters or fewer.`,
      422,
      "SECRET_NAME_TOO_LONG"
    );
  }
  return name;
}

function normalizeSecretValue(rawValue: string): string {
  const value = (rawValue ?? "").trim();
  if (!value) {
    throw new AppError("Paste the key value before saving.", 422, "SECRET_VALUE_REQUIRED");
  }
  if (value.length > SECRET_VALUE_MAX_LENGTH) {
    throw new AppError("That value is too long to be an API key.", 422, "SECRET_VALUE_TOO_LONG");
  }
  return value;
}

/**
 * Add a key, or replace the value of an existing key with the same name for
 * this architect (add-or-replace). Returns the masked summary — never the value.
 */
export async function createArchitectSecret(
  architectUserId: string,
  rawName: string,
  rawValue: string
): Promise<ArchitectSecretSummary> {
  const name = normalizeSecretName(rawName);
  const value = normalizeSecretValue(rawValue);
  const valueEncrypted = encryptSecret(value);

  const row = await prisma.architectSecret.upsert({
    where: { architectUserId_name: { architectUserId, name } },
    update: { valueEncrypted },
    create: { architectUserId, name, valueEncrypted },
    select: { id: true, name: true, createdAt: true, updatedAt: true }
  });

  return toSummary(row);
}

/** List an architect's keys, masked and newest first. Never decrypts. */
export async function listArchitectSecrets(
  architectUserId: string
): Promise<ArchitectSecretSummary[]> {
  const rows = await prisma.architectSecret.findMany({
    where: { architectUserId },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" }
  });
  return rows.map(toSummary);
}

/**
 * Delete a key by id, scoped to its owner so one architect can never delete
 * another's key. Returns true if a row was removed.
 */
export async function deleteArchitectSecret(
  architectUserId: string,
  id: string
): Promise<boolean> {
  const result = await prisma.architectSecret.deleteMany({
    where: { id, architectUserId }
  });
  return result.count > 0;
}

/**
 * Decrypt and return a stored key value at call time. Owner-scoped by name.
 * Returns null when the architect has no key with that name. This is the ONLY
 * function that yields plaintext — its result must never be logged or persisted
 * into run context/output. A decryption failure (e.g. a rotated ENCRYPTION_KEY)
 * is allowed to throw; the API Call runtime catches it and records a graceful
 * error rather than crashing the run.
 */
export async function getArchitectSecretValue(
  architectUserId: string,
  rawName: string
): Promise<string | null> {
  const name = (rawName ?? "").trim();
  if (!name) return null;

  const row = await prisma.architectSecret.findUnique({
    where: { architectUserId_name: { architectUserId, name } },
    select: { valueEncrypted: true }
  });
  if (!row) return null;

  return decryptSecret(row.valueEncrypted);
}

/* -------------------------------------------------------------------------- */
/*                          Platform YouTube key pool                         */
/* -------------------------------------------------------------------------- */

/**
 * Parse the YOUTUBE_API_KEY_POOL env value (a JSON array of key strings) into a
 * clean list. Empty-safe: unset, non-JSON, non-array, or all-blank all yield an
 * empty array — never throws.
 */
export function parseYouTubeKeyPool(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

let youTubeRotationCursor = 0;

/** Round-robin pick over a key list. Returns null for an empty list. */
export function rotateKeyPool(keys: string[]): string | null {
  if (keys.length === 0) return null;
  const key = keys[youTubeRotationCursor % keys.length];
  youTubeRotationCursor = (youTubeRotationCursor + 1) % keys.length;
  return key;
}

/**
 * Get the next platform YouTube API key (round-robin over YOUTUBE_API_KEY_POOL)
 * so a YouTube demo works out of the box without the architect adding a key.
 * Returns null when the pool is unset or empty — callers must handle that and
 * fall back to asking the architect to add their own key.
 */
export function getPlatformYouTubeKey(): string | null {
  return rotateKeyPool(parseYouTubeKeyPool(env.YOUTUBE_API_KEY_POOL));
}
