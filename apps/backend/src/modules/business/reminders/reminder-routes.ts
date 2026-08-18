import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { prisma } from "../../../lib/prisma";
import { logBusinessActivity } from "../activity-log";
import { requireBusinessPermission } from "../team/membership";
import {
  MAX_REMINDER_OFFSET_MINUTES,
  MAX_REMINDER_OFFSETS,
  MIN_REMINDER_OFFSET_MINUTES,
  normalizeReminderOffsets,
  resolveReminderConfig
} from "./reminder-config";
import { ACTIVE_REMINDER_STATUSES } from "./reminder-service";

/**
 * Appointment-reminder routes for the business workspace. Mounted under the
 * authenticated business router (requireAuth + BUSINESS role run upstream);
 * per-route permissions are enforced here with requireBusinessPermission.
 */
export const reminderRoutes = new Hono();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve the installed agent the request targets: explicit
 * ?installedAgentId= (must belong to this business) else the newest ACTIVE
 * installed agent of the workspace.
 */
async function resolveInstalledAgent(businessId: string, requestedId: string | null) {
  if (requestedId) {
    const agent = await prisma.installedAgent.findFirst({
      where: { id: requestedId, businessId },
      select: { id: true, name: true, configJson: true }
    });
    return { agent, notFound: !agent };
  }

  const agent = await prisma.installedAgent.findFirst({
    where: { businessId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, configJson: true }
  });
  return { agent, notFound: false };
}

/** GET / — reminder config for the (resolved) agent + upcoming reminders. */
reminderRoutes.get("/", requireBusinessPermission("view_calls"), async (c) => {
  const businessId = c.get("businessMembership").businessId;
  const requestedId = c.req.query("installedAgentId")?.trim() || null;

  const { agent, notFound } = await resolveInstalledAgent(businessId, requestedId);
  if (notFound) {
    return errorResponse(c, "Installed agent not found for this business", 404, "AGENT_NOT_FOUND");
  }

  const upcoming = await prisma.appointmentReminder.findMany({
    where: { businessId, status: { in: [...ACTIVE_REMINDER_STATUSES] } },
    orderBy: { sendAt: "asc" },
    take: 50,
    include: {
      appointment: {
        select: {
          id: true,
          customerName: true,
          customerPhone: true,
          service: true,
          startAt: true,
          timeZone: true,
          status: true
        }
      }
    }
  });

  return successResponse(c, {
    installedAgentId: agent?.id ?? null,
    installedAgentName: agent?.name ?? null,
    config: resolveReminderConfig(agent?.configJson),
    upcoming
  });
});

/** PUT /config — update configJson.reminders on the installed agent (merge). */
reminderRoutes.put("/config", requireBusinessPermission("manage_workflows"), async (c) => {
  const membership = c.get("businessMembership");
  const businessId = membership.businessId;

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isRecord(body)) {
    return errorResponse(c, "Request body must be a JSON object", 422, "INVALID_BODY");
  }

  if ("enabled" in body && typeof body.enabled !== "boolean") {
    return errorResponse(c, "enabled must be a boolean", 422, "INVALID_REMINDER_CONFIG");
  }
  if ("offsetsMinutes" in body) {
    const offsets = body.offsetsMinutes;
    const valid =
      Array.isArray(offsets) &&
      offsets.length > 0 &&
      offsets.length <= MAX_REMINDER_OFFSETS &&
      offsets.every(
        (value) =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= MIN_REMINDER_OFFSET_MINUTES &&
          value <= MAX_REMINDER_OFFSET_MINUTES
      );
    if (!valid) {
      return errorResponse(
        c,
        `offsetsMinutes must be 1-${MAX_REMINDER_OFFSETS} numbers between ${MIN_REMINDER_OFFSET_MINUTES} and ${MAX_REMINDER_OFFSET_MINUTES} minutes`,
        422,
        "INVALID_REMINDER_CONFIG"
      );
    }
  }

  const requestedId =
    c.req.query("installedAgentId")?.trim() ||
    (typeof body.installedAgentId === "string" ? body.installedAgentId.trim() : "") ||
    null;

  const { agent } = await resolveInstalledAgent(businessId, requestedId);
  if (!agent) {
    return errorResponse(c, "Installed agent not found for this business", 404, "AGENT_NOT_FOUND");
  }

  const before = resolveReminderConfig(agent.configJson);
  const next = {
    enabled: typeof body.enabled === "boolean" ? body.enabled : before.enabled,
    offsetsMinutes:
      "offsetsMinutes" in body ? normalizeReminderOffsets(body.offsetsMinutes) : before.offsetsMinutes
  };

  // MERGE, never replace: configJson carries many other buyer-owned keys
  // (businessDetails, buyerSetupSchema, emailRecipients, ...) that must survive.
  const existing = isRecord(agent.configJson) ? agent.configJson : {};
  const mergedConfig = { ...existing, reminders: next } as Prisma.InputJsonValue;

  await prisma.installedAgent.update({
    where: { id: agent.id },
    data: { configJson: mergedConfig }
  });

  const authUser = c.get("authUser");
  await logBusinessActivity({
    businessId,
    action: "REMINDER_CONFIG_CHANGED",
    actorUserId: authUser?.id ?? null,
    targetType: "InstalledAgent",
    targetId: agent.id,
    detail: { before, after: next }
  });

  return successResponse(c, { installedAgentId: agent.id, config: next }, "Reminder settings saved");
});
