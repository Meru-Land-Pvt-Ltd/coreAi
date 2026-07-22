import { Hono } from "hono";
import { successResponse } from "../../lib/api-response";
import { sendPlatformEmail } from "../../lib/mailer";
import { requireAuth } from "../../middleware/auth";
import { DPA_FILE_NAME, getDpaPdf } from "./dpa-pdf";

const SUPPORT_EMAIL = "support@triven.ai";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character] ?? character);
}

export const legalRoutes = new Hono();

legalRoutes.get("/dpa.pdf", async (c) => {
  const pdf = await getDpaPdf();
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${DPA_FILE_NAME}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
      "X-Content-Type-Options": "nosniff"
    }
  });
});

legalRoutes.post("/dpa/requests", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  const body: Record<string, unknown> = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}));
  const company = typeof body.company === "string" ? body.company.trim().slice(0, 200) : "";
  const industry = typeof body.industry === "string" ? body.industry.trim().slice(0, 100) : "";
  const requirements = typeof body.requirements === "string" ? body.requirements.trim().slice(0, 4000) : "";
  const requesterName =
    (typeof body.fullName === "string" ? body.fullName.trim().slice(0, 200) : "") ||
    authUser.fullName ||
    "Not provided";
  const requesterEmail =
    (typeof body.email === "string" ? body.email.trim().slice(0, 320) : "") || authUser.email;
  const requestedAt = new Date().toISOString();
  const lines = [
    "A signed Data Processing Agreement has been requested.",
    "",
    `Requester: ${requesterName}`,
    `Account email: ${authUser.email}`,
    `Reply email: ${requesterEmail}`,
    `Account role: ${authUser.role}`,
    `Company: ${company || "Not provided"}`,
    `Industry: ${industry || "Not provided"}`,
    `Requirements: ${requirements || "None provided"}`,
    `User ID: ${authUser.id}`,
    `Requested at: ${requestedAt}`
  ];

  await sendPlatformEmail({
    purpose: "support",
    to: SUPPORT_EMAIL,
    subject: `Signed DPA request - ${company || requesterName}`,
    text: lines.join("\n"),
    html: `<h2>Signed DPA request</h2><p>A user has requested a countersigned Data Processing Agreement.</p><table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#e2e8f0"><tr><th align="left">Requester</th><td>${escapeHtml(requesterName)}</td></tr><tr><th align="left">Account email</th><td>${escapeHtml(authUser.email)}</td></tr><tr><th align="left">Reply email</th><td>${escapeHtml(requesterEmail)}</td></tr><tr><th align="left">Role</th><td>${escapeHtml(authUser.role)}</td></tr><tr><th align="left">Company</th><td>${escapeHtml(company || "Not provided")}</td></tr><tr><th align="left">Industry</th><td>${escapeHtml(industry || "Not provided")}</td></tr><tr><th align="left">Requirements</th><td>${escapeHtml(requirements || "None provided")}</td></tr><tr><th align="left">User ID</th><td>${escapeHtml(authUser.id)}</td></tr><tr><th align="left">Requested at</th><td>${escapeHtml(requestedAt)}</td></tr></table>`
  });

  return successResponse(c, { requestedAt }, "Signed DPA request sent", 201);
});
