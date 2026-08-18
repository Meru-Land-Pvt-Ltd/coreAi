import {
  SCHEDULE_MIN_INTERVAL_MINUTES,
  SCHEDULE_NODE_TYPE,
  DEFAULT_TIME_ZONE,
  dateOnlyInZone,
  isValidTimeZone,
  normalizeTimeZone,
  zonedWallClockToUtc,
  type ScheduleCadence
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { checkUsageCapAndNotify } from "../business/usage-cap";
import { isInstalledAgentActivityPaused } from "./twilio-business-routing";
import { parseRunnerWorkflowJson, runWorkflowTest } from "./workflow-runner";

/**
 * THE TIMER — the first way an agent starts with no human present.
 *
 * Before this, every agent on the platform waited for someone to type, call or
 * text. That single fact capped what the platform could sell: a product that
 * only reacts is a chat box, not an employee. A clock changes the category —
 * the daily report, the morning summary, the hourly watch all become possible.
 *
 * Design, and why:
 *
 * - **Postgres is the clock, not Redis.** The truth about who should run lives
 *   in InstalledAgent and the saved graph. A repeatable queue job would put the
 *   schedule in a second place that has to be reconciled on every edit, pause,
 *   uninstall or cap-hit; drift there means a cancelled customer's agent still
 *   runs. One `nextRunAt` column cannot drift from the row it lives on.
 * - **One row per (installed agent, node).** The workflow is shared by every
 *   buyer, so the schedule cannot live in the graph — that would give one
 *   buyer's clock to all of them.
 * - **The claim is the lock.** A conditional `updateMany` that both selects and
 *   advances the row means two sweeps racing produce exactly one run: the loser
 *   updates zero rows. No advisory lock, no lease table.
 * - **A run is claimed even if it then fails.** The clock is not a retry queue.
 *   A failed tick is recorded and the agent tries again at its next natural
 *   time, so a broken agent cannot hammer a paid API in a loop.
 */

/** How many due clocks one sweep will handle. Keeps a tick bounded. */
const MAX_PER_SWEEP = 25;

/** After this many failures in a row the clock stops and says why. */
const MAX_CONSECUTIVE_FAILURES = 5;

let scheduleTimer: NodeJS.Timeout | null = null;

type CadenceInput = {
  cadence: string;
  hourLocal: number;
  minuteLocal: number;
  weekdayLocal: number | null;
  timeZone: string;
};

/**
 * The next moment this clock should fire, strictly after `after`.
 *
 * Wall-clock in the business's own zone is the promise ("every day at 9"), so
 * the arithmetic is done on the calendar and converted, never by adding 24
 * hours — that would drift by an hour twice a year across a DST change.
 */
export function computeNextRunAt(schedule: CadenceInput, after: Date): Date {
  // A stored zone can be junk (old row, hand-edited profile, renamed zone).
  // Intl throws on an unknown zone, and a throw inside the sweep would stop
  // every OTHER business's clock too — so an unusable zone quietly becomes the
  // platform default rather than taking the timer down.
  const requested = normalizeTimeZone(schedule.timeZone);
  const timeZone = requested && isValidTimeZone(requested) ? requested : DEFAULT_TIME_ZONE;
  const cadence = (schedule.cadence || "daily") as ScheduleCadence;

  if (cadence === "hourly") {
    // The floor between runs is one hour: a tighter clock multiplies model
    // spend with nobody watching the bill.
    const next = new Date(after.getTime() + SCHEDULE_MIN_INTERVAL_MINUTES * 60_000);
    next.setUTCSeconds(0, 0);
    return next;
  }

  const hour = clampInt(schedule.hourLocal, 0, 23, 9);
  const minute = clampInt(schedule.minuteLocal, 0, 59, 0);

  // Walk forward a day at a time from "today in their zone" until a slot lands
  // after `after` — and, for weekly, on the right weekday. Bounded at 370 so a
  // nonsense weekday can never spin.
  for (let dayOffset = 0; dayOffset <= 370; dayOffset += 1) {
    const probe = new Date(after.getTime() + dayOffset * 24 * 60 * 60_000);
    const dateStr = dateOnlyInZone(probe, timeZone);
    const candidate = zonedWallClockToUtc(dateStr, hour, minute, timeZone);
    if (candidate.getTime() <= after.getTime()) continue;
    if (cadence === "weekly") {
      const weekday = clampInt(schedule.weekdayLocal ?? 1, 0, 6, 1);
      if (weekdayInZone(candidate, timeZone) !== weekday) continue;
    }
    return candidate;
  }

  // Unreachable with valid input; a day from now is the honest fallback.
  return new Date(after.getTime() + 24 * 60 * 60_000);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 0 = Sunday … 6 = Saturday, as seen in the given zone. */
function weekdayInZone(date: Date, timeZone: string): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
  return index === -1 ? date.getUTCDay() : index;
}

/** The schedule nodes on a saved graph, with their architect-set config. */
export function scheduleNodesOf(workflowJson: unknown): Array<{
  nodeId: string;
  cadence: string;
  hourLocal: number;
  minuteLocal: number;
  weekdayLocal: number | null;
}> {
  const parsed = parseRunnerWorkflowJson(workflowJson);
  return parsed.nodes
    .filter((node) => String((node.data as Record<string, unknown>)?.type ?? "") === SCHEDULE_NODE_TYPE)
    .map((node) => {
      const data = (node.data ?? {}) as Record<string, unknown>;
      const cadence = String(data.cadence ?? "daily");
      return {
        nodeId: node.id,
        cadence: cadence === "hourly" || cadence === "weekly" ? cadence : "daily",
        hourLocal: clampInt(data.hour, 0, 23, 9),
        minuteLocal: clampInt(data.minute, 0, 59, 0),
        weekdayLocal: data.weekday === undefined || data.weekday === null ? null : clampInt(data.weekday, 0, 6, 1)
      };
    });
}

/**
 * Make the stored clocks match the graph for one installed agent.
 *
 * Called whenever an install appears, its status changes, or its workflow is
 * republished. Adds clocks for new schedule nodes, updates changed ones, and
 * removes clocks whose node is gone — so an architect deleting the timer really
 * does stop the agent.
 */
export async function syncSchedulesForInstalledAgent(installedAgentId: string): Promise<void> {
  const agent = await prisma.installedAgent.findUnique({
    where: { id: installedAgentId },
    select: {
      id: true,
      businessId: true,
      workflowId: true,
      status: true,
      workflow: { select: { workflowJson: true } },
      business: { select: { profile: { select: { timeZone: true } } } }
    }
  });
  if (!agent) return;

  const nodes = scheduleNodesOf(agent.workflow.workflowJson);
  const timeZone = normalizeTimeZone(agent.business.profile?.timeZone) || DEFAULT_TIME_ZONE;
  const paused = isInstalledAgentActivityPaused(agent.status);
  const status = paused ? "PAUSED" : "ACTIVE";
  const now = new Date();

  const existing = await prisma.scheduledAgentRun.findMany({
    where: { installedAgentId: agent.id },
    select: { id: true, nodeId: true }
  });
  const keep = new Set(nodes.map((n) => n.nodeId));

  const stale = existing.filter((row) => !keep.has(row.nodeId)).map((row) => row.id);
  if (stale.length > 0) {
    await prisma.scheduledAgentRun.deleteMany({ where: { id: { in: stale } } });
  }

  for (const node of nodes) {
    const nextRunAt = computeNextRunAt({ ...node, timeZone }, now);
    await prisma.scheduledAgentRun.upsert({
      where: { installedAgentId_nodeId: { installedAgentId: agent.id, nodeId: node.nodeId } },
      create: {
        businessId: agent.businessId,
        installedAgentId: agent.id,
        workflowId: agent.workflowId,
        nodeId: node.nodeId,
        cadence: node.cadence,
        hourLocal: node.hourLocal,
        minuteLocal: node.minuteLocal,
        weekdayLocal: node.weekdayLocal,
        timeZone,
        status,
        nextRunAt
      },
      update: {
        cadence: node.cadence,
        hourLocal: node.hourLocal,
        minuteLocal: node.minuteLocal,
        weekdayLocal: node.weekdayLocal,
        timeZone,
        status,
        // A paused agent keeps its slot; an active one is never pushed back by
        // a mere edit, so "every day at 9" stays 9 even if saved at 9:01.
        ...(paused ? {} : {})
      }
    });
  }
}

/** Every install of a workflow re-reads the graph — used after a republish. */
export async function syncSchedulesForWorkflow(workflowId: string): Promise<void> {
  const installs = await prisma.installedAgent.findMany({
    where: { workflowId },
    select: { id: true }
  });
  for (const install of installs) {
    await syncSchedulesForInstalledAgent(install.id).catch((error) => {
      console.error("[schedule] sync failed", { installedAgentId: install.id, error: String(error) });
    });
  }
}

/**
 * One pass of the clock. Claims every due row, runs it, and books the next
 * time. `now` is injectable so the behaviour is testable without waiting.
 */
export async function runScheduleSweep(now: Date = new Date()): Promise<{ claimed: number; ran: number }> {
  const due = await prisma.scheduledAgentRun.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: MAX_PER_SWEEP,
    select: {
      id: true,
      businessId: true,
      installedAgentId: true,
      workflowId: true,
      nodeId: true,
      cadence: true,
      hourLocal: true,
      minuteLocal: true,
      weekdayLocal: true,
      timeZone: true,
      nextRunAt: true,
      consecutiveFailures: true
    }
  });

  let claimed = 0;
  let ran = 0;

  for (const row of due) {
    const dueAt = row.nextRunAt;
    const nextRunAt = computeNextRunAt(row, now);

    // The claim IS the lock: only the sweep that still sees the old nextRunAt
    // wins, so a second instance (or an overlapping tick) does nothing.
    const claim = await prisma.scheduledAgentRun.updateMany({
      where: { id: row.id, status: "ACTIVE", nextRunAt: dueAt },
      data: { nextRunAt, lastRunAt: now }
    });
    if (claim.count === 0) continue;
    claimed += 1;

    try {
      const executed = await executeScheduledRun(row, dueAt);
      if (executed) ran += 1;
      await prisma.scheduledAgentRun.update({
        where: { id: row.id },
        data: { consecutiveFailures: 0, lastError: null }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failures = row.consecutiveFailures + 1;
      // A clock that fails forever is worse than one that stops and says so.
      await prisma.scheduledAgentRun.update({
        where: { id: row.id },
        data: {
          consecutiveFailures: failures,
          lastError: message.slice(0, 500),
          ...(failures >= MAX_CONSECUTIVE_FAILURES ? { status: "PAUSED_FAILING" } : {})
        }
      });
      console.error("[schedule] run failed", {
        scheduleId: row.id,
        installedAgentId: row.installedAgentId,
        failures,
        message: message.slice(0, 300)
      });
    }
  }

  return { claimed, ran };
}

type DueRow = {
  id: string;
  businessId: string;
  installedAgentId: string;
  workflowId: string;
  nodeId: string;
  cadence: string;
  timeZone: string;
};

/** Run one claimed clock for its business, live. Returns false when skipped. */
async function executeScheduledRun(row: DueRow, dueAt: Date): Promise<boolean> {
  const agent = await prisma.installedAgent.findUnique({
    where: { id: row.installedAgentId },
    select: {
      id: true,
      status: true,
      businessId: true,
      workflowId: true,
      listingId: true,
      workflow: { select: { workflowJson: true } },
      business: {
        select: {
          id: true,
          name: true,
          type: true,
          ownerId: true,
          profile: {
            select: { calendarId: true, timeZone: true, services: true, bookingUrl: true, teamPhone: true }
          },
          phoneNumbers: {
            take: 1,
            orderBy: { createdAt: "asc" },
            select: { phoneNumber: true }
          }
        }
      }
    }
  });

  if (!agent) {
    await prisma.scheduledAgentRun.deleteMany({ where: { id: row.id } });
    return false;
  }

  // A paused or unpaid agent must not act in the world. Billing already stops
  // the charge for these, but only this check stops the work.
  if (isInstalledAgentActivityPaused(agent.status)) {
    await prisma.scheduledAgentRun.update({ where: { id: row.id }, data: { status: "PAUSED" } });
    return false;
  }

  const cap = await checkUsageCapAndNotify(agent.businessId).catch(() => ({ exceeded: false }));
  if (cap.exceeded) {
    console.warn("[schedule] skipped — usage cap reached", {
      scheduleId: row.id,
      businessId: agent.businessId
    });
    return false;
  }

  const profile = agent.business.profile;

  await runWorkflowTest({
    userId: agent.business.ownerId,
    workflowId: agent.workflowId,
    workflowJson: agent.workflow.workflowJson,
    mode: "live",
    executionMode: "LIVE",
    // The pair below is what makes a double tick impossible: WorkflowRun is
    // unique on (callProvider, externalCallId), so a duplicate throws instead
    // of charging the business twice for the same slot.
    callProvider: "SCHEDULE",
    externalCallId: `${row.id}:${dueAt.toISOString()}`,
    input: {
      businessId: agent.businessId,
      businessOwnerId: agent.business.ownerId,
      installedAgentId: agent.id,
      listingId: agent.listingId ?? undefined,
      businessName: agent.business.name,
      businessType: agent.business.type ?? undefined,
      businessPhoneNumber: agent.business.phoneNumbers[0]?.phoneNumber,
      bookingUrl: profile?.bookingUrl ?? undefined,
      teamPhone: profile?.teamPhone ?? undefined,
      calendarId: profile?.calendarId ?? undefined,
      timeZone: profile?.timeZone ?? row.timeZone,
      services: profile?.services ?? [],
      schedule: {
        scheduleId: row.id,
        nodeId: row.nodeId,
        cadence: row.cadence,
        timeZone: row.timeZone,
        dueAt: dueAt.toISOString()
      }
    }
  });

  return true;
}

export function startScheduleWorker() {
  if (scheduleTimer) return;
  const execute = () =>
    void runScheduleSweep().catch((error) => console.error("[schedule] sweep failed", error));
  execute();
  scheduleTimer = setInterval(execute, 60 * 1000);
  scheduleTimer.unref();
}

export function stopScheduleWorker() {
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
}
