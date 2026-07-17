import { EMAIL_TEMPLATE_VARIABLES, VOICE_NODE_TYPES } from "@coreai/shared";
import type { EmailPurpose } from "@prisma/client";
import { isValidEmailAddress, sanitizeInboundHtml } from "./ses-mail-service";

/**
 * Architect-authored Send Email node (communication.send_email) configuration,
 * extracted from workflow JSON and validated server-side. Workflow JSON is
 * architect-supplied data — nothing in it is trusted: recipients are
 * re-validated, templates only substitute the allowed variable set, and HTML
 * is sanitized before it reaches SES.
 */

export type SendEmailNodeConfig = {
  recipientType: "customer" | "team" | "custom" | "variable";
  customRecipient: string;
  recipientVariable: string;
  cc: string[];
  bcc: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  htmlTemplate: string;
  purpose: "auto" | Extract<EmailPurpose, "BOOKING_CONFIRMATION" | "CUSTOMER_FOLLOW_UP" | "CALL_SUMMARY" | "INTERNAL_NOTIFICATION">;
  continueOnFailure: boolean;
  fallbackBehavior: "skip" | "notify_team";
};

export type EmailTemplateVariables = Partial<Record<(typeof EMAIL_TEMPLATE_VARIABLES)[number], string>>;

const ALLOWED_VARIABLES = new Set<string>(EMAIL_TEMPLATE_VARIABLES);
const RECIPIENT_TYPES = new Set(["customer", "team", "custom", "variable"]);
const PURPOSES = new Set(["auto", "BOOKING_CONFIRMATION", "CUSTOMER_FOLLOW_UP", "CALL_SUMMARY", "INTERNAL_NOTIFICATION"]);
const MAX_TEMPLATE_LENGTH = 20_000;
const MAX_SECONDARY_RECIPIENTS = 10;

function str(data: Record<string, unknown>, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" ? value.trim() : fallback;
}

/** Comma/semicolon-separated address list → validated, capped array. */
export function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry && isValidEmailAddress(entry))
    .slice(0, MAX_SECONDARY_RECIPIENTS);
}

/**
 * Fill {{variable}} tokens from the allowed set; unknown tokens are removed so
 * architect templates can never exfiltrate runtime state beyond the contract.
 */
export function fillEmailTemplate(template: string, variables: EmailTemplateVariables): string {
  return template
    .slice(0, MAX_TEMPLATE_LENGTH)
    .replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, name: string) => {
      if (!ALLOWED_VARIABLES.has(name)) return "";
      return variables[name as keyof EmailTemplateVariables]?.trim() ?? "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Same policy as inbound: strip scripts/handlers/javascript: URLs before SES. */
export function sanitizeOutboundHtml(html: string): string {
  return sanitizeInboundHtml(html);
}

type NodeLike = { data?: Record<string, unknown> };

/** Extract + validate the Send Email node config from a workflow graph. */
export function extractSendEmailNodeConfig(workflowJson: unknown): SendEmailNodeConfig | null {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return null;

  const node = (nodes as NodeLike[]).find(
    (item) => (item.data?.type as string) === VOICE_NODE_TYPES.sendEmail
  );
  if (!node?.data) return null;
  const data = node.data;

  const recipientTypeRaw = str(data, "recipientType", "customer");
  const purposeRaw = str(data, "purpose", "auto");
  const customRecipient = str(data, "customRecipient").toLowerCase();

  return {
    recipientType: (RECIPIENT_TYPES.has(recipientTypeRaw) ? recipientTypeRaw : "customer") as SendEmailNodeConfig["recipientType"],
    customRecipient: isValidEmailAddress(customRecipient) ? customRecipient : "",
    recipientVariable: str(data, "recipientVariable").slice(0, 100),
    cc: parseEmailList(str(data, "ccTemplate")),
    bcc: parseEmailList(str(data, "bccTemplate")),
    subjectTemplate: str(data, "subjectTemplate").slice(0, 500),
    bodyTemplate: str(data, "bodyTemplate").slice(0, MAX_TEMPLATE_LENGTH),
    htmlTemplate: str(data, "htmlTemplate").slice(0, MAX_TEMPLATE_LENGTH),
    purpose: (PURPOSES.has(purposeRaw) ? purposeRaw : "auto") as SendEmailNodeConfig["purpose"],
    continueOnFailure: str(data, "continueOnFailure", "true") !== "false",
    fallbackBehavior: str(data, "fallbackBehavior", "skip") === "notify_team" ? "notify_team" : "skip"
  };
}

/**
 * Buyer-configured recipients, stored on InstalledAgent.configJson.emailRecipients
 * by the buyer setup page. Buyer input is untrusted like workflow JSON:
 * addresses are re-validated and CC/BCC lists capped with the same policy as
 * the architect node fields they replace.
 */
export type BuyerEmailRecipients = {
  recipientType: "customer" | "team" | "custom";
  customRecipient: string;
  cc: string[];
  bcc: string[];
};

const BUYER_RECIPIENT_TYPES = new Set(["customer", "team", "custom"]);

export function extractBuyerEmailRecipients(configJson: unknown): BuyerEmailRecipients | null {
  const raw = (configJson as { emailRecipients?: unknown } | null)?.emailRecipients;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;

  const typeRaw = str(data, "recipientType", "customer");
  const customRecipient = str(data, "customRecipient").toLowerCase();
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? parseEmailList(value.filter((entry) => typeof entry === "string").join(","))
      : parseEmailList(typeof value === "string" ? value : "");

  return {
    recipientType: (BUYER_RECIPIENT_TYPES.has(typeRaw) ? typeRaw : "customer") as BuyerEmailRecipients["recipientType"],
    customRecipient: isValidEmailAddress(customRecipient) ? customRecipient : "",
    cc: list(data.cc),
    bcc: list(data.bcc)
  };
}

/**
 * Recipients are buyer-owned: when the buyer configured them, they override
 * whatever legacy To/CC/BCC fields are still stored on the architect's node.
 */
export function applyBuyerEmailRecipients(
  node: SendEmailNodeConfig,
  buyer: BuyerEmailRecipients | null
): SendEmailNodeConfig;
export function applyBuyerEmailRecipients(
  node: SendEmailNodeConfig | null,
  buyer: BuyerEmailRecipients | null
): SendEmailNodeConfig | null;
export function applyBuyerEmailRecipients(
  node: SendEmailNodeConfig | null,
  buyer: BuyerEmailRecipients | null
): SendEmailNodeConfig | null {
  if (!node || !buyer) return node;

  return {
    ...node,
    recipientType: buyer.recipientType,
    customRecipient: buyer.recipientType === "custom" ? buyer.customRecipient : "",
    recipientVariable: "",
    cc: buyer.cc,
    bcc: buyer.bcc
  };
}

/**
 * Resolve the "variable" recipient source against the runtime variable set.
 * Only email-bearing variables are honored (currently customerEmail aliases).
 */
export function resolveVariableRecipient(
  recipientVariable: string,
  variables: EmailTemplateVariables
): string | null {
  const key = recipientVariable.trim().replace(/^\{\{|\}\}$/g, "").replace(/^customer\.email$/i, "customerEmail");
  const value = key === "customerEmail" ? variables.customerEmail : undefined;
  const email = value?.trim().toLowerCase() ?? "";
  return isValidEmailAddress(email) ? email : null;
}
