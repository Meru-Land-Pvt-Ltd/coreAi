import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { handleVapiWebhook } from "./twilio-business-routing";

await vi.hoisted(async () => {
  const { fileURLToPath } = await import("node:url");
  const nodePath = await import("node:path");
  const dotenv = await import("dotenv");
  dotenv.config({
    path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../../.env")
  });
  process.env.NODE_ENV = "test";
  process.env.SES_DRY_RUN = "true";
  delete process.env.REDIS_URL;
  return {};
});

const RUN = `nameturns-${process.pid}-${Date.now().toString(36)}`;

async function dbUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

let fixtureCounter = 0;

async function makeFixture() {
  fixtureCounter += 1;
  const architect = await prisma.user.create({
    data: { email: `${RUN}-${fixtureCounter}@test.local`, role: "ARCHITECT" }
  });
  const business = await prisma.business.create({
    data: { ownerId: architect.id, name: `${RUN} Sandbox ${fixtureCounter}`, type: "dental practice" }
  });
  const workflow = await prisma.workflowDefinition.create({
    data: { name: `${RUN} wf ${fixtureCounter}`, workflowJson: { nodes: [], edges: [] }, architectUserId: architect.id }
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
        useTestCalendar: false,
        testSessionId: `${RUN}-session`,
        architectUserId: architect.id
      } as never
    }
  });
  return { architect, business, workflow, agent };
}

async function cleanupFixture(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  await prisma.testCalendarEvent.deleteMany({ where: { ownerUserId: fixture.architect.id } }).catch(() => null);
  await prisma.installedAgent.delete({ where: { id: fixture.agent.id } });
  await prisma.workflowDefinition.delete({ where: { id: fixture.workflow.id } });
  await prisma.business.delete({ where: { id: fixture.business.id } });
  await prisma.user.delete({ where: { id: fixture.architect.id } });
}

async function postBooking(
  businessId: string,
  options: {
    callId: string;
    args: Record<string, unknown>;
    artifactMessages?: Array<{ role: string; message: string }>;
  }
): Promise<Record<string, unknown>> {
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
            id: "tc_name_test",
            function: { name: "book_appointment", arguments: JSON.stringify(options.args) }
          }
        ],
        ...(options.artifactMessages ? { artifact: { messages: options.artifactMessages } } : {}),
        call: { id: options.callId, customer: { number: "+15550012222" } }
      },
      metadata: { businessId }
    })
  });
  expect(response.status).toBe(200);
  const json = (await response.json()) as { results?: Array<{ result: string }> };
  return JSON.parse(json.results?.[0]?.result ?? "{}") as Record<string, unknown>;
}

const BOOKING_ARGS_WITHOUT_NAME = {
  customer_phone: "+15550012222",
  date: "2027-01-15",
  time: "3:00 PM",
  service_type: "Cleaning"
};

describe("caller name from structured tool-call turns", () => {
  const originalSecret = env.VAPI_WEBHOOK_SECRET;

  beforeEach(() => {
    env.VAPI_WEBHOOK_SECRET = "";
  });

  afterAll(() => {
    env.VAPI_WEBHOOK_SECRET = originalSecret;
  });

  it("control: no name anywhere → asks for the name", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    try {
      const result = await postBooking(fixture.business.id, {
        callId: `call_${RUN}_none`,
        args: BOOKING_ARGS_WITHOUT_NAME
      });
      expect(result.success).toBe(false);
      // The AI-safe sanitizer strips machine fields; the ask survives as the message.
      expect(String(result.message).toLowerCase()).toContain("name");
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30000);

  it("picks the caller's spoken name from artifact messages when the arg is missing", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    try {
      const result = await postBooking(fixture.business.id, {
        callId: `call_${RUN}_spoken`,
        args: BOOKING_ARGS_WITHOUT_NAME,
        artifactMessages: [
          { role: "bot", message: "Hi! This is Sarah from the office. How can I help?" },
          { role: "user", message: "Hi, my name is Priya Sharma and I'd like a cleaning." }
        ]
      });
      expect(result.success).toBe(true);
      expect(String(result.message)).toContain("Priya Sharma");
      expect(String(result.message)).not.toContain("Sarah");
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30000);

  it("rejects a placeholder arg and still recovers the real spoken name", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    try {
      const result = await postBooking(fixture.business.id, {
        callId: `call_${RUN}_placeholder`,
        args: { ...BOOKING_ARGS_WITHOUT_NAME, customer_name: "Customer Name" },
        artifactMessages: [
          { role: "assistant", message: "Thanks for calling — who do I have the pleasure of speaking with?" },
          { role: "user", message: "I'm Rahul Verma." }
        ]
      });
      expect(result.success).toBe(true);
      expect(String(result.message)).toContain("Rahul Verma");
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30000);

  it("never harvests the assistant's own greeting as the customer name", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    try {
      const result = await postBooking(fixture.business.id, {
        callId: `call_${RUN}_greeting`,
        args: BOOKING_ARGS_WITHOUT_NAME,
        artifactMessages: [
          { role: "bot", message: "Hi, this is Sarah Mitchell from the dental office. How can I help you today?" },
          { role: "user", message: "I want to book a cleaning tomorrow afternoon." }
        ]
      });
      expect(result.success).toBe(false);
      // The AI-safe sanitizer strips machine fields; the ask survives as the message.
      expect(String(result.message).toLowerCase()).toContain("name");
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30000);
});
