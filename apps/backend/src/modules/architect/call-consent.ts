import type { CallConsentMethod } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/**
 * CONSENT TO BE PHONED — the record that makes an AI sales call lawful.
 *
 * In February 2024 the FCC ruled that an AI-generated voice is an "artificial
 * voice" under the TCPA. A sales call placed with one therefore needs that
 * person's prior express consent, and consent cannot be bought: a purchased
 * list is never consent. Exposure is $500 per call, $1,500 if willful, with a
 * private right of action — so a thousand careless calls is a million-dollar
 * mistake plus a class action.
 *
 * The platform's answer is not a policy page. It is this table plus one check
 * in the runner: no OPTED_IN row for that person and that business, no call.
 * An architect cannot switch it off, and a buyer cannot import their way past
 * it — the only ways in are the ones below, each of which records HOW the
 * person said yes and WHAT they were shown when they said it.
 */

/** Digits-only comparison, so +1 (702) 623-2235 and +17026232235 are one person. */
function normalizePhone(raw: string): string {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

export type CallConsentDecision =
  | { allowed: true; consentId: string; method: CallConsentMethod }
  | { allowed: false; reason: string };

/**
 * May this business place an AI voice call to this number right now?
 *
 * Deliberately fails CLOSED: an unknown number, a revoked consent, or a
 * database error all mean "no". A missed call is a lost sale; an unlawful
 * call is a lawsuit.
 */
export async function mayCallNumber(args: {
  businessId: string | null | undefined;
  phoneNumber: string | null | undefined;
}): Promise<CallConsentDecision> {
  const businessId = (args.businessId ?? "").trim();
  const phone = normalizePhone(args.phoneNumber ?? "");
  if (!businessId) return { allowed: false, reason: "no business on this run" };
  if (phone.length < 8) return { allowed: false, reason: "no valid phone number" };

  try {
    const consent = await prisma.callConsent.findUnique({
      where: { businessId_phoneNumber: { businessId, phoneNumber: phone } },
      select: { id: true, status: true, method: true, revokedAt: true }
    });

    if (!consent) {
      return { allowed: false, reason: "this person has not asked to be called" };
    }
    if (consent.status !== "OPTED_IN" || consent.revokedAt) {
      return { allowed: false, reason: "this person opted out of calls" };
    }
    return { allowed: true, consentId: consent.id, method: consent.method };
  } catch (error) {
    console.error("[call-consent] lookup failed", {
      businessId,
      message: error instanceof Error ? error.message : String(error)
    });
    return { allowed: false, reason: "consent could not be verified" };
  }
}

/** Write (or refresh) a person's consent to be called by one business. */
export async function recordCallConsent(args: {
  businessId: string;
  installedAgentId?: string | null;
  phoneNumber: string;
  method: CallConsentMethod;
  evidence?: string;
  disclosureText?: string;
}): Promise<{ id: string; phoneNumber: string }> {
  const phone = normalizePhone(args.phoneNumber);
  if (phone.length < 8) throw new Error("A valid phone number is required.");

  const row = await prisma.callConsent.upsert({
    where: { businessId_phoneNumber: { businessId: args.businessId, phoneNumber: phone } },
    create: {
      businessId: args.businessId,
      installedAgentId: args.installedAgentId ?? null,
      phoneNumber: phone,
      method: args.method,
      evidence: args.evidence ?? null,
      disclosureText: args.disclosureText ?? null,
      status: "OPTED_IN"
    },
    update: {
      // Saying yes again after opting out is allowed, and clears the old no.
      status: "OPTED_IN",
      revokedAt: null,
      revokedReason: null,
      method: args.method,
      evidence: args.evidence ?? null,
      disclosureText: args.disclosureText ?? null,
      consentAt: new Date(),
      ...(args.installedAgentId ? { installedAgentId: args.installedAgentId } : {})
    },
    select: { id: true, phoneNumber: true }
  });

  return row;
}

/** "Do not call me again." Must always work, from any channel, immediately. */
export async function revokeCallConsent(args: {
  businessId: string;
  phoneNumber: string;
  reason?: string;
}): Promise<boolean> {
  const phone = normalizePhone(args.phoneNumber);
  const updated = await prisma.callConsent.updateMany({
    where: { businessId: args.businessId, phoneNumber: phone },
    data: { status: "OPTED_OUT", revokedAt: new Date(), revokedReason: args.reason ?? "requested" }
  });
  return updated.count > 0;
}
