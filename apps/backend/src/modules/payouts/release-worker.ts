import { prisma } from "../../lib/prisma";
import { payoutConfig, stripeLivemode } from "./config";
import { runSettlementReconcile } from "./reconcile";
import { releaseEligibleEarnings } from "./settlements";
import { processPendingReversals, transferReleasedEarnings } from "./transfer-service";

let releaseTimer: NodeJS.Timeout | null = null;

export async function runEarningReleaseCycle(): Promise<void> {
  try {
    const reconciled = await runSettlementReconcile();
    if (
      reconciled.settlementsCreated > 0 ||
      reconciled.transferClaimsReleased > 0 ||
      reconciled.reservationsExpired > 0
    ) {
      console.log("[payouts] settlement reconcile", reconciled);
    }

    const released = await releaseEligibleEarnings();
    if (released > 0) {
      console.log("[payouts] release cycle", { released });
    }

    const reversals = await processPendingReversals();
    if (reversals.reversed > 0 || reversals.failures.length > 0) {
      console.log("[payouts] reversal cycle", reversals);
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
