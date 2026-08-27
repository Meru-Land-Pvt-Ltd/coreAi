import fs from "node:fs";
import path from "node:path";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import PDFDocument from "pdfkit";
import { buildRawMimeMessage } from "./mime";
import { env, isProduction } from "../config/env";
import { getDefaultSendingDomain } from "../modules/admin/mail-domains";

const verificationCodeExpirationMinutes = Number(
  process.env.VERIFICATION_CODE_EXPIRATION_MINUTES ?? 10
);

const appUrl = env.FRONTEND_URL.replace(/\/$/, "");
const brandName = "Triven.ai";
const privacyLink = process.env.TRIVEN_PRIVACY_URL ?? process.env.CORE_PRIVACY_URL ?? `${appUrl}/privacy`;
const termsLink = process.env.TRIVEN_TERMS_URL ?? process.env.CORE_TERMS_URL ?? `${appUrl}/terms`;
const contactLink = process.env.TRIVEN_CONTACT_URL ?? process.env.CORE_CONTACT_URL ?? `${appUrl}/contact`;
const marketplaceLink = `${appUrl}/business/marketplace`;
const checkoutLink = `${appUrl}/business/checkout`;

const logoUrl =
  process.env.TRIVEN_LOGO_URL ??
  `${appUrl}/triven.ai%20word%20logo%20transparent%20bg.PNG`;

export type PlatformEmailPurpose = "otp" | "billing" | "confirmation" | "support" | "notification";

type PlatformEmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

export type PlatformEmailInput = {
  purpose: PlatformEmailPurpose;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: PlatformEmailAttachment[];
  /**
   * Whose name the mail wears — the agent's or the business's. The founder
   * caught a test mail arriving as "Triven Confirmation": our internal
   * identity on a business's message. The mail must wear THEIR name; we are
   * only the carrier.
   */
  fromName?: string;
  /**
   * Where replies land. The founder caught Reply-To pointing at our own
   * support desk — a patient replying to a dentist would have written to us.
   * The core promise is that replies land in the business's real inbox.
   */
  replyTo?: string;
};

/** The bare address inside "Name <addr>" — or the string itself. */
function extractEmailAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1] : value).trim() || undefined;
}

let sesClient: SESv2Client | null = null;

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

/** Sender identity per purpose; SES_FROM_NO_REPLY is the shared fallback. */
export function fromAddressFor(purpose: PlatformEmailPurpose): string | undefined {
  const noReply = env.SES_FROM_NO_REPLY;
  switch (purpose) {
    case "billing":
      return env.SES_FROM_BILLING ?? noReply;
    case "confirmation":
      return env.SES_FROM_CONFIRM ?? noReply;
    case "support":
      return env.SES_FROM_SUPPORT ?? noReply;
    default:
      return noReply;
  }
}

export function isPlatformMailConfigured(): boolean {
  return Boolean(
    (env.SES_REGION ?? env.AWS_REGION) &&
      env.AWS_ACCESS_KEY_ID &&
      env.AWS_SECRET_ACCESS_KEY &&
      fromAddressFor("notification") &&
      !env.SES_DRY_RUN
  );
}

export async function sendPlatformEmail(input: PlatformEmailInput): Promise<void> {
  const base = fromAddressFor(input.purpose);
  /* The admin's dedicated sending domain, when one is verified — the main
     domain never carries agent mail, so a spam-listed agent burns a spare
     domain and never the brand. Falls back to the shipped sender. */
  const pooledDomain = await getDefaultSendingDomain().catch(() => null);
  const baseEmail = extractEmailAddress(base);
  const sendEmailAddress = pooledDomain && baseEmail ? `${baseEmail.split("@")[0]}@${pooledDomain}` : baseEmail;
  const from =
    input.fromName && sendEmailAddress
      ? `"${input.fromName.replace(/"/g, "'")}" <${sendEmailAddress}>`
      : pooledDomain && sendEmailAddress
        ? base?.includes("<")
          ? `${base.slice(0, base.indexOf("<"))}<${sendEmailAddress}>`
          : sendEmailAddress
        : base;

  if (!isPlatformMailConfigured() || !from) {
    console.warn(
      `[mailer] SES is not configured — skipped "${input.subject}" to ${input.to} (${input.purpose}).`
    );
    if (isProduction) {
      throw new Error("Email delivery is not configured on the server");
    }
    return;
  }

  // Raw MIME so attachments and the display-name From header survive intact.
  const raw = buildRawMimeMessage({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
    // OTP mail is intentionally no-reply; everything else offers a reply path.
    replyTo:
      input.purpose !== "otp"
        ? input.replyTo ?? (env.SES_REPLY_TO ? env.SES_REPLY_TO : undefined)
        : undefined
  });

  await getSesClient().send(
    new SendEmailCommand({
      Content: { Raw: { Data: raw } },
      ...(env.SES_CONFIGURATION_SET ? { ConfigurationSetName: env.SES_CONFIGURATION_SET } : {})
    })
  );
}

type VerificationEmailPurpose = "sign_in" | "email_update";

type SendVerificationEmailInput = {
  to: string;
  code: string;
  role: "ADMIN" | "BUSINESS" | "ARCHITECT";
  purpose?: VerificationEmailPurpose;
  /** One-click sign-in link. Present for sign_in mail only. */
  magicLinkUrl?: string;
};

export function buildMagicLinkUrl(token: string): string {
  return `${appUrl}/magic-link?token=${encodeURIComponent(token)}`;
}

function verificationEmailCopy({
  purpose,
  roleLabel,
  expirationMinutes,
  magicLinkUrl
}: {
  purpose: VerificationEmailPurpose;
  roleLabel: string;
  expirationMinutes: number;
  magicLinkUrl?: string;
}) {
  if (purpose === "email_update") {
    return {
      subject: `Confirm your new ${brandName} email: verification code`,
      previewText: `Confirm your new email address. This code expires in ${expirationMinutes} minutes.`,
      bodyText: `Your ${brandName} verification code is {code}. Use this code to confirm your new email address for your ${roleLabel} account. This code expires in ${expirationMinutes} minutes. ${brandName} will never ask you for this code. Do not share it with anyone.`
    };
  }

  if (magicLinkUrl) {
    return {
      subject: `Sign in to ${brandName}`,
      previewText: `Your secure sign-in link expires in ${expirationMinutes} minutes.`,
      bodyText: `Sign in to ${brandName} as ${roleLabel} by opening this link:\n\n${magicLinkUrl}\n\nThe link expires in ${expirationMinutes} minutes and can be used once. If you're signing in on another device, open the link and it will show you a 6-digit code to enter there. If you didn't request this, you can ignore this email.`
    };
  }

  return {
    subject: `Your ${brandName} verification code: {code}`,
    previewText: `Your one-time code expires in ${expirationMinutes} minutes.`,
    bodyText: `Your ${brandName} verification code is {code}. Use this code to finish signing in as ${roleLabel}. This code expires in ${expirationMinutes} minutes. ${brandName} will never ask you for this code. Do not share it with anyone.`
  };
}

export async function sendVerificationEmail({
  to,
  code,
  role,
  purpose = "sign_in",
  magicLinkUrl
}: SendVerificationEmailInput) {
  const roleLabel =
    role === "BUSINESS" ? "Business Owner" : role === "ADMIN" ? "Admin" : "AI Architect";
  const copy = verificationEmailCopy({
    purpose,
    roleLabel,
    expirationMinutes: verificationCodeExpirationMinutes,
    magicLinkUrl
  });
  const subject = copy.subject.replace("{code}", code);
  const text = copy.bodyText.replace("{code}", code);

  if (!isPlatformMailConfigured()) {
    console.warn(
      `[mailer] SES is not configured. ${purpose === "email_update" ? "Email update" : "Sign-in"} verification code for ${to} (${roleLabel}): ${code}`
    );

    if (magicLinkUrl) {
      console.warn(`[mailer] Magic sign-in link for ${to}: ${magicLinkUrl}`);
    }

    if (isProduction) {
      throw new Error("Email delivery is not configured on the server");
    }

    return;
  }

  await sendPlatformEmail({
    purpose: "otp",
    to,
    subject,
    text,
    html: buildVerificationEmailHtml({
      code,
      roleLabel,
      expirationMinutes: verificationCodeExpirationMinutes,
      purpose,
      magicLinkUrl
    })
  });
}

function buildVerificationEmailHtml({
  code,
  roleLabel,
  expirationMinutes,
  purpose = "sign_in",
  magicLinkUrl
}: {
  code: string;
  roleLabel: string;
  expirationMinutes: number;
  purpose?: VerificationEmailPurpose;
  magicLinkUrl?: string;
}) {
  const copy = verificationEmailCopy({ purpose, roleLabel, expirationMinutes, magicLinkUrl });
  const safeCode = escapeHtml(code);
  const safeRoleLabel = escapeHtml(roleLabel);
  const safeExpirationMinutes = escapeHtml(String(expirationMinutes));
  const safePrivacyLink = escapeHtml(privacyLink);
  const safeTermsLink = escapeHtml(termsLink);
  const safePreviewText = escapeHtml(copy.previewText);
  const safeBodyHtml =
    purpose === "email_update"
      ? `Use this code to confirm your new email address for your ${brandName} account as <strong>${safeRoleLabel}</strong>.`
      : magicLinkUrl
        ? `Click below to sign in to ${brandName} as <strong>${safeRoleLabel}</strong>. No password needed.`
        : `Use this code to finish signing in to ${brandName} as <strong>${safeRoleLabel}</strong>.`;

  const safeMagicLinkUrl = magicLinkUrl ? escapeHtml(magicLinkUrl) : "";

  // Passwordless sign-in mail is link-only — the 6-digit fallback code is never
  // printed here, it is revealed by the link's landing page. Everything else
  // (email-change confirmations) keeps the original code block.
  const bodyBlockHtml = magicLinkUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0;">
<tr>
<td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="#f59e0b" style="border-radius:10px;background-image:linear-gradient(90deg,#f59e0b,#d97706);">
<a href="${safeMagicLinkUrl}" target="_blank" style="display:inline-block;padding:15px 38px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">Sign in to ${brandName}</a>
</td>
</tr>
</table>
</td>
</tr>
</table>

<p style="margin:0 0 6px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#94a3b8;">
Button not working? Paste this into your browser:
</p>

<p style="margin:0 0 14px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;word-break:break-all;">
<a href="${safeMagicLinkUrl}" target="_blank" style="color:#d97706;text-decoration:none;">${safeMagicLinkUrl}</a>
</p>

<p style="margin:0 0 12px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#94a3b8;">
This link expires in ${safeExpirationMinutes} minutes and can be used once. Signing in on a different device? Open the link and it will show you a 6-digit code to enter there.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #fde68a;border-radius:8px;overflow:hidden;background-color:#fffbeb;">
<tr>
<td width="4" style="width:4px;background-color:#f59e0b;font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:12px 16px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#92400e;">
${brandName} will never ask you to forward this link. Don't share it with anyone.
</td>
</tr>
</table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0;">
<tr>
<td align="center" style="padding:20px;background-color:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;">
<span style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#111827;">${safeCode}</span>
</td>
</tr>
</table>

<p style="margin:0 0 12px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#94a3b8;">
This code expires in ${safeExpirationMinutes} minutes.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #fde68a;border-radius:8px;overflow:hidden;background-color:#fffbeb;">
<tr>
<td width="4" style="width:4px;background-color:#f59e0b;font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:12px 16px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#92400e;">
${brandName} will never ask you for this code. Don't share it with anyone.
</td>
</tr>
</table>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(copy.subject.replace("{code}", code))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f1f5f9;">${safePreviewText}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
<tr>
<td style="padding:28px 32px 0 32px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">
${emailLogoMarkup()}
</td>
</tr>

<tr>
<td style="padding:14px 32px 0 32px;">
<div style="height:4px;line-height:4px;font-size:0;background-color:#f59e0b;background-image:linear-gradient(90deg,#f59e0b,#d97706);border-radius:2px;">&nbsp;</div>
</td>
</tr>

<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 16px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#334155;">
${safeBodyHtml}
</p>

${bodyBlockHtml}
</td>
</tr>

<tr>
<td style="padding:10px 32px 30px 32px;">
<div style="border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#94a3b8;">
<div style="font-weight:600;color:#64748b;">${brandName}</div>
<div>Your AI Workforce</div>
<div style="margin-top:8px;">
<a href="${safePrivacyLink}" target="_blank" style="color:#d97706;text-decoration:none;">Privacy</a>
&nbsp;&middot;&nbsp;
<a href="${safeTermsLink}" target="_blank" style="color:#d97706;text-decoration:none;">Terms</a>
</div>
</div>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailLogoMarkup() {
  return `<img src="${logoUrl}" alt="${brandName}" height="30" style="display:inline-block;height:30px;width:auto;border:0;outline:none;text-decoration:none;" />`;
}

// Shared header (logo row + amber divider) used by all transactional emails.
function buildEmailHeaderRows() {
  return `<tr>
<td style="padding:28px 32px 0 32px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">
${emailLogoMarkup()}
</td>
</tr>
<tr>
<td style="padding:14px 32px 0 32px;">
<div style="height:4px;line-height:4px;font-size:0;background-color:#f59e0b;background-image:linear-gradient(90deg,#f59e0b,#d97706);border-radius:2px;">&nbsp;</div>
</td>
</tr>`;
}

function buildEmailFooterRow() {
  return `<tr>
<td style="padding:10px 32px 30px 32px;">
<div style="border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#94a3b8;">
<div style="font-weight:600;color:#64748b;">${brandName}</div>
<div style="margin-top:8px;">
<a href="${escapeHtml(privacyLink)}" target="_blank" style="color:#d97706;text-decoration:none;">Privacy</a>
&nbsp;&middot;&nbsp;
<a href="${escapeHtml(contactLink)}" target="_blank" style="color:#d97706;text-decoration:none;">Help Center</a>
</div>
</div>
</td>
</tr>`;
}

// ---------------------------------------------------------------------------
// Invoices + payment-success email
// ---------------------------------------------------------------------------

export type InvoiceData = {
  invoiceNumber: string;
  date: Date;
  businessName: string;
  businessEmail: string;
  agentName: string;
  description: string;
  amountCents: number;
  listPriceCents?: number;
  currency: string;
  status: string;
  billingAddress?: string | null;
  paymentMethod?: string | null;
  transactionId?: string;
  /** Itemized fee rows; quantity/unit-price metadata is optional for legacy invoices. */
  lineItems?: Array<{
    label: string;
    amountCents: number;
    quantity?: number;
    unitPriceDisplay?: string;
  }>;
};

type InvoiceStatusView = {
  label: string;
  badgeBg: string;
  badgeText: string;
  balanceColor: string;
  isPaid: boolean;
};

function invoiceStatusView(status: string): InvoiceStatusView {
  const value = (status || "").toUpperCase();
  if (value === "SUCCEEDED" || value === "PAID" || value === "COMPLETED") {
    return {
      label: "PAID",
      badgeBg: "#dcfce7",
      badgeText: "#15803d",
      balanceColor: "#16a34a",
      isPaid: true
    };
  }
  if (value === "TRIALING") {
    return {
      label: "TRIAL",
      badgeBg: "#fef3c7",
      badgeText: "#b45309",
      balanceColor: "#d97706",
      isPaid: false
    };
  }
  if (value === "PENDING" || value === "OPEN") {
    return {
      label: "PENDING",
      badgeBg: "#dbeafe",
      badgeText: "#1d4ed8",
      balanceColor: "#d97706",
      isPaid: false
    };
  }
  if (value === "FAILED") {
    return {
      label: "FAILED",
      badgeBg: "#fee2e2",
      badgeText: "#b91c1c",
      balanceColor: "#dc2626",
      isPaid: false
    };
  }
  if (value === "OVERDUE") {
    return {
      label: "OVERDUE",
      badgeBg: "#fee2e2",
      badgeText: "#b91c1c",
      balanceColor: "#dc2626",
      isPaid: false
    };
  }
  if (value === "REFUNDED" || value === "CANCELED" || value === "VOID") {
    return {
      label: value,
      badgeBg: "#f1f5f9",
      badgeText: "#475569",
      balanceColor: "#64748b",
      isPaid: false
    };
  }
  return {
    label: value || "—",
    badgeBg: "#f1f5f9",
    badgeText: "#475569",
    balanceColor: "#475569",
    isPaid: false
  };
}

function formatInvoiceFullDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function invoiceAmounts(invoice: InvoiceData) {
  const status = invoiceStatusView(invoice.status);
  const displayAmount = formatMoney(invoice.amountCents, invoice.currency);
  const zeroAmount = formatMoney(0, invoice.currency);
  const closedWithoutBalance = ["REFUNDED", "CANCELED", "VOID"].includes(
    (invoice.status || "").toUpperCase()
  );
  const amountPaid = status.isPaid ? displayAmount : zeroAmount;
  const balanceDue = status.isPaid || closedWithoutBalance ? zeroAmount : displayAmount;

  return { status, displayAmount, amountPaid, balanceDue };
}

function invoiceLineItemValues(
  item: NonNullable<InvoiceData["lineItems"]>[number],
  currency: string
) {
  const quantity =
    typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
      ? item.quantity
      : 1;
  const quantityDisplay = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6
  }).format(quantity);
  const unitPrice =
    item.unitPriceDisplay?.trim() ||
    formatMoney(item.amountCents / quantity, currency);

  return {
    label: item.label,
    quantity: quantityDisplay,
    unitPrice,
    amount: formatMoney(item.amountCents, currency)
  };
}

/** Matches the billing invoice detail page card — used in emails, HTML, and PDF. */
export function buildInvoiceCardHtml(
  invoice: InvoiceData,
  options?: { logoSrc?: string; fullPage?: boolean }
) {
  const { status, displayAmount, amountPaid, balanceDue } = invoiceAmounts(invoice);
  const logoSrc = escapeHtml(options?.logoSrc ?? logoUrl);
  const fullPage = options?.fullPage ?? false;
  const description = escapeHtml(invoice.description || invoice.agentName || "Agent purchase");
  const invoiceNumber = escapeHtml(invoice.invoiceNumber);
  const dateIssued = escapeHtml(formatInvoiceFullDate(invoice.date));
  const businessName = escapeHtml(invoice.businessName || "Customer");
  const businessEmail = escapeHtml(invoice.businessEmail || "");
  const billingAddress = invoice.billingAddress?.trim()
    ? escapeHtml(invoice.billingAddress.trim())
    : "";
  const paymentMethod = invoice.paymentMethod?.trim()
    ? escapeHtml(invoice.paymentMethod.trim())
    : "—";
  const transactionId = escapeHtml(invoice.transactionId || "—");

  // Itemized rows when a fee breakdown exists (agent price + number fee);
  // otherwise the single description row shown historically.
  const lineItems =
    invoice.lineItems && invoice.lineItems.length > 0
      ? invoice.lineItems.map((item) => invoiceLineItemValues(item, invoice.currency))
      : [{ label: invoice.description || invoice.agentName || "Agent purchase", amountCents: invoice.amountCents }]
          .map((item) => invoiceLineItemValues(item, invoice.currency));
  const lineItemRows = lineItems
    .map(
      (item, index) => `<tr style="border-bottom:1px solid #f1f5f9;">
<td style="padding:12px;color:#64748b;">${index + 1}</td>
<td style="padding:12px;color:#0f172a;">${escapeHtml(item.label)}</td>
<td align="right" style="padding:12px;color:#0f172a;">${escapeHtml(item.quantity)}</td>
<td align="right" style="padding:12px;color:#0f172a;">${escapeHtml(item.unitPrice)}</td>
<td align="right" style="padding:12px;font-weight:600;color:#0f172a;">${item.amount}</td>
</tr>`
    )
    .join("\n");

  const paymentInfoPaid = status.isPaid
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;">
<tr>
<td width="50%" valign="top" style="padding:0 8px 12px 0;color:#64748b;">Payment method<br><span style="color:#1e293b;font-weight:600;">${paymentMethod}</span></td>
<td width="50%" valign="top" style="padding:0 0 12px 8px;color:#64748b;">Transaction ID<br><span style="color:#1e293b;font-weight:600;font-family:ui-monospace,monospace;">${transactionId}</span></td>
</tr>
<tr>
<td width="50%" valign="top" style="padding:0 8px 0 0;color:#64748b;">Payment date<br><span style="color:#1e293b;font-weight:600;">${dateIssued}</span></td>
<td width="50%" valign="top" style="padding:0 0 0 8px;color:#64748b;">Status<br><span style="color:#16a34a;font-weight:600;">✓ Successful</span></td>
</tr>
</table>`
    : `<p style="margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#64748b;">Awaiting payment. No transaction has been recorded for this invoice yet.</p>`;

  const cardStyle = fullPage
    ? "position:relative;width:100%;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 10px 15px -3px rgba(15,23,42,0.08);font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;"
    : "position:relative;max-width:800px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 10px 15px -3px rgba(15,23,42,0.08);font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;";

  return `<div id="invoice-card" style="${cardStyle}">
<div style="position:absolute;top:40px;right:32px;font-size:88px;font-weight:800;line-height:1;color:#f1f5f9;pointer-events:none;user-select:none;">INVOICE</div>
<div style="position:relative;padding:48px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #f1f5f9;padding-bottom:32px;margin-bottom:32px;">
<tr>
<td valign="top" style="padding-bottom:16px;">
<img src="${logoSrc}" alt="Triven" width="130" height="38" style="display:block;height:36px;width:auto;max-width:130px;margin-bottom:12px;" />
<p style="margin:0 0 4px 0;font-size:14px;font-weight:500;color:#334155;">Triven AI Agent Platform</p>
<p style="margin:0;font-size:14px;color:#64748b;">info@triven.ai</p>
</td>
<td valign="top" align="right" style="padding-bottom:16px;">
<p style="margin:0;font-size:24px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Invoice</p>
<p style="margin:8px 0 0 0;font-size:14px;color:#334155;font-family:ui-monospace,monospace;">#${invoiceNumber}</p>
<p style="margin:8px 0 0 0;font-size:14px;color:#64748b;">Date issued: <span style="color:#334155;font-weight:500;">${dateIssued}</span></p>
<span style="display:inline-block;margin-top:12px;padding:4px 12px;border-radius:9999px;font-size:14px;font-weight:500;background:${status.badgeBg};color:${status.badgeText};">${status.label}</span>
</td>
</tr>
</table>

<div style="margin-bottom:32px;">
<p style="margin:0 0 8px 0;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Bill To</p>
<p style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:#0f172a;">${businessName}</p>
${billingAddress ? `<p style="margin:0 0 4px 0;font-size:14px;color:#475569;">${billingAddress}</p>` : ""}
${businessEmail ? `<p style="margin:0;font-size:14px;color:#475569;">${businessEmail}</p>` : ""}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;border-collapse:collapse;margin-bottom:24px;">
<thead>
<tr style="background:#f8fafc;color:#475569;">
<th align="left" style="padding:10px 12px;font-weight:600;width:40px;">#</th>
<th align="left" style="padding:10px 12px;font-weight:600;">Description</th>
<th align="right" style="padding:10px 12px;font-weight:600;width:48px;">Qty</th>
<th align="right" style="padding:10px 12px;font-weight:600;width:96px;">Unit Price</th>
<th align="right" style="padding:10px 12px;font-weight:600;width:96px;">Amount</th>
</tr>
</thead>
<tbody>
${lineItemRows}
</tbody>
</table>

<table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:288px;font-size:14px;margin-bottom:32px;">
<tr><td style="padding:4px 0;color:#64748b;">Subtotal</td><td align="right" style="padding:4px 0;color:#334155;">${displayAmount}</td></tr>
<tr><td style="padding:8px 0 4px 0;font-size:16px;font-weight:700;color:#0f172a;border-top:1px solid #e2e8f0;">Total</td><td align="right" style="padding:8px 0 4px 0;font-size:16px;font-weight:700;color:#0f172a;border-top:1px solid #e2e8f0;">${displayAmount}</td></tr>
<tr><td style="padding:4px 0;color:#64748b;">Amount Paid</td><td align="right" style="padding:4px 0;color:#334155;">${amountPaid}</td></tr>
<tr><td style="padding:4px 0;font-weight:700;color:#0f172a;">Balance Due</td><td align="right" style="padding:4px 0;font-weight:700;color:${status.balanceColor};">${balanceDue}</td></tr>
</table>

<div style="clear:both;border-top:1px solid #f1f5f9;padding-top:32px;margin-bottom:32px;">
<p style="margin:0 0 12px 0;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Payment Information</p>
${paymentInfoPaid}
</div>

<div style="border-top:1px solid #f1f5f9;padding-top:32px;font-size:14px;color:#64748b;line-height:1.6;">
<p style="margin:0;">Thank you for your business!</p>
<p style="margin:0;">For questions about this invoice, contact info@triven.ai</p>
<p style="margin:0;">Payment terms: Due upon receipt</p>
</div>
</div>
<div style="display:flex;justify-content:space-between;gap:8px;border-top:1px solid #f1f5f9;background:#f8fafc;padding:16px 48px;font-size:12px;color:#94a3b8;">
<span>Triven AI Agent Platform — Empowering businesses with intelligent automation</span>
<span>Page 1 of 1</span>
</div>
</div>`;
}

export function getLogoDataUri(): string | null {
  const buffer = getLogoBuffer();
  if (!buffer) return null;
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export function buildInvoiceDocumentHtml(invoice: InvoiceData, options?: { logoSrc?: string }) {
  const logoSrc = options?.logoSrc ?? getLogoDataUri() ?? logoUrl;
  const card = buildInvoiceCardHtml(invoice, { logoSrc, fullPage: true });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice #${escapeHtml(invoice.invoiceNumber)}</title>
<style>
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  width: 794px;
  min-height: 1123px;
  background: #f1f5f9;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.invoice-page {
  width: 794px;
  min-height: 1123px;
  padding: 45px;
  background: #f1f5f9;
}
@media print {
  html, body { background: #f1f5f9; }
  .invoice-page { padding: 45px; }
  @page { size: A4 portrait; margin: 0; }
  #invoice-card { box-shadow: none !important; }
}
</style>
</head>
<body>
<div class="invoice-page">
${card}
</div>
</body>
</html>`;
}

const LOGO_FILE_NAME = "triven.ai word logo transparent bg.PNG";

// Resolve the Triven logo from the frontend public dir (works whether the
// backend runs from apps/backend or the repo root). Cached after first read so
// it's loaded at most once. Returns null if the asset can't be found.
let cachedLogoBuffer: Buffer | null | undefined;

function getLogoBuffer(): Buffer | null {
  if (cachedLogoBuffer !== undefined) return cachedLogoBuffer;

  const candidates = [
    process.env.TRIVEN_LOGO_PATH,
    path.resolve(process.cwd(), "assets", LOGO_FILE_NAME),
    path.resolve(process.cwd(), "../frontend/public", LOGO_FILE_NAME),
    path.resolve(process.cwd(), "apps/frontend/public", LOGO_FILE_NAME),
    path.resolve(process.cwd(), "../../apps/frontend/public", LOGO_FILE_NAME)
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedLogoBuffer = fs.readFileSync(candidate);
        return cachedLogoBuffer;
      }
    } catch {
      // try next candidate
    }
  }

  cachedLogoBuffer = null;
  return cachedLogoBuffer;
}

function formatMoney(amountCents: number, currency = "usd") {
  const amount = (Number(amountCents) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase()
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function formatInvoiceDate(date: Date) {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function prettyStatus(status: string) {
  const value = (status || "").toUpperCase();
  if (value === "SUCCEEDED") return "Paid";
  if (value === "TRIALING") return "Trial";
  if (value === "PENDING") return "Pending";
  if (value === "FAILED") return "Failed";
  if (value === "CANCELED") return "Canceled";
  if (value === "REFUNDED") return "Refunded";
  return status || "—";
}

/**
 * Render the same invoice card layout as the billing detail page to PDF.
 */
export function buildInvoicePdfBuffer(invoice: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 36 });
      const chunks: Buffer[] = [];
      const { status, displayAmount, amountPaid, balanceDue } = invoiceAmounts(invoice);

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width;
      const margin = doc.page.margins.left;
      const cardWidth = pageWidth - margin * 2;
      const cardLeft = margin;
      let y = margin;

      const drawCardContainer = () => {
        doc
          .save()
          .rect(0, 0, doc.page.width, doc.page.height)
          .fill("#ffffff")
          .restore();
        doc
          .save()
          .roundedRect(cardLeft, margin, cardWidth, doc.page.height - margin * 2, 12)
          .lineWidth(1)
          .fillAndStroke("#ffffff", "#e2e8f0")
          .restore();
      };

      // Card container
      drawCardContainer();

      const innerX = cardLeft + 40;
      const innerRight = cardLeft + cardWidth - 40;
      y += 36;

      // Logo + seller
      const logoBuffer = getLogoBuffer();
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, innerX, y, { fit: [110, 32] });
        } catch {
          // ignore logo render errors
        }
      }

      doc
        .fillColor("#334155")
        .font("Helvetica")
        .fontSize(11)
        .text("Triven AI Agent Platform", innerX, y + 40)
        .fillColor("#64748b")
        .text("info@triven.ai", innerX, y + 56);

      // Invoice meta (right)
      doc
        .fillColor("#94a3b8")
        .font("Helvetica-Bold")
        .fontSize(20)
        .text("INVOICE", innerX, y, { width: cardWidth - 80, align: "right" });

      doc
        .fillColor("#334155")
        .font("Helvetica")
        .fontSize(10)
        .text(`#${invoice.invoiceNumber}`, innerX, y + 28, { width: cardWidth - 80, align: "right" })
        .fillColor("#64748b")
        .text(
          `Date issued: ${formatInvoiceFullDate(invoice.date)}`,
          innerX,
          y + 44,
          { width: cardWidth - 80, align: "right" }
        )
        .fillColor(status.badgeText)
        .font("Helvetica-Bold")
        .text(status.label, innerX, y + 62, { width: cardWidth - 80, align: "right" });

      y += 110;
      doc.moveTo(innerX, y).lineTo(innerRight, y).strokeColor("#f1f5f9").stroke();
      y += 24;

      // Bill to
      doc.fillColor("#94a3b8").font("Helvetica-Bold").fontSize(9).text("BILL TO", innerX, y);
      doc
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(invoice.businessName || "Customer", innerX, y + 16);
      let billY = y + 32;
      if (invoice.billingAddress?.trim()) {
        doc.fillColor("#475569").font("Helvetica").fontSize(10).text(invoice.billingAddress.trim(), innerX, billY);
        billY += 14;
      }
      if (invoice.businessEmail) {
        doc.text(invoice.businessEmail, innerX, billY);
        billY += 14;
      }

      y = billY + 20;

      const description = invoice.description || invoice.agentName || "Agent purchase";
      const lineItems =
        invoice.lineItems && invoice.lineItems.length > 0
          ? invoice.lineItems
          : [{ label: description, amountCents: invoice.amountCents }];

      const drawTableHeader = () => {
        doc.rect(innerX, y, innerRight - innerX, 22).fill("#f8fafc");
        doc.fillColor("#475569").font("Helvetica-Bold").fontSize(9);
        doc.text("#", innerX + 8, y + 7, { width: 20 });
        doc.text("Description", innerX + 32, y + 7, { width: 220 });
        doc.text("Qty", innerX + 280, y + 7, { width: 30, align: "right" });
        doc.text("Unit Price", innerX + 320, y + 7, { width: 70, align: "right" });
        doc.text("Amount", innerX + 400, y + 7, {
          width: innerRight - innerX - 408,
          align: "right"
        });
        y += 22;
      };

      const beginContinuationPage = () => {
        doc.addPage();
        drawCardContainer();
        y = margin + 24;
        doc
          .fillColor("#94a3b8")
          .font("Helvetica-Bold")
          .fontSize(16)
          .text("INVOICE - CONTINUED", innerX, y);
        doc
          .fillColor("#475569")
          .font("Helvetica")
          .fontSize(10)
          .text(`#${invoice.invoiceNumber}`, innerX, y + 22);
        y += 52;
        drawTableHeader();
      };

      drawTableHeader();
      lineItems.forEach((item, index) => {
        doc.font("Helvetica").fontSize(10);
        const rowHeight = Math.max(32, doc.heightOfString(item.label, { width: 220 }) + 18);
        if (y + rowHeight > doc.page.height - margin - 215) {
          beginContinuationPage();
        }

        const values = invoiceLineItemValues(item, invoice.currency);
        doc.fillColor("#64748b").font("Helvetica").fontSize(10).text(String(index + 1), innerX + 8, y + 9, {
          width: 20
        });
        doc.fillColor("#0f172a").text(values.label, innerX + 32, y + 9, { width: 220 });
        doc.text(values.quantity, innerX + 280, y + 9, { width: 30, align: "right" });
        doc.text(values.unitPrice, innerX + 320, y + 9, { width: 70, align: "right" });
        doc.font("Helvetica-Bold").text(values.amount, innerX + 400, y + 9, {
          width: innerRight - innerX - 408,
          align: "right"
        });
        y += rowHeight;
        doc.moveTo(innerX, y).lineTo(innerRight, y).strokeColor("#f1f5f9").stroke();
      });

      doc.moveTo(innerX, y).lineTo(innerRight, y).strokeColor("#f1f5f9").stroke();
      y += 18;

      // Totals
      const totalsX = innerRight - 180;
      doc.fillColor("#64748b").font("Helvetica").fontSize(10);
      doc.text("Subtotal", totalsX, y, { width: 90 });
      doc.fillColor("#334155").text(displayAmount, totalsX + 90, y, { width: 90, align: "right" });
      y += 16;
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11);
      doc.text("Total", totalsX, y, { width: 90 });
      doc.text(displayAmount, totalsX + 90, y, { width: 90, align: "right" });
      y += 16;
      doc.fillColor("#64748b").font("Helvetica").fontSize(10);
      doc.text("Amount Paid", totalsX, y, { width: 90 });
      doc.fillColor("#334155").text(amountPaid, totalsX + 90, y, { width: 90, align: "right" });
      y += 16;
      doc.fillColor("#0f172a").font("Helvetica-Bold").text("Balance Due", totalsX, y, { width: 90 });
      doc.fillColor(status.balanceColor).text(balanceDue, totalsX + 90, y, { width: 90, align: "right" });

      y += 32;
      doc.moveTo(innerX, y).lineTo(innerRight, y).strokeColor("#f1f5f9").stroke();
      y += 18;

      doc.fillColor("#94a3b8").font("Helvetica-Bold").fontSize(9).text("PAYMENT INFORMATION", innerX, y);
      y += 16;

      if (status.isPaid) {
        doc.fillColor("#64748b").font("Helvetica").fontSize(10);
        doc.text("Payment method", innerX, y);
        doc.fillColor("#1e293b").font("Helvetica-Bold").text(invoice.paymentMethod || "—", innerX, y + 12);
        doc.fillColor("#64748b").font("Helvetica").text("Transaction ID", innerX + 240, y);
        doc
          .fillColor("#1e293b")
          .font("Helvetica-Bold")
          .text(invoice.transactionId || "—", innerX + 240, y + 12, { width: innerRight - innerX - 240 });
        y += 34;
        doc.fillColor("#64748b").font("Helvetica").text("Payment date", innerX, y);
        doc
          .fillColor("#1e293b")
          .font("Helvetica-Bold")
          .text(formatInvoiceFullDate(invoice.date), innerX, y + 12);
        doc.fillColor("#64748b").font("Helvetica").text("Status", innerX + 240, y);
        doc.fillColor("#16a34a").font("Helvetica-Bold").text("Successful", innerX + 240, y + 12);
      } else {
        doc
          .fillColor("#64748b")
          .font("Helvetica")
          .fontSize(10)
          .text("Awaiting payment. No transaction has been recorded for this invoice yet.", innerX, y, {
            width: innerRight - innerX
          });
      }

      y += 48;
      doc.moveTo(innerX, y).lineTo(innerRight, y).strokeColor("#f1f5f9").stroke();
      y += 16;
      doc
        .fillColor("#64748b")
        .font("Helvetica")
        .fontSize(10)
        .text("Thank you for your business!", innerX, y)
        .text("For questions about this invoice, contact info@triven.ai", innerX, y + 14)
        .text("Payment terms: Due upon receipt", innerX, y + 28);

      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Failed to build invoice PDF"));
    }
  });
}

type SendPaymentSuccessEmailInput = {
  to: string;
  name?: string | null;
  invoice: InvoiceData;
  setupUrl?: string | null;
};

export async function sendPaymentSuccessEmail({
  to,
  name,
  invoice,
  setupUrl
}: SendPaymentSuccessEmailInput) {
  const pdfBuffer = await buildInvoicePdfBuffer(invoice);

  await sendPlatformEmail({
    purpose: "billing",
    to,
    subject: `Your ${brandName} purchase: ${invoice.agentName}`,
    text: `Thanks for your purchase on ${brandName}. ${invoice.agentName} is now in your account. Amount: ${formatMoney(invoice.amountCents, invoice.currency)}. Invoice #${invoice.invoiceNumber}. Your invoice PDF is attached.`,
    html: buildPaymentSuccessEmailHtml({ name, invoice, setupUrl }),
    attachments: [
      {
        filename: `invoice-${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  });
}

function buildPaymentSuccessEmailHtml({
  name,
  invoice,
  setupUrl
}: {
  name?: string | null;
  invoice: InvoiceData;
  setupUrl?: string | null;
}) {
  const safeName = escapeHtml(name?.trim() || invoice.businessName?.trim() || "there");
  const safeAgentName = escapeHtml(invoice.agentName);
  const safeSetupUrl = setupUrl ? escapeHtml(setupUrl) : null;
  const invoiceCard = buildInvoiceCardHtml(invoice);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your ${brandName} purchase: ${safeAgentName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f1f5f9;">Your invoice for ${safeAgentName} is attached.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">

<tr>
<td style="padding:28px 32px 0 32px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">
${emailLogoMarkup()}
</td>
</tr>

<tr>
<td style="padding:14px 32px 0 32px;">
<div style="height:4px;line-height:4px;font-size:0;background-color:#f59e0b;background-image:linear-gradient(90deg,#f59e0b,#d97706);border-radius:2px;">&nbsp;</div>
</td>
</tr>

<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 8px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;line-height:1.4;color:#111827;">
Hi ${safeName}, your purchase is confirmed 🎉
</p>

<p style="margin:0 0 16px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#334155;">
<strong>${safeAgentName}</strong> has been added to your ${brandName} account. Your invoice is below and attached to this email as a PDF.
</p>

<div style="margin:4px 0 18px 0;">
${invoiceCard}
</div>

${safeSetupUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;">
<tr>
<td align="center">
<a href="${safeSetupUrl}" target="_blank" style="display:inline-block;background-color:#f59e0b;background-image:linear-gradient(90deg,#f59e0b,#d97706);border-radius:10px;color:#ffffff;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:1;text-decoration:none;padding:15px 24px;">
Set up your agent
</a>
</td>
</tr>
</table>` : ""}
</td>
</tr>

${buildEmailFooterRow()}

</table>
</td>
</tr>
</table>
</body>
</html>`;
}

// --- Payment failed email --------------------------------------------------

type SendPaymentFailedEmailInput = {
  to: string;
  name?: string | null;
  agentName?: string | null;
  cardLast4?: string | null;
  failureReason?: string | null;
  listingId?: string | null;
  updateUrl?: string | null;
  retryUrl?: string | null;
};

export async function sendPaymentFailedEmail({
  to,
  name,
  agentName,
  cardLast4,
  failureReason,
  listingId,
  updateUrl,
  retryUrl
}: SendPaymentFailedEmailInput) {
  const checkoutUrl = listingId
    ? `${checkoutLink}?listingId=${encodeURIComponent(listingId)}`
    : checkoutLink;
  const update = updateUrl?.trim() || checkoutUrl;
  const retry = retryUrl?.trim() || checkoutUrl;
  const reason = failureReason?.trim() || "Payment was declined";

  await sendPlatformEmail({
    purpose: "billing",
    to,
    subject: `Payment failed — please update your payment method`,
    text: `We couldn't process your most recent payment${
      agentName ? ` for ${agentName}` : ""
    }. Reason: ${reason}. Update your payment method to keep access: ${update}`,
    html: buildPaymentFailedEmailHtml({
      name,
      cardLast4,
      failureReason: reason,
      updateUrl: update,
      retryUrl: retry
    })
  });
}

function buildPaymentFailedEmailHtml({
  name,
  cardLast4,
  failureReason,
  updateUrl,
  retryUrl
}: {
  name?: string | null;
  cardLast4?: string | null;
  failureReason: string;
  updateUrl: string;
  retryUrl: string;
}) {
  const safeName = escapeHtml(name?.trim() || "there");
  const safeCard = escapeHtml((cardLast4 || "").replace(/\D/g, "").slice(-4) || "••••");
  const safeReason = escapeHtml(failureReason);
  const safeUpdate = escapeHtml(updateUrl);
  const safeRetry = escapeHtml(retryUrl);

  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 16px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Hi ${safeName}, we couldn't process your most recent payment.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
<tr><td style="padding:10px 14px;background-color:#f8fafc;${emailBodyStyle}font-size:13px;color:#64748b;white-space:nowrap;">Card</td><td align="right" style="padding:10px 14px;${emailBodyStyle}font-size:14px;color:#111827;font-weight:500;">&bull;&bull;&bull;&bull; ${safeCard}</td></tr>
<tr><td style="padding:10px 14px;background-color:#f8fafc;${emailBodyStyle}font-size:13px;color:#64748b;white-space:nowrap;border-top:1px solid #e2e8f0;">Reason</td><td align="right" style="padding:10px 14px;${emailBodyStyle}font-size:14px;color:#111827;font-weight:500;border-top:1px solid #e2e8f0;">${safeReason}</td></tr>
</table>
${primaryButton(safeUpdate, "Update payment method")}
${secondaryButton(safeRetry, "Retry payment")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">To avoid losing access, please update your details within a few days.</p>
</td>
</tr>`;

  return emailShell(
    "We couldn't process your latest payment.",
    "Payment failed — please update your payment method",
    inner
  );
}



type SendFreeAssignmentEmailInput = {
  to: string;
  assignmentLink: string;
  name?: string | null;
};

export async function sendFreeAssignmentEmail({
  to,
  assignmentLink,
  name
}: SendFreeAssignmentEmailInput) {
  await sendPlatformEmail({
    purpose: "confirmation",
    to,
    subject: `Your free ${brandName} AI assessment link`,
    text: `Your free ${brandName} AI assessment is ready. Open this link to continue: ${assignmentLink}`,
    html: buildFreeAssignmentEmailHtml({
      name,
      assignmentLink
    })
  });
}

function buildFreeAssignmentEmailHtml({
  name,
  assignmentLink
}: {
  name?: string | null;
  assignmentLink: string;
}) {
  const safeName = escapeHtml(name?.trim() || "there");
  const safeAssignmentLink = escapeHtml(assignmentLink);
  const safePrivacyLink = escapeHtml(privacyLink);
  const safeTermsLink = escapeHtml(termsLink);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your free ${brandName} AI assessment link</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f1f5f9;">
Your free ${brandName} AI assessment link is ready.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">

<tr>
<td style="padding:28px 32px 0 32px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.3px;">
${emailLogoMarkup()}
</td>
</tr>

<tr>
<td style="padding:14px 32px 0 32px;">
<div style="height:4px;line-height:4px;font-size:0;background-color:#f59e0b;background-image:linear-gradient(90deg,#f59e0b,#d97706);border-radius:2px;">&nbsp;</div>
</td>
</tr>

<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 8px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;line-height:1.4;color:#111827;">
Hi ${safeName},
</p>

<p style="margin:0 0 16px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#334155;">
Your free ${brandName} AI assessment link is ready. Use it to answer a few quick questions so we can recommend the right AI agent setup for your business.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 22px 0;">
<tr>
<td align="center">
<a href="${safeAssignmentLink}" target="_blank" style="display:inline-block;background-color:#f59e0b;background-image:linear-gradient(90deg,#f59e0b,#d97706);border-radius:10px;color:#ffffff;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:1;text-decoration:none;padding:15px 24px;">
Start free assessment
</a>
</td>
</tr>
</table>

<p style="margin:0 0 14px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#64748b;">
If the button does not work, copy and paste this link into your browser:
</p>

<p style="margin:0 0 18px 0;word-break:break-all;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#d97706;">
<a href="${safeAssignmentLink}" target="_blank" style="color:#d97706;text-decoration:none;">${safeAssignmentLink}</a>
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #fde68a;border-radius:8px;overflow:hidden;background-color:#fffbeb;">
<tr>
<td width="4" style="width:4px;background-color:#f59e0b;font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:12px 16px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#92400e;">
This assessment helps ${brandName} understand your business needs before recommending an AI agent.
</td>
</tr>
</table>
</td>
</tr>

<tr>
<td style="padding:10px 32px 30px 32px;">
<div style="border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#94a3b8;">
<div style="font-weight:600;color:#64748b;">${brandName}</div>
<div>Your AI Workforce</div>
<div style="margin-top:8px;">
<a href="${safePrivacyLink}" target="_blank" style="color:#d97706;text-decoration:none;">Privacy</a>
&nbsp;&middot;&nbsp;
<a href="${safeTermsLink}" target="_blank" style="color:#d97706;text-decoration:none;">Terms</a>
</div>
</div>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Buyer onboarding sequence: welcome (first login) → popular agents (day 3)
// → ROI / results (day 7). All use the shared Triven header + minimal footer.
// ---------------------------------------------------------------------------

const emailBodyStyle = "font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

function emailShell(previewText: string, title: string, innerRows: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f1f5f9;">${previewText}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
${buildEmailHeaderRows()}
${innerRows}
${buildEmailFooterRow()}
</table>
</td></tr>
</table>
</body>
</html>`;
}

function primaryButton(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px 0;"><tr><td align="center" bgcolor="#f59e0b" style="border-radius:8px;background-image:linear-gradient(90deg,#f59e0b,#d97706);"><a href="${href}" target="_blank" style="display:inline-block;padding:12px 30px;${emailBodyStyle}font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a></td></tr></table>`;
}

function secondaryButton(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;"><tr><td align="center" bgcolor="#ffffff" style="border-radius:8px;border:1px solid #fcd34d;"><a href="${href}" target="_blank" style="display:inline-block;padding:11px 28px;${emailBodyStyle}font-size:15px;font-weight:600;color:#b45309;text-decoration:none;border-radius:8px;">${label}</a></td></tr></table>`;
}

function billingEmailDetailRow(label: string, value: string, valueColor = "#111827") {
  return `<tr>
<td valign="top" style="padding:10px 14px;background-color:#f8fafc;${emailBodyStyle}font-size:13px;line-height:1.5;color:#64748b;">${escapeHtml(label)}</td>
<td valign="top" align="right" style="padding:10px 14px;${emailBodyStyle}font-size:14px;font-weight:600;line-height:1.5;color:${valueColor};">${escapeHtml(value)}</td>
</tr>`;
}

export function buildUsageOverdueEmailHtml({
  name,
  invoiceNumber,
  billingPeriod,
  amountUsd,
  gracePeriodEnd,
  billingUrl
}: {
  name: string;
  invoiceNumber: string;
  billingPeriod: string;
  amountUsd: string;
  gracePeriodEnd: string;
  billingUrl: string;
}) {
  const safeName = escapeHtml(name.trim() || "there");
  const safeBillingUrl = escapeHtml(billingUrl);
  const amount = `$${amountUsd}`;
  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<span style="display:inline-block;margin:0 0 12px 0;padding:5px 10px;border-radius:9999px;background-color:#fee2e2;${emailBodyStyle}font-size:12px;font-weight:700;letter-spacing:0.04em;color:#b91c1c;">PAYMENT OVERDUE</span>
<p style="margin:0 0 8px 0;${emailBodyStyle}font-size:20px;font-weight:700;line-height:1.4;color:#111827;">Your usage invoice is overdue</p>
<p style="margin:0 0 18px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Hi ${safeName}, we have not yet received payment for your ${escapeHtml(billingPeriod)} execution usage.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;border-collapse:separate;">
${billingEmailDetailRow("Invoice", invoiceNumber)}
${billingEmailDetailRow("Billing period", billingPeriod)}
${billingEmailDetailRow("Balance due", amount, "#dc2626")}
${billingEmailDetailRow("Grace period ends", gracePeriodEnd)}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #fecaca;border-radius:8px;overflow:hidden;background-color:#fef2f2;">
<tr><td width="4" style="width:4px;background-color:#dc2626;font-size:0;line-height:0;">&nbsp;</td><td style="padding:12px 16px;${emailBodyStyle}font-size:14px;line-height:1.6;color:#991b1b;">Please pay before the grace period ends to avoid interruption to your agents.</td></tr>
</table>
${primaryButton(safeBillingUrl, "View and pay invoice")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">If you have already paid, no further action is needed. Your billing status will update after the payment is processed.</p>
</td>
</tr>`;

  return emailShell(
    `Invoice ${escapeHtml(invoiceNumber)} has an outstanding balance of ${escapeHtml(amount)}.`,
    "Usage invoice overdue",
    inner
  );
}

export function buildAgentInvoiceOverdueEmailHtml({
  name,
  agentName,
  amountUsd,
  pauseDate,
  billingUrl
}: {
  name: string;
  agentName: string;
  amountUsd: string;
  pauseDate: string;
  billingUrl: string;
}) {
  const safeName = escapeHtml(name.trim() || "there");
  const safeAgentName = escapeHtml(agentName);
  const safeBillingUrl = escapeHtml(billingUrl);
  const amount = `$${amountUsd}`;
  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<span style="display:inline-block;margin:0 0 12px 0;padding:5px 10px;border-radius:9999px;background-color:#fee2e2;${emailBodyStyle}font-size:12px;font-weight:700;letter-spacing:0.04em;color:#b91c1c;">PAYMENT OVERDUE</span>
<p style="margin:0 0 8px 0;${emailBodyStyle}font-size:20px;font-weight:700;line-height:1.4;color:#111827;">The bill for ${safeAgentName} is overdue</p>
<p style="margin:0 0 18px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Hi ${safeName}, we have not yet received payment for <strong>${safeAgentName}</strong>. Please clear the balance within the 7-day grace period to keep the agent answering.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;border-collapse:separate;">
${billingEmailDetailRow("Agent", agentName)}
${billingEmailDetailRow("Balance due", amount, "#dc2626")}
${billingEmailDetailRow("Service pauses on", pauseDate)}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #fecaca;border-radius:8px;overflow:hidden;background-color:#fef2f2;">
<tr><td width="4" style="width:4px;background-color:#dc2626;font-size:0;line-height:0;">&nbsp;</td><td style="padding:12px 16px;${emailBodyStyle}font-size:14px;line-height:1.6;color:#991b1b;">If the balance is not paid by ${escapeHtml(pauseDate)}, ${safeAgentName} and all of its services &mdash; calls, texts, and bookings &mdash; will be paused until payment is received.</td></tr>
</table>
${primaryButton(safeBillingUrl, "Pay outstanding balance")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">If you have already paid, no further action is needed. Your billing status will update after the payment is processed.</p>
</td>
</tr>`;

  return emailShell(
    `${safeAgentName} has an overdue balance of ${escapeHtml(amount)}.`,
    "Agent bill overdue",
    inner
  );
}

export function buildBillingSuspendedEmailHtml({
  name,
  agentName,
  amountUsd,
  billingUrl,
  reminder
}: {
  name: string;
  agentName: string;
  amountUsd: string;
  billingUrl: string;
  /** False for the initial suspension notice, true for weekly follow-ups. */
  reminder: boolean;
}) {
  const safeName = escapeHtml(name.trim() || "there");
  const safeAgentName = escapeHtml(agentName);
  const safeBillingUrl = escapeHtml(billingUrl);
  const amount = `$${amountUsd}`;
  const headline = reminder
    ? `${safeAgentName} is still paused for an unpaid balance`
    : `${safeAgentName} has been paused for an unpaid balance`;
  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<span style="display:inline-block;margin:0 0 12px 0;padding:5px 10px;border-radius:9999px;background-color:#fee2e2;${emailBodyStyle}font-size:12px;font-weight:700;letter-spacing:0.04em;color:#b91c1c;">SERVICE PAUSED</span>
<p style="margin:0 0 8px 0;${emailBodyStyle}font-size:20px;font-weight:700;line-height:1.4;color:#111827;">${headline}</p>
<p style="margin:0 0 18px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Hi ${safeName}, the 7-day grace period on your overdue balance has ended, so <strong>${safeAgentName}</strong> and all of its services &mdash; calls, texts, and bookings &mdash; are paused. Service resumes automatically as soon as the balance is paid.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;border-collapse:separate;">
${billingEmailDetailRow("Agent", agentName)}
${billingEmailDetailRow("Balance due", amount, "#dc2626")}
${billingEmailDetailRow("Service status", "Paused")}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #fecaca;border-radius:8px;overflow:hidden;background-color:#fef2f2;">
<tr><td width="4" style="width:4px;background-color:#dc2626;font-size:0;line-height:0;">&nbsp;</td><td style="padding:12px 16px;${emailBodyStyle}font-size:14px;line-height:1.6;color:#991b1b;">Customers calling this agent are not being answered while it is paused. Pay the outstanding balance to restore service immediately.</td></tr>
</table>
${primaryButton(safeBillingUrl, "Pay outstanding balance")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">If you have already paid, no further action is needed. Your service will be restored automatically once the payment is processed.</p>
</td>
</tr>`;

  return emailShell(
    `${safeAgentName} is paused with an outstanding balance of ${escapeHtml(amount)}.`,
    reminder ? "Service still paused" : "Service paused",
    inner
  );
}

export function buildSpendingAlertEmailHtml({
  name,
  billingPeriod,
  totalUsd,
  thresholdUsd,
  billingUrl
}: {
  name: string;
  billingPeriod: string;
  totalUsd: string;
  thresholdUsd: string;
  billingUrl: string;
}) {
  const safeName = escapeHtml(name.trim() || "there");
  const safeBillingUrl = escapeHtml(billingUrl);
  const total = `$${totalUsd}`;
  const threshold = `$${thresholdUsd}`;
  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<span style="display:inline-block;margin:0 0 12px 0;padding:5px 10px;border-radius:9999px;background-color:#fef3c7;${emailBodyStyle}font-size:12px;font-weight:700;letter-spacing:0.04em;color:#b45309;">SPENDING ALERT</span>
<p style="margin:0 0 8px 0;${emailBodyStyle}font-size:20px;font-weight:700;line-height:1.4;color:#111827;">Your spending threshold was reached</p>
<p style="margin:0 0 18px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Hi ${safeName}, your agent execution usage for ${escapeHtml(billingPeriod)} has reached the alert amount you configured.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;border-collapse:separate;">
${billingEmailDetailRow("Billing period", billingPeriod)}
${billingEmailDetailRow("Current execution cost", total, "#d97706")}
${billingEmailDetailRow("Alert threshold", threshold)}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #fde68a;border-radius:8px;overflow:hidden;background-color:#fffbeb;">
<tr><td width="4" style="width:4px;background-color:#f59e0b;font-size:0;line-height:0;">&nbsp;</td><td style="padding:12px 16px;${emailBodyStyle}font-size:14px;line-height:1.6;color:#92400e;">This is an informational alert. Your services remain active and usage may continue to increase during this billing period.</td></tr>
</table>
${primaryButton(safeBillingUrl, "Review detailed usage")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">You can change or disable this alert at any time from Billing &amp; Usage.</p>
</td>
</tr>`;

  return emailShell(
    `${escapeHtml(billingPeriod)} execution usage reached ${escapeHtml(total)}.`,
    "Spending alert reached",
    inner
  );
}

export function buildSubscriptionRenewalReminderEmailHtml({
  name,
  agentName,
  renewalDate,
  amountUsd,
  billingUrl
}: {
  name: string;
  agentName: string;
  renewalDate: string;
  amountUsd: string;
  billingUrl: string;
}) {
  const safeName = escapeHtml(name.trim() || "there");
  const safeAgentName = escapeHtml(agentName);
  const safeBillingUrl = escapeHtml(billingUrl);
  const amount = `$${amountUsd}`;
  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<span style="display:inline-block;margin:0 0 12px 0;padding:5px 10px;border-radius:9999px;background-color:#fef3c7;${emailBodyStyle}font-size:12px;font-weight:700;letter-spacing:0.04em;color:#b45309;">RENEWAL REMINDER</span>
<p style="margin:0 0 8px 0;${emailBodyStyle}font-size:20px;font-weight:700;line-height:1.4;color:#111827;">Your agent subscription renews tomorrow</p>
<p style="margin:0 0 18px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Hi ${safeName}, your current 30-day subscription for <strong>${safeAgentName}</strong> is almost complete. Please review the renewal invoice to continue service without interruption.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;border-collapse:separate;">
${billingEmailDetailRow("Agent", agentName)}
${billingEmailDetailRow("Renewal date", renewalDate)}
${billingEmailDetailRow("Renewal amount", amount, "#d97706")}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #fde68a;border-radius:8px;overflow:hidden;background-color:#fffbeb;">
<tr><td width="4" style="width:4px;background-color:#f59e0b;font-size:0;line-height:0;">&nbsp;</td><td style="padding:12px 16px;${emailBodyStyle}font-size:14px;line-height:1.6;color:#92400e;">Please clear the renewal invoice by the renewal date so your agent can continue serving customers without interruption.</td></tr>
</table>
${primaryButton(safeBillingUrl, "Review renewal invoice")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">This reminder was sent one day before your current subscription period ends.</p>
</td>
</tr>`;

  return emailShell(
    `${safeAgentName} renews on ${escapeHtml(renewalDate)}.`,
    "Subscription renewal reminder",
    inner
  );
}

export function buildPendingInvoiceReminderEmailHtml({
  name,
  invoiceNumber,
  description,
  amountUsd,
  dueDate,
  billingUrl
}: {
  name: string;
  invoiceNumber: string;
  description: string;
  amountUsd: string;
  dueDate: string;
  billingUrl: string;
}) {
  const safeName = escapeHtml(name.trim() || "there");
  const safeBillingUrl = escapeHtml(billingUrl);
  const amount = `$${amountUsd}`;
  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<span style="display:inline-block;margin:0 0 12px 0;padding:5px 10px;border-radius:9999px;background-color:#dbeafe;${emailBodyStyle}font-size:12px;font-weight:700;letter-spacing:0.04em;color:#1d4ed8;">PAYMENT REMINDER</span>
<p style="margin:0 0 8px 0;${emailBodyStyle}font-size:20px;font-weight:700;line-height:1.4;color:#111827;">A gentle reminder about your pending invoice</p>
<p style="margin:0 0 18px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Hi ${safeName}, this is a friendly reminder that the invoice below is approaching its due date.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;border-collapse:separate;">
${billingEmailDetailRow("Invoice", invoiceNumber)}
${billingEmailDetailRow("Description", description)}
${billingEmailDetailRow("Amount due", amount, "#d97706")}
${billingEmailDetailRow("Due date", dueDate)}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #dbeafe;border-radius:8px;overflow:hidden;background-color:#eff6ff;">
<tr><td width="4" style="width:4px;background-color:#3b82f6;font-size:0;line-height:0;">&nbsp;</td><td style="padding:12px 16px;${emailBodyStyle}font-size:14px;line-height:1.6;color:#1e40af;">Please clear the invoice by its due date to keep your services running without interruption.</td></tr>
</table>
${primaryButton(safeBillingUrl, "Review and pay invoice")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">If payment is already in progress, no action is required.</p>
</td>
</tr>`;

  return emailShell(
    `Invoice ${escapeHtml(invoiceNumber)} is due on ${escapeHtml(dueDate)}.`,
    "Pending invoice reminder",
    inner
  );
}

export function buildTrialEndedEmailHtml({
  agentName,
  trialEndDate,
  myAgentsLink
}: {
  agentName: string;
  trialEndDate: string;
  myAgentsLink: string;
}) {
  const safeAgentName = escapeHtml(agentName);
  const safeTrialEndDate = escapeHtml(trialEndDate);
  const safeMyAgentsLink = escapeHtml(myAgentsLink);
  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 16px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Your ${brandName} trial for <strong>${safeAgentName}</strong> ended on <strong>${safeTrialEndDate}</strong>. Your data is safe. Choose a plan to continue using your agent.</p>
${primaryButton(safeMyAgentsLink, "Choose a plan")}
</td>
</tr>`;

  return emailShell(
    "Your trial ended, but your data is safe.",
    "Your trial has expired",
    inner
  );
}

export type AppointmentBookedEmailDetails = {
  businessName: string;
  appointmentId: string;
  customerName?: string | null;
  customerPhone: string;
  service?: string | null;
  providerName?: string | null;
  startAt: Date;
  endAt: Date;
  timeZone?: string | null;
  appointmentLink?: string | null;
};

type SendAppointmentBookedEmailInput = AppointmentBookedEmailDetails & {
  to: string;
};

function appointmentEmailTimeZone(timeZone?: string | null) {
  const requested = timeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: requested }).format(new Date());
    return requested;
  } catch {
    return "UTC";
  }
}

function appointmentEmailDisplay(details: AppointmentBookedEmailDetails) {
  const timeZone = appointmentEmailTimeZone(details.timeZone);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone
  }).format(details.startAt);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone
  }).format(details.startAt);
  const durationMinutes = Math.max(
    0,
    Math.round((details.endAt.getTime() - details.startAt.getTime()) / 60_000)
  );

  return {
    customerName: details.customerName?.trim() || "Customer",
    service: details.service?.trim() || "Appointment",
    providerName: details.providerName?.trim() || null,
    date,
    time,
    duration: durationMinutes === 1 ? "1 minute" : `${durationMinutes} minutes`,
    timeZone
  };
}

function appointmentEmailDestination(appointmentLink?: string | null) {
  const dashboardLink = `${appUrl}/business/dashboard`;
  const candidate = appointmentLink?.trim();
  if (!candidate) return dashboardLink;

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : dashboardLink;
  } catch {
    return dashboardLink;
  }
}

export function buildAppointmentBookedEmailHtml(details: AppointmentBookedEmailDetails) {
  const display = appointmentEmailDisplay(details);
  const destination = appointmentEmailDestination(details.appointmentLink);
  const detailRow = (label: string, value: string) =>
    `<tr><td valign="top" width="145" style="padding:7px 12px 7px 0;${emailBodyStyle}font-size:13px;font-weight:600;line-height:1.5;color:#64748b;">${escapeHtml(label)}</td><td valign="top" style="padding:7px 0;${emailBodyStyle}font-size:14px;font-weight:500;line-height:1.5;color:#111827;word-break:break-word;">${escapeHtml(value)}</td></tr>`;

  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 7px 0;${emailBodyStyle}font-size:20px;font-weight:700;line-height:1.4;color:#111827;">New appointment booked</p>
<p style="margin:0 0 18px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">A new appointment has been booked for <strong>${escapeHtml(details.businessName)}</strong>. Here are the details your team needs.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
<tr><td style="padding:14px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${detailRow("Customer", display.customerName)}
${detailRow("Phone", details.customerPhone)}
${detailRow("Service", display.service)}
${detailRow("Date", display.date)}
${detailRow("Time", display.time)}
${detailRow("Duration", display.duration)}
${display.providerName ? detailRow("Team member", display.providerName) : ""}
${detailRow("Booking reference", details.appointmentId)}
</table>
</td></tr>
</table>
${primaryButton(escapeHtml(destination), "View appointment")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">Please review the appointment and prepare for the customer. This notification was sent automatically by ${brandName}.</p>
</td>
</tr>`;

  return emailShell(
    `${escapeHtml(display.customerName)} booked ${escapeHtml(display.service)} for ${escapeHtml(display.date)}.`,
    "New appointment booked",
    inner
  );
}

export async function sendAppointmentBookedEmail({
  to,
  ...details
}: SendAppointmentBookedEmailInput) {
  const display = appointmentEmailDisplay(details);
  const destination = appointmentEmailDestination(details.appointmentLink);
  const textRows = [
    `A new appointment has been booked for ${details.businessName}.`,
    "",
    `Customer: ${display.customerName}`,
    `Phone: ${details.customerPhone}`,
    `Service: ${display.service}`,
    `Date: ${display.date}`,
    `Time: ${display.time}`,
    `Duration: ${display.duration}`,
    ...(display.providerName ? [`Team member: ${display.providerName}`] : []),
    `Booking reference: ${details.appointmentId}`,
    "",
    `View appointment: ${destination}`
  ];

  await sendPlatformEmail({
    purpose: "notification",
    to,
    subject: `New appointment booked: ${display.customerName} — ${display.service}`,
    text: textRows.join("\n"),
    html: buildAppointmentBookedEmailHtml(details)
  });
}

// --- 1) Welcome email (sent on a buyer's first login) ----------------------

type SendBuyerWelcomeEmailInput = {
  to: string;
  buyerName?: string | null;
  companyName?: string | null;
  onboardingLink?: string | null;
  docsLink?: string | null;
};

export async function sendBuyerWelcomeEmail({
  to,
  buyerName,
  companyName,
  onboardingLink,
  docsLink
}: SendBuyerWelcomeEmailInput) {
  const name = buyerName?.trim() || "there";
  const onboarding = onboardingLink?.trim() || marketplaceLink;

  await sendPlatformEmail({
    purpose: "notification",
    to,
    subject: `Welcome to ${brandName}, ${name}! Let's get started`,
    text: `Welcome aboard, ${name}. Your ${brandName} account is ready. Browse the marketplace and pick an agent, connect your tools, and run your first task. Start here: ${onboarding}`,
    html: buildBuyerWelcomeEmailHtml({ buyerName: name, companyName, onboardingLink: onboarding, docsLink })
  });
}

function buildBuyerWelcomeEmailHtml({
  buyerName,
  companyName,
  onboardingLink,
  docsLink
}: {
  buyerName: string;
  companyName?: string | null;
  onboardingLink: string;
  docsLink?: string | null;
}) {
  const safeName = escapeHtml(buyerName);
  const safeCompany = companyName?.trim() ? escapeHtml(companyName.trim()) : "your business";
  const safeOnboarding = escapeHtml(onboardingLink);

  const step = (text: string) =>
    `<tr><td valign="top" width="20" style="padding:0 0 8px 0;${emailBodyStyle}font-size:15px;line-height:1.6;color:#f59e0b;">&#8226;</td><td valign="top" style="padding:0 0 8px 0;${emailBodyStyle}font-size:15px;line-height:1.6;color:#334155;">${text}</td></tr>`;

  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 16px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Welcome aboard, ${safeName}. Your ${brandName} account for ${safeCompany} is ready, and you're a few steps away from your first working agent.</p>
<p style="margin:22px 0 10px 0;${emailBodyStyle}font-size:16px;font-weight:700;color:#111827;line-height:1.4;">Your first steps</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 16px 0;">
${step("Browse the marketplace and pick an agent that fits your workflow")}
${step("Connect the tools your team already uses")}
${step("Run your first task and review the results")}
</table>
${primaryButton(safeOnboarding, "Start onboarding")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">Have a question along the way? Just reply to this email.</p>
</td>
</tr>`;

  return emailShell(
    "Your first steps to putting AI agents to work.",
    `Welcome to ${brandName}, ${safeName}! Let's get started`,
    inner
  );
}

// --- 2) Popular agents email (day 3 of onboarding) -------------------------

type SendBuyerPopularAgentsEmailInput = {
  to: string;
  buyerName?: string | null;
  featuredAgents?: string | null;
  browseLink?: string | null;
  successStoriesLink?: string | null;
};

/* TWO ONBOARDING EMAILS WITH INVENTED FIGURES, AND NO SENDER.
   A day-three "most popular agents" mail naming three agents as this week's
   favourites, and a day-seven mail telling a business that teams in their
   industry see "30% less time on admin", "2x faster response time" and "98%
   tasks completed". Nothing on this platform measures any of that, and
   nothing ever called either function — the sequence they belong to was
   never built past its welcome mail. Removed 2026-08-27. */

const architectDashboardLink = `${appUrl}/architect/payouts`;

type SendArchitectNewSaleEmailInput = {
  to: string;
  architectName?: string | null;
  agentName: string;
  earningsCents?: number | null;
  dashboardLink?: string | null;
};

export async function sendArchitectNewSaleEmail({
  to,
  architectName,
  agentName,
  earningsCents,
  dashboardLink
}: SendArchitectNewSaleEmailInput) {
  const name = architectName?.trim() || "there";
  const dashboard = dashboardLink?.trim() || architectDashboardLink;

  await sendPlatformEmail({
    purpose: "notification",
    to,
    subject: `Congrats! Another person is now using ${agentName} 🎉`,
    text: `Great news, ${name} — someone just started using your agent "${agentName}" on ${brandName}. That's one more business putting your work to use.${
      earningsCents && earningsCents > 0 ? ` Estimated earnings from this sale: ${formatMoney(earningsCents)}.` : ""
    } View your earnings: ${dashboard}`,
    html: buildArchitectNewSaleEmailHtml({ architectName: name, agentName, earningsCents, dashboardLink: dashboard })
  });
}

function buildArchitectNewSaleEmailHtml({
  architectName,
  agentName,
  earningsCents,
  dashboardLink
}: {
  architectName: string;
  agentName: string;
  earningsCents?: number | null;
  dashboardLink: string;
}) {
  const safeName = escapeHtml(architectName);
  const safeAgentName = escapeHtml(agentName);
  const safeDashboard = escapeHtml(dashboardLink);
  const earningsRow =
    earningsCents && earningsCents > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #fde68a;border-radius:8px;overflow:hidden;background-color:#fffbeb;">
<tr>
<td width="4" style="width:4px;background-color:#f59e0b;font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:12px 16px;${emailBodyStyle}font-size:14px;line-height:1.6;color:#92400e;">Estimated earnings from this sale: <strong>${escapeHtml(formatMoney(earningsCents))}</strong></td>
</tr>
</table>`
      : "";

  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 8px 0;${emailBodyStyle}font-size:18px;font-weight:700;line-height:1.4;color:#111827;">Congrats, ${safeName}! 🎉</p>
<p style="margin:0 0 16px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">You have one more person using your agent. Someone just started using <strong>${safeAgentName}</strong> on ${brandName} — that's another business putting your work to good use.</p>
${earningsRow}
${primaryButton(safeDashboard, "View your earnings")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">Keep it up — every install grows your storefront.</p>
</td>
</tr>`;

  return emailShell(
    "You have one more person using your agent.",
    `Congrats! Another person is now using ${safeAgentName}`,
    inner
  );
}
