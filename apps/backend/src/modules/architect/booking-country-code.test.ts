import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { handleVapiWebhook, hasExplicitCountryCode } from "./twilio-business-routing";

/**
 * Regression: on WEB calls (no caller ID) a dictated bare 10-digit phone
 * number is ambiguous across countries — booking on a +1 guess sends the
 * confirmation text to the wrong number and makes caller-ID reschedules
 * impossible. The booking tool must ask for the country code, then accept the
 * full +<cc> number.
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

const RUN = `ccode-${process.pid}-${Date.now().toString(36)}`;

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
  const user = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
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
      name: "Country Code Test",
      status: "ACTIVE",
      configJson: {} as never
    }
  });
  fixture = { userId: user.id, businessId: business.id, workflowId: workflow.id, agentId: agent.id };
  return fixture;
}

async function postBooking(
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
          { id: "tc_cc", function: { name: "book_appointment", arguments: JSON.stringify(args) } }
        ],
        // No customer.number — exactly the browser-test situation (no caller ID).
        call: { id: callId }
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

describe("hasExplicitCountryCode", () => {
  it("accepts +E.164, 00-international, and 11+ digit numbers", () => {
    expect(hasExplicitCountryCode("+916396039675")).toBe(true);
    expect(hasExplicitCountryCode("+1 650 555 1234")).toBe(true);
    expect(hasExplicitCountryCode("00916396039675")).toBe(true);
    expect(hasExplicitCountryCode("16505551234")).toBe(true);
    expect(hasExplicitCountryCode("916396039675")).toBe(true);
  });

  it("flags bare 10-digit numbers as ambiguous", () => {
    expect(hasExplicitCountryCode("6396039675")).toBe(false);
    expect(hasExplicitCountryCode("639-603-9675")).toBe(false);
    expect(hasExplicitCountryCode("(650) 555-1234")).toBe(false);
  });
});

describe("web-call booking requires a country code for dictated numbers", () => {
  const originalSecret = env.VAPI_WEBHOOK_SECRET;

  beforeEach(() => {
    env.VAPI_WEBHOOK_SECRET = "";
  });

  afterAll(async () => {
    env.VAPI_WEBHOOK_SECRET = originalSecret;
    if (fixture) {
      await prisma.appointment.deleteMany({ where: { businessId: fixture.businessId } });
      await prisma.installedAgent.deleteMany({ where: { id: fixture.agentId } });
      await prisma.workflowDefinition.deleteMany({ where: { id: fixture.workflowId } });
      await prisma.business.deleteMany({ where: { id: fixture.businessId } });
      await prisma.user.deleteMany({ where: { id: fixture.userId } });
    }
    await prisma.$disconnect();
  });

  it("a bare 10-digit number is asked for its country code, and the full +91 number books", async () => {
    if (!(await dbUp())) return;
    const created = await makeFixture();
    const date = nearOpenDate();

    const ambiguous = await postBooking(created.businessId, `call_${RUN}_a`, {
      customer_name: "Rahul Verma",
      customer_phone: "6396039675",
      date,
      time: "10:00 AM",
      service_type: "Cleaning"
    });
    expect(ambiguous.success).toBe(false);
    expect(String(ambiguous.message)).toContain("country");

    const full = await postBooking(created.businessId, `call_${RUN}_b`, {
      customer_name: "Rahul Verma",
      customer_phone: "+916396039675",
      date,
      time: "10:00 AM",
      service_type: "Cleaning"
    });
    expect(full.success).toBe(true);

    const appointment = await prisma.appointment.findFirst({
      where: { businessId: created.businessId, customerName: "Rahul Verma" },
      select: { customerPhone: true }
    });
    expect(appointment?.customerPhone).toBe("+916396039675");
  }, 30000);
});
