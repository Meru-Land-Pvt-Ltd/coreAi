import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { BusinessEmailAlias, EmailPurpose, EmailReplyHandlingMode, Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

const MAX_LOCAL_PART_LENGTH = 50;
const OUTBOUND_PER_HOUR_LIMIT = 50;
const MAX_BODY_LENGTH = 100_000;

export const RESERVED_LOCAL_PARTS = new Set([
  "admin",
  "support",
  "abuse",
  "postmaster",
  "security",
  "billing",
  "sales",
  "hello",
  "help",
  "info",
  "contact",
  "mailer-daemon",
  "noreply",
  "no-reply",
  "notifications",
  "triven",
  "root",
  "system"
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_PART_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,48}[a-z0-9])?$/;

class AliasTakenError extends Error {
  constructor(localPart: string) {
    super(`Alias "${localPart}" is already taken.`);
    this.name = "AliasTakenError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

let sesClient: SESv2Client | null = null;

export function isSesConfigured(): boolean {
  return (
    Boolean((env.SES_REGION ?? env.AWS_REGION) && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) &&
    !env.SES_DRY_RUN
  );
}

function getSesClient(): SESv2Client {
  if (!sesClient) {
    sesClient = new SESv2Client({
      region: env.SES_REGION ?? env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string
      }
    });
  }
  return sesClient;
}

export function isValidEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/* ---------------------------------- alias ---------------------------------- */

/** "Smile Dental!" → "smile-dental" — lowercase, a-z/0-9/hyphen/dot only. */
export function normalizeEmailAliasLocalPart(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/[-.]{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, MAX_LOCAL_PART_LENGTH)
    .replace(/[-.]+$/g, "");
}

export type LocalPartIssue = { field: "localPart"; message: string };

export function validateLocalPart(localPart: string): LocalPartIssue | null {
  if (!localPart) return { field: "localPart", message: "Email alias is required." };
  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    return { field: "localPart", message: `Email alias must be at most ${MAX_LOCAL_PART_LENGTH} characters.` };
  }
  if (!LOCAL_PART_PATTERN.test(localPart)) {
    return {
      field: "localPart",
      message: "Email alias can only contain lowercase letters, numbers, hyphens, and dots."
    };
  }
  if (RESERVED_LOCAL_PARTS.has(localPart)) {
    return { field: "localPart", message: `"${localPart}" is reserved — pick a different alias.` };
  }
  return null;
}

export function aliasEmailAddress(localPart: string): string {
  return `${localPart}@${env.SES_FROM_DOMAIN}`;
}

/** Free localPart derived from the business name ("-2", "-3" suffix when taken). */
export async function generateSuggestedAlias(businessName: string): Promise<string> {
  const base = normalizeEmailAliasLocalPart(businessName) || "business";
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (RESERVED_LOCAL_PARTS.has(candidate)) continue;
    const taken = await prisma.businessEmailAlias.findUnique({
      where: { emailAddress: aliasEmailAddress(candidate) },
      select: { id: true }
    });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now() % 100000}`;
}

export async function isLocalPartAvailable(localPart: string, forBusinessId?: string): Promise<boolean> {
  const existing = await prisma.businessEmailAlias.findUnique({
    where: { emailAddress: aliasEmailAddress(localPart) },
    select: { businessId: true }
  });
  return !existing || existing.businessId === forBusinessId;
}

export async function getBusinessEmailAlias(businessId: string): Promise<BusinessEmailAlias | null> {
  return prisma.businessEmailAlias.findFirst({
    where: { businessId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" }
  });
}

export async function createOrUpdateBusinessEmailAlias(input: {
  businessId: string;
  buyerUserId: string;
  installedAgentId?: string | null;
  localPart: string;
  displayName: string;
  forwardToEmail?: string | null;
  replyHandlingMode?: EmailReplyHandlingMode;
  customerConfirmationEnabled?: boolean;
  internalSummaryEnabled?: boolean;
}): Promise<{ ok: true; alias: BusinessEmailAlias } | { ok: false; error: string }> {
  const localPart = normalizeEmailAliasLocalPart(input.localPart);
  const issue = validateLocalPart(localPart);
  if (issue) return { ok: false, error: issue.message };

  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: "Sender name is required." };

  const forwardToEmail = input.forwardToEmail?.trim() || null;
  if (forwardToEmail && !isValidEmailAddress(forwardToEmail)) {
    return { ok: false, error: "Forward-to email must be a valid email address." };
  }

  // Availability re-check and the claim run inside one transaction; the unique
  // constraint on emailAddress is the final arbiter for concurrent claims.
  let alias: BusinessEmailAlias;
  let existing: BusinessEmailAlias | null;
  try {
    [existing, alias] = await prisma.$transaction(async (tx) => {
      const taken = await tx.businessEmailAlias.findUnique({
        where: { emailAddress: aliasEmailAddress(localPart) },
        select: { businessId: true }
      });
      if (taken && taken.businessId !== input.businessId) {
        throw new AliasTakenError(localPart);
      }

      const current = await tx.businessEmailAlias.findFirst({
        where: { businessId: input.businessId, status: { not: "ARCHIVED" } },
        orderBy: { createdAt: "desc" }
      });

      const data = {
        localPart,
        domain: env.SES_FROM_DOMAIN,
        emailAddress: aliasEmailAddress(localPart),
        displayName,
        forwardToEmail,
        replyHandlingMode: input.replyHandlingMode ?? ("TRIVEN_AND_FORWARD" as const),
        customerConfirmationEnabled:
          input.customerConfirmationEnabled ?? current?.customerConfirmationEnabled ?? true,
        internalSummaryEnabled: input.internalSummaryEnabled ?? current?.internalSummaryEnabled ?? true,
        status: "ACTIVE" as const,
        installedAgentId: input.installedAgentId ?? current?.installedAgentId ?? null,
        lastError: null
      };

      const saved = current
        ? await tx.businessEmailAlias.update({ where: { id: current.id }, data })
        : await tx.businessEmailAlias.create({
            data: { ...data, businessId: input.businessId, buyerUserId: input.buyerUserId }
          });

      return [current, saved] as const;
    });
  } catch (error) {
    if (error instanceof AliasTakenError || isUniqueViolation(error)) {
      return { ok: false, error: `"${localPart}" is already taken — pick a different alias.` };
    }
    throw error;
  }

  // Audit trail for alias changes (identifiers only — never credentials).
  if (existing && existing.emailAddress !== alias.emailAddress) {
    console.log(
      `[email] alias changed for business ${input.businessId}: ${existing.emailAddress} -> ${alias.emailAddress} (by user ${input.buyerUserId})`
    );
  } else if (!existing) {
    console.log(`[email] alias created for business ${input.businessId}: ${alias.emailAddress}`);
  }

  return { ok: true, alias };
}

/* --------------------------------- outbound -------------------------------- */

/** Recipient on the suppression list, or previously bounced/complained. */
export async function isEmailSuppressed(toEmail: string): Promise<boolean> {
  const email = toEmail.toLowerCase();

  const entry = await prisma.emailSuppression.findUnique({
    where: { emailAddress: email },
    select: { active: true }
  });
  if (entry) return entry.active;

  /* Legacy fallback: messages marked before the suppression table existed.
     A COMPLAINT is a person saying "stop", and it should stop everyone. A
     BOUNCE is one delivery failing — a full mailbox, a server down — and
     treating it as permanent, platform-wide, silence for that person is how a
     business loses a customer they never knew they had stopped writing to.
     The suppression table above is the real record; this is only for rows
     that predate it. */
  const suppressed = await prisma.emailMessage.findFirst({
    where: { toEmail: email, status: "COMPLAINED" },
    select: { id: true }
  });
  return Boolean(suppressed);
}

/** Add (or re-activate) a suppression entry. Reason is stored for admin review. */
export async function addEmailSuppression(
  emailAddress: string,
  reason: string,
  source = "SES"
): Promise<void> {
  const email = emailAddress.toLowerCase();
  await prisma.emailSuppression.upsert({
    where: { emailAddress: email },
    update: { active: true, reason: reason.slice(0, 500), source },
    create: { emailAddress: email, reason: reason.slice(0, 500), source }
  });
}

async function isRateLimited(businessId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const sentLastHour = await prisma.emailMessage.count({
    where: { businessId, direction: "OUTBOUND", createdAt: { gte: oneHourAgo } }
  });
  return sentLastHour >= OUTBOUND_PER_HOUR_LIMIT;
}

export type SendBusinessEmailInput = {
  businessId: string;
  to: string;
  cc?: string[] | null;
  bcc?: string[] | null;
  subject: string;
  textBody: string;
  htmlBody?: string;
  purpose: EmailPurpose;
  installedAgentId?: string | null;
  threadKey?: string | null;
  inReplyTo?: string | null;
  /** Stable dedupe key (e.g. "booking_confirmation:<callId>") — a repeat send with the same key is a no-op. */
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Normalize a cc/bcc list: trim + lowercase, drop invalid entries, dedupe, and
 * remove overlap with earlier recipient tiers (to > cc > bcc). Suppressed
 * recipients are filtered out (the primary recipient blocks the send instead).
 */
async function normalizeSecondaryRecipients(
  raw: string[] | null | undefined,
  exclude: Set<string>
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of raw ?? []) {
    const email = entry.trim().toLowerCase();
    if (!email || !isValidEmailAddress(email) || exclude.has(email)) continue;
    if (await isEmailSuppressed(email)) {
      console.log(`[email] dropped suppressed cc/bcc recipient ${email}`);
      continue;
    }
    exclude.add(email);
    result.push(email);
  }
  return result;
}

export type SendBusinessEmailResult =
  | { ok: true; messageId: string; dryRun: boolean; duplicate?: boolean }
  | { ok: false; error: string };

/**
 * Send one transactional email from the business's proxy alias. Every attempt
 * (sent, dry-run, or failed) is stored as an EmailMessage row.
 */
/** Sentinel recipient resolved to the alias's forward-to (buyer team) address. */
export const TEAM_RECIPIENT = "__team__";

export async function sendBusinessEmail(input: SendBusinessEmailInput): Promise<SendBusinessEmailResult> {
  const alias = await getBusinessEmailAlias(input.businessId);
  if (!alias || alias.status !== "ACTIVE") {
    return { ok: false, error: "No active email alias — complete Mail Setup first." };
  }

  const requestedTo = input.to.trim();
  if (requestedTo === TEAM_RECIPIENT && !alias.forwardToEmail) {
    return { ok: false, error: "No forward-to email configured for team notifications." };
  }
  const to = (requestedTo === TEAM_RECIPIENT ? (alias.forwardToEmail as string) : requestedTo).toLowerCase();
  if (!isValidEmailAddress(to)) return { ok: false, error: `Invalid recipient email: ${input.to}` };

  const idempotencyKey = input.idempotencyKey?.trim() || null;
  // A FAILED record with the same key is a retry candidate (queue backoff);
  // anything else means the message was already handled.
  let retryRecordId: string | null = null;
  if (idempotencyKey) {
    const existing = await prisma.emailMessage.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true }
    });
    if (existing && existing.status !== "FAILED") {
      return { ok: true, messageId: existing.id, dryRun: false, duplicate: true };
    }
    retryRecordId = existing?.id ?? null;
  }

  const fromDisplay = `${alias.displayName} via Triven`;
  const fromEmail = alias.emailAddress;

  if (await isEmailSuppressed(to)) {
    // Record the blocked attempt so it is visible in admin/dashboards.
    try {
      await prisma.emailMessage.create({
        data: {
          businessId: input.businessId,
          installedAgentId: input.installedAgentId ?? alias.installedAgentId,
          aliasId: alias.id,
          direction: "OUTBOUND",
          fromEmail,
          toEmail: to,
          replyToEmail: fromEmail,
          subject: input.subject.slice(0, 500),
          status: "SUPPRESSED",
          purpose: input.purpose,
          idempotencyKey,
          metadata: { ...(input.metadata ?? {}), suppressed: true } as never
        }
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    return { ok: false, error: `Recipient ${to} is suppressed after a bounce/complaint.` };
  }
  if (await isRateLimited(input.businessId)) {
    /* IT VANISHED WITH NO RECORD. A refused send returned before the message
       row was created, so the fifty-first email in an hour left no trace at
       all: not in the business's own mail list, not in the admin's. The
       suppression branch just above writes its refusal down; this one did
       not. A message we refused to send is still a message that existed. */
    try {
      await prisma.emailMessage.create({
        data: {
          businessId: input.businessId ?? null,
          aliasId: alias?.id ?? null,
          direction: "OUTBOUND",
          fromEmail,
          toEmail: to,
          replyToEmail: fromEmail,
          subject: input.subject.slice(0, 500),
          status: "FAILED",
          purpose: input.purpose,
          idempotencyKey,
          metadata: {
            ...(input.metadata ?? {}),
            refused: "hourly limit reached for this business"
          } as never
        }
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    return { ok: false, error: "Email rate limit reached for this business — try again later." };
  }

  const configured = isSesConfigured();
  const dryRun = !configured;

  // to > cc > bcc precedence; overlapping addresses stay in the highest tier.
  const seen = new Set<string>([to]);
  const ccEmails = await normalizeSecondaryRecipients(input.cc, seen);
  const bccEmails = await normalizeSecondaryRecipients(input.bcc, seen);

  const recordData = {
    businessId: input.businessId,
    installedAgentId: input.installedAgentId ?? alias.installedAgentId,
    aliasId: alias.id,
    direction: "OUTBOUND" as const,
    fromEmail,
    toEmail: to,
    ccEmails,
    bccEmails,
    replyToEmail: fromEmail,
    subject: input.subject.slice(0, 500),
    textBody: input.textBody.slice(0, MAX_BODY_LENGTH),
    htmlBody: input.htmlBody?.slice(0, MAX_BODY_LENGTH) ?? null,
    status: "QUEUED" as const,
    purpose: input.purpose,
    threadKey: input.threadKey ?? null,
    inReplyTo: input.inReplyTo ?? null,
    idempotencyKey,
    metadata: ({ ...(input.metadata ?? {}), fromDisplay, ...(dryRun ? { dryRun: true } : {}) }) as never
  };

  let record: { id: string };
  try {
    record = retryRecordId
      ? await prisma.emailMessage.update({ where: { id: retryRecordId }, data: recordData })
      : await prisma.emailMessage.create({ data: recordData });
  } catch (error) {
    // Concurrent duplicate with the same idempotency key lost the race — treat as already sent.
    if (idempotencyKey && isUniqueViolation(error)) {
      const winner = await prisma.emailMessage.findUnique({
        where: { idempotencyKey },
        select: { id: true }
      });
      if (winner) return { ok: true, messageId: winner.id, dryRun: false, duplicate: true };
    }
    throw error;
  }

  if (dryRun) {
    if (env.NODE_ENV === "production" && !env.SES_DRY_RUN) {
      await prisma.emailMessage.update({
        where: { id: record.id },
        data: { status: "FAILED", metadata: { ...(input.metadata ?? {}), error: "SES is not configured" } as never }
      });
      return { ok: false, error: "Email is not configured (SES). Contact support." };
    }

    await prisma.emailMessage.update({
      where: { id: record.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: `dry-run-${record.id}` }
    });
    console.log(`[email] DRY RUN ${input.purpose}: "${fromDisplay} <${fromEmail}>" -> ${to} | ${input.subject}`);
    return { ok: true, messageId: record.id, dryRun: true };
  }

  try {
    const command = new SendEmailCommand({
      FromEmailAddress: `${fromDisplay} <${fromEmail}>`,
      Destination: {
        ToAddresses: [to],
        ...(ccEmails.length ? { CcAddresses: ccEmails } : {}),
        ...(bccEmails.length ? { BccAddresses: bccEmails } : {})
      },
      ReplyToAddresses: [fromEmail],
      ...(env.SES_CONFIGURATION_SET ? { ConfigurationSetName: env.SES_CONFIGURATION_SET } : {}),
      Content: {
        Simple: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: input.textBody, Charset: "UTF-8" },
            ...(input.htmlBody ? { Html: { Data: input.htmlBody, Charset: "UTF-8" } } : {})
          }
        }
      }
    });

    const response = await getSesClient().send(command);
    await prisma.emailMessage.update({
      where: { id: record.id },
      data: { status: "SENT", sentAt: new Date(), sesMessageId: response.MessageId ?? null }
    });
    return { ok: true, messageId: record.id, dryRun: false };
  } catch (error) {
    // Store the failure without any credential material.
    const message = error instanceof Error ? error.message.slice(0, 500) : "SES send failed";
    await prisma.emailMessage.update({
      where: { id: record.id },
      data: { status: "FAILED", metadata: { ...(input.metadata ?? {}), error: message } as never }
    });
    console.error(`[email] SES send failed for business ${input.businessId}: ${message}`);
    return { ok: false, error: `Email send failed: ${message}` };
  }
}

/* ------------------------- generic template wrappers ------------------------ */

/** Customer-facing follow-up / booking confirmation. Generic — never industry-specific. */
export async function sendCustomerFollowUpEmail(input: {
  businessId: string;
  customerEmail: string;
  customerName?: string | null;
  businessName: string;
  appointmentTime?: string | null;
  serviceName?: string | null;
  extraNotes?: string | null;
  purpose?: Extract<EmailPurpose, "BOOKING_CONFIRMATION" | "CUSTOMER_FOLLOW_UP">;
  idempotencyKey?: string | null;
}): Promise<SendBusinessEmailResult> {
  const alias = await getBusinessEmailAlias(input.businessId);
  if (alias && !alias.customerConfirmationEnabled) {
    return { ok: false, error: "Customer email confirmations are disabled in Mail Setup." };
  }

  const purpose = input.purpose ?? (input.appointmentTime ? "BOOKING_CONFIRMATION" : "CUSTOMER_FOLLOW_UP");
  const greeting = input.customerName?.trim() ? `Hi ${input.customerName.trim()},` : "Hi,";

  const subject =
    purpose === "BOOKING_CONFIRMATION"
      ? `Appointment confirmation with ${input.businessName}`
      : `Following up from ${input.businessName}`;

  const lines = [greeting, ""];
  if (purpose === "BOOKING_CONFIRMATION" && input.appointmentTime) {
    lines.push(
      `Your ${input.serviceName?.trim() ? `${input.serviceName.trim()} appointment` : "appointment"} with ${input.businessName} is confirmed for ${input.appointmentTime}.`
    );
  } else {
    lines.push(`Thanks for getting in touch with ${input.businessName}.`);
  }
  if (input.extraNotes?.trim()) lines.push("", input.extraNotes.trim());
  lines.push("", "If you need to reply, just respond to this email.", "", `— ${input.businessName}`);

  return sendBusinessEmail({
    businessId: input.businessId,
    to: input.customerEmail,
    subject,
    textBody: lines.join("\n"),
    purpose,
    idempotencyKey: input.idempotencyKey
  });
}

/** Internal notification to the buyer (lead capture / call summary). */
export async function sendInternalNotificationEmail(input: {
  businessId: string;
  businessName: string;
  subjectSuffix?: string;
  purpose?: Extract<EmailPurpose, "INTERNAL_NOTIFICATION" | "CALL_SUMMARY">;
  idempotencyKey?: string | null;
  fields: {
    caller?: string | null;
    phone?: string | null;
    email?: string | null;
    requestedService?: string | null;
    summary?: string | null;
    nextAction?: string | null;
  };
}): Promise<SendBusinessEmailResult> {
  const alias = await getBusinessEmailAlias(input.businessId);
  if (!alias?.forwardToEmail) {
    return { ok: false, error: "No forward-to email configured for internal notifications." };
  }
  if (!alias.internalSummaryEnabled) {
    return { ok: false, error: "Internal summary emails are disabled in Mail Setup." };
  }

  const purpose = input.purpose ?? "CALL_SUMMARY";
  const subject = input.subjectSuffix
    ? `New AI call summary — ${input.businessName} (${input.subjectSuffix})`
    : `New AI call summary — ${input.businessName}`;

  const row = (label: string, value?: string | null) => `${label}: ${value?.trim() || "-"}`;
  const textBody = [
    row("Caller", input.fields.caller),
    row("Phone", input.fields.phone),
    row("Email", input.fields.email),
    row("Requested service", input.fields.requestedService),
    row("Summary", input.fields.summary),
    row("Next action", input.fields.nextAction)
  ].join("\n");

  return sendBusinessEmail({
    businessId: input.businessId,
    to: alias.forwardToEmail,
    subject,
    textBody,
    purpose,
    idempotencyKey: input.idempotencyKey
  });
}

/* --------------------------------- inbound --------------------------------- */

/** Strip scripts, event handlers, and javascript: URLs from inbound HTML. Never executed, only stored/forwarded. */
export function sanitizeInboundHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, "")
    .slice(0, MAX_BODY_LENGTH);
}

type InboundEmailInput = {
  recipient: string;
  /** SES's own verdict on the mail. Spam and viruses are stored and forwarded
      like anything else, but they never start a billed run. */
  failedScanning?: boolean;
  fromEmail: string;
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  sesMessageId?: string | null;
  inReplyTo?: string | null;
};

export type InboundRouteResult =
  | { routed: true; businessId: string; forwarded: boolean; messageId: string }
  | { routed: false; reason: string; messageId?: string };

/** Route one inbound email to the owning business by alias. Cross-buyer isolation via unique alias lookup. */
export async function routeInboundEmailToBusiness(input: InboundEmailInput): Promise<InboundRouteResult> {
  const recipient = input.recipient.trim().toLowerCase();
  const alias = await prisma.businessEmailAlias.findUnique({ where: { emailAddress: recipient } });

  const textBody = input.textBody?.slice(0, MAX_BODY_LENGTH) ?? null;
  const htmlBody = input.htmlBody ? sanitizeInboundHtml(input.htmlBody) : null;

  if (!alias || alias.status !== "ACTIVE") {
    // Unknown/disabled alias: store unrouted for admin triage (no business attached).
    const unrouted = await prisma.emailMessage.create({
      data: {
        direction: "INBOUND",
        fromEmail: input.fromEmail.toLowerCase(),
        toEmail: recipient,
        subject: input.subject.slice(0, 500),
        textBody,
        htmlBody,
        sesMessageId: input.sesMessageId ?? null,
        status: "RECEIVED",
        purpose: "REPLY",
        receivedAt: new Date(),
        metadata: { unrouted: true, reason: alias ? `alias ${alias.status}` : "unknown alias" } as never
      }
    });
    return { routed: false, reason: alias ? `alias is ${alias.status}` : "unknown alias", messageId: unrouted.id };
  }

  const stored = await prisma.emailMessage.create({
    data: {
      businessId: alias.businessId,
      installedAgentId: alias.installedAgentId,
      aliasId: alias.id,
      direction: "INBOUND",
      fromEmail: input.fromEmail.toLowerCase(),
      toEmail: recipient,
      subject: input.subject.slice(0, 500),
      textBody,
      htmlBody,
      sesMessageId: input.sesMessageId ?? null,
      inReplyTo: input.inReplyTo ?? null,
      threadKey: recipient,
      status: "RECEIVED",
      purpose: "REPLY",
      receivedAt: new Date()
    }
  });

  // Forward a safe copy to the buyer's real mailbox (loop-guarded).
  let forwarded = false;
  const wantsForward = alias.replyHandlingMode !== "TRIVEN_INBOX" && Boolean(alias.forwardToEmail);
  const isLoop =
    input.fromEmail.toLowerCase() === alias.emailAddress ||
    input.fromEmail.toLowerCase() === alias.forwardToEmail?.toLowerCase();

  if (wantsForward && !isLoop && alias.forwardToEmail) {
    const result = await sendBusinessEmail({
      businessId: alias.businessId,
      to: alias.forwardToEmail,
      subject: `Fwd: ${input.subject}`.slice(0, 500),
      textBody: `From: ${input.fromEmail}\nTo: ${recipient}\n\n${textBody ?? "(no text content)"}`,
      purpose: "REPLY",
      threadKey: recipient,
      metadata: { forwardedFrom: input.fromEmail, originalMessageId: stored.id }
    });
    forwarded = result.ok;
  }

  /*
   * NODE 010 — THE EAR FIRES.
   *
   * Routing and forwarding are bookkeeping; this is the point of the limb:
   * when the alias belongs to an installed agent whose canvas carries the
   * "Email received" trigger, the mail STARTS THE WORKFLOW — live, under the
   * business, with the sender as the memory drawer's key so the same customer
   * is remembered across mails. Fire-and-forget: a failed run is logged, but
   * the inbound mail is already stored and forwarded — the ear must never
   * lose the letter because the brain stumbled.
   */
  /* ANY EMAIL, INCLUDING SPAM, STARTED A BILLED LIVE RUN. Every inbound mail
     ran the business's agent — a real run, on their bill, with the sender's
     address as the memory key, from an address anybody can forge. SES already
     tells us whether the mail failed its spam and virus checks, and nothing
     read it. The letter is still stored and still forwarded, exactly as
     before; it just does not wake the agent. */
  if (input.failedScanning && alias.installedAgentId) {
    console.warn("[email-in] mail failed SES scanning — stored and forwarded, but no run started", {
      messageId: stored.id
    });
  }

  if (!isLoop && alias.installedAgentId && !input.failedScanning) {
    void startEmailTriggeredRun({
      installedAgentId: alias.installedAgentId,
      fromEmail: input.fromEmail,
      subject: input.subject,
      body: textBody ?? "",
      inboundMessageId: stored.id
    }).catch((error) =>
      console.error("[email-trigger] run failed", { messageId: stored.id, error: (error as Error).message })
    );
  }

  return { routed: true, businessId: alias.businessId, forwarded, messageId: stored.id };
}

/** Does this agent's canvas carry the ear? */
function workflowHasEmailTrigger(workflowJson: unknown): boolean {
  const nodes = (workflowJson as { nodes?: Array<{ data?: { type?: unknown } }> })?.nodes;
  return Array.isArray(nodes) && nodes.some((node) => node?.data?.type === "trigger.email_received");
}

async function startEmailTriggeredRun(input: {
  installedAgentId: string;
  fromEmail: string;
  subject: string;
  body: string;
  inboundMessageId: string;
}): Promise<void> {
  const agent = await prisma.installedAgent.findUnique({
    where: { id: input.installedAgentId },
    select: {
      id: true,
      status: true,
      businessId: true,
      workflowId: true,
      listingId: true,
      workflow: { select: { workflowJson: true } },
      business: {
        select: {
          id: true,
          name: true,
          type: true,
          ownerId: true,
          profile: { select: { calendarId: true, timeZone: true, services: true, bookingUrl: true, teamPhone: true } }
        }
      }
    }
  });
  if (!agent || !workflowHasEmailTrigger(agent.workflow.workflowJson)) return;
  if (agent.status !== "ACTIVE") return;

  /* The Timer's patience: a reply IS the waking. Any conversation held for
     this sender is cancelled — the ear handles their mail as a fresh run,
     and the silence follow-up must never fire after they answered. */
  await prisma.heldConversation
    .updateMany({
      where: {
        installedAgentId: input.installedAgentId,
        threadKey: input.fromEmail.toLowerCase(),
        status: "HELD"
      },
      data: { status: "CANCELLED" }
    })
    .catch(() => undefined);

  const { runWorkflowTest } = await import("../architect/workflow-runner.js");
  const profile = agent.business.profile;

  await runWorkflowTest({
    userId: agent.business.ownerId,
    workflowId: agent.workflowId,
    workflowJson: agent.workflow.workflowJson,
    mode: "live",
    executionMode: "LIVE",
    /* One inbound mail, one run — a duplicate SNS delivery throws on the
       unique pair instead of running the agent twice for the same letter. */
    callProvider: "EMAIL",
    externalCallId: input.inboundMessageId,
    input: {
      businessId: agent.businessId,
      businessOwnerId: agent.business.ownerId,
      installedAgentId: agent.id,
      listingId: agent.listingId ?? undefined,
      businessName: agent.business.name,
      businessType: agent.business.type ?? undefined,
      bookingUrl: profile?.bookingUrl ?? undefined,
      teamPhone: profile?.teamPhone ?? undefined,
      calendarId: profile?.calendarId ?? undefined,
      timeZone: profile?.timeZone ?? undefined,
      services: profile?.services ?? [],
      /* The sender keys the memory drawer: the same customer writing twice is
         remembered, two different customers never share a drawer. */
      callerNumber: input.fromEmail,
      email: {
        from: input.fromEmail,
        subject: input.subject,
        body: input.body,
        receivedAt: new Date().toISOString()
      }
    } as never
  });
}

const MAX_INBOUND_RAW_BYTES = 2 * 1024 * 1024;

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.SES_REGION ?? env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string
      }
    });
  }
  return s3Client;
}

/**
 * Fetch the raw MIME stored by the SES receipt rule. Only the configured
 * inbound bucket is ever read — a spoofed bucket name in the payload is refused.
 */
async function fetchInboundRawFromS3(bucketName: string, objectKey: string): Promise<string | null> {
  if (!env.SES_INBOUND_BUCKET || bucketName !== env.SES_INBOUND_BUCKET) {
    console.warn(`[email] refused S3 fetch from unexpected bucket "${bucketName}"`);
    return null;
  }
  if (!objectKey || objectKey.includes("..") || objectKey.startsWith("/")) {
    console.warn(`[email] refused suspicious S3 object key`);
    return null;
  }
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return null;

  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucketName, Key: objectKey, Range: `bytes=0-${MAX_INBOUND_RAW_BYTES - 1}` })
    );
    const raw = await response.Body?.transformToString("utf-8");
    return raw ?? null;
  } catch (error) {
    console.error(`[email] S3 inbound fetch failed: ${error instanceof Error ? error.message : "unknown"}`);
    return null;
  }
}

/** Very light text extraction from a raw MIME body (best effort, no attachments). */
function extractTextFromRawMime(raw: string): { text: string | null; html: string | null } {
  if (!raw.includes("Content-Type:")) return { text: raw.slice(0, MAX_BODY_LENGTH), html: null };
  const textMatch = raw.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
  const htmlMatch = raw.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
  return {
    text: textMatch ? textMatch[1].trim().slice(0, MAX_BODY_LENGTH) : null,
    html: htmlMatch ? htmlMatch[1].trim().slice(0, MAX_BODY_LENGTH) : null
  };
}

function unwrapSnsEnvelope(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.Message === "string") {
    try {
      return JSON.parse(record.Message) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return record;
}

/** Handle an SES inbound receipt (SNS envelope, raw SES JSON, or simplified test payload). */
export async function handleSesInboundNotification(payload: unknown): Promise<InboundRouteResult[]> {
  const message = unwrapSnsEnvelope(payload);
  if (!message) return [{ routed: false, reason: "unparseable payload" }];

  // Simplified/test shape: { to, from, subject, text, html? }
  if (typeof message.to === "string" && typeof message.from === "string") {
    return [
      await routeInboundEmailToBusiness({
        recipient: message.to,
        fromEmail: message.from,
        subject: typeof message.subject === "string" ? message.subject : "(no subject)",
        textBody: typeof message.text === "string" ? message.text : null,
        htmlBody: typeof message.html === "string" ? message.html : null
      })
    ];
  }

  // SES receipt shape: { mail: {...}, receipt: {...}, content?: "raw mime" }
  const mail = (message.mail ?? {}) as Record<string, unknown>;
  const receipt = (message.receipt ?? {}) as Record<string, unknown>;
  const commonHeaders = (mail.commonHeaders ?? {}) as Record<string, unknown>;

  /* SES's own scan results, which nothing had ever read. */
  const verdict = (name: string) => {
    const entry = receipt[name];
    if (!entry || typeof entry !== "object") return null;
    const status = (entry as Record<string, unknown>).status;
    return typeof status === "string" ? status.toUpperCase() : null;
  };
  const failedScanning = ["spamVerdict", "virusVerdict"].some((name) => verdict(name) === "FAIL");

  const recipients = (Array.isArray(receipt.recipients) ? receipt.recipients : mail.destination) as unknown;
  const recipientList = Array.isArray(recipients)
    ? recipients.filter((item): item is string => typeof item === "string")
    : [];
  const fromEmail =
    (Array.isArray(commonHeaders.from) && typeof commonHeaders.from[0] === "string"
      ? commonHeaders.from[0].replace(/^.*<([^>]+)>.*$/, "$1")
      : typeof mail.source === "string"
        ? mail.source
        : "") || "unknown@unknown";
  const subject = typeof commonHeaders.subject === "string" ? commonHeaders.subject : "(no subject)";
  const sesMessageId = typeof mail.messageId === "string" ? mail.messageId : null;

  // Duplicate SNS delivery of the same inbound message → acknowledge, don't re-store.
  if (sesMessageId) {
    const already = await prisma.emailMessage.findFirst({
      where: { sesMessageId, direction: "INBOUND" },
      select: { id: true, businessId: true }
    });
    if (already) {
      return [
        already.businessId
          ? { routed: true, businessId: already.businessId, forwarded: false, messageId: already.id }
          : { routed: false, reason: "duplicate delivery", messageId: already.id }
      ];
    }
  }

  // Raw MIME: inline in the notification, or stored in S3 by the receipt rule.
  let raw = typeof message.content === "string" ? message.content : null;
  if (!raw) {
    const action = (receipt.action ?? {}) as Record<string, unknown>;
    if (
      action.type === "S3" &&
      typeof action.bucketName === "string" &&
      typeof action.objectKey === "string"
    ) {
      raw = await fetchInboundRawFromS3(action.bucketName, action.objectKey);
    }
  }
  const bodies = raw ? extractTextFromRawMime(raw.slice(0, MAX_INBOUND_RAW_BYTES)) : { text: null, html: null };

  if (recipientList.length === 0) return [{ routed: false, reason: "no recipients in payload" }];

  const results: InboundRouteResult[] = [];
  for (const recipient of recipientList) {
    results.push(
      await routeInboundEmailToBusiness({
        recipient,
        fromEmail,
        subject,
        textBody: bodies.text,
        htmlBody: bodies.html,
        sesMessageId,
        failedScanning
      })
    );
  }
  return results;
}

/**
 * Cross-endpoint event dedupe: the same SES event can arrive via both the
 * configuration-set topic (/ses/events) and the legacy identity topic
 * (/ses/bounce-complaint). All DB writes are idempotent regardless; this cache
 * just skips the duplicate work inside the delivery window.
 */
const RECENT_EVENT_KEYS = new Map<string, number>();
const EVENT_DEDUPE_TTL_MS = 15 * 60 * 1000;

function isDuplicateEvent(type: string, sesMessageId: string | null): boolean {
  if (!sesMessageId) return false;
  const key = `${type}:${sesMessageId}`;
  const now = Date.now();
  if (RECENT_EVENT_KEYS.size > 2000) {
    for (const [cached, at] of RECENT_EVENT_KEYS) {
      if (now - at > EVENT_DEDUPE_TTL_MS) RECENT_EVENT_KEYS.delete(cached);
    }
  }
  const seen = RECENT_EVENT_KEYS.get(key);
  RECENT_EVENT_KEYS.set(key, now);
  return Boolean(seen && now - seen < EVENT_DEDUPE_TTL_MS);
}

/** Handle SES bounce/complaint events — marks messages and feeds the suppression list. */
export async function handleSesBounceComplaintNotification(
  payload: unknown
): Promise<{ handled: boolean; type?: string; updated: number }> {
  const message = unwrapSnsEnvelope(payload);
  if (!message) return { handled: false, updated: 0 };

  const type = String(message.notificationType ?? message.eventType ?? "").toLowerCase();
  if (type !== "bounce" && type !== "complaint") return { handled: false, updated: 0 };

  const status = type === "bounce" ? ("BOUNCED" as const) : ("COMPLAINED" as const);
  const now = new Date();
  const timestamps = type === "bounce" ? { bouncedAt: now } : { complainedAt: now };
  const mail = (message.mail ?? {}) as Record<string, unknown>;
  const sesMessageId = typeof mail.messageId === "string" ? mail.messageId : null;

  if (isDuplicateEvent(type, sesMessageId)) {
    return { handled: true, type, updated: 0 };
  }

  const detail = (message.bounce ?? message.complaint ?? {}) as Record<string, unknown>;
  // Transient bounces (mailbox full, greylisting) do NOT suppress the recipient.
  const bounceType = typeof detail.bounceType === "string" ? detail.bounceType.toLowerCase() : null;
  const isPermanent = type === "complaint" || bounceType === "permanent" || bounceType === "undetermined";

  const recipientEntries = (detail.bouncedRecipients ?? detail.complainedRecipients ?? []) as Array<
    Record<string, unknown>
  >;
  const recipients = Array.isArray(recipientEntries)
    ? recipientEntries
        .map((entry) => (typeof entry?.emailAddress === "string" ? entry.emailAddress.toLowerCase() : ""))
        .filter(Boolean)
    : [];

  let updated = 0;
  if (sesMessageId) {
    const byId = await prisma.emailMessage.updateMany({
      where: { sesMessageId },
      data: { status, ...timestamps }
    });
    updated += byId.count;
  }
  for (const recipient of recipients) {
    /* ONE BOUNCE MARKED EVERY BUSINESS'S MAIL TO THAT ADDRESS AS BOUNCED.
       The bounced message is already found by its own id, above. This second
       pass then flipped EVERY still-sent message to that address, from every
       business on the platform, to the same status — and because the
       suppression check falls back to "has this address ever bounced", a
       single full mailbox at one business silently blocked that person for
       everybody. One bounce is one message. */

    if (isPermanent) {
      const reason =
        type === "complaint"
          ? "Recipient complained (marked as spam)"
          : `Permanent bounce${typeof detail.bounceSubType === "string" ? ` (${detail.bounceSubType})` : ""}`;
      await addEmailSuppression(recipient, reason, "SES");
    }
  }

  console.log(
    `[email] SES ${type}${bounceType ? `/${bounceType}` : ""}: ${recipients.join(", ") || sesMessageId || "unknown"} (${updated} message(s) marked${isPermanent ? ", suppressed" : ""})`
  );
  return { handled: true, type, updated };
}

/**
 * Configuration-set delivery events (SES_EVENTS_TOPIC_ARN): Send, Delivery,
 * Bounce, Complaint, Reject, RenderingFailure. Bounce/complaint delegate to
 * the handler above so suppression stays in one place.
 */
export async function handleSesDeliveryEventNotification(
  payload: unknown
): Promise<{ handled: boolean; type?: string; updated: number }> {
  const message = unwrapSnsEnvelope(payload);
  if (!message) return { handled: false, updated: 0 };

  const type = String(message.eventType ?? message.notificationType ?? "").toLowerCase();
  if (!type) return { handled: false, updated: 0 };

  if (type === "bounce" || type === "complaint") {
    return handleSesBounceComplaintNotification(payload);
  }

  const mail = (message.mail ?? {}) as Record<string, unknown>;
  const sesMessageId = typeof mail.messageId === "string" ? mail.messageId : null;
  if (!sesMessageId) return { handled: false, type, updated: 0 };
  if (isDuplicateEvent(type, sesMessageId)) return { handled: true, type, updated: 0 };

  let updated = 0;

  if (type === "delivery") {
    const result = await prisma.emailMessage.updateMany({
      where: { sesMessageId, status: { in: ["QUEUED", "SENT"] } },
      data: { status: "DELIVERED", deliveredAt: new Date() }
    });
    updated = result.count;
  } else if (type === "reject") {
    const result = await prisma.emailMessage.updateMany({
      where: { sesMessageId },
      data: { status: "REJECTED" }
    });
    updated = result.count;
  } else if (type === "renderingfailure" || type === "rendering failure") {
    const result = await prisma.emailMessage.updateMany({
      where: { sesMessageId },
      data: { status: "FAILED" }
    });
    updated = result.count;
  } else if (type === "send") {
    // Send is informational; the row is already SENT from the API call.
    return { handled: true, type, updated: 0 };
  } else {
    // DeliveryDelay, Open, Click, Subscription — acknowledged, not tracked.
    return { handled: true, type, updated: 0 };
  }

  console.log(`[email] SES event ${type}: ${sesMessageId} (${updated} message(s) updated)`);
  return { handled: true, type, updated };
}
