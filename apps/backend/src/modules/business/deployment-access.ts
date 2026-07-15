import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { isBillingEnabled } from "../../lib/stripe";

const DEPLOYABLE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

/** Enforcement needs both the flag AND a configured Stripe account. */
export function isAgentSubscriptionEnforcementEnabled(): boolean {
  return env.ENFORCE_AGENT_SUBSCRIPTION && isBillingEnabled();
}

/** Tolerates casing/whitespace drift in stored Stripe statuses. */
export function isDeployableSubscriptionStatus(status: string | null | undefined): boolean {
  return DEPLOYABLE_SUBSCRIPTION_STATUSES.has((status ?? "").trim().toLowerCase());
}

export type DeploymentAccess = {
  allowed: boolean;
  subscriptionEnforcementEnabled: boolean;
  reason: "SUBSCRIPTION_REQUIRED" | null;
};

export async function canBusinessDeployAgent(ownerId: string): Promise<DeploymentAccess> {
  if (!isAgentSubscriptionEnforcementEnabled()) {
    return { allowed: true, subscriptionEnforcementEnabled: false, reason: null };
  }

  const businesses = await prisma.business.findMany({
    where: { ownerId },
    select: { subscriptionStatus: true }
  });

  const allowed = businesses.some((business) =>
    isDeployableSubscriptionStatus(business.subscriptionStatus)
  );

  return {
    allowed,
    subscriptionEnforcementEnabled: true,
    reason: allowed ? null : "SUBSCRIPTION_REQUIRED"
  };
}
