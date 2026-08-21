/**
 * ONE BUG IS ONE BUG, HOWEVER MANY TIMES IT HAPPENS.
 *
 * This is what makes the self-healing layer cheap. A broken step does not fail
 * once — it fails on every run, four hundred times before anyone looks. Asking
 * an AI four hundred times what went wrong would cost four hundred times as
 * much and produce four hundred copies of the same sentence.
 *
 * So every failure is reduced to a signature: the smallest description of the
 * CAUSE, with everything specific to one run stripped out. Same signature means
 * same bug, which means one diagnosis, applied to all of them.
 *
 * The stripping is the whole craft. Leave a phone number in and every caller
 * becomes a separate bug. Strip too much and two different faults merge into
 * one and get the wrong answer.
 */

/**
 * Values that make one run different from another and have nothing to do with
 * why it broke.
 *
 * Without this, "no answer for +447700900123" and "no answer for +447700900456"
 * are two bugs, and the platform pays to diagnose the same thing twice a day
 * forever.
 */
function stripRunSpecifics(text: string): string {
  return (
    text
      // Order matters. A date like 2026-08-21 is digits and hyphens, so a
      // phone-number pattern will happily swallow it — and then two failures a
      // few hours apart look like two different bugs for ever.
      .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "{time}")
      .replace(/\d{4}-\d{2}-\d{2}/g, "{date}")
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "{time}")
      // Ids: cuid, uuid, and long hex or base64-ish runs.
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "{id}")
      .replace(/\b[a-z0-9]{20,}\b/gi, "{id}")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "{email}")
      .replace(/[$£€₹]\s?[\d,.]+/g, "{money}")
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "{phone}")
      // Anything else numeric. A count of 3 and a count of 4 are the same fault.
      .replace(/\b\d+\b/g, "{n}")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300)
  );
}

export type FailureFacts = {
  nodeType: string;
  /** "unproven" when it claimed success and delivered nothing. */
  kind: "unproven" | "error";
  /** For unproven: the names it declared and did not return. */
  missingOutputs?: string[];
  /** For error: whatever the step said went wrong. */
  errorMessage?: string;
};

/**
 * The smallest description of a cause.
 *
 * Deliberately readable rather than a hash. Somebody will eventually have to
 * look at a list of these and understand what the platform is spending money
 * diagnosing, and a column of hashes tells them nothing.
 */
export function failureSignature(facts: FailureFacts): string {
  const nodeType = facts.nodeType || "unknown";

  if (facts.kind === "unproven") {
    const missing = [...(facts.missingOutputs ?? [])].sort().join(",");
    return `${nodeType}::unproven::${missing || "nothing-returned"}`;
  }

  return `${nodeType}::error::${stripRunSpecifics(facts.errorMessage ?? "no message")}`;
}

/**
 * How far a fix is allowed to travel.
 *
 * The most valuable thing about this layer is that a fix found for one
 * architect helps every architect after them. It is also the most dangerous
 * thing about it, because the same mechanism can take one business's mistake
 * and spread it across the platform.
 *
 *   generic — a fault in the SHAPE of things: a field named wrongly, a date in
 *             the wrong format, a value nothing produces. True for everyone who
 *             uses that step, so the fix travels.
 *
 *   local   — a fault in ONE account's situation: their Google is not
 *             connected, their key has expired, they are out of credit. Telling
 *             another business to reconnect a calendar they never connected is
 *             worse than saying nothing.
 *
 * Judged from the words, and deliberately biased towards "local": a fix that
 * fails to travel costs one architect a few minutes, and a fix that travels
 * when it should not can quietly break every agent on the platform.
 */
export function fixScopeFor(cause: string): "generic" | "local" {
  const text = (cause ?? "").toLowerCase();

  const localSigns = [
    "not connected",
    "reconnect",
    "expired",
    "credential",
    "api key",
    "token",
    "unauthor",
    "permission",
    "credit",
    "quota",
    "billing",
    "not set up",
    "account",
    "subscription",
    "no key"
  ];
  if (localSigns.some((sign) => text.includes(sign))) return "local";

  const genericSigns = [
    "field",
    "format",
    "shape",
    "name",
    "mapping",
    "produces",
    "missing output",
    "type",
    "path",
    "declare"
  ];
  if (genericSigns.some((sign) => text.includes(sign))) return "generic";

  // Unsure means local. See above: the two mistakes are not the same size.
  return "local";
}

/**
 * May the platform apply this itself, without asking anyone?
 *
 * Only for things that cannot change what a person on the other end receives.
 * A wrong field name is arithmetic and can be corrected silently. Rewriting a
 * message, changing a number, or sending something again is the platform doing
 * something to somebody's customer that no human chose — and that is never
 * automatic, however confident the diagnosis.
 */
export function isSafeToApplyAutomatically(remedy: string): boolean {
  const text = (remedy ?? "").toLowerCase();

  const neverAutomatic = [
    "send",
    "resend",
    "retry the call",
    "call again",
    "text",
    "sms",
    "email them",
    "message",
    "book",
    "cancel",
    "refund",
    "charge",
    "delete",
    "phone number"
  ];
  if (neverAutomatic.some((sign) => text.includes(sign))) return false;

  const safe = ["rename", "map", "field", "format", "path", "declare", "key name", "spelling"];
  return safe.some((sign) => text.includes(sign));
}
