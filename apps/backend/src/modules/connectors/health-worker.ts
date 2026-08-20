/**
 * The clock behind the daily self-test.
 *
 * Deliberately boring: one timer, one sweep a day, and a first run a few
 * minutes after boot rather than at the moment of boot. A deploy restarts
 * every container at once, and firing every provider's probe during that same
 * second is how a health check turns into the outage it was meant to detect.
 */

import { sweepConnectorHealth } from "./health-sweep";

const A_DAY = 24 * 60 * 60_000;
const AFTER_BOOT = 5 * 60_000;

let timer: NodeJS.Timeout | null = null;
let firstRun: NodeJS.Timeout | null = null;

async function sweep(): Promise<void> {
  try {
    const result = await sweepConnectorHealth();
    const broken = result.broken.length;
    console.log(
      `[connectors] self-test: ${result.checked} checked, ${broken} failing${
        broken ? ` (${result.broken.map((entry) => entry.connectorId).join(", ")})` : ""
      }`
    );
  } catch (error) {
    console.error("[connectors] self-test sweep failed", error);
  }
}

export function startConnectorHealthWorker(): void {
  if (timer) return;

  firstRun = setTimeout(() => void sweep(), AFTER_BOOT);
  firstRun.unref();

  timer = setInterval(() => void sweep(), A_DAY);
  // Never hold the process open for a health check.
  timer.unref();
}

export function stopConnectorHealthWorker(): void {
  if (firstRun) clearTimeout(firstRun);
  if (timer) clearInterval(timer);
  firstRun = null;
  timer = null;
}
