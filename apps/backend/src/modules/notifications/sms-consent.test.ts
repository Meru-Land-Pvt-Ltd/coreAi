import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SMS_CONSENT_DISCLOSURE_VERSION, verbalSmsConsentDisclosure } from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import {
  applySmsOptOut,
  applySmsReOptIn,
  canSendTransactionalSms,
  classifyInboundSmsKeyword,
  getSmsConsentStatusLabel,
  maskPhone,
  messagingProgramForMessageType,
  recordVerbalSmsConsent,
  recordWebFormSmsConsent,
  smsDisclosureHash,
  SMS_MESSAGING_PROGRAM_TRANSACTIONAL_BOOKING as PROGRAM
} from "./sms-consent";
import { sendTrackedSms } from "./sms-notification-service";

/**
 * SMS consent — the compliance core. Pure classification/template tests need
 * no DB; consent-record and send-gate suites run against the local dev
 * database (skipped when unreachable) with Twilio stubbed via global fetch.
 */

const RUN = `smsconsent-${process.pid}-${Date.now().toString(36)}`;

const originalEnv = {
  TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY_SID: env.TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET: env.TWILIO_API_KEY_SECRET,
  TWILIO_MESSAGING_SERVICE_SID: env.TWILIO_MESSAGING_SERVICE_SID,
  TWILIO_SMS_MODE: env.TWILIO_SMS_MODE,
  TWILIO_TEST_MODE: env.TWILIO_TEST_MODE
};

let dbAvailable = false;
let bizAId = "";
let bizBId = "";
let sidCounter = 0;

// Distinct E.164 numbers per test to keep consent rows independent.
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+1616555${String(1000 + phoneCounter).slice(-4)}`;
}

function stubTwilioAccepting() {
  env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
  env.TWILIO_AUTH_TOKEN = "test-auth-token";
  env.TWILIO_API_KEY_SID = undefined;
  env.TWILIO_API_KEY_SECRET = undefined;
  env.TWILIO_MESSAGING_SERVICE_SID = "MGtest0000000000000000000000000000";
  env.TWILIO_SMS_MODE = "LIVE";
  env.TWILIO_TEST_MODE = false;

  const fetchMock = vi.fn(async () => {
    sidCounter += 1;
    return {
      ok: true,
      status: 201,
      json: async () => ({
        sid: `SM${RUN}${sidCounter}`,
        status: "queued",
        messaging_service_sid: "MGtest0000000000000000000000000000",
        num_segments: "1"
      })
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[sms-consent.test] database unreachable — DB suites skipped");
    return;
  }

  const [ownerA, ownerB] = await Promise.all([
    prisma.user.create({ data: { email: `${RUN}-a@test.local`, role: "BUSINESS" } }),
    prisma.user.create({ data: { email: `${RUN}-b@test.local`, role: "BUSINESS" } })
  ]);
  const [bizA, bizB] = await Promise.all([
    prisma.business.create({ data: { ownerId: ownerA.id, name: `${RUN} Dental`, type: "dental" } }),
    prisma.business.create({ data: { ownerId: ownerB.id, name: `${RUN} Salon`, type: "salon" } })
  ]);
  bizAId = bizA.id;
  bizBId = bizB.id;
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    const ids = [bizAId, bizBId].filter(Boolean);
    await prisma.smsExecution.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.smsConsent.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  }
  await prisma.$disconnect();
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

/* ------------------------------- pure tests ------------------------------- */

describe("classifyInboundSmsKeyword", () => {
  it("recognizes STOP keyword variants", () => {
    for (const body of ["STOP", "stop", " Stop ", "UNSUBSCRIBE", "cancel", "END", "quit", "stop."]) {
      expect(classifyInboundSmsKeyword(body)).toBe("STOP");
    }
  });

  it("recognizes START and HELP", () => {
    expect(classifyInboundSmsKeyword("START")).toBe("START");
    expect(classifyInboundSmsKeyword("unstop")).toBe("START");
    expect(classifyInboundSmsKeyword("HELP")).toBe("HELP");
    expect(classifyInboundSmsKeyword("info")).toBe("HELP");
  });

  it("prefers Twilio's OptOutType over body matching", () => {
    expect(classifyInboundSmsKeyword("random text", "STOP")).toBe("STOP");
    expect(classifyInboundSmsKeyword("random text", "HELP")).toBe("HELP");
  });

  it("does not classify normal conversation as a keyword", () => {
    expect(classifyInboundSmsKeyword("please stop by tomorrow")).toBeNull();
    expect(classifyInboundSmsKeyword("can you help me book a slot?")).toBeNull();
    expect(classifyInboundSmsKeyword("")).toBeNull();
    expect(classifyInboundSmsKeyword(null)).toBeNull();
  });
});

describe("maskPhone", () => {
  it("never exposes the full phone number", () => {
    const masked = maskPhone("+15551234567");
    expect(masked).not.toContain("1234567");
    expect(masked).toContain("***");
  });
});

describe("messagingProgramForMessageType", () => {
  it("requires consent for every customer-directed message class", () => {
    expect(messagingProgramForMessageType("APPOINTMENT_CONFIRMATION")).toBe(PROGRAM);
    expect(messagingProgramForMessageType("MISSED_CALL_TEXT_BACK")).toBe(PROGRAM);
    expect(messagingProgramForMessageType("WORKFLOW_SMS")).toBe(PROGRAM);
  });

  it("exempts only owner/staff-directed classes", () => {
    expect(messagingProgramForMessageType("TEST_SMS")).toBeNull();
    expect(messagingProgramForMessageType("TEAM_NOTIFICATION")).toBeNull();
  });
});

/* ------------------------------ consent (DB) ------------------------------ */

describe("verbal consent records (DB)", () => {
  it("a clear verbal yes creates OPTED_IN consent with full evidence", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();

    const outcome = await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-1`,
      affirmative: true
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.consent.status).toBe("OPTED_IN");
    expect(outcome.consent.method).toBe("VERBAL_CALL");
    expect(outcome.consent.consentAt).not.toBeNull();
    expect(outcome.consent.vapiCallId).toBe(`${RUN}-call-1`);
    expect(outcome.consent.businessNamePresented).toBe(`${RUN} Dental`);
    expect(outcome.consent.disclosureVersion).toBe(SMS_CONSENT_DISCLOSURE_VERSION);
    expect(outcome.consent.disclosureHash).toBe(
      smsDisclosureHash(verbalSmsConsentDisclosure(`${RUN} Dental`))
    );

    const auth = await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM });
    expect(auth.allowed).toBe(true);
  });

  it("a verbal no records a decline, not consent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();

    const outcome = await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-2`,
      affirmative: false
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.consent.status).toBe("OPTED_OUT");
    expect(outcome.consent.consentAt).toBeNull();
    expect(outcome.consent.optOutAt).not.toBeNull();

    const auth = await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM });
    expect(auth).toEqual({ allowed: false, reason: "SMS_OPTED_OUT" });
  });

  it("silence/no tool call means no consent exists — sends stay blocked", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    // Ambiguous responses never reach recordVerbalSmsConsent(affirmative=true);
    // with no record at all the authorization check must deny.
    const phone = nextPhone();
    const auth = await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM });
    expect(auth).toEqual({ allowed: false, reason: "SMS_CONSENT_REQUIRED" });
  });

  it("consent for Business A never authorizes Business B", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-3`,
      affirmative: true
    });

    const authA = await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM });
    const authB = await canSendTransactionalSms({ businessId: bizBId, phoneNumber: phone, messagingProgram: PROGRAM });
    expect(authA.allowed).toBe(true);
    expect(authB).toEqual({ allowed: false, reason: "SMS_CONSENT_REQUIRED" });
  });

  it("duplicate consent submissions are idempotent (one row per business+phone+program)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();
    const submit = () =>
      recordVerbalSmsConsent({
        businessId: bizAId,
        phoneNumber: phone,
        businessName: `${RUN} Dental`,
        vapiCallId: `${RUN}-call-4`,
        affirmative: true
      });

    await Promise.all([submit(), submit(), submit()]);
    const rows = await prisma.smsConsent.findMany({ where: { businessId: bizAId, phoneNumber: phone } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("OPTED_IN");
  });

  it("normalizes phone formatting variants onto one consent record", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();
    const decorated = `+1 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;

    const outcome = await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: decorated,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-5`,
      affirmative: true
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.consent.phoneNumber).toBe(phone);

    const auth = await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM });
    expect(auth.allowed).toBe(true);
  });

  it("rejects an ambiguous bare national number instead of guessing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const outcome = await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: "6165551234",
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-6`,
      affirmative: true
    });
    expect(outcome.ok).toBe(false);
  });

  it("web-form consent stores booking id, source URL, and request metadata", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();

    const outcome = await recordWebFormSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      appointmentId: `${RUN}-appt-1`,
      sourceUrl: "https://triven.ai/book/test-slug",
      ipAddress: "203.0.113.10",
      userAgent: "vitest"
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.consent.method).toBe("WEB_FORM");
    expect(outcome.consent.status).toBe("OPTED_IN");
    expect(outcome.consent.appointmentId).toBe(`${RUN}-appt-1`);
    expect(outcome.consent.sourceUrl).toBe("https://triven.ai/book/test-slug");
    expect(outcome.consent.ipAddress).toBe("203.0.113.10");
    expect(outcome.consent.userAgent).toBe("vitest");
  });
});

describe("STOP / START consent sync (DB)", () => {
  it("STOP revokes consent and blocks future sends; START restores it", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-7`,
      affirmative: true
    });

    const optOut = await applySmsOptOut({ phoneNumber: phone, businessId: bizAId, source: "SMS_STOP" });
    expect(optOut.updated).toBe(1);
    expect(
      await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM })
    ).toEqual({ allowed: false, reason: "SMS_OPTED_OUT" });
    expect(await getSmsConsentStatusLabel(bizAId, phone)).toBe("declined");

    const reOptIn = await applySmsReOptIn({ phoneNumber: phone, businessId: bizAId });
    expect(reOptIn.updated).toBe(1);
    const auth = await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM });
    expect(auth.allowed).toBe(true);
    expect(await getSmsConsentStatusLabel(bizAId, phone)).toBe("granted");
  });

  it("a STOP for one business does not alter another business's records", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-8a`,
      affirmative: true
    });
    await recordVerbalSmsConsent({
      businessId: bizBId,
      phoneNumber: phone,
      businessName: `${RUN} Salon`,
      vapiCallId: `${RUN}-call-8b`,
      affirmative: true
    });

    await applySmsOptOut({ phoneNumber: phone, businessId: bizAId, source: "SMS_STOP" });

    const authA = await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM });
    const authB = await canSendTransactionalSms({ businessId: bizBId, phoneNumber: phone, messagingProgram: PROGRAM });
    expect(authA).toEqual({ allowed: false, reason: "SMS_OPTED_OUT" });
    expect(authB.allowed).toBe(true);
  });

  it("START never manufactures consent that did not previously exist", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();

    // A verbal decline (no prior opt-in) must NOT flip to OPTED_IN on START —
    // bare keyword opt-in is not a supported consent method.
    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-9`,
      affirmative: false
    });

    const restored = await applySmsReOptIn({ phoneNumber: phone, businessId: bizAId });
    expect(restored.updated).toBe(0);
    expect(
      await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM })
    ).toEqual({ allowed: false, reason: "SMS_OPTED_OUT" });
  });

  it("START scoped to Business B never restores Business A's revoked consent (cross-business)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const phone = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-xb`,
      affirmative: true
    });
    await applySmsOptOut({ phoneNumber: phone, businessId: bizAId, source: "SMS_STOP" });

    // START arriving in Business B's context restores nothing anywhere.
    const restored = await applySmsReOptIn({ phoneNumber: phone, businessId: bizBId });
    expect(restored.updated).toBe(0);
    expect(
      await canSendTransactionalSms({ businessId: bizAId, phoneNumber: phone, messagingProgram: PROGRAM })
    ).toEqual({ allowed: false, reason: "SMS_OPTED_OUT" });
    expect(
      await canSendTransactionalSms({ businessId: bizBId, phoneNumber: phone, messagingProgram: PROGRAM })
    ).toEqual({ allowed: false, reason: "SMS_CONSENT_REQUIRED" });
  });
});

/* ------------------------------ send gate (DB) ----------------------------- */

describe("central SMS authorization gate (DB)", () => {
  it("no SMS is sent without consent — suppressed with SMS_CONSENT_REQUIRED", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fetchMock = stubTwilioAccepting();
    const phone = nextPhone();

    const outcome = await sendTrackedSms({
      to: phone,
      body: "should never reach Twilio",
      messageType: "WORKFLOW_SMS",
      businessId: bizAId
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.sent).toBe(false);
    expect(outcome.suppressed).toBe(true);
    expect(outcome.errorCode).toBe("SMS_CONSENT_REQUIRED");

    const row = await prisma.smsExecution.findUnique({ where: { id: outcome.executionId! } });
    expect(row?.status).toBe("SUPPRESSED");
    expect(row?.errorCode).toBe("SMS_CONSENT_REQUIRED");
    expect(row?.messageSid).toBeNull();
  });

  it("sends after opt-in, and appends the STOP/HELP notice when missing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fetchMock = stubTwilioAccepting();
    const phone = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-10`,
      affirmative: true
    });

    const outcome = await sendTrackedSms({
      to: phone,
      body: "Your booking is confirmed for Friday.",
      messageType: "WORKFLOW_SMS",
      businessId: bizAId,
      businessName: `${RUN} Dental`,
      smsPurpose: "APPOINTMENT_CONFIRMATION"
    });

    // Even WITH consent: a missing/unknown purpose or missing business
    // identity is blocked before Twilio (campaign purpose allowlist).
    const noPurpose = await sendTrackedSms({
      to: phone,
      body: "free-form message",
      messageType: "WORKFLOW_SMS",
      businessId: bizAId,
      businessName: `${RUN} Dental`
    });
    expect(noPurpose.suppressed).toBe(true);
    expect(noPurpose.errorCode).toBe("SMS_PURPOSE_NOT_ALLOWED");

    const noIdentity = await sendTrackedSms({
      to: phone,
      body: "confirmed for Friday",
      messageType: "WORKFLOW_SMS",
      businessId: bizAId,
      smsPurpose: "APPOINTMENT_CONFIRMATION"
    });
    expect(noIdentity.suppressed).toBe(true);
    expect(noIdentity.errorCode).toBe("SMS_BUSINESS_IDENTITY_REQUIRED");

    expect(outcome.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = await prisma.smsExecution.findUnique({ where: { id: outcome.executionId! } });
    expect(row?.body).toContain("Reply STOP to opt out or HELP for assistance.");
  });

  it("blocks sends after STOP with SMS_OPTED_OUT", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fetchMock = stubTwilioAccepting();
    const phone = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-11`,
      affirmative: true
    });
    await applySmsOptOut({ phoneNumber: phone, businessId: bizAId, source: "SMS_STOP" });

    const outcome = await sendTrackedSms({
      to: phone,
      body: "post opt-out message",
      messageType: "APPOINTMENT_CONFIRMATION",
      businessId: bizAId
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.suppressed).toBe(true);
    expect(outcome.errorCode).toBe("SMS_OPTED_OUT");
  });

  it("consent for Business A does not allow Business B to text the same phone", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fetchMock = stubTwilioAccepting();
    const phone = nextPhone();

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-12`,
      affirmative: true
    });

    const outcome = await sendTrackedSms({
      to: phone,
      body: "cross-business attempt",
      messageType: "WORKFLOW_SMS",
      businessId: bizBId
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.suppressed).toBe(true);
    expect(outcome.errorCode).toBe("SMS_CONSENT_REQUIRED");
  });

  it("a message with no business scope is never sent to a customer program", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fetchMock = stubTwilioAccepting();

    const outcome = await sendTrackedSms({
      to: nextPhone(),
      body: "no business context",
      messageType: "MISSED_CALL_TEXT_BACK",
      businessId: null
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.suppressed).toBe(true);
  });

  it("a suppressed attempt never consumes the dedupe key of a later consented send", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fetchMock = stubTwilioAccepting();
    const phone = nextPhone();
    const dedupeKey = `${RUN}-dedupe-after-consent`;

    const blocked = await sendTrackedSms({
      to: phone,
      body: "first attempt without consent",
      messageType: "WORKFLOW_SMS",
      businessId: bizAId,
      dedupeKey
    });
    expect(blocked.suppressed).toBe(true);

    await recordVerbalSmsConsent({
      businessId: bizAId,
      phoneNumber: phone,
      businessName: `${RUN} Dental`,
      vapiCallId: `${RUN}-call-13`,
      affirmative: true
    });

    const sent = await sendTrackedSms({
      to: phone,
      body: "second attempt with consent",
      messageType: "WORKFLOW_SMS",
      businessId: bizAId,
      businessName: `${RUN} Dental`,
      smsPurpose: "APPOINTMENT_CONFIRMATION",
      dedupeKey
    });
    expect(sent.sent).toBe(true);
    expect(sent.alreadySent).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("TEAM_NOTIFICATION and TEST_SMS remain exempt (owner/staff-directed)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const fetchMock = stubTwilioAccepting();

    const team = await sendTrackedSms({
      to: nextPhone(),
      body: "New booking: Jane, Fri 3pm",
      messageType: "TEAM_NOTIFICATION",
      businessId: bizAId
    });
    const test = await sendTrackedSms({
      to: nextPhone(),
      body: "Test of your appointment confirmations. Reply STOP to opt out.",
      messageType: "TEST_SMS",
      businessId: bizAId
    });

    expect(team.sent).toBe(true);
    expect(test.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
