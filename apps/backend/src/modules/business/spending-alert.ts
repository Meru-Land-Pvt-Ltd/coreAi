import type { Context } from "hono";
import { z } from "zod";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import {
  billingMonthFor,
  sendSpendingAlertIfNeeded
} from "./execution-billing";
import { resolvePrimaryBusinessId } from "./primary-business";

const spendingAlertSchema = z.object({
  enabled: z.boolean(),
  thresholdCents: z.number().int().min(1).max(100_000_000)
});

/** THE month-to-date execution-spend formula — usage-cap and alerts must agree. */
export async function currentSpendMicroUsd(businessId: string, month: string) {
  const usage = await prisma.agentUsageExecution.aggregate({
    where: { businessId, billingMonth: month },
    _sum: { amountMicroUsd: true, legacyBilledCostMicroUsd: true }
  });
  return (
    (usage._sum.amountMicroUsd ?? 0) +
    (usage._sum.legacyBilledCostMicroUsd ?? 0)
  );
}

export async function updateBusinessSpendingAlert(c: Context) {
  const parsed = spendingAlertSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message ?? "Invalid spending alert",
      422,
      "INVALID_SPENDING_ALERT"
    );
  }

  const authUser = c.get("authUser");
  const businessId = await resolvePrimaryBusinessId(authUser.id);
  if (!businessId) {
    return errorResponse(c, "Business not found", 404, "BUSINESS_NOT_FOUND");
  }

  const previous = await prisma.business.findFirst({
    where: { id: businessId, ownerId: authUser.id },
    select: {
      id: true,
      spendingAlertEnabled: true,
      spendingAlertThresholdCents: true
    }
  });
  if (!previous) {
    return errorResponse(c, "Business not found", 404, "BUSINESS_NOT_FOUND");
  }

  const resetNotificationClaim =
    (!previous.spendingAlertEnabled && parsed.data.enabled) ||
    previous.spendingAlertThresholdCents !== parsed.data.thresholdCents;
  const updated = await prisma.business.update({
    where: { id: previous.id },
    data: {
      spendingAlertEnabled: parsed.data.enabled,
      spendingAlertThresholdCents: parsed.data.thresholdCents,
      ...(resetNotificationClaim
        ? {
            spendingAlertLastNotifiedMonth: null,
            spendingAlertLastNotifiedAt: null
          }
        : {})
    },
    select: {
      spendingAlertEnabled: true,
      spendingAlertThresholdCents: true,
      spendingAlertLastNotifiedAt: true,
      spendingAlertLastNotifiedMonth: true
    }
  });

  const month = billingMonthFor(new Date());
  // Evaluate immediately: lowering/enabling an alert below current spend must
  // notify now rather than waiting for another execution.
  if (updated.spendingAlertEnabled) {
    await sendSpendingAlertIfNeeded(previous.id, month);
  }
  const spendMicroUsd = await currentSpendMicroUsd(previous.id, month);

  return successResponse(
    c,
    {
      spendingAlert: {
        enabled: updated.spendingAlertEnabled,
        thresholdCents: updated.spendingAlertThresholdCents,
        currentMonth: month,
        currentMonthCostCents: Math.round(spendMicroUsd / 10_000),
        lastNotifiedMonth: updated.spendingAlertLastNotifiedMonth,
        lastNotifiedAt: updated.spendingAlertLastNotifiedAt?.toISOString() ?? null
      }
    },
    "Spending alert updated"
  );
}
