import {
  GOOGLE_CALENDAR_DISCLOSURE_VERSION,
  GOOGLE_CALENDAR_INTEGRATION,
  GOOGLE_DISCLOSURE_ACTION_AGREED
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";

export const DISCLOSURE_CONSENT_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Retention rule (documented in Privacy Policy §9 Data Retention): identifiable
 * consent records are kept for 24 months as compliance evidence, then deleted
 * by the prune script. On account deletion the records are pseudonymized
 * immediately (userId → irreversible token, businessId cleared) so the
 * evidence that a disclosure was agreed to survives without identifying
 * anyone.
 */
export const DISCLOSURE_CONSENT_RETENTION_DAYS = 730;

/** Delete identifiable consent records older than the retention period. */
export async function pruneExpiredDisclosureConsents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DISCLOSURE_CONSENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.integrationDisclosureConsent.deleteMany({
    where: { createdAt: { lt: cutoff } }
  });
  return result.count;
}

/**
 * Account deletion: pseudonymize instead of delete — the record that SOME user
 * agreed to disclosure version X at time T remains as compliance evidence, but
 * it can no longer be tied to the deleted person. The token is a one-way HMAC
 * (no lookup table exists), and businessId is cleared.
 */
export async function pseudonymizeDisclosureConsentsForUser(userId: string): Promise<number> {
  const { createHmac } = await import("node:crypto");
  const token = `deleted:${createHmac("sha256", process.env.JWT_SECRET ?? "consent-pseudonym")
    .update(`disclosure-consent:${userId}`)
    .digest("hex")
    .slice(0, 20)}`;
  const result = await prisma.integrationDisclosureConsent.updateMany({
    where: { userId },
    data: { userId: token, businessId: null }
  });
  return result.count;
}

export class DisclosureConsentError extends Error {
  constructor(
    message: string,
    public status: 409 | 422,
    public code: string
  ) {
    super(message);
    this.name = "DisclosureConsentError";
  }
}

export type RecordDisclosureConsentInput = {
  userId: string;
  businessId?: string | null;
  integration: string;
  disclosureVersion: string;
  action: string;
};

export async function recordDisclosureConsent(input: RecordDisclosureConsentInput): Promise<{
  id: string;
  disclosureVersion: string;
  createdAt: Date;
}> {
  if (input.integration !== GOOGLE_CALENDAR_INTEGRATION) {
    throw new DisclosureConsentError("Unknown integration.", 422, "UNKNOWN_INTEGRATION");
  }
  if (input.action !== GOOGLE_DISCLOSURE_ACTION_AGREED) {
    throw new DisclosureConsentError(
      "Only an explicit agreement is recorded as consent.",
      422,
      "CONSENT_ACTION_INVALID"
    );
  }
  if (input.disclosureVersion !== GOOGLE_CALENDAR_DISCLOSURE_VERSION) {
    throw new DisclosureConsentError(
      "The disclosure shown is out of date. Reload and review the current disclosure.",
      409,
      "DISCLOSURE_VERSION_STALE"
    );
  }

  const record = await prisma.integrationDisclosureConsent.create({
    data: {
      userId: input.userId,
      businessId: input.businessId ?? null,
      integration: input.integration,
      disclosureVersion: input.disclosureVersion,
      action: input.action
    },
    select: { id: true, disclosureVersion: true, createdAt: true }
  });

  return record;
}

/** Whether the user AGREED to the CURRENT disclosure version recently. */
export async function hasFreshDisclosureConsent(params: {
  userId: string;
  integration: string;
  maxAgeMs?: number;
}): Promise<boolean> {
  const cutoff = new Date(Date.now() - (params.maxAgeMs ?? DISCLOSURE_CONSENT_MAX_AGE_MS));

  const record = await prisma.integrationDisclosureConsent.findFirst({
    where: {
      userId: params.userId,
      integration: params.integration,
      action: GOOGLE_DISCLOSURE_ACTION_AGREED,
      disclosureVersion: GOOGLE_CALENDAR_DISCLOSURE_VERSION,
      createdAt: { gte: cutoff }
    },
    select: { id: true }
  });

  return Boolean(record);
}
