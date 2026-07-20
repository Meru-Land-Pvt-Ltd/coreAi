import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { zonedWallClockToUtc } from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { createBusinessTestProviders } from "../agent-runtime/provider-adapters";
import { buildInstalledAgentRunStats } from "../business/installed-agent-run-stats";
import { handleVapiWebhook } from "./twilio-business-routing";
import { runArchitectConversationTest } from "./workflow-conversation-test";
import { runWorkflowTest } from "./workflow-runner";

/**
 * Architect dry-run booking path — checkbox OFF simulates with a full preview,
 * checkbox ON attempts a REAL write to the architect's own calendar (mocked
 * here: success, disconnected, and provider-failure variants), and the Business
 * test keeps creating [TRIVEN BUSINESS TEST] events. The Google insert is a
 * partial module mock; everything else (runtime, providers, DB rows) is real.
 * DB-dependent cases skip when the database is down.
 */

const { calendarCreateMock } = await vi.hoisted(async () => {
  // vi.mock evaluates this file's module graph BEFORE setupFiles run, so
  // src/config/env.ts would parse an empty process.env and throw. Replicate
  // test/setup.ts's env bootstrap here, ahead of every import.
  const { fileURLToPath } = await import("node:url");
  const nodePath = await import("node:path");
  const dotenv = await import("dotenv");
  dotenv.config({
    path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../../.env")
  });
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-at-least-24-chars";
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "test-encryption-key-24-chars!";
  process.env.SES_DRY_RUN = "true";
  delete process.env.REDIS_URL;
  return { calendarCreateMock: vi.fn() };
});

vi.mock("./google-calendar-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google-calendar-connector")>()),
  createGoogleCalendarAppointment: calendarCreateMock
}));

const RUN = `dryrun-${process.pid}-${Date.now().toString(36)}`;
const SESSION = `${RUN}-session`;

const workflowJson = {
  nodes: [
    { id: "t1", data: { type: "trigger.phone_call", nodeKind: "trigger", label: "Call trigger" } },
    { id: "ai1", data: { type: "voice.conversation", nodeKind: "ai", label: "AI Receptionist" } },
    { id: "cal1", data: { type: "calendar.check_availability", label: "Check availability" } },
    { id: "book1", data: { type: "calendar.book_appointment", label: "Book appointment" } },
    { id: "end1", data: { type: "flow.end", label: "End Flow" } }
  ],
  edges: [
    { source: "t1", target: "ai1" },
    { source: "ai1", target: "cal1" },
    { source: "cal1", target: "book1" },
    { source: "book1", target: "end1" }
  ]
};

const TEST_CONTEXT = {
  businessName: "Dry Run Biz",
  callerName: "Alex Tester",
  callerPhone: "+15550017777",
  timeZone: "America/New_York",
  appointmentService: "Test Appointment"
};

const FULL_BOOKING_MESSAGE =
  "Hi, I'd like to book a Test Appointment tomorrow at 3 PM. My name is Alex Tester and my number is 555-001-7777.";

/** Booking intent + identity, but NO date/time — those come from the test form. */
const FORM_SEEDED_MESSAGE =
  "Hi, I'd like to book a Test Appointment please. My name is Alex Tester and my number is 555-001-7777.";

async function dbUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

afterAll(async () => {
  if (await dbUp()) {
    await prisma.testCalendarEvent.deleteMany({ where: { testSessionId: { startsWith: RUN } } });
  }
});

beforeEach(() => {
  calendarCreateMock.mockReset();
});

describe("architect dry run — checkbox OFF (simulated)", () => {
  it("executes the workflow, returns a SIMULATED preview, and never writes to Google", async () => {
    if (!(await dbUp())) return;

    const result = await runArchitectConversationTest({
      userId: `${RUN}-architect`,
      workflowId: "wf-dryrun",
      workflowJson,
      message: FULL_BOOKING_MESSAGE,
      executionMode: "ARCHITECT_DRY_RUN",
      testSessionId: `${SESSION}-off`,
      useTestCalendar: false,
      testContext: TEST_CONTEXT
    });

    expect(result.configError).toBeNull();
    expect(result.calendarError).toBeNull();
    expect(result.calendarEvent?.status).toBe("SIMULATED");
    // Exact service name with the architect-test prefix — never "Consultation".
    expect(result.calendarEvent?.title).toBe("[TRIVEN ARCHITECT TEST] Test Appointment");
    expect(result.calendarEvent?.timeZone).toBe("America/New_York");
    expect(result.calendarEvent?.htmlLink).toBeNull();
    expect(calendarCreateMock).not.toHaveBeenCalled();

    // The SIMULATED preview is recorded and scoped to the architect.
    const row = await prisma.testCalendarEvent.findUnique({
      where: { id: result.calendarEvent!.testEventId! }
    });
    expect(row?.status).toBe("SIMULATED");
    expect(row?.executionMode).toBe("ARCHITECT_DRY_RUN");
    expect(row?.ownerUserId).toBe(`${RUN}-architect`);
    expect(row?.serviceName).toBe("Test Appointment");
  }, 30000);
});

describe("architect dry run — checkbox ON (real test calendar)", () => {
  it("creates a real event in the architect's own calendar with the exact prefixed title", async () => {
    if (!(await dbUp())) return;

    calendarCreateMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "gcal-evt-1",
      htmlLink: "https://calendar.google.com/event?eid=gcal-evt-1",
      calendarId: "primary",
      summary: String(input.summaryOverride ?? ""),
      startAt: new Date(input.startAt as Date).toISOString(),
      endAt: new Date(input.endAt as Date).toISOString(),
      timeZone: String(input.timeZone ?? "")
    }));

    const result = await runArchitectConversationTest({
      userId: `${RUN}-architect`,
      workflowId: "wf-dryrun",
      workflowJson,
      message: FULL_BOOKING_MESSAGE,
      executionMode: "ARCHITECT_DRY_RUN",
      testSessionId: `${SESSION}-on`,
      useTestCalendar: true,
      testContext: TEST_CONTEXT
    });

    // useTestCalendar=true reached the provider: a real write was attempted...
    expect(calendarCreateMock).toHaveBeenCalledTimes(1);
    const insert = calendarCreateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    // ...in the ARCHITECT's calendar, with the exact prefixed service name.
    expect(insert.userId).toBe(`${RUN}-architect`);
    expect(insert.summaryOverride).toBe("[TRIVEN ARCHITECT TEST] Test Appointment");
    expect(insert.timeZone).toBe("America/New_York");

    expect(result.calendarEvent?.status).toBe("CREATED");
    expect(result.calendarEvent?.htmlLink).toBe("https://calendar.google.com/event?eid=gcal-evt-1");
    expect(result.calendarEvent?.testEventId).toBeTruthy();
    expect(result.calendarError).toBeNull();

    // The delete action is available: the row stores the Google event id.
    const row = await prisma.testCalendarEvent.findUnique({
      where: { id: result.calendarEvent!.testEventId! }
    });
    expect(row?.googleEventId).toBe("gcal-evt-1");
    expect(row?.status).toBe("CREATED");
  }, 30000);

  it("returns CALENDAR_NOT_CONNECTED when Google is disconnected — no silent simulated fallback", async () => {
    calendarCreateMock.mockRejectedValue(new Error("Gmail is not connected for this account."));

    const result = await runArchitectConversationTest({
      userId: `${RUN}-architect-disconnected`,
      workflowId: "wf-dryrun",
      workflowJson,
      message: FULL_BOOKING_MESSAGE,
      executionMode: "ARCHITECT_DRY_RUN",
      testSessionId: `${SESSION}-disc`,
      useTestCalendar: true,
      testContext: TEST_CONTEXT
    });

    expect(result.calendarError?.code).toBe("CALENDAR_NOT_CONNECTED");
    expect(result.calendarError?.remediation).toContain("Connect Google Calendar");
    expect(result.calendarEvent).toBeNull();

    const booking = result.toolCalls.find((call) => call.name === "calendar.book_appointment");
    expect(booking?.status).toBe("error");
    expect((booking?.output as { status?: string }).status).toBe("failed");
  }, 30000);

  it("a failed Google insert returns CALENDAR_EVENT_CREATE_FAILED, never false success", async () => {
    calendarCreateMock.mockRejectedValue(Object.assign(new Error("Backend Error"), { code: 500 }));

    const result = await runArchitectConversationTest({
      userId: `${RUN}-architect`,
      workflowId: "wf-dryrun",
      workflowJson,
      message: FULL_BOOKING_MESSAGE,
      executionMode: "ARCHITECT_DRY_RUN",
      testSessionId: `${SESSION}-fail`,
      useTestCalendar: true,
      testContext: TEST_CONTEXT
    });

    expect(result.calendarError?.code).toBe("CALENDAR_EVENT_CREATE_FAILED");
    expect(result.calendarEvent).toBeNull();

    const booking = result.toolCalls.find((call) => call.name === "calendar.book_appointment");
    expect(booking?.status).toBe("error");
    // The safe message denies the booking rather than claiming success.
    expect(booking?.message).toBe("The calendar event could not be created. The appointment was not booked.");
    expect((booking?.output as { status?: string }).status).toBe("failed");
  }, 30000);
});

describe("test-form date/time seeding", () => {
  it("the selected date, time, and timezone reach the booking without being retyped in chat", async () => {
    if (!(await dbUp())) return;

    const result = await runArchitectConversationTest({
      userId: `${RUN}-architect`,
      workflowId: "wf-dryrun",
      workflowJson,
      message: FORM_SEEDED_MESSAGE,
      executionMode: "ARCHITECT_DRY_RUN",
      testSessionId: `${SESSION}-seed`,
      testContext: {
        ...TEST_CONTEXT,
        requestedDate: "2026-07-25",
        requestedTime: "15:00"
      }
    });

    expect(result.calendarEvent?.status).toBe("SIMULATED");
    // 2026-07-25 3:00 PM America/New_York (EDT) = 19:00 UTC — exact timezone math.
    expect(result.calendarEvent?.startAt).toBe(
      zonedWallClockToUtc("2026-07-25", 15, 0, "America/New_York").toISOString()
    );

    const booking = result.toolCalls.find((call) => call.name === "calendar.book_appointment");
    expect((booking?.input as { slot?: string }).slot).toBe("2026-07-25 3:00 PM");
    expect((booking?.input as { service?: string }).service).toBe("Test Appointment");
  }, 30000);

  it("a time stated in the conversation still wins over the form seed", async () => {
    if (!(await dbUp())) return;

    const result = await runArchitectConversationTest({
      userId: `${RUN}-architect`,
      workflowId: "wf-dryrun",
      workflowJson,
      message:
        "Hi, I'd like to book a Test Appointment at 10:30 AM please. My name is Alex Tester and my number is 555-001-7777.",
      executionMode: "ARCHITECT_DRY_RUN",
      testSessionId: `${SESSION}-override`,
      testContext: {
        ...TEST_CONTEXT,
        requestedDate: "2026-07-25",
        requestedTime: "15:00"
      }
    });

    const booking = result.toolCalls.find((call) => call.name === "calendar.book_appointment");
    expect((booking?.input as { slot?: string }).slot).toBe("2026-07-25 10:30 AM");
  }, 30000);
});

describe("business test path", () => {
  it("still creates a [TRIVEN BUSINESS TEST] event in the business owner's calendar", async () => {
    if (!(await dbUp())) return;

    calendarCreateMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "gcal-biz-evt-1",
      htmlLink: "https://calendar.google.com/event?eid=gcal-biz-evt-1",
      calendarId: "primary",
      summary: String(input.summaryOverride ?? ""),
      startAt: new Date(input.startAt as Date).toISOString(),
      endAt: new Date(input.endAt as Date).toISOString(),
      timeZone: String(input.timeZone ?? "")
    }));

    const providers = createBusinessTestProviders({
      ownerUserId: `${RUN}-owner`,
      businessId: `${RUN}-business`,
      workflowId: "wf-biz",
      testSessionId: `${SESSION}-biz`,
      businessName: "Biz Under Test"
    });

    const booking = await providers.calendar.bookAppointment({
      calendarId: "primary",
      timeZone: "Asia/Kolkata",
      slot: "2026-07-25 3:00 PM",
      service: "Test Appointment",
      customerName: "Owner Tester",
      customerPhone: "+15550012222"
    });

    expect(booking.status).toBe("confirmed");
    expect(booking.event?.status).toBe("CREATED");
    expect(booking.event?.title).toBe("[TRIVEN BUSINESS TEST] Test Appointment");

    const insert = calendarCreateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insert.userId).toBe(`${RUN}-owner`);
    expect(insert.summaryOverride).toBe("[TRIVEN BUSINESS TEST] Test Appointment");

    const row = await prisma.testCalendarEvent.findUnique({
      where: { id: booking.event!.testEventId! }
    });
    expect(row?.executionMode).toBe("BUSINESS_TEST");
    expect(row?.businessId).toBe(`${RUN}-business`);
  }, 30000);
});

describe("run-test dry runner (missed-call workflow path)", () => {
  const runnerWorkflowJson = {
    nodes: [
      { id: "t1", data: { type: "trigger.twilio_missed_call", nodeKind: "trigger", label: "Missed call" } },
      {
        id: "cal1",
        data: {
          nodeKind: "connector",
          connector: "google_calendar",
          connectorAction: "book_appointment",
          label: "Book appointment"
        }
      }
    ],
    edges: [{ source: "t1", target: "cal1" }]
  };

  async function fixture() {
    const architect = await prisma.user.create({
      data: { email: `${RUN}-runner@test.local`, role: "ARCHITECT" }
    });
    const workflow = await prisma.workflowDefinition.create({
      data: { name: `${RUN} runner wf`, workflowJson: runnerWorkflowJson, architectUserId: architect.id }
    });
    return { architect, workflow };
  }

  async function cleanup(architectId: string, workflowId: string) {
    await prisma.workflowRun.deleteMany({ where: { workflowId } });
    await prisma.workflowDefinition.delete({ where: { id: workflowId } });
    await prisma.user.delete({ where: { id: architectId } });
  }

  it("dry run without the test calendar returns a SIMULATED preview in the exact wall-clock instant", async () => {
    if (!(await dbUp())) return;
    const { architect, workflow } = await fixture();

    try {
      const run = await runWorkflowTest({
        userId: architect.id,
        workflowId: workflow.id,
        workflowJson: runnerWorkflowJson,
        mode: "test",
        input: {
          callerNumber: "+916396039675",
          callerName: "Test Customer",
          businessName: "Sample Business",
          // Deprecated alias must canonicalize, and the naive local datetime
          // must be interpreted in that zone — 15:02 IST = 09:32 UTC.
          timeZone: "Asia/Calcutta",
          appointmentService: "General Consultation",
          appointmentStartAt: "2026-07-19T15:02:00",
          testSessionId: `${RUN}-runner-sim`
        }
      });

      const appointment = run.context.calendarAppointment as Record<string, unknown>;
      expect(appointment.status).toBe("SIMULATED");
      expect(appointment.timeZone).toBe("Asia/Kolkata");
      expect(appointment.startAt).toBe("2026-07-19T09:32:00.000Z");
      expect(appointment.summary).toBe("[TRIVEN ARCHITECT TEST] General Consultation");
      expect(calendarCreateMock).not.toHaveBeenCalled();
    } finally {
      await cleanup(architect.id, workflow.id);
    }
  }, 30000);

  it("dry run with useTestCalendar creates a real event in the ARCHITECT's calendar", async () => {
    if (!(await dbUp())) return;
    const { architect, workflow } = await fixture();

    calendarCreateMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "gcal-runner-evt-1",
      htmlLink: "https://calendar.google.com/event?eid=gcal-runner-evt-1",
      calendarId: "primary",
      summary: String(input.summaryOverride ?? ""),
      startAt: new Date(input.startAt as Date).toISOString(),
      endAt: new Date(input.endAt as Date).toISOString(),
      timeZone: String(input.timeZone ?? "")
    }));

    try {
      const run = await runWorkflowTest({
        userId: architect.id,
        workflowId: workflow.id,
        workflowJson: runnerWorkflowJson,
        mode: "test",
        input: {
          callerNumber: "+916396039675",
          callerName: "Test Customer",
          businessName: "Sample Business",
          timeZone: "Asia/Calcutta",
          appointmentService: "General Consultation",
          appointmentStartAt: "2026-07-19T15:02:00",
          useTestCalendar: true,
          testSessionId: `${RUN}-runner-real`
        }
      });

      expect(calendarCreateMock).toHaveBeenCalledTimes(1);
      const insert = calendarCreateMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insert.userId).toBe(architect.id);
      expect(insert.summaryOverride).toBe("[TRIVEN ARCHITECT TEST] General Consultation");
      expect(insert.timeZone).toBe("Asia/Kolkata");
      expect(new Date(insert.startAt as Date).toISOString()).toBe("2026-07-19T09:32:00.000Z");

      const appointment = run.context.calendarAppointment as Record<string, unknown>;
      expect(appointment.status).toBe("CREATED");
      expect(appointment.htmlLink).toBe("https://calendar.google.com/event?eid=gcal-runner-evt-1");
      expect(appointment.testEventId).toBeTruthy();
    } finally {
      await cleanup(architect.id, workflow.id);
    }
  }, 30000);

  it("a failed real write reports the safe error, never a created appointment", async () => {
    if (!(await dbUp())) return;
    const { architect, workflow } = await fixture();

    calendarCreateMock.mockRejectedValue(new Error("Gmail is not connected for this account."));

    try {
      const run = await runWorkflowTest({
        userId: architect.id,
        workflowId: workflow.id,
        workflowJson: runnerWorkflowJson,
        mode: "test",
        input: {
          callerNumber: "+916396039675",
          timeZone: "Asia/Kolkata",
          appointmentService: "General Consultation",
          appointmentStartAt: "2026-07-19T15:02:00",
          useTestCalendar: true,
          testSessionId: `${RUN}-runner-fail`
        }
      });

      const appointment = run.context.calendarAppointment as Record<string, unknown>;
      expect(appointment.status).toBe("FAILED");
      expect(appointment.errorCode).toBe("CALENDAR_NOT_CONNECTED");
      expect(appointment.id).toBeNull();

      const bookLog = run.logs.find((log) => log.label === "Book appointment");
      expect(bookLog?.status).toBe("error");
    } finally {
      await cleanup(architect.id, workflow.id);
    }
  }, 30000);
});

describe("vapi browser voice call booking (webhook tool path)", () => {
  async function browserTestFixture(useTestCalendar: boolean) {
    const architect = await prisma.user.create({
      data: { email: `${RUN}-vapi-${useTestCalendar ? "on" : "off"}@test.local`, role: "ARCHITECT" }
    });
    const business = await prisma.business.create({
      data: { ownerId: architect.id, name: `${RUN} Vapi Sandbox`, type: "service business" }
    });
    const workflow = await prisma.workflowDefinition.create({
      data: { name: `${RUN} vapi wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: architect.id }
    });
    const agent = await prisma.installedAgent.create({
      data: {
        businessId: business.id,
        workflowId: workflow.id,
        name: "Browser Test",
        status: "ACTIVE",
        configJson: {
          testMode: true,
          executionMode: "ARCHITECT_DRY_RUN",
          testDryRun: true,
          useTestCalendar,
          testSessionId: `${SESSION}-vapi`,
          architectUserId: architect.id,
          calendar: { ownerUserId: architect.id, calendarId: "primary", timeZone: "Asia/Kolkata" }
        } as never
      }
    });
    return { architect, business, workflow, agent };
  }

  async function cleanupFixture(fixture: Awaited<ReturnType<typeof browserTestFixture>>) {
    await prisma.installedAgent.delete({ where: { id: fixture.agent.id } });
    await prisma.workflowDefinition.delete({ where: { id: fixture.workflow.id } });
    await prisma.business.delete({ where: { id: fixture.business.id } });
    await prisma.user.delete({ where: { id: fixture.architect.id } });
  }

  async function postBooking(businessId: string): Promise<Record<string, unknown>> {
    const app = new Hono();
    app.post("/architect/connectors/vapi/webhook", handleVapiWebhook);

    const response = await app.request("/architect/connectors/vapi/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          toolCalls: [
            {
              id: "tc_browser_book",
              function: {
                name: "book_appointment",
                arguments: JSON.stringify({
                  customer_name: "Alex Tester",
                  customer_phone: "+15550018888",
                  date: "2026-07-25",
                  time: "3:00 PM",
                  service_type: "Test Appointment"
                })
              }
            }
          ],
          call: { id: "call_browser_book", customer: { number: "+15550018888" } }
        },
        metadata: { businessId }
      })
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { results?: Array<{ result: string }> };
    return JSON.parse(json.results?.[0]?.result ?? "{}") as Record<string, unknown>;
  }

  const originalSecret = env.VAPI_WEBHOOK_SECRET;

  it("with the toggle ON creates a real marked event in the architect's calendar", async () => {
    if (!(await dbUp())) return;
    env.VAPI_WEBHOOK_SECRET = "";

    calendarCreateMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: "gcal-vapi-evt-1",
      htmlLink: "https://calendar.google.com/event?eid=gcal-vapi-evt-1",
      calendarId: "primary",
      summary: String(input.summaryOverride ?? ""),
      startAt: new Date(input.startAt as Date).toISOString(),
      endAt: new Date(input.endAt as Date).toISOString(),
      timeZone: String(input.timeZone ?? "")
    }));

    const fixture = await browserTestFixture(true);
    try {
      const result = await postBooking(fixture.business.id);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.calendar_status).toBe("test_event_created");
      expect(result.event_link).toBe("https://calendar.google.com/event?eid=gcal-vapi-evt-1");
      expect(result.event_title).toBe("[TRIVEN ARCHITECT TEST] Test Appointment");

      const insert = calendarCreateMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(insert.userId).toBe(fixture.architect.id);
      expect(insert.summaryOverride).toBe("[TRIVEN ARCHITECT TEST] Test Appointment");
      // 3:00 PM IST on 2026-07-25 = 09:30 UTC.
      expect(new Date(insert.startAt as Date).toISOString()).toBe("2026-07-25T09:30:00.000Z");

      // No real customer appointment row was created.
      const appointments = await prisma.appointment.count({ where: { businessId: fixture.business.id } });
      expect(appointments).toBe(0);
    } finally {
      env.VAPI_WEBHOOK_SECRET = originalSecret;
      await cleanupFixture(fixture);
    }
  }, 30000);

  it("with the toggle OFF stays fully simulated (no Google write)", async () => {
    if (!(await dbUp())) return;
    env.VAPI_WEBHOOK_SECRET = "";

    const fixture = await browserTestFixture(false);
    try {
      const result = await postBooking(fixture.business.id);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.calendar_status).toBe("dry_run");
      expect(result.event_link).toBeNull();
      expect(calendarCreateMock).not.toHaveBeenCalled();
    } finally {
      env.VAPI_WEBHOOK_SECRET = originalSecret;
      await cleanupFixture(fixture);
    }
  }, 30000);
});

describe("test exclusion from production data", () => {
  it("test-mode appointments never count in run stats", async () => {
    if (!(await dbUp())) return;

    const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
    const business = await prisma.business.create({
      data: { ownerId: owner.id, name: `${RUN} Biz`, type: "salon" }
    });

    try {
      await prisma.appointment.create({
        data: {
          businessId: business.id,
          customerPhone: "+15550013333",
          service: "Test Appointment",
          startAt: new Date("2026-07-25T19:00:00Z"),
          endAt: new Date("2026-07-25T19:30:00Z"),
          timeZone: "America/New_York",
          executionMode: "BUSINESS_TEST"
        }
      });
      await prisma.appointment.create({
        data: {
          businessId: business.id,
          customerPhone: "+15550014444",
          service: "Real Booking",
          startAt: new Date("2026-07-26T19:00:00Z"),
          endAt: new Date("2026-07-26T19:30:00Z"),
          timeZone: "America/New_York"
        }
      });
      // The call that produced the live booking — the only countable run.
      await prisma.vapiCall.create({
        data: {
          businessId: business.id,
          callId: `${RUN}-runstats-live-1`,
          customerPhone: "+15550014444",
          executionMode: "LIVE"
        }
      });

      const stats = await buildInstalledAgentRunStats(business.id, [{ id: "agent-1", listingId: null }]);
      // Appointments are outcomes of an already-counted call, never separate
      // runs (live or test) — only the LIVE call itself counts.
      expect(stats.get("agent-1")?.runs).toBe(1);
    } finally {
      await prisma.vapiCall.deleteMany({ where: { businessId: business.id } });
      await prisma.appointment.deleteMany({ where: { businessId: business.id } });
      await prisma.business.delete({ where: { id: business.id } });
      await prisma.user.delete({ where: { id: owner.id } });
    }
  }, 30000);
});
