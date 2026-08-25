/**
 * NODE 013 — APPROVAL: the owner's yes/no door.
 *
 * The agent drafts a reply and HOLDS it. The owner gets one mail with the
 * draft and a link here. This page shows the draft and two buttons; Approve
 * sends the held mail to the customer, Reject buries it. No login — the
 * secret token in the link is the key, exactly like an unsubscribe link.
 *
 * Two laws of this door:
 *  - GET never decides. Mail scanners prefetch links; a prefetched GET that
 *    approved a mail would be the machine approving itself. Decisions are
 *    POST from the buttons only.
 *  - Deciding twice is honest, not an error: the page says what already
 *    happened and who cannot be mailed twice.
 */

import { Hono } from "hono";
import { prisma } from "../../lib/prisma";
import { isPlatformMailConfigured, sendPlatformEmail } from "../../lib/mailer";
import { getBusinessEmailAlias } from "../email/ses-mail-service";

export const approvalRoutes = new Hono();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a}
  .wrap{max-width:560px;margin:0 auto;padding:40px 20px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px}
  h1{font-size:18px;margin:0 0 6px}
  p{font-size:14px;line-height:1.6;color:#475569;margin:8px 0}
  .draft{white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:14px;line-height:1.6;margin:14px 0}
  .row{display:flex;gap:10px;margin-top:18px}
  button{flex:1;border:0;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:pointer}
  .yes{background:#f59e0b;color:#fff}
  .no{background:#e2e8f0;color:#334155}
  .meta{font-size:12px;color:#94a3b8;margin-top:14px}
</style></head><body><div class="wrap"><div class="card">${body}</div></div></body></html>`;
}

async function loadPending(token: string) {
  if (!/^[a-f0-9]{48,64}$/.test(token)) return null;
  return prisma.pendingApproval.findUnique({ where: { token } });
}

function statusPage(status: string, customer: string): string {
  if (status === "APPROVED")
    return page("Already sent", `<h1>Already sent</h1><p>This reply was approved and has gone to ${escapeHtml(customer)}. Nothing more to do.</p>`);
  if (status === "REJECTED")
    return page("Not sent", `<h1>Not sent</h1><p>This draft was rejected — nothing reached ${escapeHtml(customer)}. If you want to answer, reply to your agent's mail: it reaches them directly.</p>`);
  return page("Expired", `<h1>This draft expired</h1><p>It waited too long for a decision and was never sent. The customer may still be waiting — reply to your agent's mail to reach them directly.</p>`);
}

approvalRoutes.get("/:token", async (c) => {
  const pending = await loadPending(c.req.param("token"));
  if (!pending) return c.html(page("Not found", "<h1>Link not recognised</h1><p>This approval link is not valid.</p>"), 404);

  if (pending.status !== "PENDING") return c.html(statusPage(pending.status, pending.customerEmail));
  if (pending.expiresAt < new Date()) {
    await prisma.pendingApproval.update({ where: { id: pending.id }, data: { status: "EXPIRED" } });
    return c.html(statusPage("EXPIRED", pending.customerEmail));
  }

  return c.html(
    page(
      "Approve this reply?",
      `<h1>Your agent wants to send this${pending.isTest ? " (test)" : ""}</h1>
<p>To: <strong>${escapeHtml(pending.customerEmail)}</strong><br>Subject: <strong>${escapeHtml(pending.draftSubject)}</strong></p>
<div class="draft">${escapeHtml(pending.draftBody)}</div>
<form method="post" action="${escapeHtml(pending.token)}/decide">
  <div class="row">
    <button class="yes" name="decision" value="approve" type="submit">Approve — send it</button>
    <button class="no" name="decision" value="reject" type="submit">Don't send</button>
  </div>
</form>
<p class="meta">Want different words? Just reply to the mail that brought you here — your reply goes straight to the customer.</p>`
    )
  );
});

approvalRoutes.post("/:token/decide", async (c) => {
  const pending = await loadPending(c.req.param("token"));
  if (!pending) return c.html(page("Not found", "<h1>Link not recognised</h1><p>This approval link is not valid.</p>"), 404);
  if (pending.status !== "PENDING") return c.html(statusPage(pending.status, pending.customerEmail));
  if (pending.expiresAt < new Date()) {
    await prisma.pendingApproval.update({ where: { id: pending.id }, data: { status: "EXPIRED" } });
    return c.html(statusPage("EXPIRED", pending.customerEmail));
  }

  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const decision = String((form as Record<string, unknown>).decision ?? "");

  if (decision === "reject") {
    await prisma.pendingApproval.update({
      where: { id: pending.id },
      data: { status: "REJECTED", decidedAt: new Date() }
    });
    return c.html(statusPage("REJECTED", pending.customerEmail));
  }
  if (decision !== "approve") {
    return c.html(page("Choose", "<h1>Nothing decided</h1><p>Use the two buttons on the approval page.</p>"), 422);
  }

  /* Claim atomically — two clicks, one send. Whoever updates the PENDING row
     sends; the other click sees "already sent". */
  const claimed = await prisma.pendingApproval.updateMany({
    where: { id: pending.id, status: "PENDING" },
    data: { status: "APPROVED", decidedAt: new Date() }
  });
  if (claimed.count === 0) {
    const fresh = await prisma.pendingApproval.findUnique({ where: { id: pending.id } });
    return c.html(statusPage(fresh?.status ?? "APPROVED", pending.customerEmail));
  }

  if (!isPlatformMailConfigured()) {
    return c.html(
      page("Approved", `<h1>Approved — sending is not configured</h1><p>The draft was approved but this server cannot send mail. The customer has not received it.</p>`)
    );
  }

  /* Live, the reply continues the conversation: Reply-To is the agent's own
     address, so the customer's answer wakes the ear again. In a test the
     "customer" is the architect, and the loop points back at them. */
  let businessName = "your business";
  let replyTo: string | undefined = pending.isTest ? pending.customerEmail : undefined;
  if (pending.businessId) {
    const business = await prisma.business.findUnique({
      where: { id: pending.businessId },
      select: { name: true }
    });
    if (business?.name) businessName = business.name;
    if (!pending.isTest) {
      const alias = await getBusinessEmailAlias(pending.businessId).catch(() => null);
      if (alias?.emailAddress) replyTo = alias.emailAddress;
    }
  }

  try {
    await sendPlatformEmail({
      purpose: "notification",
      to: pending.customerEmail,
      subject: pending.draftSubject,
      text: pending.draftBody,
      fromName: businessName,
      ...(replyTo ? { replyTo } : {})
    });
  } catch {
    await prisma.pendingApproval.update({
      where: { id: pending.id },
      data: { status: "PENDING", decidedAt: null }
    });
    return c.html(
      page("Try again", "<h1>Sending failed</h1><p>The mail could not be sent just now — the draft is still waiting. Open the link again in a minute.</p>"),
      502
    );
  }

  return c.html(
    page(
      "Sent",
      `<h1>Sent${pending.isTest ? " (test)" : ""}</h1><p>Your agent's reply is on its way to <strong>${escapeHtml(pending.customerEmail)}</strong>. Their answer will reach your agent by itself.</p>`
    )
  );
});
