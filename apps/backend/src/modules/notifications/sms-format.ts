export const SMS_COMPLIANCE_FOOTER =
  "Reply STOP to opt out or HELP for assistance. Msg & data rates may apply.";

export const SMS_MAX_TOTAL_LENGTH = 480;

export const TRANSACTIONAL_SMS_PURPOSES = [
  "APPOINTMENT_CONFIRMATION",
  "BOOKING_ACKNOWLEDGEMENT",
  "APPOINTMENT_REMINDER",
  "RESCHEDULE_CONFIRMATION",
  "CANCELLATION_CONFIRMATION",
  "SERVICE_UPDATE",
  "SUPPORT_RESPONSE"
] as const;

export type TransactionalSmsPurpose = (typeof TRANSACTIONAL_SMS_PURPOSES)[number];

export function isApprovedSmsPurpose(value: unknown): value is TransactionalSmsPurpose {
  return typeof value === "string" && (TRANSACTIONAL_SMS_PURPOSES as readonly string[]).includes(value);
}

export type FormatTransactionalSmsResult =
  | { ok: true; body: string }
  | { ok: false; code: "SMS_PURPOSE_NOT_ALLOWED" | "SMS_BUSINESS_IDENTITY_REQUIRED"; reason: string };

const FOOTER_FRAGMENT_PATTERNS = [
  /reply\s+stop[^.\n]*(\.|$)/gi,
  /reply\s+start[^.\n]*(\.|$)/gi,
  /\bor\s+help\s+for\s+(assistance|help)[^.\n]*(\.|$)/gi,
  /\bhelp\s+for\s+(assistance|help)[^.\n]*(\.|$)/gi,
  /\b(msg|message)\s*(&|and)\s*data\s+rates\s+may\s+apply[^.\n]*(\.|$)/gi,
  /\bmessage\s+frequency\s+varies[^.\n]*(\.|$)/gi
];

/** Campaign purpose guard: transactional only, no links, no marketing. */
const BLOCKED_CONTENT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /https?:\/\/|www\.[a-z0-9-]|\b[a-z0-9-]+\.(ly|gg|io|me)\/[a-z0-9]/i, reason: "embedded link" },
  { pattern: /\b\d{1,3}\s?%\s?off\b/i, reason: "discount offer" },
  { pattern: /\b(promo|coupon|discount|voucher)\s?code\b/i, reason: "coupon code" },
  { pattern: /\b(flash sale|limited[- ]time offer|special offer|buy now|act now|free gift|refer a friend)\b/i, reason: "promotional language" },
  { pattern: /\bnewsletter\b/i, reason: "newsletter content" }
];

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripFooterFragments(text: string): string {
  let result = text;
  for (const pattern of FOOTER_FRAGMENT_PATTERNS) {
    result = result.replace(pattern, " ");
  }
  return normalizeWhitespace(result).replace(/[ \t]+([.,!?])/g, "$1");
}

const ATTRIBUTION_PATTERN = /^[^\n:]{1,80}\svia\sTriven\.ai:/i;

export function formatTransactionalSms(input: {
  body: string;
  businessName?: string | null;
}): FormatTransactionalSmsResult {
  const businessName = (input.businessName ?? "").trim();
  if (!businessName) {
    return {
      ok: false,
      code: "SMS_BUSINESS_IDENTITY_REQUIRED",
      reason: "customer SMS requires the sending business's name for attribution"
    };
  }

  let content = stripFooterFragments(normalizeWhitespace(input.body));

  for (const { pattern, reason } of BLOCKED_CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      return { ok: false, code: "SMS_PURPOSE_NOT_ALLOWED", reason };
    }
  }

  if (!ATTRIBUTION_PATTERN.test(content)) {
    content = `${businessName} via Triven.ai: ${content}`;
  }

  const maxContentLength = SMS_MAX_TOTAL_LENGTH - SMS_COMPLIANCE_FOOTER.length - 1;
  if (content.length > maxContentLength) {
    content = `${content.slice(0, maxContentLength - 1).trimEnd()}…`;
  }

  return { ok: true, body: `${content}\n${SMS_COMPLIANCE_FOOTER}` };
}
