import nodemailer from "nodemailer";

const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpSecure = process.env.SMTP_SECURE === "true";

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
    subject: "Your CORE verification code",
    text: `Your CORE verification code is ${code}. This code will expire in 10 minutes.`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:32px;">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #f1f5f9;border-radius:18px;padding:28px;">
          <h2 style="margin:0;color:#0f172a;">Verify your CORE login</h2>
          <p style="color:#475569;font-size:14px;line-height:1.6;">
            Use this verification code to continue as <strong>${roleLabel}</strong>.
          </p>
          <div style="margin:24px 0;padding:18px;border-radius:14px;background:#fffbeb;text-align:center;">
            <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#d97706;">${code}</div>
          </div>
          <p style="color:#64748b;font-size:13px;">
            This code expires in 10 minutes. If you did not request this, you can ignore this email.
          </p>
        </div>
      </div>
    `
  });
}