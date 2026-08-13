import { Hono } from "hono";
import { env } from "../../config/env";
import { sendFreeAssignmentEmail, sendPaymentFailedEmail } from "../../lib/mailer";
import { requireAuth } from "../../middleware/auth";
// [DISABLED:non-handoff]
// import { getSharedRedis } from "../../lib/redis";

/**
 * Only two mail endpoints exist on purpose:
 * - the lead-magnet route stays public (the landing page calls it before any
 *   account exists) and is rate-limited below;
 * - the payment-failed notice (called by the checkout page) requires a
 *   signed-in user and delivers ONLY to that user's own verified email —
 *   request bodies never choose the recipient.
 * The old send-payment-success / send-buyer-welcome / popular-agents / ROI
 * routes were removed: they had no callers (those emails are sent server-side
 * by payments/auth flows) and let any signed-in user mint official-looking
 * receipt emails with arbitrary amounts.
 */

const FREE_ASSIGNMENT_IP_LIMIT = 5;
const FREE_ASSIGNMENT_IP_WINDOW_MS = 60 * 60 * 1000;
const FREE_ASSIGNMENT_EMAIL_COOLDOWN_MS = 10 * 60 * 1000;

const freeAssignmentIpHits = new Map<string, number[]>();
const freeAssignmentEmailSentAt = new Map<string, number>();

/**
 * Nearest-proxy hop: nginx APPENDS the real client IP as the LAST entry of
 * X-Forwarded-For, while earlier entries are attacker-suppliable. Never key a
 * rate limit on the first entry.
 */
function clientIp(headerValue: string | undefined): string {
  const hops = (headerValue ?? "").split(",");
  return hops[hops.length - 1]?.trim() || "unknown";
}

/** Drop expired entries; if a map is still oversized, evict oldest-inserted. */
function pruneRateMaps(now: number): void {
  for (const [ip, hits] of freeAssignmentIpHits) {
    const fresh = hits.filter((at) => now - at < FREE_ASSIGNMENT_IP_WINDOW_MS);
    if (fresh.length === 0) freeAssignmentIpHits.delete(ip);
    else freeAssignmentIpHits.set(ip, fresh);
  }
  for (const [email, at] of freeAssignmentEmailSentAt) {
    if (now - at >= FREE_ASSIGNMENT_EMAIL_COOLDOWN_MS) freeAssignmentEmailSentAt.delete(email);
  }
  // Bounded memory without ever resetting ACTIVE limits wholesale.
  for (const map of [freeAssignmentIpHits, freeAssignmentEmailSentAt] as const) {
    while (map.size > 10_000) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
}

/**
 * Redis-first distributed limiting (INCR/EXPIRE) so the limit holds across
 * processes and restarts; the in-memory maps remain the degraded fallback
 * when Redis is unavailable. true = allowed.
 */
async function allowFreeAssignmentSend(ip: string, email: string): Promise<boolean> {
  // [DISABLED:non-handoff] Redis-first distributed limiting — uncomment to
  // restore; the in-memory limiter below is the previously-shipped behavior.
  // const redis = getSharedRedis();
  // if (redis) {
  //   try {
  //     const ipKey = `rl:free-assignment:ip:${ip}`;
  //     const emailKey = `rl:free-assignment:email:${email}`;
  //     const ipCount = await redis.incr(ipKey);
  //     if (ipCount === 1) await redis.pexpire(ipKey, FREE_ASSIGNMENT_IP_WINDOW_MS);
  //     if (ipCount > FREE_ASSIGNMENT_IP_LIMIT) return false;
  //     const claimed = await redis.set(emailKey, "1", "PX", FREE_ASSIGNMENT_EMAIL_COOLDOWN_MS, "NX");
  //     return claimed === "OK";
  //   } catch (error) {
  //     console.error("[mails] Redis rate limit failed — using in-memory fallback", {
  //       message: error instanceof Error ? error.message : String(error)
  //     });
  //   }
  // }

  const now = Date.now();
  pruneRateMaps(now);

  const hits = freeAssignmentIpHits.get(ip) ?? [];
  if (hits.length >= FREE_ASSIGNMENT_IP_LIMIT) return false;

  const lastForEmail = freeAssignmentEmailSentAt.get(email);
  if (lastForEmail && now - lastForEmail < FREE_ASSIGNMENT_EMAIL_COOLDOWN_MS) return false;

  hits.push(now);
  freeAssignmentIpHits.set(ip, hits);
  freeAssignmentEmailSentAt.set(email, now);

  return true;
}

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

    if (!(await allowFreeAssignmentSend(clientIp(c.req.header("x-forwarded-for")), to.toLowerCase()))) {
      return c.json(
        {
          success: false,
          message: "Too many requests — please try again later."
        },
        429
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

// Everything below sends platform-branded mail: signed-in users only, and
// always to their own account email — the body never picks the recipient.
mailRoutes.use("*", requireAuth);

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

    const to = c.get("authUser").email;

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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
