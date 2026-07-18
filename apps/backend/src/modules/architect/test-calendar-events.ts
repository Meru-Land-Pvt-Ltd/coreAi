import {
  calendarEventTitleForMode,
  type ExecutionMode
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { classifyCalendarError, publicCalendarError } from "./calendar-errors";
import {
  cancelGoogleCalendarAppointment,
  createGoogleCalendarAppointment
} from "./google-calendar-connector";

/**
 * Test calendar events — the one service both test modes book through.
 * ARCHITECT_DRY_RUN writes only to the architect's own connected calendar (or
 * simulates); BUSINESS_TEST writes clearly-marked events to the business's
 * connected calendar. Every write is recorded as a TestCalendarEvent row that
 * owns the deletion lifecycle.
 */

export type TestEventPreview = {
  testEventId: string;
  executionMode: ExecutionMode;
  title: string;
  serviceName: string;
  date: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  description: string;
  /** "SIMULATED" = no provider write; "CREATED" = real Google event. */
  status: "SIMULATED" | "CREATED";
  googleEventId: string | null;
  htmlLink: string | null;
};

function testEventDescription(params: {
  executionMode: ExecutionMode;
  ownerUserId: string;
  testSessionId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
}): string {
  const header =
    params.executionMode === "ARCHITECT_DRY_RUN"
      ? "Triven.ai architect dry-run test appointment."
      : "Triven.ai business test appointment.";

  return [
    header,
    "This is not a real customer booking.",
    params.executionMode === "ARCHITECT_DRY_RUN" ? `Architect ID: ${params.ownerUserId}` : null,
    params.testSessionId ? `Test session: ${params.testSessionId}` : null,
    params.customerName ? `Test customer: ${params.customerName}` : null,
    params.customerPhone ? `Test phone: ${params.customerPhone}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

export async function createTestCalendarEvent(params: {
  executionMode: Extract<ExecutionMode, "ARCHITECT_DRY_RUN" | "BUSINESS_TEST">;
  ownerUserId: string;
  businessId?: string | null;
  installedAgentId?: string | null;
  workflowId?: string | null;
  workflowRunId?: string | null;
  testSessionId?: string | null;
  serviceName: string;
  customerName?: string | null;
  customerPhone?: string | null;
  startAt: Date;
  endAt: Date;
  timeZone: string;
  calendarId?: string | null;
  businessName: string;
  /** true = no Google write; store a SIMULATED row and return the preview. */
  simulate: boolean;
}): Promise<
  | { ok: true; event: TestEventPreview }
  | { ok: false; error: ReturnType<typeof publicCalendarError> }
> {
  const title = calendarEventTitleForMode(params.executionMode, params.serviceName);
  const description = testEventDescription(params);

  if (params.simulate) {
    const row = await prisma.testCalendarEvent.create({
      data: {
        executionMode: params.executionMode,
        ownerUserId: params.ownerUserId,
        businessId: params.businessId ?? null,
        installedAgentId: params.installedAgentId ?? null,
        workflowId: params.workflowId ?? null,
        workflowRunId: params.workflowRunId ?? null,
        testSessionId: params.testSessionId ?? null,
        serviceName: params.serviceName,
        customerName: params.customerName ?? null,
        customerPhone: params.customerPhone ?? null,
        startAt: params.startAt,
        endAt: params.endAt,
        timeZone: params.timeZone,
        calendarId: params.calendarId ?? null,
        status: "SIMULATED"
      }
    });

    return {
      ok: true,
      event: {
        testEventId: row.id,
        executionMode: params.executionMode,
        title,
        serviceName: params.serviceName,
        date: params.startAt.toISOString().slice(0, 10),
        startAt: params.startAt.toISOString(),
        endAt: params.endAt.toISOString(),
        timeZone: params.timeZone,
        description,
        status: "SIMULATED",
        googleEventId: null,
        htmlLink: null
      }
    };
  }

  let created: Awaited<ReturnType<typeof createGoogleCalendarAppointment>>;
  try {
    created = await createGoogleCalendarAppointment({
      userId: params.ownerUserId,
      calendarId: params.calendarId,
      timeZone: params.timeZone,
      businessName: params.businessName,
      customerName: params.customerName,
      customerPhone: params.customerPhone ?? "",
      service: params.serviceName,
      startAt: params.startAt,
      endAt: params.endAt,
      summaryOverride: title,
      description
    });
  } catch (error) {
    const classified = classifyCalendarError(error, "create");
    console.error("[test-calendar-events] create failed", {
      code: classified.code,
      providerCode: classified.providerCode,
      detail: classified.internalDetail
    });
    return { ok: false, error: publicCalendarError(classified) };
  }

  const row = await prisma.testCalendarEvent.create({
    data: {
      executionMode: params.executionMode,
      ownerUserId: params.ownerUserId,
      businessId: params.businessId ?? null,
      installedAgentId: params.installedAgentId ?? null,
      workflowId: params.workflowId ?? null,
      workflowRunId: params.workflowRunId ?? null,
      testSessionId: params.testSessionId ?? null,
      serviceName: params.serviceName,
      customerName: params.customerName ?? null,
      customerPhone: params.customerPhone ?? null,
      startAt: params.startAt,
      endAt: params.endAt,
      timeZone: params.timeZone,
      calendarId: created.calendarId,
      googleEventId: created.id,
      htmlLink: created.htmlLink,
      status: "CREATED"
    }
  });

  return {
    ok: true,
    event: {
      testEventId: row.id,
      executionMode: params.executionMode,
      title,
      serviceName: params.serviceName,
      date: params.startAt.toISOString().slice(0, 10),
      startAt: params.startAt.toISOString(),
      endAt: params.endAt.toISOString(),
      timeZone: params.timeZone,
      description,
      status: "CREATED",
      googleEventId: created.id,
      htmlLink: created.htmlLink
    }
  };
}

export type DeleteTestEventOutcome =
  | "deleted"
  | "already_deleted"
  | "not_found"
  | "ownership_denied"
  | "calendar_disconnected"
  | "provider_failure";

/**
 * Idempotent, ownership-checked deletion of a test calendar event. Only the
 * stored googleEventId is ever deleted on the provider — an arbitrary event id
 * from the client is never accepted.
 */
export async function deleteTestCalendarEvent(params: {
  testEventId: string;
  requesterUserId: string;
  /** For business-side deletion: businesses the requester owns. */
  allowedBusinessIds?: string[];
  scope: "ARCHITECT" | "BUSINESS";
}): Promise<{ outcome: DeleteTestEventOutcome; error?: ReturnType<typeof publicCalendarError> }> {
  const row = await prisma.testCalendarEvent.findUnique({ where: { id: params.testEventId } });

  if (!row) return { outcome: "not_found" };

  const ownsAsArchitect =
    params.scope === "ARCHITECT" &&
    row.executionMode === "ARCHITECT_DRY_RUN" &&
    row.ownerUserId === params.requesterUserId;

  const ownsAsBusiness =
    params.scope === "BUSINESS" &&
    row.executionMode === "BUSINESS_TEST" &&
    (row.ownerUserId === params.requesterUserId ||
      (row.businessId !== null && (params.allowedBusinessIds ?? []).includes(row.businessId)));

  if (!ownsAsArchitect && !ownsAsBusiness) {
    return { outcome: "ownership_denied" };
  }

  if (row.status === "DELETED") return { outcome: "already_deleted" };

  if (row.status === "SIMULATED" || !row.googleEventId) {
    await prisma.testCalendarEvent.update({
      where: { id: row.id },
      data: { status: "DELETED", deletedAt: new Date() }
    });
    return { outcome: "deleted" };
  }

  try {
    const result = await cancelGoogleCalendarAppointment({
      userId: row.ownerUserId,
      calendarId: row.calendarId,
      eventId: row.googleEventId
    });

    await prisma.testCalendarEvent.update({
      where: { id: row.id },
      data: { status: "DELETED", deletedAt: new Date() }
    });

    return { outcome: result.alreadyGone ? "already_deleted" : "deleted" };
  } catch (error) {
    const classified = classifyCalendarError(error, "delete");
    console.error("[test-calendar-events] delete failed", {
      code: classified.code,
      providerCode: classified.providerCode,
      detail: classified.internalDetail
    });

    const disconnected =
      classified.code === "CALENDAR_NOT_CONNECTED" ||
      classified.code === "CALENDAR_TOKEN_EXPIRED" ||
      classified.code === "CALENDAR_REAUTH_REQUIRED";

    return {
      outcome: disconnected ? "calendar_disconnected" : "provider_failure",
      error: publicCalendarError(classified)
    };
  }
}
