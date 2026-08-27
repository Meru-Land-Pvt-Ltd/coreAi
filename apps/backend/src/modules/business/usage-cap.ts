import { env } from "../../config/env";
import { isPlatformMailConfigured, sendPlatformEmail } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { billingMonthFor, MICRO_USD_PER_CENT } from "./execution-billing";
import { currentSpendMicroUsd } from "./spending-alert";

export function resolveUsageCapCents(businessCapCents: number | null | undefined): number {
  if (typeof businessCapCents === "number") return Math.max(0, businessCapCents);
  return env.LIVE_USAGE_HARD_CAP_CENTS;
}

export type UsageCapStatus = {
  exceeded: boolean;
  capCents: number;
  /** Priced execution-ledger spend (the shared formula the alert email uses). */
  spentMicroUsd: number;
  /**
   * What the cap actually compares: priced spend PLUS a conservative estimate
   * for LIVE calls still PENDING/UNPRICED and standalone SMS ledger spend —
   * the two blind spots the earlier audit flagged. No double counting:
   * unpriced calls have no execution row yet, and per-message SMS spend never
   * enters the execution ledger.
   */
  exposureMicroUsd: number;
  billingMonth: string;
  /** Business.usageCapNotifiedMonth at read time — lets callers skip the notify query. */
  notifiedMonth: string | null;
};

function billingMonthWindow(billingMonth: string): { start: Date; end: Date } {
  const start = new Date(`${billingMonth}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export async function getLiveUsageCapStatus(
  businessId: string | null | undefined
): Promise<UsageCapStatus> {
  const billingMonth = billingMonthFor(new Date());
  const open: UsageCapStatus = {
    exceeded: false,
    capCents: 0,
    spentMicroUsd: 0,
    exposureMicroUsd: 0,
    billingMonth,
    notifiedMonth: null
  };

  if (!businessId) return open;

  try {
    const [business, spentMicroUsd] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { usageHardCapCents: true, usageCapNotifiedMonth: true }
      }),
      currentSpendMicroUsd(businessId, billingMonth)
    ]);

    if (!business) return open;

    const capCents = resolveUsageCapCents(business.usageHardCapCents);
    const exposureMicroUsd = spentMicroUsd;

    return {
      exceeded: capCents > 0 && exposureMicroUsd >= capCents * MICRO_USD_PER_CENT,
      capCents,
      spentMicroUsd,
      exposureMicroUsd,
      billingMonth,
      notifiedMonth: business.usageCapNotifiedMonth
    };
  } catch (error) {
    // Never let a cap lookup outage take a business's phone line down.
    console.error("[usage-cap] status lookup failed (failing open)", {
      businessId,
      message: error instanceof Error ? error.message : String(error)
    });
    return open;
  }
}

export async function checkUsageCapAndNotify(
  businessId: string | null | undefined
): Promise<UsageCapStatus> {
  const status = await getLiveUsageCapStatus(businessId);
  if (status.exceeded && businessId && status.notifiedMonth !== status.billingMonth) {
    void notifyUsageCapReachedIfNeeded(businessId, status);
  }
  return status;
}

/** Once-per-month "cap reached" email to the owner (claim mirrors spending alert). */
export async function notifyUsageCapReachedIfNeeded(
  businessId: string,
  status: UsageCapStatus
): Promise<void> {
  if (!status.exceeded || !isPlatformMailConfigured()) return;

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        billingEmail: true,
        usageCapNotifiedMonth: true,
        owner: { select: { email: true, fullName: true } }
      }
    });
    if (!business || business.usageCapNotifiedMonth === status.billingMonth) return;

    const claimed = await prisma.business.updateMany({
      where: {
        id: business.id,
        OR: [
          { usageCapNotifiedMonth: null },
          { usageCapNotifiedMonth: { not: status.billingMonth } }
        ]
      },
      data: {
        usageCapNotifiedMonth: status.billingMonth,
        usageCapNotifiedAt: new Date()
      }
    });
    if (claimed.count !== 1) return;

    const spentUsd = (status.spentMicroUsd / 1_000_000).toFixed(2);
    const capUsd = (status.capCents / 100).toFixed(2);
    const billingUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/business/billingandusage`;
    const recipient = business.billingEmail || business.owner.email;
    const displayName = business.owner.fullName || business.name;

    await sendPlatformEmail({
      purpose: "billing",
      to: recipient,
      subject: `AI answering paused: monthly usage cap reached ($${capUsd})`,
      text: `Hi ${displayName}, your AI usage this month reached $${spentUsd}, hitting the $${capUsd} monthly cap. To protect you from runaway costs, AI call answering and AI follow-ups are paused — inbound calls now forward to your business phone. Answering resumes automatically next month, or raise the cap: ${billingUrl}`,
      html: `<p>Hi ${displayName},</p><p>Your AI usage this month reached <b>$${spentUsd}</b>, hitting the <b>$${capUsd}</b> monthly cap. To protect you from runaway costs, AI call answering and AI follow-ups are paused — inbound calls now forward to your business phone.</p><p>Answering resumes automatically next month, or you can raise the cap on your <a href="${billingUrl}">billing page</a>.</p>`
    });
  } catch (error) {
    console.error("[usage-cap] cap-reached notification failed (non-fatal)", {
      businessId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
