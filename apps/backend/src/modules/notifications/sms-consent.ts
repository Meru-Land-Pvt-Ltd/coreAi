import crypto from "crypto";
import type { SmsConsent, SmsConsentMethod, SmsMessageType } from "@prisma/client";
import {
  SMS_CONSENT_DISCLOSURE_VERSION,
  SMS_CONSENT_SUPPORT_EMAIL,
  SMS_MESSAGING_PROGRAM_TRANSACTIONAL_BOOKING,
  verbalSmsConsentDisclosure,
  webFormSmsConsentDisclosure
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { validateSmsRecipientE164 } from "../architect/twilio-connector";

export {
  SMS_CONSENT_DISCLOSURE_VERSION,
  SMS_MESSAGING_PROGRAM_TRANSACTIONAL_BOOKING,
  verbalSmsConsentDisclosure,
  webFormSmsConsentDisclosure
};

/** SHA-256 of the exact disclosure text presented — immutable evidence. */
export function smsDisclosureHash(disclosureText: string): string {
  return crypto.createHash("sha256").update(disclosureText, "utf8").digest("hex");
}

/** Phone rendering that is safe to log — never log full phone numbers. */
export function maskPhone(phone: string | null | undefined): string {
  const value = (phone ?? "").trim();
  if (value.length <= 4) return value ? "***" : "(none)";
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

const CONSENT_EXEMPT_MESSAGE_TYPES: ReadonlySet<SmsMessageType> = new Set([
  "TEST_SMS",
  "TEAM_NOTIFICATION"
] as SmsMessageType[]);

export function messagingProgramForMessageType(type: SmsMessageType): string | null {
  if (CONSENT_EXEMPT_MESSAGE_TYPES.has(type)) return null;
  return SMS_MESSAGING_PROGRAM_TRANSACTIONAL_BOOKING;
}

export type SmsConsentDenialReason =
  | "SMS_CONSENT_REQUIRED"
  | "SMS_OPTED_OUT"
  | "INVALID_PHONE"
  | "MISSING_BUSINESS";

export type SmsAuthorizationResult =
  | { allowed: true; consentId: string }
  | { allowed: false; reason: SmsConsentDenialReason };

export async function canSendTransactionalSms(input: {
  businessId: string | null | undefined;
  phoneNumber: string;
  messagingProgram: string;
}): Promise<SmsAuthorizationResult> {
  if (!input.businessId) return { allowed: false, reason: "MISSING_BUSINESS" };

  const recipient = validateSmsRecipientE164(input.phoneNumber);
  if (!recipient.ok) return { allowed: false, reason: "INVALID_PHONE" };

  const consent = await prisma.smsConsent.findUnique({
    where: {
      businessId_phoneNumber_messagingProgram: {
        businessId: input.businessId,
        phoneNumber: recipient.e164,
        messagingProgram: input.messagingProgram
      }
    }
  });

  if (!consent) return { allowed: false, reason: "SMS_CONSENT_REQUIRED" };
  if (consent.status === "OPTED_OUT") return { allowed: false, reason: "SMS_OPTED_OUT" };
  // Defensive: a later opt-out always wins even if status drifted.
  if (consent.optOutAt && (!consent.consentAt || consent.optOutAt > consent.consentAt)) {
    return { allowed: false, reason: "SMS_OPTED_OUT" };
  }
  if (!consent.consentAt) return { allowed: false, reason: "SMS_CONSENT_REQUIRED" };
  return { allowed: true, consentId: consent.id };
}

/**
 * Compact consent label injected into the live call as the
 * {{smsConsentStatus}} runtime variable, so the assistant only reads the
 * disclosure when consent doesn't already exist.
 */
export async function getSmsConsentStatusLabel(
  businessId: string | null | undefined,
  phoneNumber: string | null | undefined
): Promise<"granted" | "declined" | "none"> {
  if (!businessId || !phoneNumber) return "none";
  const recipient = validateSmsRecipientE164(phoneNumber);
  if (!recipient.ok) return "none";
  const consent = await prisma.smsConsent
    .findUnique({
      where: {
        businessId_phoneNumber_messagingProgram: {
          businessId,
          phoneNumber: recipient.e164,
          messagingProgram: SMS_MESSAGING_PROGRAM_TRANSACTIONAL_BOOKING
        }
      },
      select: { status: true, consentAt: true }
    })
    .catch(() => null);
  if (!consent) return "none";
  return consent.status === "OPTED_IN" && consent.consentAt ? "granted" : "declined";
}

export type RecordConsentOutcome =
  | { ok: true; consent: SmsConsent; created: boolean }
  | { ok: false; error: string };

type RecordConsentBase = {
  businessId: string;
  installedAgentId?: string | null;
  phoneNumber: string;
  /** Business name presented to the customer in the disclosure. */
  businessName: string;
  messagingProgram?: string;
};

async function upsertConsentDecision(input: {
  base: RecordConsentBase;
  method: SmsConsentMethod;
  affirmative: boolean;
  disclosureText: string;
  vapiCallId?: string | null;
  appointmentId?: string | null;
  sourceUrl?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<RecordConsentOutcome> {
  const recipient = validateSmsRecipientE164(input.base.phoneNumber);
  if (!recipient.ok) return { ok: false, error: recipient.error };

  const business = await prisma.business.findUnique({
    where: { id: input.base.businessId },
    select: { id: true }
  });
  if (!business) return { ok: false, error: "Business not found for SMS consent." };

  const messagingProgram =
    input.base.messagingProgram ?? SMS_MESSAGING_PROGRAM_TRANSACTIONAL_BOOKING;
  const now = new Date();
  const where = {
    businessId_phoneNumber_messagingProgram: {
      businessId: input.base.businessId,
      phoneNumber: recipient.e164,
      messagingProgram
    }
  };
  const evidence = {
    installedAgentId: input.base.installedAgentId ?? null,
    method: input.method,
    businessNamePresented: input.base.businessName,
    disclosureVersion: SMS_CONSENT_DISCLOSURE_VERSION,
    disclosureHash: smsDisclosureHash(input.disclosureText),
    ...(input.vapiCallId !== undefined ? { vapiCallId: input.vapiCallId } : {}),
    ...(input.appointmentId !== undefined ? { appointmentId: input.appointmentId } : {}),
    ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
    ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {})
  };

  const existing = await prisma.smsConsent.findUnique({ where, select: { id: true } });

  if (input.affirmative) {
    const consent = await prisma.smsConsent.upsert({
      where,
      update: { ...evidence, status: "OPTED_IN", consentAt: now, optOutAt: null, optOutSource: null },
      create: {
        businessId: input.base.businessId,
        phoneNumber: recipient.e164,
        messagingProgram,
        status: "OPTED_IN",
        consentAt: now,
        ...evidence
      }
    });
    return { ok: true, consent, created: !existing };
  }

  const consent = await prisma.smsConsent.upsert({
    where,
    update: { ...evidence, status: "OPTED_OUT", optOutAt: now, optOutSource: "VERBAL_DECLINE" },
    create: {
      businessId: input.base.businessId,
      phoneNumber: recipient.e164,
      messagingProgram,
      status: "OPTED_OUT",
      optOutAt: now,
      optOutSource: "VERBAL_DECLINE",
      ...evidence
    }
  });
  return { ok: true, consent, created: !existing };
}

export async function recordVerbalSmsConsent(
  input: RecordConsentBase & { vapiCallId: string | null; affirmative: boolean }
): Promise<RecordConsentOutcome> {
  return upsertConsentDecision({
    base: input,
    method: "VERBAL_CALL",
    affirmative: input.affirmative,
    disclosureText: verbalSmsConsentDisclosure(input.businessName),
    vapiCallId: input.vapiCallId
  });
}

export async function recordWebFormSmsConsent(
  input: RecordConsentBase & {
    appointmentId?: string | null;
    sourceUrl?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<RecordConsentOutcome> {
  return upsertConsentDecision({
    base: input,
    method: "WEB_FORM",
    affirmative: true,
    disclosureText: webFormSmsConsentDisclosure(input.businessName),
    appointmentId: input.appointmentId ?? null,
    sourceUrl: input.sourceUrl ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  });
}

/* ------------------------- STOP / START / HELP ---------------------------- */

export type InboundSmsKeyword = "STOP" | "START" | "HELP";

const STOP_KEYWORDS = new Set(["stop", "stopall", "stop all", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "opt out"]);
const START_KEYWORDS = new Set(["start", "unstop", "yes", "subscribe"]);
const HELP_KEYWORDS = new Set(["help", "info"]);

export function classifyInboundSmsKeyword(
  body: string | null | undefined,
  optOutType?: string | null
): InboundSmsKeyword | null {
  const fromTwilio = (optOutType ?? "").trim().toUpperCase();
  if (fromTwilio === "STOP" || fromTwilio === "START" || fromTwilio === "HELP") return fromTwilio;

  const text = (body ?? "").trim().toLowerCase().replace(/[.!]+$/, "");
  if (STOP_KEYWORDS.has(text)) return "STOP";
  if (START_KEYWORDS.has(text)) return "START";
  if (HELP_KEYWORDS.has(text)) return "HELP";
  return null;
}

export async function applySmsOptOut(input: {
  phoneNumber: string;
  businessId?: string | null;
  source?: string;
}): Promise<{ updated: number }> {
  const recipient = validateSmsRecipientE164(input.phoneNumber);
  if (!recipient.ok) return { updated: 0 };

  const result = await prisma.smsConsent.updateMany({
    where: {
      phoneNumber: recipient.e164,
      ...(input.businessId ? { businessId: input.businessId } : {}),
      status: "OPTED_IN"
    },
    data: {
      status: "OPTED_OUT",
      optOutAt: new Date(),
      optOutSource: input.source ?? "SMS_STOP"
    }
  });
  return { updated: result.count };
}

export async function applySmsReOptIn(input: {
  phoneNumber: string;
  businessId?: string | null;
}): Promise<{ updated: number }> {
  const recipient = validateSmsRecipientE164(input.phoneNumber);
  if (!recipient.ok) return { updated: 0 };

  const result = await prisma.smsConsent.updateMany({
    where: {
      phoneNumber: recipient.e164,
      ...(input.businessId ? { businessId: input.businessId } : {}),
      status: "OPTED_OUT",
      optOutSource: "SMS_STOP",
      consentAt: { not: null }
    },
    data: { status: "OPTED_IN", optOutAt: null, optOutSource: null }
  });
  return { updated: result.count };
}

/** Support text for HELP replies (only sent when Twilio auto-replies are off). */
export function smsHelpReplyText(): string {
  return (
    "Triven.ai: transactional appointment & service messages sent on behalf of " +
    `the business you contacted. For support email ${SMS_CONSENT_SUPPORT_EMAIL}. ` +
    "Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out."
  );
}
