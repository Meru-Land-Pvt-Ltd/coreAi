import nodemailer from "nodemailer";

const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpSecure = process.env.SMTP_SECURE === "true";

const verificationCodeExpirationMinutes = Number(
  process.env.VERIFICATION_CODE_EXPIRATION_MINUTES ?? 10
);

const appUrl = process.env.APP_URL ?? "https://usecore.ai";
const brandName = "Triven.ai";
const trivenLogoUrl = `${appUrl}/${encodeURIComponent("triven.ai word logo transparent bg.PNG")}`;
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
  const safeLogoUrl = escapeHtml(trivenLogoUrl);
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
<img src="${safeLogoUrl}" alt="${brandName} logo" width="36" height="36" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none;" />
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
<div>San Francisco, CA</div>
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
  const safeLogoUrl = escapeHtml(trivenLogoUrl);
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
<img src="${safeLogoUrl}" alt="${brandName} logo" width="36" height="36" style="display:inline-block;vertical-align:middle;border:0;outline:none;text-decoration:none;" />
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
<div style="font-weight:600;color:#64748b;">${brandName} &mdash; AI Agent Platform</div>
<div>San Francisco, CA</div>
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