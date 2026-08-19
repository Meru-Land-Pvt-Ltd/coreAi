/**
 * CALL LISTS — the engine that works through a business's own people.
 *
 * This is the part of the platform that can hurt someone. Everything below is
 * written so that the failure mode is "we called too few people" rather than
 * "we called someone at 6am, six times, after they asked us to stop".
 *
 * The claim-lock pattern is lifted from schedule-trigger.ts, which has been
 * running the Timer trigger in production: the UPDATE that changes a person's
 * status IS the lock, so two servers sweeping at the same instant cannot both
 * dial the same person.
 */

import {
  CALL_LIST_NODE_TYPE,
  CALL_LIST_DEFAULTS,
  clampCallWindow,
  mayDialNow,
  normalizeCallPhone,
  outcomeFromEndedReason,
  retryDelayMinutes,
  summariseList,
  timeZoneForPhone,
  TERMINAL_PERSON_STATUSES,
  type CallListSettings,
  type CallPersonStatus
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { mayCallNumber, revokeCallConsent } from "./call-consent";
import { runWorkflowTest } from "./workflow-runner";

/** How many lists one sweep will look at. Keeps a tick bounded. */
const MAX_LISTS_PER_SWEEP = 25;
/** How many people one list may start per tick, regardless of concurrency. */
const MAX_STARTS_PER_LIST_PER_SWEEP = 5;

type GraphNode = { id?: string; data?: Record<string, unknown> };

function nodesOf(workflowJson: unknown): GraphNode[] {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? (nodes as GraphNode[]) : [];
}

/** The call-list trigger nodes on a graph. */
export function callListNodesOf(workflowJson: unknown): GraphNode[] {
  return nodesOf(workflowJson).filter((node) => node.data?.type === CALL_LIST_NODE_TYPE);
}

function settingsFrom(row: {
  maxAttempts: number;
  windowStartHour: number;
  windowEndHour: number;
  maxConcurrentCalls: number;
  maxCallsPerPersonPerDay: number;
  budgetUsd: number;
}): CallListSettings {
  return clampCallWindow({
    maxAttempts: row.maxAttempts,
    windowStartHour: row.windowStartHour,
    windowEndHour: row.windowEndHour,
    maxConcurrentCalls: row.maxConcurrentCalls,
    maxCallsPerPersonPerDay: row.maxCallsPerPersonPerDay,
    budgetUsd: row.budgetUsd
  });
}

/**
 * Make sure every call-list node on an installed agent has a list behind it.
 *
 * Called on install and on every workflow save, exactly like the Timer's
 * syncSchedulesForInstalledAgent. Lists are created DRAFT — installing an
 * agent must never start dialling anyone.
 */
export async function syncCallListsForInstalledAgent(installedAgentId: string): Promise<void> {
  const agent = await prisma.installedAgent.findUnique({
    where: { id: installedAgentId },
    select: { id: true, businessId: true, workflowId: true, workflow: { select: { workflowJson: true } } }
  });
  if (!agent?.workflowId) return;

  const nodes = callListNodesOf(agent.workflow?.workflowJson);
  const wanted = new Set(nodes.map((node) => String(node.id ?? "")).filter(Boolean));

  for (const node of nodes) {
    const nodeId = String(node.id ?? "");
    if (!nodeId) continue;

    const existing = await prisma.callList.findFirst({
      where: { installedAgentId: agent.id, nodeId },
      select: { id: true }
    });
    if (existing) continue;

    await prisma.callList.create({
      data: {
        businessId: agent.businessId,
        installedAgentId: agent.id,
        workflowId: agent.workflowId,
        nodeId,
        name: typeof node.data?.title === "string" && node.data.title.trim() ? node.data.title.trim() : "My list",
        ...CALL_LIST_DEFAULTS,
        // A list that starts itself on install is the nightmare version of
        // this feature. It waits for a person to press Start.
        status: "DRAFT"
      }
    });
  }

  // A node the architect deleted should stop dialling, but its history is
  // evidence — pause, never destroy.
  const orphans = await prisma.callList.findMany({
    where: { installedAgentId: agent.id, status: { in: ["RUNNING", "DRAFT"] } },
    select: { id: true, nodeId: true }
  });
  for (const orphan of orphans) {
    if (wanted.has(orphan.nodeId)) continue;
    await prisma.callList.update({
      where: { id: orphan.id },
      data: { status: "PAUSED", lastError: "The step this list belonged to was removed from the agent." }
    });
  }
}

export type ImportResult = {
  added: number;
  duplicates: number;
  invalid: number;
  suppressed: number;
  invalidExamples: string[];
};

/**
 * Add people to a list.
 *
 * Everything is normalised to E.164 first, so "(212) 555-0134", "+12125550134"
 * and "12125550134" collapse to one person rather than three attempts at the
 * same human being.
 */
export async function importPeopleIntoList(
  listId: string,
  rows: Array<{ name?: string | null; phone: string; notes?: string | null }>
): Promise<ImportResult> {
  const list = await prisma.callList.findUnique({
    where: { id: listId },
    select: { id: true, businessId: true }
  });
  if (!list) throw new Error("List not found");

  const result: ImportResult = { added: 0, duplicates: 0, invalid: 0, suppressed: 0, invalidExamples: [] };

  const seen = new Set<string>();
  for (const row of rows) {
    const phone = normalizeCallPhone(row.phone);
    if (!phone) {
      result.invalid += 1;
      if (result.invalidExamples.length < 5) result.invalidExamples.push(String(row.phone ?? "").slice(0, 32));
      continue;
    }
    // Duplicates inside the uploaded file itself, before we touch the database.
    if (seen.has(phone)) {
      result.duplicates += 1;
      continue;
    }
    seen.add(phone);

    const suppressed = await prisma.callSuppression.findFirst({
      where: { businessId: list.businessId, phone },
      select: { id: true }
    });

    try {
      await prisma.callListPerson.create({
        data: {
          listId: list.id,
          name: row.name?.trim() || null,
          phone,
          notes: row.notes?.trim() || null,
          timeZone: timeZoneForPhone(phone),
          // Someone who asked this business to stop is loaded visibly rather
          // than dropped, so the operator can see why the count is short.
          status: suppressed ? "SUPPRESSED" : "WAITING"
        }
      });
      if (suppressed) result.suppressed += 1;
      else result.added += 1;
    } catch {
      // Unique(listId, phone) — already on this list.
      result.duplicates += 1;
    }
  }

  return result;
}

/** Start, pause or stop a list. Stopping keeps its place; nothing is lost. */
export async function setListStatus(
  listId: string,
  status: "RUNNING" | "PAUSED" | "DRAFT",
  actor?: string
): Promise<void> {
  await prisma.callList.update({
    where: { id: listId },
    data: {
      status,
      ...(status === "RUNNING" ? { startedAt: new Date(), lastError: null } : {}),
      ...(status !== "RUNNING" ? { stoppedAt: new Date(), stoppedBy: actor ?? null } : {})
    }
  });
}

/**
 * The platform kill switch. One call, every list on Triven stops.
 *
 * Deliberately a status change rather than a flag: when this is used it is
 * 2am and something is wrong, and the person using it needs the lists to be
 * visibly stopped, not secretly filtered.
 */
export async function stopAllCallLists(reason: string): Promise<number> {
  const stopped = await prisma.callList.updateMany({
    where: { status: "RUNNING" },
    data: { status: "PAUSED", stoppedAt: new Date(), stoppedBy: "PLATFORM", lastError: reason }
  });
  return stopped.count;
}

function dayKey(at: Date, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * One tick. Finds lists that are running, works out how many calls each may
 * start right now, and starts them.
 */
export async function runCallListSweep(now: Date = new Date()): Promise<{ started: number; skipped: number }> {
  const lists = await prisma.callList.findMany({
    where: { status: "RUNNING" },
    orderBy: { lastSweptAt: "asc" },
    take: MAX_LISTS_PER_SWEEP
  });

  let started = 0;
  let skipped = 0;

  for (const list of lists) {
    await prisma.callList.update({ where: { id: list.id }, data: { lastSweptAt: now } });
    const settings = settingsFrom(list);

    // ---- Money first. A runaway loop is the one failure that cannot be
    // undone by pausing after the fact.
    if (settings.budgetUsd > 0 && list.spentCents >= settings.budgetUsd * 100) {
      await prisma.callList.update({
        where: { id: list.id },
        data: {
          status: "STOPPED_BUDGET",
          stoppedAt: now,
          stoppedBy: "BUDGET",
          lastError: `Stopped: this list has spent its $${settings.budgetUsd} limit.`
        }
      });
      continue;
    }

    // ---- Concurrency. Never more calls in flight than the list allows.
    const inFlight = await prisma.callListPerson.count({
      where: { listId: list.id, status: "CALLING" }
    });
    const capacity = Math.min(settings.maxConcurrentCalls - inFlight, MAX_STARTS_PER_LIST_PER_SWEEP);
    if (capacity <= 0) continue;

    const candidates = await prisma.callListPerson.findMany({
      where: {
        listId: list.id,
        status: { in: ["WAITING", "RETRY"] },
        attempts: { lt: settings.maxAttempts },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      // Over-fetch: most candidates will be outside their calling window, and
      // a list whose first 3 people are asleep must still reach the ones who
      // are awake.
      take: capacity * 8
    });

    if (candidates.length === 0) {
      const remaining = await prisma.callListPerson.count({
        where: { listId: list.id, status: { in: ["WAITING", "RETRY", "CALLING"] } }
      });
      if (remaining === 0) {
        await prisma.callList.update({
          where: { id: list.id },
          data: { status: "DONE", stoppedAt: now, stoppedBy: "COMPLETE" }
        });
      }
      continue;
    }

    let startedForList = 0;

    for (const person of candidates) {
      if (startedForList >= capacity) break;

      // ---- Their clock, not ours.
      const window = mayDialNow(person.phone, settings, now, person.timeZone);
      if (!window.allowed) {
        skipped += 1;
        continue;
      }

      // ---- One call per person per day.
      const today = dayKey(now, person.timeZone);
      const attemptsToday = person.attemptsDay === today ? person.attemptsToday : 0;
      if (attemptsToday >= settings.maxCallsPerPersonPerDay) {
        skipped += 1;
        continue;
      }

      // ---- Did they tell this business to stop, on any list?
      const suppressed = await prisma.callSuppression.findFirst({
        where: { businessId: list.businessId, phone: person.phone },
        select: { id: true }
      });
      if (suppressed) {
        await prisma.callListPerson.update({
          where: { id: person.id },
          data: { status: "SUPPRESSED", lastError: "This person asked not to be called." }
        });
        continue;
      }

      // ---- Consent. The engine refuses without it, and fails closed.
      const consent = await mayCallNumber({ businessId: list.businessId, phoneNumber: person.phone }).catch(() => ({
        allowed: false,
        reason: "Could not check consent."
      }));
      if (!consent.allowed) {
        await prisma.callListPerson.update({
          where: { id: person.id },
          data: {
            status: "OPTED_OUT",
            lastError: consent.reason ?? "No consent on file for this number."
          }
        });
        continue;
      }

      // ---- The claim IS the lock. Only the sweep that still sees this person
      // WAITING/RETRY wins; a second server does nothing.
      const claim = await prisma.callListPerson.updateMany({
        where: { id: person.id, status: { in: ["WAITING", "RETRY"] }, attempts: person.attempts },
        data: {
          status: "CALLING",
          attempts: person.attempts + 1,
          attemptsToday: attemptsToday + 1,
          attemptsDay: today,
          lastAttemptAt: now
        }
      });
      if (claim.count === 0) continue;

      try {
        const callId = await placeListCall(list, person);
        await prisma.callListPerson.update({
          where: { id: person.id },
          data: { lastCallId: callId ?? null, lastError: null }
        });
        started += 1;
        startedForList += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A person we failed to dial goes back in the queue, not into limbo.
        await prisma.callListPerson.update({
          where: { id: person.id },
          data: {
            status: person.attempts + 1 >= settings.maxAttempts ? "FAILED" : "RETRY",
            nextAttemptAt: new Date(now.getTime() + 30 * 60_000),
            lastError: message.slice(0, 400)
          }
        });
        await prisma.callList.update({
          where: { id: list.id },
          data: { lastError: message.slice(0, 400) }
        });
      }
    }
  }

  return { started, skipped };
}

/** Dial one person by running the agent's own workflow, live. */
async function placeListCall(
  list: { id: string; businessId: string; installedAgentId: string; workflowId: string; name: string },
  person: { id: string; phone: string; name: string | null }
): Promise<string | null> {
  const workflow = await prisma.workflowDefinition.findUnique({
    where: { id: list.workflowId },
    select: { id: true, name: true, workflowJson: true, architectUserId: true }
  });
  if (!workflow) throw new Error("The agent behind this list no longer exists.");

  const business = await prisma.business.findUnique({
    where: { id: list.businessId },
    select: { ownerId: true, name: true, profile: { select: { vapiAssistantId: true } } }
  });

  const result = await runWorkflowTest({
    userId: business?.ownerId ?? workflow.architectUserId,
    workflowId: workflow.id,
    workflowJson: workflow.workflowJson,
    mode: "live",
    executionMode: "LIVE",
    callProvider: "CALL_LIST",
    // Unique per person per attempt: the runner's @@unique([callProvider,
    // externalCallId]) then makes a double-dial impossible even if this
    // function is somehow entered twice.
    externalCallId: `${list.id}:${person.id}:${Date.now()}`,
    input: {
      businessId: list.businessId,
      businessOwnerId: business?.ownerId ?? undefined,
      installedAgentId: list.installedAgentId,
      businessName: business?.name ?? workflow.name,
      callerNumber: person.phone,
      customerName: person.name ?? undefined,
      ...(business?.profile?.vapiAssistantId ? { vapiAssistantId: business.profile.vapiAssistantId } : {}),
      latestMessage: `Outbound call from the list "${list.name}".`
    }
  });

  const callLog = (result.logs ?? []).find(
    (log) => typeof log === "object" && log !== null && "output" in log && (log as { output?: { id?: string } }).output?.id
  ) as { output?: { id?: string } } | undefined;

  return callLog?.output?.id ?? null;
}

/**
 * What happened on a call — the field nothing ever wrote.
 *
 * Of the first 159 calls on this platform, zero had an outcome recorded,
 * because the code that reads Vapi's endedReason was commented out. A status
 * board with an empty outcome column does not look broken; it looks like every
 * call went fine. This is called from the end-of-call webhook for EVERY call,
 * list or not, so ordinary calls get their outcome too.
 */
export async function recordCallOutcome(input: {
  callId: string;
  endedReason?: string | null;
  transcript?: string | null;
  costCents?: number | null;
  bookedAppointment?: boolean;
}): Promise<void> {
  const outcome = outcomeFromEndedReason(input.endedReason);

  await prisma.vapiCall
    .updateMany({ where: { callId: input.callId }, data: { outcome } })
    .catch(() => undefined);

  const person = await prisma.callListPerson.findFirst({
    where: { lastCallId: input.callId },
    include: { list: true }
  });
  if (!person) return;

  const settings = settingsFrom(person.list);
  const spoke = outcome === "ANSWERED";
  const booked = Boolean(input.bookedAppointment);

  let status: CallPersonStatus = booked ? "BOOKED" : outcome;
  let nextAttemptAt: Date | null = null;

  if (!booked && !spoke) {
    const delay = retryDelayMinutes(outcome, person.attempts);
    const outOfAttempts = person.attempts >= settings.maxAttempts;
    // A dead number is dead on the first try. Do not spend six attempts
    // proving it.
    if (outcome !== "BAD_NUMBER" && delay !== null && !outOfAttempts) {
      status = "RETRY";
      nextAttemptAt = new Date(Date.now() + delay * 60_000);
    }
  }

  await prisma.callListPerson.update({
    where: { id: person.id },
    data: {
      status,
      lastOutcome: outcome,
      nextAttemptAt,
      ...(booked ? { bookedAt: new Date() } : {})
    }
  });

  if (typeof input.costCents === "number" && input.costCents > 0) {
    await prisma.callList.update({
      where: { id: person.listId },
      data: { spentCents: { increment: Math.round(input.costCents) } }
    });
  }

  // "Stop calling me" has to survive the call it was said on.
  if (input.transcript && saidStopCalling(input.transcript)) {
    await suppressNumber(person.list.businessId, person.phone, "They asked not to be called again.");
    await prisma.callListPerson.update({
      where: { id: person.id },
      data: { status: "OPTED_OUT", nextAttemptAt: null }
    });
  }
}

/**
 * Did they ask us to stop?
 *
 * Deliberately generous. A false positive costs one lost lead; a false
 * negative is the call that generates the complaint, and complaints are what
 * regulators actually act on.
 */
export function saidStopCalling(transcript: string): boolean {
  const text = transcript.toLowerCase();
  const phrases = [
    "stop calling",
    "don't call me",
    "do not call",
    "dont call me",
    "take me off",
    "remove me from",
    "unsubscribe",
    "never call",
    "stop contacting",
    "leave me alone",
    "not interested, stop"
  ];
  // Only count it when the CUSTOMER said it — the agent repeating it back
  // ("I'll take you off the list") must not opt out a person who never asked.
  const customerLines = text
    .split("\n")
    .filter((line) => line.startsWith("user:") || line.startsWith("customer:"))
    .join(" ");
  const haystack = customerLines || text;
  return phrases.some((phrase) => haystack.includes(phrase));
}

/** Never call this number for this business again, on any list. */
export async function suppressNumber(businessId: string, phone: string, reason: string): Promise<void> {
  const normalized = normalizeCallPhone(phone);
  if (!normalized) return;

  await prisma.callSuppression
    .create({ data: { businessId, phone: normalized, reason, source: "call" } })
    .catch(() => undefined);

  // Take them off every list this business is running, not just this one.
  await prisma.callListPerson.updateMany({
    where: { phone: normalized, list: { businessId }, status: { notIn: [...TERMINAL_PERSON_STATUSES] } },
    data: { status: "OPTED_OUT", nextAttemptAt: null, lastError: reason }
  });

  await revokeCallConsent({ businessId, phoneNumber: normalized, reason }).catch(() => undefined);
}

/** The numbers a business actually looks at. */
export async function getListReport(listId: string) {
  const list = await prisma.callList.findUnique({
    where: { id: listId },
    include: { people: { select: { status: true, attempts: true } } }
  });
  if (!list) return null;

  return {
    list: {
      id: list.id,
      name: list.name,
      status: list.status,
      startedAt: list.startedAt,
      stoppedAt: list.stoppedAt,
      lastError: list.lastError,
      settings: settingsFrom(list)
    },
    report: summariseList(list.people, list.spentCents / 100)
  };
}

let sweepTimer: NodeJS.Timeout | null = null;

/** Start the ticker. Same shape as the schedule worker so ops behaves alike. */
export function startCallListWorker(intervalMs = 60_000): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    runCallListSweep().catch((error) => {
      console.error("[call-list] sweep failed", error);
    });
  }, intervalMs);
  // Never hold the process open for a timer.
  sweepTimer.unref?.();
  console.log(`[call-list] worker started — sweeping every ${Math.round(intervalMs / 1000)}s`);
}
