import { Hono } from "hono";
import { env } from "../../config/env";
import {
  sendBuyerPopularAgentsEmail,
  sendBuyerRoiEmail,
  sendBuyerWelcomeEmail,
  sendFreeAssignmentEmail,
  sendPaymentFailedEmail,
  sendPaymentSuccessEmail
} from "../../lib/mailer";

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

type SendPaymentFailedMailBody = {
  to?: string;
  name?: string | null;
  agentName?: string | null;
  cardLast4?: string | null;
  failureReason?: string | null;
  listingId?: string | null;
};

mailRoutes.post("/send-payment-failed", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as SendPaymentFailedMailBody;

    const to = body.to?.trim();

    if (!to || !isValidEmail(to)) {
      return c.json({ success: false, message: "A valid recipient email is required" }, 400);
    }

    await sendPaymentFailedEmail({
      to,
      name: body.name?.trim() || null,
      agentName: body.agentName?.trim() || null,
      cardLast4: body.cardLast4?.trim() || null,
      failureReason: body.failureReason?.trim() || null,
      listingId: body.listingId?.trim() || null
    });

    return c.json({ success: true, message: "Payment failed email sent" }, 200);
  } catch (error) {
    console.error("Send payment failed email error:", error);
    return c.json({ success: false, message: "Failed to send payment failed email" }, 500);
  }
});

// --- Buyer onboarding emails ------------------------------------------------

type SendBuyerWelcomeMailBody = {
  to?: string;
  buyerName?: string | null;
  companyName?: string | null;
  onboardingLink?: string | null;
  docsLink?: string | null;
};

mailRoutes.post("/send-buyer-welcome", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as SendBuyerWelcomeMailBody;
    const to = body.to?.trim();

    if (!to || !isValidEmail(to)) {
      return c.json({ success: false, message: "A valid recipient email is required" }, 400);
    }

    await sendBuyerWelcomeEmail({
      to,
      buyerName: body.buyerName?.trim() || null,
      companyName: body.companyName?.trim() || null,
      onboardingLink: body.onboardingLink?.trim() || null,
      docsLink: body.docsLink?.trim() || null
    });

    return c.json({ success: true, message: "Welcome email sent" }, 200);
  } catch (error) {
    console.error("Send buyer welcome email error:", error);
    return c.json({ success: false, message: "Failed to send welcome email" }, 500);
  }
});

type SendBuyerPopularAgentsMailBody = {
  to?: string;
  buyerName?: string | null;
  featuredAgents?: string | null;
  browseLink?: string | null;
  successStoriesLink?: string | null;
};

mailRoutes.post("/send-buyer-popular-agents", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as SendBuyerPopularAgentsMailBody;
    const to = body.to?.trim();

    if (!to || !isValidEmail(to)) {
      return c.json({ success: false, message: "A valid recipient email is required" }, 400);
    }

    await sendBuyerPopularAgentsEmail({
      to,
      buyerName: body.buyerName?.trim() || null,
      featuredAgents: body.featuredAgents?.trim() || null,
      browseLink: body.browseLink?.trim() || null,
      successStoriesLink: body.successStoriesLink?.trim() || null
    });

    return c.json({ success: true, message: "Popular agents email sent" }, 200);
  } catch (error) {
    console.error("Send buyer popular agents email error:", error);
    return c.json({ success: false, message: "Failed to send popular agents email" }, 500);
  }
});

type SendBuyerRoiMailBody = {
  to?: string;
  buyerName?: string | null;
  industry?: string | null;
  caseStudies?: string | null;
  demoLink?: string | null;
};

mailRoutes.post("/send-buyer-roi", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as SendBuyerRoiMailBody;
    const to = body.to?.trim();

    if (!to || !isValidEmail(to)) {
      return c.json({ success: false, message: "A valid recipient email is required" }, 400);
    }

    await sendBuyerRoiEmail({
      to,
      buyerName: body.buyerName?.trim() || null,
      industry: body.industry?.trim() || null,
      caseStudies: body.caseStudies?.trim() || null,
      demoLink: body.demoLink?.trim() || null
    });

    return c.json({ success: true, message: "ROI email sent" }, 200);
  } catch (error) {
    console.error("Send buyer ROI email error:", error);
    return c.json({ success: false, message: "Failed to send ROI email" }, 500);
  }
});

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}