import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { handleVapiWebhook } from "./twilio-business-routing";

/**
 * Regression (the "Better White 9 AM" transcript): when the Limited Use guard
 * is UNCONFIRMED (compliance flags off — e.g. a deployment without the env
 * confirmations), the external Google Calendar is excluded but availability
 * must still answer from the business's appointment hours + platform bookings
 * — never a blanket "cannot confirm" for every requested time.
 */

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

const RUN = `availwr-${process.pid}-${Date.now().toString(36)}`;

/** Simulate the deployment that has NO compliance confirmations set. */
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
  (env as Record<string, unknown>)[flag] = false;
}

async function dbUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

let fixture: { userId: string; businessId: string; workflowId: string; agentId: string } | null = null;

async function makeFixture() {
  const user = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "BUSINESS" }
  });
  const business = await prisma.business.create({
    data: { ownerId: user.id, name: `${RUN} Practice`, type: "dental practice" }
  });
  const workflow = await prisma.workflowDefinition.create({
    data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: user.id }
  });
  const agent = await prisma.installedAgent.create({
    data: {
      businessId: business.id,
      workflowId: workflow.id,
      name: "Restricted Availability Test",
      status: "ACTIVE",
      configJson: { executionMode: "BUSINESS_TEST" } as never
    }
  });
  fixture = { userId: user.id, businessId: business.id, workflowId: workflow.id, agentId: agent.id };
  return fixture;
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
          { id: "tc_avail", function: { name: "check_availability", arguments: JSON.stringify(args) } }
        ],
        call: { id: callId, customer: { number: "+15550014444" } }
      },
      metadata: { businessId }
    })
  });
  expect(response.status).toBe(200);
  const json = (await response.json()) as { results?: Array<{ result: string }> };
  return JSON.parse(json.results?.[0]?.result ?? "{}") as Record<string, unknown>;
}

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

describe("availability with the Limited Use guard unconfirmed", () => {
  const originalSecret = env.VAPI_WEBHOOK_SECRET;

  beforeEach(() => {
    env.VAPI_WEBHOOK_SECRET = "";
  });

  afterAll(async () => {
    env.VAPI_WEBHOOK_SECRET = originalSecret;
    for (const flag of GUARD_FLAGS) {
      (env as Record<string, unknown>)[flag] = savedFlags.get(flag);
    }
    if (fixture) {
      await prisma.installedAgent.deleteMany({ where: { id: fixture.agentId } });
      await prisma.workflowDefinition.deleteMany({ where: { id: fixture.workflowId } });
      await prisma.business.deleteMany({ where: { id: fixture.businessId } });
      await prisma.user.deleteMany({ where: { id: fixture.userId } });
    }
    await prisma.$disconnect();
  });

  it("a 9 AM exact-time ask gets a real verdict from the business schedule", async () => {
    if (!(await dbUp())) return;
    const created = await makeFixture();

    const result = await postCheckAvailability(created.businessId, `call_${RUN}_9am`, {
      date: nearOpenDate(),
      time: "9:00 AM",
      service_type: "Cleaning"
    });
    expect(result.success).toBe(true);
    expect(String(result.message)).toContain("available");
    expect(String(result.message)).not.toContain("cannot be confirmed");
    expect(String(result.message)).toContain("team will confirm");
  }, 30000);

  it("a full-day ask still offers a spoken sample of slots", async () => {
    if (!(await dbUp())) return;
    const businessId = fixture?.businessId ?? (await makeFixture()).businessId;

    const result = await postCheckAvailability(businessId, `call_${RUN}_day`, {
      date: nearOpenDate(),
      service_type: "Cleaning"
    });
    expect(result.success).toBe(true);
    const slots = result.availableTimes as string[] | undefined;
    expect(Array.isArray(slots)).toBe(true);
    expect((slots ?? []).length).toBeGreaterThanOrEqual(3);
    expect((slots ?? []).length).toBeLessThanOrEqual(5);
  }, 30000);
});
