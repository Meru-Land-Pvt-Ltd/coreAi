import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { env } from "../config/env";

const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpSecure = process.env.SMTP_SECURE === "true";

const verificationCodeExpirationMinutes = Number(
  process.env.VERIFICATION_CODE_EXPIRATION_MINUTES ?? 10
);

const appUrl = env.FRONTEND_URL.replace(/\/$/, "");
const brandName = "Triven.ai";
const privacyLink = process.env.CORE_PRIVACY_URL ?? `${appUrl}/privacy`;
const termsLink = process.env.CORE_TERMS_URL ?? `${appUrl}/terms`;
const helpLink = process.env.CORE_HELP_URL ?? `${appUrl}/contact`;
const marketplaceLink = `${appUrl}/business/marketplace`;

export const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

type SendVerificationEmailInput = {
  to: string;
  code: string;
  role: "BUSINESS" | "ARCHITECT";
};

export async function sendVerificationEmail({
  to,
  code,
  role
}: SendVerificationEmailInput) {
  const roleLabel = role === "BUSINESS" ? "Business Owner" : "AI Architect";

  await mailTransporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: `Your ${brandName} verification code: ${code}`,
    text: `Your ${brandName} verification code is ${code}. Use this code to finish signing in as ${roleLabel}. This code expires in ${verificationCodeExpirationMinutes} minutes. ${brandName} will never ask you for this code. Do not share it with anyone.`,
    html: buildVerificationEmailHtml({
      code,
      roleLabel,
      expirationMinutes: verificationCodeExpirationMinutes
    })
  });
}

function buildVerificationEmailHtml({
  code,
  roleLabel,
  expirationMinutes
}: {
  code: string;
  roleLabel: string;
  expirationMinutes: number;
}) {
  const safeCode = escapeHtml(code);
  const safeRoleLabel = escapeHtml(roleLabel);
  const safeExpirationMinutes = escapeHtml(String(expirationMinutes));
  const safePrivacyLink = escapeHtml(privacyLink);
  const safeTermsLink = escapeHtml(termsLink);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your ${brandName} verification code: ${safeCode}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f1f5f9;">Your one-time code expires in ${safeExpirationMinutes} minutes.</div>
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
Use this code to finish signing in to ${brandName} as <strong>${safeRoleLabel}</strong>.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0;">
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
</table>
</td>
</tr>

<tr>
<td style="padding:10px 32px 30px 32px;">
<div style="border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#94a3b8;">
<div style="font-weight:600;color:#64748b;">${brandName} &mdash; AI Agent Platform</div>
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

// Text-based wordmark (amber dot + brand name) rendered inline in the email
// header. Using HTML instead of an <img> avoids the "1 attachment" indicator
// and broken-image issues in clients that block remote/inline images.
function emailLogoMarkup() {
  return `<span style="color:#f59e0b;font-size:22px;line-height:1;vertical-align:middle;">&#9679;</span><span style="vertical-align:middle;margin-left:8px;color:#f59e0b;">${brandName}</span>`;
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

// Minimal footer: brand name + Privacy / Help links only. No mailing address,
// no unsubscribe link, no "AI Agent Platform" tagline.
function buildEmailFooterRow() {
  return `<tr>
<td style="padding:10px 32px 30px 32px;">
<div style="border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#94a3b8;">
<div style="font-weight:600;color:#64748b;">${brandName}</div>
<div style="margin-top:8px;">
<a href="${escapeHtml(privacyLink)}" target="_blank" style="color:#d97706;text-decoration:none;">Privacy</a>
&nbsp;&middot;&nbsp;
<a href="${escapeHtml(helpLink)}" target="_blank" style="color:#d97706;text-decoration:none;">Help Center</a>
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
  currency: string;
  status: string;
};

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
 * Render a branded PDF invoice to a Buffer. Used both for the billing-page
 * download endpoint and as the attachment on the payment-success email.
 */
export function buildInvoicePdfBuffer(invoice: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const amber = "#f59e0b";
      const slate = "#0f172a";
      const muted = "#64748b";
      const pageLeft = doc.page.margins.left;
      const pageRight = doc.page.width - doc.page.margins.right;
      const contentWidth = pageRight - pageLeft;

      // Header band.
      doc.rect(pageLeft, 50, contentWidth, 6).fill(amber);

      // Brand block (logo + wordmark + tagline) sharing a single left edge,
      // vertically centered against the logo on the left.
      const brandNameY = 70;
      const taglineY = 96;
      const logoSize = 36;
      // Center the logo on the two-line text block (brand name + tagline).
      const logoY = Math.round((brandNameY + taglineY + 12) / 2 - logoSize / 2);

      const logoBuffer = getLogoBuffer();
      let brandTextX = pageLeft;

      if (logoBuffer) {
        try {
          doc.image(logoBuffer, pageLeft, logoY, { fit: [logoSize, logoSize] });
          brandTextX = pageLeft + logoSize + 12;
        } catch {
          brandTextX = pageLeft;
        }
      }

      doc
        .fillColor(amber)
        .font("Helvetica-Bold")
        .fontSize(22)
        .text(brandName, brandTextX, brandNameY);

      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(10)
        .text("AI Agent Platform — Your AI Workforce", brandTextX, taglineY);

      doc
        .fillColor(slate)
        .font("Helvetica-Bold")
        .fontSize(26)
        .text("INVOICE", pageLeft, 72, { align: "right", width: contentWidth });

      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(10)
        .text(`Invoice #: ${invoice.invoiceNumber}`, pageLeft, 104, { align: "right", width: contentWidth })
        .text(`Date: ${formatInvoiceDate(invoice.date)}`, pageLeft, 118, { align: "right", width: contentWidth })
        .text(`Status: ${prettyStatus(invoice.status)}`, pageLeft, 132, { align: "right", width: contentWidth });

      // Bill-to.
      const billY = 168;
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("BILLED TO", pageLeft, billY);

      doc
        .fillColor(slate)
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(invoice.businessName || "Customer", pageLeft, billY + 14);

      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(10)
        .text(invoice.businessEmail || "", pageLeft, billY + 30);

      // Line-item table.
      const tableTop = billY + 70;
      const descX = pageLeft + 14;
      const amountColWidth = 120;
      const amountX = pageRight - amountColWidth - 14;

      doc.rect(pageLeft, tableTop, contentWidth, 26).fill("#f8fafc");
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("DESCRIPTION", descX, tableTop + 9)
        .text("AMOUNT", amountX, tableTop + 9, { width: amountColWidth, align: "right" });

      const rowY = tableTop + 26 + 12;
      doc
        .fillColor(slate)
        .font("Helvetica")
        .fontSize(11)
        .text(invoice.description || invoice.agentName, descX, rowY, { width: amountX - descX - 10 })
        .text(formatMoney(invoice.amountCents, invoice.currency), amountX, rowY, {
          width: amountColWidth,
          align: "right"
        });

      const dividerY = rowY + 34;
      doc.moveTo(pageLeft, dividerY).lineTo(pageRight, dividerY).strokeColor("#e2e8f0").stroke();

      // Total.
      const totalY = dividerY + 16;
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("Total", amountX - 120, totalY, { width: 120, align: "right" });
      doc
        .fillColor(slate)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(formatMoney(invoice.amountCents, invoice.currency), amountX, totalY - 1, {
          width: amountColWidth,
          align: "right"
        });

      // Footer.
      const footerY = doc.page.height - 90;
      doc.moveTo(pageLeft, footerY).lineTo(pageRight, footerY).strokeColor("#e2e8f0").stroke();
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(9)
        .text(
          `Thank you for your business. This invoice was generated by ${brandName}.`,
          pageLeft,
          footerY + 12,
          { width: contentWidth, align: "center" }
        );

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

  await mailTransporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
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
  const safeDescription = escapeHtml(invoice.description || invoice.agentName);
  const safeAmount = escapeHtml(formatMoney(invoice.amountCents, invoice.currency));
  const safeInvoiceNumber = escapeHtml(invoice.invoiceNumber);
  const safeDate = escapeHtml(formatInvoiceDate(invoice.date));
  const safeStatus = escapeHtml(prettyStatus(invoice.status));
  const safePrivacyLink = escapeHtml(privacyLink);
  const safeTermsLink = escapeHtml(termsLink);
  const safeSetupUrl = setupUrl ? escapeHtml(setupUrl) : null;

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
<strong>${safeAgentName}</strong> has been added to your ${brandName} account. Your invoice is attached to this email as a PDF.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
<tr>
<td style="padding:14px 16px;background-color:#f8fafc;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#64748b;">
Invoice #${safeInvoiceNumber}
</td>
<td align="right" style="padding:14px 16px;background-color:#f8fafc;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#64748b;">
${safeDate}
</td>
</tr>
<tr>
<td style="padding:14px 16px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#334155;">
${safeDescription}
</td>
<td align="right" style="padding:14px 16px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#111827;">
${safeAmount}
</td>
</tr>
<tr>
<td colspan="2" style="padding:0 16px;"><div style="border-top:1px solid #e2e8f0;height:1px;line-height:1px;font-size:0;">&nbsp;</div></td>
</tr>
<tr>
<td style="padding:12px 16px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#111827;">
Total &middot; ${safeStatus}
</td>
<td align="right" style="padding:12px 16px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#f59e0b;">
${safeAmount}
</td>
</tr>
</table>

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

<tr>
<td style="padding:10px 32px 30px 32px;">
<div style="border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#94a3b8;">
<div style="font-weight:600;color:#64748b;">${brandName} &mdash; AI Agent Platform</div>
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
  await mailTransporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
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

  await mailTransporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
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

export async function sendBuyerPopularAgentsEmail({
  to,
  buyerName,
  featuredAgents,
  browseLink,
  successStoriesLink
}: SendBuyerPopularAgentsEmailInput) {
  const name = buyerName?.trim() || "there";

  await mailTransporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: `Discover the most popular agents on ${brandName}`,
    text: `Hi ${name}, now that you're set up, here are some of the most popular agents on ${brandName} right now. Browse them here: ${browseLink?.trim() || marketplaceLink}`,
    html: buildBuyerPopularAgentsEmailHtml({ buyerName: name, featuredAgents, browseLink, successStoriesLink })
  });
}

function buildBuyerPopularAgentsEmailHtml({
  buyerName,
  featuredAgents,
  browseLink,
  successStoriesLink
}: {
  buyerName: string;
  featuredAgents?: string | null;
  browseLink?: string | null;
  successStoriesLink?: string | null;
}) {
  const safeName = escapeHtml(buyerName);
  const safeFeatured = escapeHtml(
    featuredAgents?.trim() ||
      "Missed Call Text-Back, Appointment Reminder Pro, and Google Review Booster"
  );
  const safeBrowse = escapeHtml(browseLink?.trim() || marketplaceLink);

  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 16px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Hi ${safeName}, now that you're set up, here are some of the most popular agents on ${brandName} right now.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background-color:#f8fafc;"><tr><td width="4" style="width:4px;background-color:#cbd5e1;font-size:0;line-height:0;">&nbsp;</td><td style="padding:12px 16px;${emailBodyStyle}font-size:14px;line-height:1.6;color:#334155;">${safeFeatured}</td></tr></table>
<p style="margin:0 0 16px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Each one is ready to try in minutes, with no setup required to test it out.</p>
${primaryButton(safeBrowse, "Browse featured agents")}
</td>
</tr>`;

  return emailShell(
    "Hand-picked agents teams are using every day.",
    `Discover the most popular agents on ${brandName}`,
    inner
  );
}

// --- 3) ROI / results email (day 7 of onboarding) --------------------------

type SendBuyerRoiEmailInput = {
  to: string;
  buyerName?: string | null;
  industry?: string | null;
  caseStudies?: string | null;
  demoLink?: string | null;
};

export async function sendBuyerRoiEmail({
  to,
  buyerName,
  industry,
  caseStudies,
  demoLink
}: SendBuyerRoiEmailInput) {
  const name = buyerName?.trim() || "there";
  const industryLabel = industry?.trim() || "service";

  await mailTransporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: `See the ROI: ${name}, here's what other ${industryLabel} teams achieve`,
    text: `Hi ${name}, a week in is a good time to look at what's possible. Teams in ${industryLabel} are seeing measurable results with ${brandName} agents. Explore your dashboard or schedule a demo: ${demoLink?.trim() || helpLink}`,
    html: buildBuyerRoiEmailHtml({ buyerName: name, industry: industryLabel, caseStudies, demoLink })
  });
}

function buildBuyerRoiEmailHtml({
  buyerName,
  industry,
  caseStudies,
  demoLink
}: {
  buyerName: string;
  industry: string;
  caseStudies?: string | null;
  demoLink?: string | null;
}) {
  const safeName = escapeHtml(buyerName);
  const safeIndustry = escapeHtml(industry);
  const safeCaseStudies = escapeHtml(
    caseStudies?.trim() || "how teams like yours automate follow-ups and win back missed calls"
  );
  const safeDemo = escapeHtml(demoLink?.trim() || helpLink);

  const statCell = (value: string, label: string) =>
    `<td align="center" valign="top" width="33%" style="padding:14px 8px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;"><div style="${emailBodyStyle}font-size:21px;font-weight:700;color:#b45309;line-height:1.2;">${value}</div><div style="${emailBodyStyle}font-size:12px;color:#92400e;margin-top:4px;line-height:1.3;">${label}</div></td>`;

  const inner = `<tr>
<td style="padding:24px 32px 6px 32px;">
<p style="margin:0 0 16px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">Hi ${safeName}, a week in is a good time to look at what's possible. Teams in ${safeIndustry} are seeing measurable results with ${brandName} agents.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;"><tr>
${statCell("30%", "Less time on admin")}
<td width="10" style="font-size:0;line-height:0;">&nbsp;</td>
${statCell("2x", "Faster response time")}
<td width="10" style="font-size:0;line-height:0;">&nbsp;</td>
${statCell("98%", "Tasks completed")}
</tr></table>
<p style="margin:0 0 16px 0;${emailBodyStyle}font-size:15px;line-height:1.65;color:#334155;">We've pulled together case studies relevant to your work: ${safeCaseStudies}</p>
${primaryButton(safeDemo, "Schedule a demo")}
<p style="margin:0 0 12px 0;${emailBodyStyle}font-size:13px;line-height:1.6;color:#94a3b8;">Prefer to explore on your own? Everything above is available in your dashboard.</p>
</td>
</tr>`;

  return emailShell(
    "Real results from teams like yours.",
    `See the ROI: ${safeName}, here's what other ${safeIndustry} teams achieve`,
    inner
  );
}