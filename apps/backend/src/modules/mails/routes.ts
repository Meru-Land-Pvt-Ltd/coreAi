import { Hono } from "hono";
import { sendFreeAssignmentEmail } from "../../lib/mailer";

type SendFreeAssignmentMailBody = {
  to?: string;
  name?: string | null;
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

    const appUrl =
      process.env.APP_URL ||
      process.env.FRONTEND_URL ||
      "https://globalbrandgrowth.com";

    const assignmentLink = `${appUrl.replace(/\/$/, "")}/assignment`;

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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}