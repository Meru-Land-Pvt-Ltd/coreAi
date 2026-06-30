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
const EMAIL_LOGO_CID = "triven-logo@triven.ai";
const trivenLogoUrl = `${appUrl.replace(/\/$/, "")}/${encodeURIComponent("triven.ai word logo transparent bg.PNG")}`;
const privacyLink = process.env.CORE_PRIVACY_URL ?? `${appUrl}/privacy`;
const termsLink = process.env.CORE_TERMS_URL ?? `${appUrl}/terms`;

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
    }),
    attachments: getEmailLogoAttachments()
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
  const safeLogoSrc = escapeHtml(getEmailLogoSrc());
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
<img src="${safeLogoSrc}" alt="${brandName} logo" width="36" height="36" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none;" />
<span style="display:inline-block;vertical-align:middle;margin-left:10px;color:#f59e0b;">${brandName}</span>
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

function getEmailLogoSrc() {
  return getLogoBuffer() ? `cid:${EMAIL_LOGO_CID}` : trivenLogoUrl;
}

function getEmailLogoAttachments() {
  const logoBuffer = getLogoBuffer();
  if (!logoBuffer) return [];

  return [
    {
      filename: "triven-logo.png",
      content: logoBuffer,
      cid: EMAIL_LOGO_CID,
      contentType: "image/png"
    }
  ];
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
      ...getEmailLogoAttachments(),
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
  const safeLogoSrc = escapeHtml(getEmailLogoSrc());
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
<img src="${safeLogoSrc}" alt="${brandName} logo" width="36" height="36" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none;" />
<span style="display:inline-block;vertical-align:middle;margin-left:10px;color:#f59e0b;">${brandName}</span>
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
    }),
    attachments: getEmailLogoAttachments()
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
  const safeLogoSrc = escapeHtml(getEmailLogoSrc());
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
<img src="${safeLogoSrc}" alt="${brandName} logo" width="36" height="36" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none;" />
<span style="display:inline-block;vertical-align:middle;margin-left:10px;color:#f59e0b;">${brandName}</span>
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