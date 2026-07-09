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
  "noreply",
  "no-reply",
  "root"
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_PART_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,48}[a-z0-9])?$/;

let sesClient: SESv2Client | null = null;

export function isSesConfigured(): boolean {
  return Boolean(env.SES_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) && !env.SES_DRY_RUN;
}

function getSesClient(): SESv2Client {
  if (!sesClient) {
    sesClient = new SESv2Client({
      region: env.SES_REGION,
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

  if (!(await isLocalPartAvailable(localPart, input.businessId))) {
    return { ok: false, error: `"${localPart}" is already taken — pick a different alias.` };
  }

  const existing = await getBusinessEmailAlias(input.businessId);
  const data = {
    localPart,
    domain: env.SES_FROM_DOMAIN,
    emailAddress: aliasEmailAddress(localPart),
    displayName,
    forwardToEmail,
    replyHandlingMode: input.replyHandlingMode ?? "TRIVEN_AND_FORWARD",
    status: "ACTIVE" as const,
    installedAgentId: input.installedAgentId ?? existing?.installedAgentId ?? null,
    lastError: null
  };

  const alias = existing
    ? await prisma.businessEmailAlias.update({ where: { id: existing.id }, data })
    : await prisma.businessEmailAlias.create({
        data: { ...data, businessId: input.businessId, buyerUserId: input.buyerUserId }
      });

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

/** Recipient previously bounced or complained → suppressed. */
export async function isEmailSuppressed(toEmail: string): Promise<boolean> {
  const suppressed = await prisma.emailMessage.findFirst({
    where: { toEmail: toEmail.toLowerCase(), status: { in: ["BOUNCED", "COMPLAINED"] } },
    select: { id: true }
  });
  return Boolean(suppressed);
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
  subject: string;
  textBody: string;
  htmlBody?: string;
  purpose: EmailPurpose;
  installedAgentId?: string | null;
  threadKey?: string | null;
  inReplyTo?: string | null;
  metadata?: Record<string, unknown>;
};

export type SendBusinessEmailResult =
  | { ok: true; messageId: string; dryRun: boolean }
  | { ok: false; error: string };

/**
 * Send one transactional email from the business's proxy alias. Every attempt
 * (sent, dry-run, or failed) is stored as an EmailMessage row.
 */
export async function sendBusinessEmail(input: SendBusinessEmailInput): Promise<SendBusinessEmailResult> {
  const alias = await getBusinessEmailAlias(input.businessId);
  if (!alias || alias.status !== "ACTIVE") {
    return { ok: false, error: "No active email alias — complete Mail Setup first." };
  }

  const to = input.to.trim().toLowerCase();
  if (!isValidEmailAddress(to)) return { ok: false, error: `Invalid recipient email: ${input.to}` };
  if (await isEmailSuppressed(to)) {
    return { ok: false, error: `Recipient ${to} is suppressed after a bounce/complaint.` };
  }
  if (await isRateLimited(input.businessId)) {
    return { ok: false, error: "Email rate limit reached for this business — try again later." };
  }

  const fromDisplay = `${alias.displayName} via Triven`;
  const fromEmail = alias.emailAddress;
  const configured = isSesConfigured();
  const dryRun = !configured;

  const record = await prisma.emailMessage.create({
    data: {
      businessId: input.businessId,
      installedAgentId: input.installedAgentId ?? alias.installedAgentId,
      aliasId: alias.id,
      direction: "OUTBOUND",
      fromEmail,
      toEmail: to,
      replyToEmail: fromEmail,
      subject: input.subject.slice(0, 500),
      textBody: input.textBody.slice(0, MAX_BODY_LENGTH),
      htmlBody: input.htmlBody?.slice(0, MAX_BODY_LENGTH) ?? null,
      status: "QUEUED",
      purpose: input.purpose,
      threadKey: input.threadKey ?? null,
      inReplyTo: input.inReplyTo ?? null,
      metadata: ({ ...(input.metadata ?? {}), fromDisplay, ...(dryRun ? { dryRun: true } : {}) }) as never
    }
  });

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
      Destination: { ToAddresses: [to] },
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
}): Promise<SendBusinessEmailResult> {
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
    purpose
  });
}

/** Internal notification to the buyer (lead capture / call summary). */
export async function sendInternalNotificationEmail(input: {
  businessId: string;
  businessName: string;
  subjectSuffix?: string;
  purpose?: Extract<EmailPurpose, "INTERNAL_NOTIFICATION" | "CALL_SUMMARY">;
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
    purpose
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

  return { routed: true, businessId: alias.businessId, forwarded, messageId: stored.id };
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
  const raw = typeof message.content === "string" ? message.content : null;
  const bodies = raw ? extractTextFromRawMime(raw) : { text: null, html: null };
  const sesMessageId = typeof mail.messageId === "string" ? mail.messageId : null;

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
        sesMessageId
      })
    );
  }
  return results;
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
  const mail = (message.mail ?? {}) as Record<string, unknown>;
  const sesMessageId = typeof mail.messageId === "string" ? mail.messageId : null;

  const detail = (message.bounce ?? message.complaint ?? {}) as Record<string, unknown>;
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
    const byId = await prisma.emailMessage.updateMany({ where: { sesMessageId }, data: { status } });
    updated += byId.count;
  }
  for (const recipient of recipients) {
    const byRecipient = await prisma.emailMessage.updateMany({
      where: { toEmail: recipient, direction: "OUTBOUND", status: "SENT" },
      data: { status }
    });
    updated += byRecipient.count;
  }

  console.log(`[email] SES ${type}: ${recipients.join(", ") || sesMessageId || "unknown"} (${updated} message(s) marked)`);
  return { handled: true, type, updated };
}
