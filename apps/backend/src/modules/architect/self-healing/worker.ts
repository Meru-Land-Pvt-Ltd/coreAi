/**
 * WHEN THE PLATFORM THINKS.
 *
 * Not on a run. Not on a failure. Only when there is a fault nobody has
 * explained yet — and even then, a handful at a time.
 *
 * The timer is a floor, not a schedule: it wakes, asks whether anything is
 * waiting, and goes back to sleep if not. On a healthy platform that is a
 * single cheap query every ten minutes and nothing else, which is the whole
 * point. Nothing here costs anything while things are working.
 */

import { diagnoseUnknownFailures } from "./diagnose";

const EVERY_MS = 10 * 60_000;
const AFTER_BOOT = 3 * 60_000;
/** Per sweep. A bad deploy can make fifty new faults in an hour; the platform
 *  should learn them across a day rather than in one bill. */
const PER_SWEEP = 5;

let timer: NodeJS.Timeout | null = null;
let firstRun: NodeJS.Timeout | null = null;

async function sweep(): Promise<void> {
  try {
    const result = await diagnoseUnknownFailures(PER_SWEEP);
    if (result.diagnosed > 0 || result.waiting > 0) {
      console.log(
        `[self-healing] learned ${result.diagnosed} new fault${result.diagnosed === 1 ? "" : "s"}, ${result.waiting} still waiting`
      );
    }
  } catch (error) {
    console.error("[self-healing] sweep failed", error);
  }
}

export function startSelfHealingWorker(): void {
  if (timer) return;
  firstRun = setTimeout(() => void sweep(), AFTER_BOOT);
  firstRun.unref();
  timer = setInterval(() => void sweep(), EVERY_MS);
  timer.unref();
}

export function stopSelfHealingWorker(): void {
  if (firstRun) clearTimeout(firstRun);
  if (timer) clearInterval(timer);
  firstRun = null;
  timer = null;
}
