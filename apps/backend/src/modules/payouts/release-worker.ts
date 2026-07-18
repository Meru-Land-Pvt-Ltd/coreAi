import { prisma } from "../../lib/prisma";
import { payoutConfig, stripeLivemode } from "./config";
import { releaseEligibleEarnings } from "./settlements";
import { transferReleasedEarnings } from "./transfer-service";

let releaseTimer: NodeJS.Timeout | null = null;

/**
 * Hourly earning release cycle: moves expired HELD earnings (that passed the
 * admin review gate) to AVAILABLE_FOR_TRANSFER. Actual Stripe transfers run
 * here only when ARCHITECT_AUTO_TRANSFER_ENABLED=true — otherwise they happen
 * at payout-request time, so the worker never moves money unattended.
 */
export async function runEarningReleaseCycle(): Promise<void> {
  try {
    const released = await releaseEligibleEarnings();
    if (released > 0) {
      console.log("[payouts] release cycle", { released });
    }

    if (!payoutConfig.autoTransferEnabled) return;

    const architects = await prisma.architectEarning.findMany({
      where: { status: "AVAILABLE_FOR_TRANSFER", livemode: stripeLivemode() },
      select: { architectUserId: true },
      distinct: ["architectUserId"],
      take: 20
    });

    for (const { architectUserId } of architects) {
      const result = await transferReleasedEarnings(architectUserId, "release_cycle");
      if (result.transferredCents > 0 || result.failures.length > 0) {
        console.log("[payouts] auto-transfer cycle", {
          architectUserId,
          transferredCents: result.transferredCents,
          failures: result.failures
        });
      }
    }
  } catch (error) {
    console.error("[payouts] release cycle failed", error);
  }
}

export function startEarningReleaseWorker() {
  if (releaseTimer) return;
  void runEarningReleaseCycle();
  releaseTimer = setInterval(() => void runEarningReleaseCycle(), 60 * 60 * 1000);
  releaseTimer.unref();
}

export function stopEarningReleaseWorker() {
  if (releaseTimer) {
    clearInterval(releaseTimer);
    releaseTimer = null;
  }
}
