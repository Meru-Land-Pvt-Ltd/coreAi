import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verbalSmsConsentDisclosure } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

/**
 * Consent-status sync, exact-disclosure enforcement, honest provider-status
 * wording, and monotonic Twilio delivery states (production incident: consent
 * re-asked despite OPTED_IN, abbreviated disclosure, false "sent" claim after
 * DISCLOSURE_NOT_PRESENTED, UNDELIVERED 30007).
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

const { handleVapiWebhook } = await import("./twilio-business-routing");
const { applyTwilioMessageStatus } = await import("../notifications/sms-notification-service");
const { toAiSafeBookingResult } = await import("../compliance/ai-safe-results");
const { buildAgentSystemPrompt } = await import("../agent-runtime/prompt-builder");

const RUN = `smshonest-${process.pid}-${Date.now().toString(36)}`;
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

async function makeFixture(): Promise<Fixture> {
  const index = fixtures.length;
  const user = await prisma.user.create({ data: { email: `${RUN}-${index}@test.local`, role: "BUSINESS" } });
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
      name: "Honesty Test",
      status: "ACTIVE",
      configJson: {} as never
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
  options?: { artifactMessages?: Array<{ role: string; message: string }> }
): Promise<Record<string, unknown>> {
  const app = new Hono();
  app.post("/architect/connectors/vapi/webhook", handleVapiWebhook);

  const response = await app.request("/architect/connectors/vapi/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        type: "tool-calls",
        toolCalls: [{ id: "tc_honest", function: { name: toolName, arguments: JSON.stringify(args) } }],
        ...(options?.artifactMessages ? { artifact: { messages: options.artifactMessages } } : {}),
        call: { id: callId }
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
    if (weekday !== "Sunday") return candidate.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  }
  throw new Error("unreachable");
}

function bookArgs() {
  return {
    customer_name: "Rahul Verma",
    customer_phone: INDIA_PHONE,
    date: nearOpenDate(),
    time: "10:00 AM",
    service_type: "Cleaning"
  };
}

describe("delivery-state monotonic precedence", () => {
  it("UNDELIVERED 30007 is terminal: later QUEUED or DELIVERED callbacks never overwrite it", async () => {
    if (!(await dbUp())) return;
    const sid = `SM_${RUN}_order`;
    const row = await prisma.smsExecution.create({
      data: { toPhone: INDIA_PHONE, body: "x", status: "SENT", messageSid: sid, provider: "TWILIO" }
    });

    await applyTwilioMessageStatus({ MessageSid: sid, MessageStatus: "undelivered", ErrorCode: "30007" });
    let current = await prisma.smsExecution.findUnique({ where: { id: row.id } });
    expect(current?.status).toBe("UNDELIVERED");
    expect(current?.errorCode).toBe("30007");

    // Out-of-order late callbacks must not resurrect or flip the state.
    await applyTwilioMessageStatus({ MessageSid: sid, MessageStatus: "queued" });
    await applyTwilioMessageStatus({ MessageSid: sid, MessageStatus: "sent" });
    await applyTwilioMessageStatus({ MessageSid: sid, MessageStatus: "delivered" });
    current = await prisma.smsExecution.findUnique({ where: { id: row.id } });
    expect(current?.status).toBe("UNDELIVERED");
    expect(current?.errorCode).toBe("30007");

    await prisma.smsExecution.delete({ where: { id: row.id } });
  }, 30000);

  it("normal forward progression still works (QUEUED → SENT → DELIVERED)", async () => {
    if (!(await dbUp())) return;
    const sid = `SM_${RUN}_fwd`;
    const row = await prisma.smsExecution.create({
      data: { toPhone: INDIA_PHONE, body: "x", status: "QUEUED", messageSid: sid, provider: "TWILIO" }
    });
    await applyTwilioMessageStatus({ MessageSid: sid, MessageStatus: "sent" });
    await applyTwilioMessageStatus({ MessageSid: sid, MessageStatus: "delivered" });
    const current = await prisma.smsExecution.findUnique({ where: { id: row.id } });
    expect(current?.status).toBe("DELIVERED");
    await prisma.smsExecution.delete({ where: { id: row.id } });
  }, 30000);
});

describe("honest provider-status wording (AI-safe booking result)", () => {
  const base = { success: true, date: "2026-07-24", time: "10:00", service_type: "Cleaning" };

  it("QUEUED with messageSid permits only provider-acceptance wording", () => {
    const result = toAiSafeBookingResult({
      ...base,
      canonical_recipient_ending: "9675",
      consent_status: "granted",
      sms: { attempted: true, sent: true, provider_accepted: true, status: "QUEUED", blocked_reason: null }
    });
    expect(result.customerSafeMessage).toBe("Your confirmation text has been submitted.");
    expect(result.message).toContain("has been submitted");
    expect(result.message).not.toContain("delivered to");
    expect(result.consentStatus).toBe("granted");
    expect(result.smsStatus).toBe("QUEUED");
  });

  it("UNDELIVERED 30007 produces no success claim", () => {
    const result = toAiSafeBookingResult({
      ...base,
      sms: {
        attempted: true,
        sent: false,
        provider_accepted: true,
        status: "UNDELIVERED",
        delivery_error_code: "30007",
        blocked_reason: null
      }
    });
    expect(result.customerSafeMessage).toBe("Your appointment is booked, but I couldn't send the confirmation text.");
    expect(result.message).not.toContain("submitted");
    expect(result.deliveryErrorCode).toBe("30007");
    expect(result.smsStatus).toBe("UNDELIVERED");
  });

  it("OPTED_OUT never asks again and never claims a send", () => {
    const result = toAiSafeBookingResult({
      ...base,
      consent_status: "declined",
      sms: { attempted: false, sent: false, provider_accepted: false, blocked_reason: "SMS_OPTED_OUT" }
    });
    expect(result.message).toContain("Do NOT ask for SMS consent again");
    expect(result.customerSafeMessage).toContain("couldn't send");
    expect(result.consentStatus).toBe("declined");
  });
});

describe("consent-status synchronization through booking", () => {
  const originalSecret = env.VAPI_WEBHOOK_SECRET;

  beforeEach(() => {
    env.VAPI_WEBHOOK_SECRET = "";
    sendTwilioSmsMock.mockReset();
    sendTwilioSmsMock.mockImplementation(async () => ({
      messageSid: `SM_${Math.random().toString(36).slice(2, 10)}`,
      id: "x",
      status: "queued",
      to: "",
      from: "+17252202182",
      messagingServiceSid: null,
      numSegments: 1,
      price: null,
      priceUnit: null,
      simulated: false,
      testCredentials: false
    }));
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

  it("existing OPTED_IN consent: booking reports granted, submits the text, and never re-asks", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    await prisma.smsConsent.create({
      data: {
        businessId: fixture.businessId,
        installedAgentId: fixture.agentId,
        phoneNumber: INDIA_PHONE,
        messagingProgram: "TRANSACTIONAL_BOOKING",
        status: "OPTED_IN",
        method: "VERBAL_CALL",
        consentAt: new Date(),
        disclosureVersion: "test"
      }
    });

    const result = await postTool(fixture, `call_${RUN}_optin`, "book_appointment", bookArgs());
    expect(result.success).toBe(true);
    expect(result.consentStatus).toBe("granted");
    // +91 destination: carriers filter our US long code — the agent is told
    // delivery cannot be promised and to confirm details verbally.
    expect(String(result.message)).toContain("delivery cannot be promised");
    expect(result.requiredDisclosure).toBeUndefined();
    expect(result.customerSafeMessage).toBe("Your confirmation text has been submitted.");
    expect(result.recipientEnding).toBe(INDIA_PHONE.slice(-4));
    expect(sendTwilioSmsMock).toHaveBeenCalledTimes(1);
  }, 40000);

  it("existing OPTED_OUT consent: booking reports declined, sends nothing, forbids re-asking", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    await prisma.smsConsent.create({
      data: {
        businessId: fixture.businessId,
        phoneNumber: INDIA_PHONE,
        messagingProgram: "TRANSACTIONAL_BOOKING",
        status: "OPTED_OUT",
        method: "VERBAL_CALL",
        optOutAt: new Date(),
        disclosureVersion: "test"
      }
    });

    const result = await postTool(fixture, `call_${RUN}_optout`, "book_appointment", bookArgs());
    expect(result.success).toBe(true);
    expect(result.consentStatus).toBe("declined");
    expect(String(result.message)).toContain("Do NOT ask for SMS consent again");
    expect(sendTwilioSmsMock).not.toHaveBeenCalled();
  }, 40000);

  it("no consent: booking returns the EXACT canonical disclosure to read", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();

    const result = await postTool(fixture, `call_${RUN}_none`, "book_appointment", bookArgs());
    expect(result.success).toBe(true);
    expect(result.consentStatus).toBe("none");
    expect(result.requiredDisclosure).toBe(verbalSmsConsentDisclosure(fixture.businessName));
    expect(String(result.message)).toContain("WORD-FOR-WORD");
    expect(result.customerSafeMessage).toContain("couldn't send");
    expect(sendTwilioSmsMock).not.toHaveBeenCalled();
  }, 40000);

  it("an abbreviated disclosure is rejected and cannot yield spoken success", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    const callId = `call_${RUN}_abbrev`;
    await postTool(fixture, callId, "book_appointment", bookArgs());

    const result = await postTool(
      fixture,
      callId,
      "record_sms_consent",
      { affirmative: true },
      {
        artifactMessages: [
          { role: "bot", message: "Would you like to receive text messages about this appointment? Say yes or no." },
          { role: "user", message: "Yes." }
        ]
      }
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("DISCLOSURE_NOT_PRESENTED");
    expect(result.required_disclosure).toBe(verbalSmsConsentDisclosure(fixture.businessName));
    expect(String(result.message)).toContain("NEVER tell the caller consent was saved");
    expect(String(result.message)).toContain("WORD-FOR-WORD");
  }, 40000);

  it("structured artifact turns satisfy disclosure proof and keep the recipient identical end-to-end", async () => {
    if (!(await dbUp())) return;
    const fixture = await makeFixture();
    const callId = `call_${RUN}_full`;
    const appointmentBooked = await postTool(fixture, callId, "book_appointment", bookArgs());
    expect(appointmentBooked.consentStatus).toBe("none");

    const consent = await postTool(
      fixture,
      callId,
      "record_sms_consent",
      { affirmative: true },
      {
        artifactMessages: [
          { role: "bot", message: verbalSmsConsentDisclosure(fixture.businessName) },
          { role: "user", message: "Yes." }
        ]
      }
    );
    expect(consent.success).toBe(true);
    expect(consent.confirmation_sms_sent).toBe(true);
    expect(String(consent.message)).toContain("has been submitted");

    const appointment = await prisma.appointment.findFirst({ where: { businessId: fixture.businessId } });
    const consentRow = await prisma.smsConsent.findFirst({ where: { businessId: fixture.businessId } });
    const smsRow = await prisma.smsExecution.findFirst({
      where: { dedupeKey: `appointment-confirmation:${appointment?.id}` }
    });
    expect(appointment?.customerPhone).toBe(INDIA_PHONE);
    expect(consentRow?.phoneNumber).toBe(INDIA_PHONE);
    expect(smsRow?.toPhone).toBe(INDIA_PHONE);
  }, 40000);
});

describe("unreliable-destination flag", () => {
  it("flags +91 and not +1 (SMS_UNRELIABLE_COUNTRY_PREFIXES)", async () => {
    const { isSmsDeliveryUnreliable } = await import("./twilio-connector");
    expect(isSmsDeliveryUnreliable("+916396039675")).toBe(true);
    expect(isSmsDeliveryUnreliable("+16505551234")).toBe(false);
    expect(isSmsDeliveryUnreliable("6396039675")).toBe(false);
  });
});

describe("identity isolation", () => {
  it("the prompt forbids adopting another business's identity from knowledge/template text", () => {
    const prompt = buildAgentSystemPrompt({
      assistantName: "Eva Stark",
      businessName: "Better White",
      businessType: "dental practice",
      services: ["Cleaning"],
      faqs: [],
      knowledge: [
        "Thank you for calling California Family Dental Center! Reach us at (555) 111-2222, open 8-6 weekdays."
      ],
      timezoneText: "America/Los_Angeles",
      currentDateTimeText: "now",
      currentDateText: "today",
      tomorrowDateText: "tomorrow",
      capabilities: { canCheckAvailability: true, canBook: true, canText: true }
    });

    expect(prompt).toContain("you represent ONLY Better White");
    expect(prompt).toContain("NEVER adopt them");
    expect(prompt).toContain("including in closings and goodbyes");
  });
});
