import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verbalSmsConsentDisclosure } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

/**
 * Post-booking SMS consent + recipient consistency (production CASE 1/2):
 * one canonical recipient flows from book_appointment → SmsConsent →
 * appointment-confirmation sender; consent after a SUPPRESSED attempt fires
 * exactly ONE authorized send; consent for phone A never authorizes phone B;
 * "sent" is claimed only on provider acceptance (messageSid).
 */

const { sendTwilioSmsMock } = await vi.hoisted(async () => {
  const { fileURLToPath } = await import("node:url");
  const nodePath = await import("node:path");
  const dotenv = await import("dotenv");
  dotenv.config({
    path: nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../../.env")
  });
  process.env.NODE_ENV = "test";
  process.env.SES_DRY_RUN = "true";
  delete process.env.REDIS_URL;
  return { sendTwilioSmsMock: vi.fn() };
});

vi.mock("./twilio-connector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./twilio-connector")>()),
  sendTwilioSms: sendTwilioSmsMock
}));

// Import AFTER the mock so the webhook module sees the mocked sender.
const { handleVapiWebhook } = await import("./twilio-business-routing");

const RUN = `smsrecip-${process.pid}-${Date.now().toString(36)}`;
const INDIA_PHONE = "+916396039675";

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

function twilioSuccess(sid: string) {
  return {
    messageSid: sid,
    id: sid,
    status: "sent",
    to: "",
    from: "+17252202182",
    messagingServiceSid: null,
    numSegments: 1,
    price: null,
    priceUnit: null,
    simulated: false,
    testCredentials: false
  };
}

async function dbUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

type Fixture = { userId: string; businessId: string; businessName: string; workflowId: string; agentId: string };
const fixtures: Fixture[] = [];

async function makeFixture(options?: { executionMode?: string }): Promise<Fixture> {
  const index = fixtures.length;
  const user = await prisma.user.create({
    data: { email: `${RUN}-${index}@test.local`, role: "BUSINESS" }
  });
  const businessName = `${RUN} Practice ${index}`;
  const business = await prisma.business.create({
    data: { ownerId: user.id, name: businessName, type: "dental practice" }
  });
  const workflow = await prisma.workflowDefinition.create({
    data: { name: `${RUN} wf ${index}`, workflowJson: { nodes: [], edges: [] }, architectUserId: user.id }
  });
  const agent = await prisma.installedAgent.create({
    data: {
      businessId: business.id,
      workflowId: workflow.id,
      name: "Consent Recipient Test",
      status: "ACTIVE",
      configJson: (options?.executionMode ? { executionMode: options.executionMode } : {}) as never
    }
  });
  const fixture = { userId: user.id, businessId: business.id, businessName, workflowId: workflow.id, agentId: agent.id };
  fixtures.push(fixture);
  return fixture;
}

async function postTool(
  fixture: Fixture,
  callId: string,
  toolName: string,
  args: Record<string, unknown>,
  options?: { withDisclosure?: boolean; businessTest?: boolean }
): Promise<Record<string, unknown>> {
  const app = new Hono();
  app.post("/architect/connectors/vapi/webhook", handleVapiWebhook);

  const response = await app.request("/architect/connectors/vapi/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        type: "tool-calls",
        toolCalls: [{ id: "tc_recip", function: { name: toolName, arguments: JSON.stringify(args) } }],
        ...(options?.withDisclosure
          ? {
              artifact: {
                messages: [
                  { role: "bot", message: verbalSmsConsentDisclosure(fixture.businessName) },
                  { role: "user", message: "Yes." }
                ]
              }
            }
          : {}),
        // No customer.number — web/browser call, no caller ID.
        call: { id: callId, ...(options?.businessTest ? { type: "webCall" } : {}) }
      },
      metadata: { businessId: fixture.businessId, installedAgentId: fixture.agentId }
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

async function bookAppointment(fixture: Fixture, callId: string, phone: string) {
  const result = await postTool(fixture, callId, "book_appointment", {
    customer_name: "Rahul Verma",
    customer_phone: phone,
    date: nearOpenDate(),
    time: "10:00 AM",
    service_type: "Cleaning"
  });
  expect(result.success).toBe(true);
  const appointment = await prisma.appointment.findFirst({
    where: { businessId: fixture.businessId, status: "BOOKED" },
    orderBy: { createdAt: "desc" }
  });
  expect(appointment).not.toBeNull();
  return appointment!;
}

describe("post-booking SMS consent recipient consistency", () => {
  const originalSecret = env.VAPI_WEBHOOK_SECRET;

  beforeEach(() => {
    env.VAPI_WEBHOOK_SECRET = "";
    sendTwilioSmsMock.mockReset();
    sendTwilioSmsMock.mockImplementation(async () => twilioSuccess(`SM_${Math.random().toString(36).slice(2, 10)}`));
  });

  afterAll(async () => {
    env.VAPI_WEBHOOK_SECRET = originalSecret;
    for (const flag of GUARD_FLAGS) {
      (env as Record<string, unknown>)[flag] = savedFlags.get(flag);
    }
    for (const fixture of fixtures) {
      await prisma.smsExecution.deleteMany({ where: { businessId: fixture.businessId } });
      await prisma.smsConsent.deleteMany({ where: { businessId: fixture.businessId } });
      await prisma.appointment.deleteMany({ where: { businessId: fixture.businessId } });
      await prisma.installedAgent.deleteMany({ where: { id: fixture.agentId } });
      await prisma.workflowDefinition.deleteMany({ where: { id: fixture.workflowId } });
      await prisma.business.deleteMany({ where: { id: fixture.businessId } });
      await prisma.user.deleteMany({ where: { id: fixture.userId } });
    }
    await prisma.$disconnect();
  });

  it("CASE 1: consent after a suppressed attempt sends exactly one confirmation to the SAME recipient", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    const callId = `call_${RUN}_case1`;

    const appointment = await bookAppointment(fixture, callId, INDIA_PHONE);
    expect(appointment.customerPhone).toBe(INDIA_PHONE);
    expect(appointment.bookingCallId).toBe(callId);

    // Booking DEFERS the confirmation until consent — it creates NO execution
    // (not even a suppressed one) and makes no provider send (#4).
    const afterBooking = await prisma.smsExecution.findMany({
      where: { businessId: fixture.businessId }
    });
    expect(afterBooking).toHaveLength(0);
    expect(sendTwilioSmsMock).not.toHaveBeenCalled();

    // Verbal consent on the same call.
    const consent = await postTool(fixture, callId, "record_sms_consent", { affirmative: true }, { withDisclosure: true });
    expect(consent.success).toBe(true);
    expect(consent.consent_recorded).toBe(true);
    expect(consent.sms_allowed).toBe(true);
    expect(consent.confirmation_sms_sent).toBe(true);
    expect(String(consent.masked_recipient)).toContain(INDIA_PHONE.slice(-4));
    expect(String(consent.message)).toContain("has been submitted");

    // Canonical recipient identity across all three records.
    const consentRow = await prisma.smsConsent.findFirst({ where: { businessId: fixture.businessId } });
    expect(consentRow?.phoneNumber).toBe(INDIA_PHONE);
    expect(consentRow?.status).toBe("OPTED_IN");
    expect(consentRow?.installedAgentId).toBe(fixture.agentId);

    const sentRow = await prisma.smsExecution.findFirst({
      where: { dedupeKey: `appointment-confirmation:${appointment.id}` }
    });
    expect(sentRow).not.toBeNull();
    expect(sentRow?.toPhone).toBe(INDIA_PHONE);
    expect(sentRow?.messageSid).toBeTruthy();
    expect(sentRow?.vapiCallId).toBe(callId);
    expect(sentRow?.installedAgentId).toBe(fixture.agentId);
    expect(sendTwilioSmsMock).toHaveBeenCalledTimes(1);

    // Webhook retry: dedupe prevents a duplicate message but still reports sent.
    const retry = await postTool(fixture, callId, "record_sms_consent", { affirmative: true }, { withDisclosure: true });
    expect(retry.confirmation_sms_sent).toBe(true);
    expect(sendTwilioSmsMock).toHaveBeenCalledTimes(1);
  }, 40000);

  it("CASE 2: an explicitly different full number never inherits the booked number's consent", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    const callId = `call_${RUN}_case2`;

    await bookAppointment(fixture, callId, INDIA_PHONE);

    const consent = await postTool(
      fixture,
      callId,
      "record_sms_consent",
      { affirmative: true, customer_phone: "+16396039675" },
      { withDisclosure: true }
    );
    // The model-injected number is IGNORED (#3): consent binds ONLY to the
    // appointment's canonical recipient, never to a number the model supplied.
    expect(consent.consent_recorded).toBe(true);

    const consentRows = await prisma.smsConsent.findMany({ where: { businessId: fixture.businessId } });
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]?.phoneNumber).toBe(INDIA_PHONE);
    // The different full number the model tried to inject NEVER received consent.
    expect(consentRows.some((row) => row.phoneNumber === "+16396039675")).toBe(false);
  }, 40000);

  it("provider failure is reported honestly — no false 'sent' without a messageSid", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    const callId = `call_${RUN}_fail`;

    await bookAppointment(fixture, callId, INDIA_PHONE);
    sendTwilioSmsMock.mockImplementation(async () => {
      throw new Error("twilio unavailable");
    });

    const consent = await postTool(fixture, callId, "record_sms_consent", { affirmative: true }, { withDisclosure: true });
    expect(consent.success).toBe(true);
    expect(consent.consent_recorded).toBe(true);
    expect(consent.confirmation_sms_sent).toBe(false);
    expect(String(consent.message)).toContain("couldn't send the confirmation text");
    expect(String(consent.message)).not.toContain("has been sent");
  }, 40000);

  it("BUSINESS_TEST mode records nothing and never sends a real SMS", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture({ executionMode: "BUSINESS_TEST" });
    const callId = `call_${RUN}_bt`;

    const consent = await postTool(
      fixture,
      callId,
      "record_sms_consent",
      { affirmative: true },
      { withDisclosure: true, businessTest: true }
    );
    expect(consent.success).toBe(true);
    expect(consent.consent_recorded).toBe(false);
    expect(await prisma.smsConsent.count({ where: { businessId: fixture.businessId } })).toBe(0);
    expect(sendTwilioSmsMock).not.toHaveBeenCalled();
  }, 40000);
});
