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

const RUN = `availnc-${process.pid}-${Date.now().toString(36)}`;

/** Workspace guard flags must be ON for BUSINESS_TEST availability. */
const GUARD_FLAGS = [
  "GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED",
  "VAPI_WORKSPACE_NO_TRAINING_CONFIRMED",
  "VAPI_HIPAA_OR_ZDR_CONFIRMED",
  "OPENAI_NO_TRAINING_CONFIRMED",
  "OPENAI_DATA_SHARING_DISABLED_CONFIRMED",
  "DEEPGRAM_MIP_OPT_OUT_CONFIRMED",
  "ELEVENLABS_TRAINING_OPT_OUT_CONFIRMED"
] as const;
const savedFlags = new Map<string, unknown>();
for (const flag of GUARD_FLAGS) {
  savedFlags.set(flag, (env as Record<string, unknown>)[flag]);
  (env as Record<string, unknown>)[flag] = true;
}

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
  const owner = await prisma.user.create({
    data: { email: `${RUN}-${fixtureCounter}@test.local`, role: "BUSINESS" }
  });
  const business = await prisma.business.create({
    data: { ownerId: owner.id, name: `${RUN} Practice ${fixtureCounter}`, type: "dental practice" }
  });
  const workflow = await prisma.workflowDefinition.create({
    data: { name: `${RUN} wf ${fixtureCounter}`, workflowJson: { nodes: [], edges: [] }, architectUserId: owner.id }
  });
  const agent = await prisma.installedAgent.create({
    data: {
      businessId: business.id,
      workflowId: workflow.id,
      name: "Availability Test",
      status: "ACTIVE",
      configJson: { executionMode: "BUSINESS_TEST" } as never
    }
  });
  return { owner, business, workflow, agent };
}

async function cleanupFixture(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  await prisma.installedAgent.delete({ where: { id: fixture.agent.id } });
  await prisma.workflowDefinition.delete({ where: { id: fixture.workflow.id } });
  await prisma.business.delete({ where: { id: fixture.business.id } });
  await prisma.user.delete({ where: { id: fixture.owner.id } });
}

async function postCheckAvailability(
  businessId: string,
  callId: string,
  args: Record<string, unknown>
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
            id: "tc_avail",
            function: { name: "check_availability", arguments: JSON.stringify(args) }
          }
        ],
        call: { id: callId, customer: { number: "+15550013333" } }
      },
      metadata: { businessId }
    })
  });
  expect(response.status).toBe(200);
  const json = (await response.json()) as { results?: Array<{ result: string }> };
  return JSON.parse(json.results?.[0]?.result ?? "{}") as Record<string, unknown>;
}

// A near-future weekday inside the 60-day advance window and the default
// Mon-Sat 9:00-17:00 schedule (skips Sunday), in the schedule's timezone.
function nearOpenDate(): string {
  for (let offset = 5; offset < 12; offset += 1) {
    const candidate = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
    const weekday = candidate.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Los_Angeles" });
    if (weekday !== "Sunday") {
      return candidate.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    }
  }
  throw new Error("unreachable");
}
const FRIDAY = nearOpenDate();

describe("availability for a business with no external calendar", () => {
  const originalSecret = env.VAPI_WEBHOOK_SECRET;

  beforeEach(() => {
    env.VAPI_WEBHOOK_SECRET = "";
  });

  afterAll(() => {
    env.VAPI_WEBHOOK_SECRET = originalSecret;
    for (const flag of GUARD_FLAGS) {
      (env as Record<string, unknown>)[flag] = savedFlags.get(flag);
    }
  });

  it("full-day ask returns a spoken sample of real slots (not 'cannot confirm')", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    try {
      const result = await postCheckAvailability(fixture.business.id, `call_${RUN}_day`, {
        date: FRIDAY,
        service_type: "Cleaning"
      });
      // AI-safe shape: { success, date, availableTimes, message }.
      expect(result.success).toBe(true);
      const slots = result.availableTimes as string[] | undefined;
      expect(Array.isArray(slots)).toBe(true);
      expect((slots ?? []).length).toBeGreaterThanOrEqual(3);
      expect((slots ?? []).length).toBeLessThanOrEqual(5);
      expect(String(result.message)).not.toContain("cannot be confirmed");
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30000);

  it("an in-hours exact time gets a real 'available' verdict", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    try {
      const result = await postCheckAvailability(fixture.business.id, `call_${RUN}_exact`, {
        date: FRIDAY,
        time: "10:00 AM",
        service_type: "Cleaning"
      });
      expect(result.success).toBe(true);
      expect(String(result.message)).toContain("available");
      expect(String(result.message)).not.toContain("cannot be confirmed");
      expect(String(result.message)).toContain("team will confirm");
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30000);

  it("an out-of-hours exact time offers nearby alternatives instead of a bare no", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    try {
      const result = await postCheckAvailability(fixture.business.id, `call_${RUN}_late`, {
        date: FRIDAY,
        time: "6:30 PM",
        service_type: "Cleaning"
      });
      expect(result.success).toBe(true);
      expect(String(result.message)).toContain("outside");
      const alternatives = result.availableTimes as string[] | undefined;
      expect(Array.isArray(alternatives)).toBe(true);
      expect((alternatives ?? []).length).toBeGreaterThan(0);
      expect(String(result.message)).toContain("Offer the alternatives");
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30000);
});
