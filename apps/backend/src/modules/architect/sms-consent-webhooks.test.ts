import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { recordVerbalSmsConsent } from "../notifications/sms-consent";
import { handleTwilioInboundSms, handleVapiWebhook } from "./twilio-business-routing";

/**
 * Webhook-level SMS consent behavior: the Vapi record_sms_consent tool, and
 * STOP/START/HELP keyword handling on both the shared platform sender and a
 * business-mapped number. All DB cases skip when the database is down; no
 * real provider request is ever made.
 */

const RUN = `smsconwh-${process.pid}-${Date.now().toString(36)}`;

const originalEnv = {
  TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
  TWILIO_VALIDATE_SIGNATURE: env.TWILIO_VALIDATE_SIGNATURE,
  TWILIO_SHARED_SMS_NUMBER: env.TWILIO_SHARED_SMS_NUMBER,
  SMS_KEYWORD_APP_REPLIES: env.SMS_KEYWORD_APP_REPLIES,
  VAPI_WEBHOOK_SECRET: env.VAPI_WEBHOOK_SECRET
};

const AUTH_TOKEN = "unit-test-auth-token";
const SHARED_SENDER = "+17250000042";

let dbAvailable = false;
let bizAId = "";
let bizBId = "";
let bizAName = "";
let bizANumber = "";

function twilioSign(url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", AUTH_TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

function buildApp() {
  const app = new Hono();
  app.post("/architect/connectors/twilio/inbound-sms", handleTwilioInboundSms);
  app.post("/architect/connectors/vapi/webhook", handleVapiWebhook);
  return app;
}

function postForm(app: Hono, path: string, params: Record<string, string>, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(params)
  });
}

/**
 * What Vapi's running transcript looks like once the ASSISTANT has read the
 * complete disclosure (with the identified business name) and the caller has
 * answered — the exact structure the server verifies before any consent may
 * be recorded.
 */
function spokenDisclosureTranscript(businessName: string): string {
  return (
    `AI: Would you like to receive transactional text messages from ${businessName} through Triven.ai about this appointment, ` +
    "including confirmations, reminders, updates, cancellations, and customer support messages? " +
    "Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. " +
    "Consent is not required to complete the booking or service request. Please say yes or no.\nUser: okay."
  );
}

function vapiConsentPayload(input: {
  businessId: string;
  callId: string;
  customerNumber: string;
  args: Record<string, unknown>;
  /** Pass null to simulate a call where the disclosure was NEVER spoken. */
  transcript?: string | null;
}) {
  return {
    message: {
      type: "tool-calls",
      ...(input.transcript === null
        ? {}
        : { transcript: input.transcript ?? spokenDisclosureTranscript(bizAName) }),
      toolCalls: [
        {
          id: `tc_${input.callId}`,
          function: {
            name: "record_sms_consent",
            arguments: JSON.stringify(input.args)
          }
        }
      ],
      call: { id: input.callId, customer: { number: input.customerNumber } }
    },
    metadata: { businessId: input.businessId }
  };
}

async function postVapi(app: Hono, payload: unknown) {
  const response = await app.request("/architect/connectors/vapi/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = (await response.json()) as { results?: Array<{ result: string }> };
  const first = json.results?.[0]?.result;
  return { response, result: first ? (JSON.parse(first) as Record<string, unknown>) : null };
}

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+1617555${String(1000 + phoneCounter).slice(-4)}`;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[sms-consent-webhooks.test] database unreachable — DB cases skipped");
    return;
  }

  const [ownerA, ownerB, architect] = await Promise.all([
    prisma.user.create({ data: { email: `${RUN}-a@test.local`, role: "BUSINESS" } }),
    prisma.user.create({ data: { email: `${RUN}-b@test.local`, role: "BUSINESS" } }),
    prisma.user.create({ data: { email: `${RUN}-arch@test.local`, role: "ARCHITECT" } })
  ]);

  bizAName = `${RUN} Dental`;
  const [bizA, bizB] = await Promise.all([
    prisma.business.create({ data: { ownerId: ownerA.id, name: bizAName, type: "dental" } }),
    prisma.business.create({ data: { ownerId: ownerB.id, name: `${RUN} Salon`, type: "salon" } })
  ]);
  bizAId = bizA.id;
  bizBId = bizB.id;
  await prisma.businessProfile.create({
    data: { businessId: bizAId, services: ["Cleaning"], timeZone: "America/New_York" }
  });

  // A resolvable business number: BusinessPhoneNumber -> InstalledAgent -> Workflow.
  const workflow = await prisma.workflowDefinition.create({
    data: {
      name: `${RUN} wf`,
      architectUserId: architect.id,
      workflowJson: { nodes: [{ id: "n1", type: "trigger.phone_call" }], edges: [] }
    }
  });
  const installed = await prisma.installedAgent.create({
    data: { businessId: bizAId, workflowId: workflow.id, name: `${RUN} agent`, status: "ACTIVE" }
  });
  bizANumber = `+1618555${String(Date.now()).slice(-4)}`;
  await prisma.businessPhoneNumber.create({
    data: {
      businessId: bizAId,
      installedAgentId: installed.id,
      phoneNumber: bizANumber,
      isActive: true
    }
  });
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    const ids = [bizAId, bizBId].filter(Boolean);
    await prisma.smsExecution.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.smsConsent.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.vapiCall.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.businessPhoneNumber.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.installedAgent.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.workflowDefinition.deleteMany({ where: { name: `${RUN} wf` } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  }
  await prisma.$disconnect();
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

/* --------------------------- Vapi consent tool ---------------------------- */

describe("Vapi record_sms_consent tool", () => {
  it("FAILS CLOSED when the disclosure was never spoken on the call (no transcript evidence)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const customer = nextPhone();

    const { result } = await postVapi(
      app,
      vapiConsentPayload({
        businessId: bizAId,
        callId: `${RUN}-nodisc-1`,
        customerNumber: customer,
        args: { affirmative: true },
        transcript: null
      })
    );

    expect(result?.success).toBe(false);
    expect(result?.error).toBe("DISCLOSURE_NOT_PRESENTED");
    expect(result?.consent_recorded).toBe(false);
    expect(result?.sms_allowed).toBe(false);

    const consent = await prisma.smsConsent.findFirst({
      where: { businessId: bizAId, phoneNumber: customer }
    });
    expect(consent).toBeNull();
  });

  it("a transcript WITHOUT the disclosure phrases also fails closed — arbitrary text is not proof", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const customer = nextPhone();

    const { result } = await postVapi(
      app,
      vapiConsentPayload({
        businessId: bizAId,
        callId: `${RUN}-nodisc-2`,
        customerNumber: customer,
        args: { affirmative: true },
        transcript: "AI: You're booked for 3 PM. Would you like anything else?\nUser: yes, send me a text."
      })
    );

    expect(result?.error).toBe("DISCLOSURE_NOT_PRESENTED");
    expect(
      await prisma.smsConsent.findFirst({ where: { businessId: bizAId, phoneNumber: customer } })
    ).toBeNull();
  });

  it("caller-authored disclosure text can NEVER create OFFERED state (role spoofing)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const customer = nextPhone();

    // The full disclosure wording appears ONLY in a User: segment.
    const spoofed = spokenDisclosureTranscript(bizAName).replace(/^AI:/, "User:");
    const { result } = await postVapi(
      app,
      vapiConsentPayload({
        businessId: bizAId,
        callId: `${RUN}-spoof-1`,
        customerNumber: customer,
        args: { affirmative: true },
        transcript: spoofed
      })
    );

    expect(result?.error).toBe("DISCLOSURE_NOT_PRESENTED");
    expect(
      await prisma.smsConsent.findFirst({ where: { businessId: bizAId, phoneNumber: customer } })
    ).toBeNull();
  });

  it("OFFERED state persists across webhook retries mid-call, and is SPENT after a terminal decision", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const customer = nextPhone();
    const callId = `${RUN}-offered-1`;

    // BUSINESS_TEST first: the marker persists across retries (no terminal record).
    const testPayload = (transcript: string | null | undefined) => ({
      ...vapiConsentPayload({ businessId: bizAId, callId: `${callId}-t`, customerNumber: customer, args: { affirmative: true }, transcript }),
      metadata: { businessId: bizAId, purpose: "BUYER_SETUP_PREVIEW" }
    });
    const testFirst = await postVapi(app, testPayload(undefined));
    expect(testFirst.result?.success).toBe(true);
    const testRetry = await postVapi(app, testPayload(null));
    expect(testRetry.result?.success).toBe(true);

    // LIVE: disclosure spoken → decline recorded (terminal) → marker spent.
    const first = await postVapi(
      app,
      vapiConsentPayload({ businessId: bizAId, callId, customerNumber: customer, args: { affirmative: false } })
    );
    expect(first.result?.success).toBe(true);

    // A retry WITHOUT transcript now fails closed (marker was consumed)…
    const stale = await postVapi(
      app,
      vapiConsentPayload({ businessId: bizAId, callId, customerNumber: customer, args: { affirmative: true }, transcript: null })
    );
    expect(stale.result?.error).toBe("DISCLOSURE_NOT_PRESENTED");

    // …while a realistic Vapi retry (transcript included) re-verifies and succeeds.
    const retry = await postVapi(
      app,
      vapiConsentPayload({ businessId: bizAId, callId, customerNumber: customer, args: { affirmative: true } })
    );
    expect(retry.result?.success).toBe(true);
    expect(retry.result?.consent_recorded).toBe(true);
  });

  it("a clear yes records OPTED_IN consent scoped to the call's business", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const customer = nextPhone();

    const { response, result } = await postVapi(
      app,
      vapiConsentPayload({
        businessId: bizAId,
        callId: `${RUN}-vapi-1`,
        customerNumber: customer,
        args: { affirmative: true }
      })
    );

    expect(response.status).toBe(200);
    expect(result?.success).toBe(true);
    expect(result?.consent_recorded).toBe(true);
    expect(result?.sms_allowed).toBe(true);

    const consent = await prisma.smsConsent.findFirst({
      where: { businessId: bizAId, phoneNumber: customer }
    });
    expect(consent?.status).toBe("OPTED_IN");
    expect(consent?.method).toBe("VERBAL_CALL");
    expect(consent?.vapiCallId).toBe(`${RUN}-vapi-1`);
    expect(consent?.businessNamePresented).toBe(bizAName);

    // Consent belongs to Business A only.
    const other = await prisma.smsConsent.findFirst({
      where: { businessId: bizBId, phoneNumber: customer }
    });
    expect(other).toBeNull();
  });

  it("a no records a decline and reports sms_allowed=false", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const customer = nextPhone();

    const { result } = await postVapi(
      app,
      vapiConsentPayload({
        businessId: bizAId,
        callId: `${RUN}-vapi-2`,
        customerNumber: customer,
        args: { affirmative: false }
      })
    );

    expect(result?.success).toBe(true);
    expect(result?.sms_allowed).toBe(false);

    const consent = await prisma.smsConsent.findFirst({
      where: { businessId: bizAId, phoneNumber: customer }
    });
    expect(consent?.status).toBe("OPTED_OUT");
    expect(consent?.consentAt).toBeNull();
  });

  it("a missing/ambiguous affirmative value records nothing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const customer = nextPhone();

    const noArg = await postVapi(
      app,
      vapiConsentPayload({
        businessId: bizAId,
        callId: `${RUN}-vapi-3`,
        customerNumber: customer,
        args: {}
      })
    );
    const stringArg = await postVapi(
      app,
      vapiConsentPayload({
        businessId: bizAId,
        callId: `${RUN}-vapi-3b`,
        customerNumber: customer,
        args: { affirmative: "maybe" }
      })
    );

    expect(noArg.result?.consent_recorded).toBe(false);
    expect(stringArg.result?.consent_recorded).toBe(false);

    const consent = await prisma.smsConsent.findFirst({
      where: { businessId: bizAId, phoneNumber: customer }
    });
    expect(consent).toBeNull();
  });
});

/* --------------------------- STOP / START / HELP -------------------------- */

describe("keyword handling on the shared platform sender", () => {
  it("STOP revokes consent for that phone and never auto-replies", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    env.TWILIO_VALIDATE_SIGNATURE = false;
    env.TWILIO_SHARED_SMS_NUMBER = SHARED_SENDER;
    const app = buildApp();
    const customer = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: customer,
      businessName: bizAName,
      vapiCallId: `${RUN}-stop-1`,
      affirmative: true
    });

    const response = await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: SHARED_SENDER,
      From: customer,
      Body: "STOP"
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<Response></Response>");

    const consent = await prisma.smsConsent.findFirst({
      where: { businessId: bizAId, phoneNumber: customer }
    });
    expect(consent?.status).toBe("OPTED_OUT");
    expect(consent?.optOutSource).toBe("SMS_STOP");
  });

  it("START restores consent that was revoked by an SMS STOP", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    env.TWILIO_VALIDATE_SIGNATURE = false;
    env.TWILIO_SHARED_SMS_NUMBER = SHARED_SENDER;
    const app = buildApp();
    const customer = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: customer,
      businessName: bizAName,
      vapiCallId: `${RUN}-start-1`,
      affirmative: true
    });
    await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: SHARED_SENDER,
      From: customer,
      Body: "STOP"
    });
    await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: SHARED_SENDER,
      From: customer,
      Body: "START"
    });

    const consent = await prisma.smsConsent.findFirst({
      where: { businessId: bizAId, phoneNumber: customer }
    });
    expect(consent?.status).toBe("OPTED_IN");
  });

  it("HELP returns support info only when app-level replies are enabled", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    env.TWILIO_VALIDATE_SIGNATURE = false;
    env.TWILIO_SHARED_SMS_NUMBER = SHARED_SENDER;
    const app = buildApp();
    const customer = nextPhone();

    // Default: Twilio's (Advanced) Opt-Out replies — no duplicate app reply.
    env.SMS_KEYWORD_APP_REPLIES = false;
    const silent = await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: SHARED_SENDER,
      From: customer,
      Body: "HELP"
    });
    expect(await silent.text()).toBe("<Response></Response>");

    // Explicitly enabled (Twilio keyword handling off): app answers HELP.
    env.SMS_KEYWORD_APP_REPLIES = true;
    const replied = await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: SHARED_SENDER,
      From: customer,
      Body: "HELP"
    });
    const text = await replied.text();
    expect(text).toContain("<Message>");
    expect(text).toContain("info@triven.ai");
  });
});

describe("keyword handling on a business-mapped number", () => {
  it("STOP is scoped to that business only and the AI never replies to it", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    env.TWILIO_VALIDATE_SIGNATURE = false;
    const app = buildApp();
    const customer = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: customer,
      businessName: bizAName,
      vapiCallId: `${RUN}-bizstop-a`,
      affirmative: true
    });
    await recordVerbalSmsConsent({
      businessId: bizBId,
      phoneNumber: customer,
      businessName: `${RUN} Salon`,
      vapiCallId: `${RUN}-bizstop-b`,
      affirmative: true
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: bizANumber,
      From: customer,
      Body: "STOP"
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<Response></Response>");
    expect(fetchMock).not.toHaveBeenCalled();

    const consentA = await prisma.smsConsent.findFirst({ where: { businessId: bizAId, phoneNumber: customer } });
    const consentB = await prisma.smsConsent.findFirst({ where: { businessId: bizBId, phoneNumber: customer } });
    expect(consentA?.status).toBe("OPTED_OUT");
    expect(consentB?.status).toBe("OPTED_IN");
  });
});

/* --------------------------- webhook validation --------------------------- */

describe("inbound-sms webhook signature validation stays enforced", () => {
  it("rejects an unsigned request when validation is enabled", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    env.TWILIO_VALIDATE_SIGNATURE = true;
    env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    const app = buildApp();

    const response = await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: bizANumber,
      From: nextPhone(),
      Body: "STOP"
    });
    expect(response.status).toBe(403);
  });

  it("accepts a correctly signed request", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    env.TWILIO_VALIDATE_SIGNATURE = true;
    env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    const app = buildApp();

    const params = { To: bizANumber, From: nextPhone(), Body: "STOP" };
    const url = `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/twilio/inbound-sms`;
    const response = await postForm(app, "/architect/connectors/twilio/inbound-sms", params, {
      "X-Twilio-Signature": twilioSign(url, params)
    });
    expect(response.status).toBe(200);
  });
});
