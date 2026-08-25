/**
 * THE PATIENCE SWEEPER — the Timer's mid-wire flavor, kept honest by a clock.
 *
 * Every few minutes: any held conversation whose silence outlasted the wait
 * is resumed from its Timer node, with the exit door reporting "N days,
 * still silence". Replies never come through here — the ear cancels holds
 * the moment the customer writes back.
 */

import { fireDueHeldConversations } from "./workflow-runner";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startHeldConversationsWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void fireDueHeldConversations()
      .then((fired) => {
        if (fired > 0) console.log(`[timer-hold] woke ${fired} held conversation(s)`);
      })
      .catch((error) => console.error("[timer-hold] sweep failed", error));
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  console.log("[timer-hold] patience sweeper running (every 5 minutes)");
}

export function stopHeldConversationsWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
