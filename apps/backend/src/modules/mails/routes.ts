import { Hono } from "hono";
import { env } from "../../config/env";
import { sendFreeAssignmentEmail, sendPaymentSuccessEmail } from "../../lib/mailer";

type SendFreeAssignmentMailBody = {
  to?: string;
  name?: string | null;
};

type SendPaymentSuccessMailBody = {
  to?: string;
  name?: string | null;
  agentName?: string;
  description?: string | null;
  amountCents?: number;
  currency?: string;
  status?: string;
  invoiceNumber?: string;
  setupUrl?: string | null;
};

export const mailRoutes = new Hono();

mailRoutes.post("/send-free-assignment-mail", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as SendFreeAssignmentMailBody;

    const to = body.to?.trim();
    const name = body.name?.trim() || null;

    if (!to) {
      return c.json(
        {
          success: false,
          message: "Email is required"
        },
        400
      );
    }

    if (!isValidEmail(to)) {
      return c.json(
        {
          success: false,
          message: "Invalid email address"
        },
        400
      );
    }

    const assignmentLink = `${env.FRONTEND_URL.replace(/\/$/, "")}/assignment`;

    await sendFreeAssignmentEmail({
      to,
      name,
      assignmentLink
    });

    return c.json(
      {
        success: true,
        message: "Free assignment email sent successfully"
      },
      200
    );
  } catch (error) {
    console.error("Send free assignment email error:", error);

    return c.json(
      {
        success: false,
        message: "Failed to send free assignment email"
      },
      500
    );
  }
});

mailRoutes.post("/send-payment-success", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as SendPaymentSuccessMailBody;

    const to = body.to?.trim();
    const agentName = body.agentName?.trim();

    if (!to || !isValidEmail(to)) {
      return c.json({ success: false, message: "A valid recipient email is required" }, 400);
    }

    if (!agentName) {
      return c.json({ success: false, message: "agentName is required" }, 400);
    }

    const amountCents = Number.isFinite(body.amountCents) ? Number(body.amountCents) : 0;

    await sendPaymentSuccessEmail({
      to,
      name: body.name?.trim() || null,
      setupUrl: body.setupUrl?.trim() || null,
      invoice: {
        invoiceNumber: body.invoiceNumber?.trim() || `INV-${Date.now().toString(36).toUpperCase()}`,
        date: new Date(),
        businessName: body.name?.trim() || "Customer",
        businessEmail: to,
        agentName,
        description: body.description?.trim() || agentName,
        amountCents,
        currency: body.currency?.trim() || "usd",
        status: body.status?.trim() || "SUCCEEDED"
      }
    });

    return c.json({ success: true, message: "Payment success email sent" }, 200);
  } catch (error) {
    console.error("Send payment success email error:", error);
    return c.json({ success: false, message: "Failed to send payment success email" }, 500);
  }
});

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}