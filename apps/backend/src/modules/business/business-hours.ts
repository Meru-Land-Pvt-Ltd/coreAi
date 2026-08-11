import { Hono } from "hono";
import { z } from "zod";
import {
  businessOpenStatus,
  describeOpenStatus,
  effectiveHoursForDate,
  formatWeeklySummaryLines,
  isValidIanaTimeZone,
  toStoredHoursJson,
  validateSpecialHours,
  validateWeeklyHours,
  type SpecialHoursEntry,
  type WeeklyHours
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { resolvePrimaryBusinessId } from "./primary-business";
import { errorResponse, successResponse } from "../../lib/api-response";
import { extractHoursFromDocuments } from "./scheduling";
import { deployInstalledAgentVoiceAssistant } from "./deploy";
import { loadBusinessHoursState, type BusinessHoursState } from "./business-hours-state";

/* -------------------------------- validation ------------------------------- */

const periodSchema = z.object({
  open: z.string().trim().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/, "Times must use HH:mm"),
  close: z.string().trim().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/, "Times must use HH:mm")
});

const daySchema = z.object({
  day: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
  closed: z.boolean(),
  periods: z.array(periodSchema).max(6).default([]),
  note: z.string().trim().max(160).optional()
});

const specialSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must use YYYY-MM-DD"),
  closed: z.boolean(),
  periods: z.array(periodSchema).max(6).default([]),
  note: z.string().trim().max(160).optional(),
  kind: z.enum(["holiday", "special", "closure"]).default("special")
});

const putHoursSchema = z.object({
  hours: z.array(daySchema).min(1).max(7),
  timeZone: z.string().trim().min(1),
  specialDates: z.array(specialSchema).max(100).default([]),
  /**
   * The agent these hours belong to. Without it the save is business-wide, so
   * one agent's holiday closure shut down every sibling in the account.
   */
  listingId: z.string().trim().min(1).optional()
});

/** Resolve the agent a hours request is scoped to, if any. */
async function resolveHoursAgentId(
  businessId: string,
  listingId?: string | null
): Promise<string | null> {
  if (!listingId) return null;
  const agent = await prisma.installedAgent.findFirst({
    where: { businessId, listingId },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  return agent?.id ?? null;
}

/* ---------------------------------- routes --------------------------------- */

export const businessHoursRoutes = new Hono();

async function resolveOwnedBusiness(ownerId: string) {
  const primaryId = await resolvePrimaryBusinessId(ownerId);
  return prisma.business.findFirst({
    where: { id: primaryId ?? "" },
    select: { id: true }
  });
}

function serializeState(state: BusinessHoursState) {
  const status = businessOpenStatus({
    weekly: state.weekly,
    special: state.special,
    timeZone: state.timeZone
  });

  return {
    hours: state.weekly,
    timeZone: state.timeZone,
    specialDates: state.special,
    source: state.source,
    confirmedAt: state.confirmedAt?.toISOString() ?? null,
    configured: state.configured,
    weeklySummary: formatWeeklySummaryLines(state.weekly),
    openStatus: { state: status.state, description: describeOpenStatus(status) }
  };
}

businessHoursRoutes.get("/", async (c) => {
  const authUser = c.get("authUser");
  const business = await resolveOwnedBusiness(authUser.id);

  if (!business) {
    // No business yet — nothing configured; the UI shows the empty editor.
    return successResponse(c, {
      hours: null,
      timeZone: "America/New_York",
      specialDates: [],
      source: null,
      confirmedAt: null,
      configured: false,
      weeklySummary: null,
      openStatus: { state: "unknown", description: "Operating hours have not been confirmed yet." },
      suggestion: null,
      liveAssistant: false
    });
  }

  // ?listingId= scopes the editor to one agent's schedule and closures.
  const hoursAgentId = await resolveHoursAgentId(business.id, c.req.query("listingId")?.trim() || null);
  const state = await loadBusinessHoursState(business.id, hoursAgentId);

  // PDF-detected hours are ONLY a suggestion, and only while the buyer has
  // not confirmed a schedule themselves.
  let suggestion: { days: Record<string, { open: string; close: string; closed: boolean }>; sourceFilename: string | null } | null =
    null;
  if (!state.confirmedAt) {
    const extracted = await extractHoursFromDocuments({ businessId: business.id });
    if (extracted) {
      suggestion = { days: extracted.days as never, sourceFilename: extracted.sourceFilename };
    }
  }

  const profile = await prisma.businessProfile.findUnique({
    where: { businessId: business.id },
    select: { vapiAssistantId: true }
  });

  return successResponse(c, {
    ...serializeState(state),
    suggestion,
    liveAssistant: Boolean(profile?.vapiAssistantId)
  });
});

businessHoursRoutes.put("/", async (c) => {
  const authUser = c.get("authUser");
  const parsed = putHoursSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message ?? "Invalid business hours payload",
      422,
      "HOURS_VALIDATION_ERROR"
    );
  }

  const input = parsed.data;

  if (!isValidIanaTimeZone(input.timeZone)) {
    return errorResponse(c, "Select a valid timezone", 422, "HOURS_INVALID_TIMEZONE");
  }

  const weekly: WeeklyHours = input.hours.map((day) => ({
    day: day.day,
    closed: day.closed,
    periods: day.closed ? [] : day.periods,
    ...(day.note ? { note: day.note } : {})
  }));

  const weeklyIssues = validateWeeklyHours(weekly);
  if (weeklyIssues.length > 0) {
    return errorResponse(
      c,
      `${weeklyIssues[0].day ? `${weeklyIssues[0].day}: ` : ""}${weeklyIssues[0].message}`,
      422,
      "HOURS_VALIDATION_ERROR"
    );
  }

  const specialEntries: SpecialHoursEntry[] = input.specialDates.map((entry) => ({
    date: entry.date,
    closed: entry.closed,
    periods: entry.closed ? [] : entry.periods,
    ...(entry.note ? { note: entry.note } : {}),
    kind: entry.kind
  }));

  const specialIssues = validateSpecialHours(specialEntries);
  if (specialIssues.length > 0) {
    return errorResponse(
      c,
      `${specialIssues[0].date ? `${specialIssues[0].date}: ` : ""}${specialIssues[0].message}`,
      422,
      "HOURS_VALIDATION_ERROR"
    );
  }

  const business = await resolveOwnedBusiness(authUser.id);
  if (!business) {
    return errorResponse(
      c,
      "Add your business details first, then configure Business Hours.",
      409,
      "BUSINESS_REQUIRED"
    );
  }

  const stored = toStoredHoursJson(weekly) as never;
  const now = new Date();
  const hoursAgentId = await resolveHoursAgentId(business.id, input.listingId);

  await prisma.$transaction(async (tx) => {
    await tx.businessProfile.upsert({
      where: { businessId: business.id },
      create: {
        businessId: business.id,
        hoursJson: stored,
        timeZone: input.timeZone,
        hoursSource: "manual",
        hoursConfirmedAt: now
      },
      update: {
        hoursJson: stored,
        timeZone: input.timeZone,
        hoursSource: "manual",
        hoursConfirmedAt: now
      }
    });

    // Replace only THIS agent's closures. A business-wide save (no agent)
    // still owns the legacy NULL-scoped rows; neither can clear the other.
    await tx.businessSpecialHours.deleteMany({
      where: { businessId: business.id, installedAgentId: hoursAgentId }
    });
    if (specialEntries.length > 0) {
      await tx.businessSpecialHours.createMany({
        data: specialEntries.map((entry) => ({
          businessId: business.id,
          installedAgentId: hoursAgentId,
          date: entry.date,
          kind: entry.kind,
          closed: entry.closed,
          periodsJson: entry.closed ? undefined : (entry.periods as never),
          note: entry.note ?? null
        }))
      });
    }
  });

  // Rebuild the live assistant so calls immediately use the new schedule.
  // NEVER claim the live agent was updated when the sync failed — the UI
  // shows the honest status and offers a retry.
  const profile = await prisma.businessProfile.findUnique({
    where: { businessId: business.id },
    select: { vapiAssistantId: true }
  });

  let sync: { status: "synced" | "failed" | "not_deployed"; error?: string };
  if (!profile?.vapiAssistantId) {
    sync = { status: "not_deployed" };
  } else {
    try {
      const deployed = await deployInstalledAgentVoiceAssistant(business.id);
      sync = deployed
        ? { status: "synced" }
        : { status: "failed", error: "Voice deployment is not configured." };
    } catch (error) {
      console.error("Business-hours live sync failed", error);
      sync = {
        status: "failed",
        error: error instanceof Error ? error.message : "Live assistant update failed"
      };
    }
  }

  const state = await loadBusinessHoursState(business.id);
  return successResponse(
    c,
    { ...serializeState(state), suggestion: null, liveAssistant: Boolean(profile?.vapiAssistantId), sync },
    sync.status === "failed"
      ? "Hours saved — live agent update failed, please retry the sync"
      : "Business Hours saved"
  );
});

/** Retry only the live-assistant sync (hours are already saved). */
businessHoursRoutes.post("/sync", async (c) => {
  const authUser = c.get("authUser");
  const business = await resolveOwnedBusiness(authUser.id);
  if (!business) {
    return errorResponse(c, "Business not found", 404, "BUSINESS_NOT_FOUND");
  }

  const profile = await prisma.businessProfile.findUnique({
    where: { businessId: business.id },
    select: { vapiAssistantId: true }
  });
  if (!profile?.vapiAssistantId) {
    return successResponse(c, { sync: { status: "not_deployed" } });
  }

  try {
    const deployed = await deployInstalledAgentVoiceAssistant(business.id);
    return successResponse(c, {
      sync: deployed
        ? { status: "synced" }
        : { status: "failed", error: "Voice deployment is not configured." }
    });
  } catch (error) {
    console.error("Business-hours sync retry failed", error);
    return successResponse(c, {
      sync: {
        status: "failed",
        error: error instanceof Error ? error.message : "Live assistant update failed"
      }
    });
  }
});

/* ------------------------- effective-day convenience ------------------------ */

/** Effective hours for one date (weekly + special) — used by tests/inspection. */
export async function effectiveBusinessHoursForDate(businessId: string, date: string) {
  const state = await loadBusinessHoursState(businessId);
  return effectiveHoursForDate({
    weekly: state.weekly,
    special: state.special,
    date,
    timeZone: state.timeZone
  });
}
