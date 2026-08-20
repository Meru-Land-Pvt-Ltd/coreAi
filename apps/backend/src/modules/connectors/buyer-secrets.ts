/**
 * A BUSINESS'S OWN KEY, HANDLED THE WAY EVERY OTHER CREDENTIAL ON THIS
 * PLATFORM IS HANDLED.
 *
 * The setup form can ask a business for their own API key — their Apollo,
 * their Instantly. Marking that field `secret` made the browser render a
 * password box, and nothing more: the typed value went into
 * InstalledAgent.configJson as plain text, unlike every other credential here,
 * which goes through encryptSecret.
 *
 * That was my mistake and this file is the fix. Three rules, and they are not
 * optional:
 *
 *   1. A secret is encrypted before it is written.
 *   2. A secret is decrypted only at the moment a heart needs it.
 *   3. A secret is NEVER sent back to a browser — not even to the person who
 *      typed it. The form shows that a key is saved; it never shows the key.
 */

import type { BuyerContract } from "@coreai/shared";
import { decryptSecret, encryptSecret } from "../../lib/crypto";

/**
 * Marks a stored string as encrypted by this module.
 *
 * Needed because these answers live in a shared JSON blob alongside plain
 * values, and a stored key written before this file existed is still sitting
 * there in the clear. The prefix is what tells the two apart, so old rows keep
 * working and get re-sealed the next time the business saves.
 */
const SEALED = "enc:v1:";

/** What the browser is shown in place of a saved key. */
export const SECRET_PLACEHOLDER = "••••••••";

function secretKeysOf(contract: BuyerContract): Set<string> {
  return new Set(contract.inputs.filter((input) => input.kind === "secret").map((input) => input.key));
}

/**
 * Decrypt by key list rather than by contract.
 *
 * The run time holds a ConnectorContract, not the buyer-facing one, and its
 * secret keys are exactly the platform credentials a business may supply
 * themselves. Same code, so the two can never disagree about what a secret is.
 */
export function openSecretValues(
  secretKeys: string[],
  answers: Record<string, unknown>
): Record<string, unknown> {
  const opened: Record<string, unknown> = { ...answers };
  for (const key of secretKeys) {
    const value = opened[key];
    if (typeof value !== "string" || !isSealed(value)) continue;
    try {
      opened[key] = decryptSecret(value.slice(SEALED.length));
    } catch {
      console.warn(`[connectors] could not decrypt the saved secret for "${key}"`);
      delete opened[key];
    }
  }
  return opened;
}

export function isSealed(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(SEALED);
}

/**
 * Encrypt every secret answer before it is written to the database.
 *
 * A submitted value equal to the placeholder means "I did not retype my key" —
 * the browser was showing dots and the business pressed save. Keeping the
 * stored value is the only correct reading of that; overwriting it with dots
 * would silently destroy a working key.
 */
export function sealBuyerAnswers(
  contract: BuyerContract,
  answers: Record<string, unknown>,
  previous: Record<string, unknown> = {}
): Record<string, unknown> {
  const sealed: Record<string, unknown> = { ...answers };

  for (const key of secretKeysOf(contract)) {
    const value = sealed[key];
    if (typeof value !== "string" || value === "") continue;

    // The browser was showing dots and the business pressed save without
    // retyping. That means "leave my key alone" — putting the dots through the
    // encrypter would destroy a working credential and the business would only
    // find out when their agent stopped finding leads.
    if (value === SECRET_PLACEHOLDER) {
      const kept = previous[key];
      if (typeof kept === "string" && kept !== "") sealed[key] = kept;
      else delete sealed[key];
      continue;
    }

    if (isSealed(value)) continue;
    sealed[key] = `${SEALED}${encryptSecret(value)}`;
  }

  return sealed;
}

/**
 * Decrypt secrets so a heart can use them. Called at run time and nowhere else.
 *
 * A value that will not decrypt is dropped rather than passed through. Handing
 * a heart a corrupted string produces a confusing 401 from the provider; a
 * missing key produces the engine's own plain sentence about the connector not
 * being connected yet, which is the truth.
 */
export function openBuyerAnswers(
  contract: BuyerContract,
  answers: Record<string, unknown>
): Record<string, unknown> {
  const opened: Record<string, unknown> = { ...answers };

  for (const key of secretKeysOf(contract)) {
    const value = opened[key];
    if (typeof value !== "string") continue;
    if (!isSealed(value)) continue; // written before this file existed
    try {
      opened[key] = decryptSecret(value.slice(SEALED.length));
    } catch {
      console.warn(`[connectors] could not decrypt the saved secret for "${key}"`);
      delete opened[key];
    }
  }

  return opened;
}

/**
 * What the setup form is allowed to see.
 *
 * The business gets to know whether a key is saved. They do not get the key
 * back — a screen-share, a support session or a stolen session cookie should
 * not be able to read out a credential they typed six months ago.
 */
export function maskBuyerAnswers(
  contract: BuyerContract,
  answers: Record<string, unknown>
): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...answers };

  for (const key of secretKeysOf(contract)) {
    if (typeof masked[key] === "string" && masked[key] !== "") masked[key] = SECRET_PLACEHOLDER;
  }

  return masked;
}
