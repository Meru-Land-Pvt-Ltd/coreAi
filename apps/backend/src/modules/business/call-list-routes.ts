/**
 * The business's own controls for a call list.
 *
 * Everything here is scoped by `business: { ownerId: authUser.id }`. A list
 * holds real people's phone numbers, and the architect who built the agent
 * must never be able to read them — that separation is the whole reason the
 * list belongs to the buyer.
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  CALL_LIST_STATUSES,
  clampCallWindow,
  deriveBusinessSurface,
  normalizeCallPhone,
  sanitizeProductSpec,
  summariseList
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { fillDashboardSpec, loadDashboardData, type DashboardWindow } from "./dashboard-metrics";
import {
  getListReport,
  importPeopleIntoList,
  setListStatus,
  suppressNumber
} from "../architect/call-list";

export const callListRoutes = new Hono();

/** A list this signed-in owner is actually allowed to touch. */
async function ownedList(userId: string, listId: string) {
  return prisma.callList.findFirst({
    where: { id: listId, business: { ownerId: userId } },
    select: { id: true, businessId: true, name: true, status: true }
  });
}

/** Every list on one installed agent. */
callListRoutes.get("/agents/:installedAgentId/call-lists", async (c) => {
  const authUser = c.get("authUser");
  const installedAgentId = c.req.param("installedAgentId");

  const lists = await prisma.callList.findMany({
    where: { installedAgentId, business: { ownerId: authUser.id } },
    orderBy: { createdAt: "asc" },
    include: { people: { select: { status: true, attempts: true } } }
  });

  return successResponse(c, {
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      status: list.status,
      startedAt: list.startedAt,
      stoppedAt: list.stoppedAt,
      lastError: list.lastError,
      settings: clampCallWindow({
        maxAttempts: list.maxAttempts,
        windowStartHour: list.windowStartHour,
        windowEndHour: list.windowEndHour,
        maxConcurrentCalls: list.maxConcurrentCalls,
        maxCallsPerPersonPerDay: list.maxCallsPerPersonPerDay,
        budgetUsd: list.budgetUsd
      }),
      report: summariseList(list.people, list.spentCents / 100)
    }))
  });
});

/** The board: everyone on the list and what happened to them. */
callListRoutes.get("/call-lists/:listId", async (c) => {
  const authUser = c.get("authUser");
  const listId = c.req.param("listId");

  const list = await ownedList(authUser.id, listId);
  if (!list) return errorResponse(c, "List not found", 404, "LIST_NOT_FOUND");

  const [detail, people] = await Promise.all([
    getListReport(listId),
    prisma.callListPerson.findMany({
      where: { listId },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: 500,
      select: {
        id: true,
        name: true,
        phone: true,
        status: true,
        attempts: true,
        lastAttemptAt: true,
        nextAttemptAt: true,
        lastOutcome: true,
        lastError: true,
        bookedAt: true
      }
    })
  ]);

  return successResponse(c, { ...detail, people });
});

const importSchema = z.object({
  /** Pasted text or CSV. One person per line: name, phone. */
  text: z.string().trim().min(1).max(200_000)
});

/**
 * Add people by pasting them in.
 *
 * Deliberately paste-first rather than file-first: a business owner with 50
 * numbers in a spreadsheet can select and paste in five seconds, and the same
 * endpoint handles a CSV dropped in as text.
 */
callListRoutes.post("/call-lists/:listId/people", async (c) => {
  const authUser = c.get("authUser");
  const listId = c.req.param("listId");

  const list = await ownedList(authUser.id, listId);
  if (!list) return errorResponse(c, "List not found", 404, "LIST_NOT_FOUND");

  const body = importSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return errorResponse(c, body.error.issues[0]?.message ?? "Paste your list first", 422, "VALIDATION_ERROR");
  }

  const rows = parsePastedPeople(body.data.text);
  if (rows.length === 0) {
    return errorResponse(c, "No phone numbers found in what you pasted.", 422, "NO_ROWS");
  }
  if (rows.length > 5000) {
    return errorResponse(c, "That is more than 5,000 people. Split it into smaller lists.", 422, "TOO_MANY");
  }

  const result = await importPeopleIntoList(listId, rows);
  return successResponse(
    c,
    result,
    `${result.added} added${result.duplicates ? `, ${result.duplicates} already there` : ""}${
      result.invalid ? `, ${result.invalid} not valid numbers` : ""
    }${result.suppressed ? `, ${result.suppressed} asked not to be called` : ""}`
  );
});

/**
 * Read pasted text into people.
 *
 * Accepts "Name, +1555…", "+1555…, Name", a bare number per line, or a CSV
 * with a header row. Whichever column looks like a phone number IS the phone
 * number — asking a dentist to format a CSV correctly is how this feature
 * would fail.
 */
export function parsePastedPeople(text: string): Array<{ name?: string | null; phone: string }> {
  const rows: Array<{ name?: string | null; phone: string }> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip a header row rather than trying to dial the word "phone".
    if (/^(name|full ?name)?[,;\t ]*(phone|number|mobile|cell|telephone)/i.test(line) && !/\d{6}/.test(line)) {
      continue;
    }

    const parts = line.split(/[,;\t]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    let phone: string | null = null;
    const others: string[] = [];
    for (const part of parts) {
      const candidate = normalizeCallPhone(part);
      if (candidate && !phone) phone = candidate;
      else others.push(part);
    }

    // A single unsplit line like "Priya +1 555 0134".
    if (!phone) {
      const match = line.match(/\+?[\d][\d\s().-]{7,}\d/);
      if (match) {
        phone = normalizeCallPhone(match[0]);
        const name = line.replace(match[0], "").replace(/[,;\t]/g, " ").trim();
        if (name) others.push(name);
      }
    }

    // Keep unparseable lines: importPeopleIntoList counts them as invalid and
    // shows the operator what it could not read, instead of silently losing
    // people from their list.
    rows.push({ phone: phone ?? line, name: others[0] ?? null });
  }

  return rows;
}

const statusSchema = z.object({
  status: z.enum(["RUNNING", "PAUSED", "DRAFT"])
});

/** Start · Pause · Stop. */
callListRoutes.post("/call-lists/:listId/status", async (c) => {
  const authUser = c.get("authUser");
  const listId = c.req.param("listId");

  const list = await ownedList(authUser.id, listId);
  if (!list) return errorResponse(c, "List not found", 404, "LIST_NOT_FOUND");

  const body = statusSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return errorResponse(c, "Invalid status", 422, "VALIDATION_ERROR");

  if (body.data.status === "RUNNING") {
    const ready = await prisma.callListPerson.count({
      where: { listId, status: { in: ["WAITING", "RETRY"] } }
    });
    if (ready === 0) {
      return errorResponse(c, "Add some people to this list first.", 422, "LIST_EMPTY");
    }
  }

  await setListStatus(listId, body.data.status, authUser.email ?? authUser.id);
  return successResponse(
    c,
    { status: body.data.status },
    body.data.status === "RUNNING" ? "Calling has started." : "Calling has stopped."
  );
});

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  maxAttempts: z.number().int().min(1).max(6).optional(),
  windowStartHour: z.number().int().min(8).max(20).optional(),
  windowEndHour: z.number().int().min(9).max(21).optional(),
  maxConcurrentCalls: z.number().int().min(1).max(10).optional(),
  maxCallsPerPersonPerDay: z.number().int().min(1).max(3).optional(),
  budgetUsd: z.number().int().min(0).max(100_000).optional()
});

callListRoutes.patch("/call-lists/:listId", async (c) => {
  const authUser = c.get("authUser");
  const listId = c.req.param("listId");

  const list = await ownedList(authUser.id, listId);
  if (!list) return errorResponse(c, "List not found", 404, "LIST_NOT_FOUND");

  const body = settingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return errorResponse(c, "Invalid settings", 422, "VALIDATION_ERROR");

  const current = await prisma.callList.findUnique({ where: { id: listId } });
  if (!current) return errorResponse(c, "List not found", 404, "LIST_NOT_FOUND");

  // The legal window is clamped in shared, not here, so the API, the engine
  // and the editor can never disagree about what 8pm means.
  const settings = clampCallWindow({
    maxAttempts: body.data.maxAttempts ?? current.maxAttempts,
    windowStartHour: body.data.windowStartHour ?? current.windowStartHour,
    windowEndHour: body.data.windowEndHour ?? current.windowEndHour,
    maxConcurrentCalls: body.data.maxConcurrentCalls ?? current.maxConcurrentCalls,
    maxCallsPerPersonPerDay: body.data.maxCallsPerPersonPerDay ?? current.maxCallsPerPersonPerDay,
    budgetUsd: body.data.budgetUsd ?? current.budgetUsd
  });

  await prisma.callList.update({
    where: { id: listId },
    data: { ...settings, ...(body.data.name ? { name: body.data.name } : {}) }
  });

  return successResponse(c, { settings }, "Saved.");
});

const suppressSchema = z.object({
  phone: z.string().trim().min(5),
  reason: z.string().trim().max(200).optional()
});

/** "Never call this person again" — across every list this business runs. */
callListRoutes.post("/call-suppressions", async (c) => {
  const authUser = c.get("authUser");
  const body = suppressSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return errorResponse(c, "A phone number is required", 422, "VALIDATION_ERROR");

  const business = await prisma.business.findFirst({
    where: { ownerId: authUser.id },
    select: { id: true }
  });
  if (!business) return errorResponse(c, "No business found", 404, "BUSINESS_NOT_FOUND");

  await suppressNumber(business.id, body.data.phone, body.data.reason ?? "Added by the business owner.");
  return successResponse(c, { ok: true }, "They will not be called again.");
});

export { CALL_LIST_STATUSES };

/**
 * THE DAILY SCREEN.
 *
 * Returns the dashboard Smart Designer composed for this agent, with today's
 * real numbers filled into it. The design is stored once; the figures are
 * resolved on every open, so a business that logs in twice a day sees the
 * truth twice a day rather than a snapshot from install time.
 */
callListRoutes.get("/agents/:installedAgentId/dashboard", async (c) => {
  const authUser = c.get("authUser");
  const installedAgentId = c.req.param("installedAgentId");
  const window = (c.req.query("window") ?? "month") as DashboardWindow;

  const agent = await prisma.installedAgent.findFirst({
    where: { id: installedAgentId, business: { ownerId: authUser.id } },
    select: {
      id: true,
      businessId: true,
      workflowId: true,
      workflow: { select: { name: true, workflowJson: true } }
    }
  });
  if (!agent) return errorResponse(c, "Agent not found", 404, "AGENT_NOT_FOUND");

  const data = await loadDashboardData(agent.id, agent.businessId, window);
  const surface = deriveBusinessSurface(agent.workflow?.workflowJson);

  const page = await prisma.publishedAgentPage.findFirst({
    where: { workflowId: agent.workflowId ?? "" },
    select: { dashboardJson: true }
  });

  const designed = sanitizeProductSpec(page?.dashboardJson);

  return successResponse(c, {
    agentName: agent.workflow?.name ?? "Your agent",
    window,
    // Null means Smart Designer has not composed one yet — the client shows
    // the plain numbers rather than an empty screen.
    dashboard: designed ? fillDashboardSpec(designed, data.values) : null,
    surface,
    values: data.values,
    tables: data.tables,
    lists: data.lists
  });
});
