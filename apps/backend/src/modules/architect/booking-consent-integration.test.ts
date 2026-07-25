/**
 * #1/#3/#4/#5/#6 — REAL Vapi tool-handler + database integration. Calls the
 * actual runCheckAvailabilityTool / runBookAppointmentTool /
 * runRecordSmsConsentTool handlers against a real Postgres row set, with the
 * Twilio network layer (global.fetch) spied so we can prove zero provider
 * sends. NOT pure helpers, NOT checkExactTime(). The suite FAILS LOUDLY if the
 * database is unavailable — it is never silently counted as passed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { resetSharedRedisForTests } from "../../lib/redis";
import { resolveDefaultLiveVoicePipeline } from "../compliance/workspace-ai-guard";
import {
  runCheckAvailabilityTool,
  runBookAppointmentTool,
  runRecordSmsConsentTool
} from "./twilio-business-routing";
import { resetCallContactStoreForTests } from "./call-contact-store";
import { appointmentConfirmationDedupeKey } from "../notifications/sms-notification-service";
import { getSmsConsentStatusLabel } from "../notifications/sms-consent";
import { markConsentOffered } from "../notifications/consent-offer-store";
import { SMS_CONSENT_DISCLOSURE_VERSION, spokenDateInTimeZone } from "@coreai/shared";
import {
  toAiSafeAvailabilityResult,
  toAiSafeBookingResult
} from "../compliance/ai-safe-results";

const RUN = `bci-${process.pid}-${Date.now().toString(36)}`;
const CALLER = "+16505551234";

// Better White business hours: Mon-Fri 05:00-21:00, Sat & Sun closed.
const BETTER_WHITE_HOURS = [
  { day: "monday", open: "05:00", close: "21:00", closed: false },
  { day: "tuesday", open: "05:00", close: "21:00", closed: false },
  { day: "wednesday", open: "05:00", close: "21:00", closed: false },
  { day: "thursday", open: "05:00", close: "21:00", closed: false },
  { day: "friday", open: "05:00", close: "21:00", closed: false },
  { day: "saturday", open: "00:00", close: "00:00", closed: true },
  { day: "sunday", open: "00:00", close: "00:00", closed: true }
];

// Next Saturday / Monday relative to "now" so min-notice never blocks them.
function nextWeekday(target: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((target - d.getUTCDay() + 7) % 7 || 7) + 7);
  return d.toISOString().slice(0, 10);
}
const SATURDAY = nextWeekday(6);
const MONDAY = nextWeekday(1);

let ownerId = "";
let businessId = "";
let workflowId = "";
let installedAgentId = "";
let fetchSpy: ReturnType<typeof vi.spyOn>;
const savedSmsMode = env.TWILIO_SMS_MODE;
const savedRedis = env.REDIS_URL;

function ctxFor(callId: string, executionMode: "LIVE" | "BUSINESS_TEST" | "ARCHITECT_DRY_RUN" = "LIVE") {
  return {
    business: {
      businessId,
      ownerId,
      businessName: "Better White",
      calendarId: "primary",
      timeZone: "America/Los_Angeles",
      installedAgentId,
      executionMode
    },
    dental: null,
    timeZone: "America/Los_Angeles",
    customerPhone: CALLER,
    patientPhone: CALLER,
    callId,
    summary: "",
    transcript: "",
    executionMode,
    installedAgentId,
    voicePipeline: resolveDefaultLiveVoicePipeline()
  } as unknown as Parameters<typeof runBookAppointmentTool>[1];
}

beforeAll(async () => {
  // REQUIRED DB — fail loudly rather than skip silently (#2).
  await prisma.$queryRaw`SELECT 1`;

  env.TWILIO_SMS_MODE = "SIMULATED";
  env.REDIS_URL = undefined;
  resetSharedRedisForTests();
  resetCallContactStoreForTests();
  // Provider spy: any Twilio API request would go through global.fetch.
  fetchSpy = vi.spyOn(globalThis, "fetch");

  ownerId = (await prisma.user.create({ data: { email: `${RUN}@t.local`, role: "BUSINESS" } })).id;
  businessId = (
    await prisma.business.create({
      data: {
        ownerId,
        name: "Better White",
        type: "dental",
        profile: { create: { hoursJson: BETTER_WHITE_HOURS, timeZone: "America/Los_Angeles" } }
      }
    })
  ).id;
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: ownerId }
    })
  ).id;
  installedAgentId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId, name: `${RUN} agent`, installSource: "FREE_INSTALL" }
    })
  ).id;
});

afterAll(async () => {
  env.TWILIO_SMS_MODE = savedSmsMode;
  env.REDIS_URL = savedRedis;
  fetchSpy?.mockRestore();
  if (!businessId) return;
  await prisma.smsExecution.deleteMany({ where: { businessId } });
  await prisma.smsConsent.deleteMany({ where: { businessId } });
  await prisma.appointment.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

function twilioSendCount() {
  return fetchSpy.mock.calls.filter((c) => String(c[0]).includes("api.twilio.com")).length;
}

// Simulate the assistant having read the disclosure aloud on this call so the
// consent handler's fail-closed disclosure gate is satisfied.
async function offerDisclosure(callId: string) {
  await markConsentOffered({ businessId, callId, disclosureVersion: SMS_CONSENT_DISCLOSURE_VERSION });
}

describe("#1 authoritative business hours via the REAL booking handler", () => {
  it("check_availability for a closed Saturday returns zero slots", async () => {
    const result = (await runCheckAvailabilityTool({ date: SATURDAY }, ctxFor(`${RUN}-s1`))) as {
      closed?: boolean;
      available_slots?: string[];
      total_free_slots?: number;
    };
    expect(result.closed).toBe(true);
    expect(result.available_slots ?? []).toHaveLength(0);
    expect(result.total_free_slots ?? 0).toBe(0);
  });

  it("book_appointment for Saturday 09:00 is rejected (closed_day) and writes NO Appointment row", async () => {
    const before = await prisma.appointment.count({ where: { businessId } });
    const result = (await runBookAppointmentTool(
      { customer_name: "Jim Test", customer_phone: CALLER, date: SATURDAY, time: "09:00", service_type: "Cleaning" },
      ctxFor(`${RUN}-s2`)
    )) as { success?: boolean; verdict?: string };
    expect(result.success).toBe(false);
    expect(result.verdict).toBe("closed_day");
    expect(await prisma.appointment.count({ where: { businessId } })).toBe(before);
  });

  it("book_appointment for a valid Monday 09:00 creates exactly one correct Appointment row", async () => {
    const result = (await runBookAppointmentTool(
      { customer_name: "Jim Test", customer_phone: CALLER, date: MONDAY, time: "09:00", service_type: "Cleaning" },
      ctxFor(`${RUN}-m1`)
    )) as { success?: boolean };
    expect(result.success).toBe(true);
    const rows = await prisma.appointment.findMany({ where: { businessId, status: "BOOKED" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerPhone).toBe(CALLER);
    // The appointment time is the requested Monday 09:00 local — never the call time.
    const localHour = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      hour12: false
    }).format(rows[0]!.startAt);
    expect(localHour).toBe("09");
  });
});

// Book a fresh valid Monday appointment on its own callId + a UNIQUE time so
// slots never collide across tests. Returns {apptId, callId, result}.
let bookHour = 10;
async function bookMonday(tag: string) {
  const callId = `${RUN}-${tag}`;
  const time = `${String(bookHour++).padStart(2, "0")}:00`;
  const result = (await runBookAppointmentTool(
    { customer_name: "Jim Test", customer_phone: CALLER, date: MONDAY, time, service_type: "Cleaning" },
    ctxFor(callId)
  )) as Record<string, unknown>;
  const appt = await prisma.appointment.findFirst({
    where: { businessId, bookingCallId: callId, status: "BOOKED" },
    orderBy: { createdAt: "desc" }
  });
  return { apptId: appt?.id ?? "", callId, result };
}

describe("#4 booking WITHOUT consent creates no customer SMS execution", () => {
  it("book result carries the disclosure + appointment ref + smsAttempted=false", async () => {
    const { result } = await bookMonday("noconsent");
    expect(result.success).toBe(true);
    expect(result.smsAttempted).toBe(false);
    expect(result.required_disclosure).toBeTruthy();
    expect(result.appointment_ref).toBeTruthy();
  });

  it("querying SmsExecution after booking proves NO confirmation and NO suppressed row, and zero provider sends", async () => {
    const startProviderCalls = twilioSendCount();
    const { apptId } = await bookMonday("noconsent2");
    const execs = await prisma.smsExecution.findMany({ where: { appointmentId: apptId } });
    expect(execs).toHaveLength(0); // booking created NO execution at all (not even SUPPRESSED)
    expect(twilioSendCount()).toBe(startProviderCalls); // no real Twilio send
  });
});

describe("#3 record_sms_consent tool handler — canonical recipient, ignores injected phone", () => {
  it("ignores a model-injected phone, loads Appointment.customerPhone, and persists that as the consent recipient", async () => {
    const { apptId, callId } = await bookMonday("consent1");
    await offerDisclosure(callId);
    // Inject bogus phone fields the model must NEVER be trusted for.
    const res = (await runRecordSmsConsentTool(
      { appointment_id: apptId, affirmative: true, phone: "+19998887777", customer_phone: "+15550009999" },
      ctxFor(callId)
    )) as { consent_recorded?: boolean; masked_recipient?: string };
    expect(res.consent_recorded).toBe(true);

    const appt = await prisma.appointment.findUnique({ where: { id: apptId } });
    const consent = await prisma.smsConsent.findFirst({ where: { businessId, appointmentId: apptId } });
    // SmsConsent.phoneNumber === Appointment.customerPhone (the caller), NOT the injected numbers.
    expect(consent?.phoneNumber).toBe(appt?.customerPhone);
    expect(consent?.phoneNumber).toBe(CALLER);
    expect(consent?.phoneNumber).not.toBe("+19998887777");
    expect(consent?.phoneNumber).not.toBe("+15550009999");
    // A different number sharing the last four remains a different, unconsented number.
    expect(await getSmsConsentStatusLabel(businessId, "+15557891234")).toBe("none");
  });
});

describe("#5 consent → exactly one send; no messageSid ≠ submitted; retries idempotent", () => {
  it("SIMULATED (no messageSid): confirmation_sms_sent=false and NEVER says 'submitted'; one execution; retry adds none; zero provider sends", async () => {
    const startProviderCalls = twilioSendCount();
    const { apptId, callId } = await bookMonday("send1");
    await offerDisclosure(callId);
    const res = (await runRecordSmsConsentTool({ appointment_id: apptId, affirmative: true }, ctxFor(callId))) as {
      confirmation_sms_sent?: boolean;
      smsProviderAccepted?: boolean;
      smsMessageSidPresent?: boolean;
      customerSafeMessage?: string;
      message?: string;
    };
    // No stored messageSid → not submitted.
    expect(res.smsMessageSidPresent).toBe(false);
    expect(res.confirmation_sms_sent).toBe(false);
    expect(res.smsProviderAccepted).toBe(false);
    expect(res.customerSafeMessage ?? "").not.toContain("submitted");
    expect(JSON.stringify(res)).not.toContain("Your confirmation text has been submitted");

    // The SmsExecution recipient equals the appointment's canonical number.
    const execs = await prisma.smsExecution.findMany({
      where: { dedupeKey: appointmentConfirmationDedupeKey(apptId) }
    });
    expect(execs).toHaveLength(1);
    expect(execs[0]?.toPhone).toBe(CALLER);

    // Retry the tool — no second execution, no extra provider send.
    await runRecordSmsConsentTool({ appointment_id: apptId, affirmative: true }, ctxFor(callId));
    const after = await prisma.smsExecution.findMany({
      where: { dedupeKey: appointmentConfirmationDedupeKey(apptId) }
    });
    expect(after).toHaveLength(1);
    expect(twilioSendCount()).toBe(startProviderCalls);
  });
});

describe("#6 execution modes — the real provider send is called zero times", () => {
  it("BUSINESS_TEST: book + consent make zero Twilio sends", async () => {
    const start = twilioSendCount();
    const callId = `${RUN}-bt`;
    await runBookAppointmentTool(
      { customer_name: "Jim Test", customer_phone: CALLER, date: MONDAY, time: "13:00", service_type: "Cleaning" },
      ctxFor(callId, "BUSINESS_TEST")
    );
    await runRecordSmsConsentTool({ appointment_id: "x", affirmative: true }, ctxFor(callId, "BUSINESS_TEST"));
    expect(twilioSendCount()).toBe(start);
  });

  it("ARCHITECT_DRY_RUN: book + consent make zero Twilio sends", async () => {
    const start = twilioSendCount();
    const callId = `${RUN}-adr`;
    await runBookAppointmentTool(
      { customer_name: "Jim Test", customer_phone: CALLER, date: MONDAY, time: "14:00", service_type: "Cleaning" },
      ctxFor(callId, "ARCHITECT_DRY_RUN")
    );
    await runRecordSmsConsentTool({ appointment_id: "x", affirmative: true }, ctxFor(callId, "ARCHITECT_DRY_RUN"));
    expect(twilioSendCount()).toBe(start);
  });

  it("SIMULATED (LIVE mode + SIMULATED sms): a real consent+send makes zero Twilio provider calls", async () => {
    const start = twilioSendCount();
    const { apptId, callId } = await bookMonday("sim");
    await offerDisclosure(callId);
    await runRecordSmsConsentTool({ appointment_id: apptId, affirmative: true }, ctxFor(callId));
    expect(twilioSendCount()).toBe(start);
  });
});

// A fully-spelled spoken date: "Saturday, July twenty-fifth" — weekday, full
// month, ordinal WORD. No digits.
const SPOKEN_DATE_RE =
  /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (January|February|March|April|May|June|July|August|September|October|November|December) (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|twenty-fifth|twenty-sixth|twenty-seventh|twenty-eighth|twenty-ninth|thirtieth|thirty-first)$/;
// The mangling TTS forms we must NEVER emit into a voice field.
const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/;
const ABBREV_DATE_RE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;

describe("date resolution honors the explicit date argument, never a stale transcript", () => {
  // Reproduces the production loop where an early "any appointment today?" pinned
  // EVERY later check_availability to that same closed day, ignoring the date the
  // model actually requested.
  const POISON_TRANSCRIPT =
    "AI: We're closed. User: any appointment available for today? " +
    "AI: closed Sunday. User: yes today please. AI: Sunday. Monday. Tuesday. tomorrow.";

  it("check_availability with a Monday date arg ignores a transcript full of 'today'/weekday and returns the Monday", async () => {
    const ctx = ctxFor(`${RUN}-dr-avail`);
    (ctx as unknown as { transcript: string }).transcript = POISON_TRANSCRIPT;
    const res = (await runCheckAvailabilityTool({ date: MONDAY, service_type: "Cleaning" }, ctx)) as Record<string, unknown>;
    expect(res.date).toBe(MONDAY); // the requested day, NOT 'today'
    expect(res.closed).not.toBe(true);
    expect((res.available_slots as string[] | undefined)?.length ?? 0).toBeGreaterThan(0);
  });

  it("book_appointment with a Monday date arg ignores the transcript and books the Monday", async () => {
    const ctx = ctxFor(`${RUN}-dr-book`);
    (ctx as unknown as { transcript: string }).transcript = POISON_TRANSCRIPT;
    const res = (await runBookAppointmentTool(
      { customer_name: "Date Test", customer_phone: CALLER, date: MONDAY, time: "16:00", service_type: "Cleaning" },
      ctx
    )) as Record<string, unknown>;
    expect(res.success).toBe(true);
    const appt = await prisma.appointment.findFirst({
      where: { businessId, customerName: "Date Test" },
      orderBy: { createdAt: "desc" }
    });
    const bookedYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(appt!.startAt);
    expect(bookedYmd).toBe(MONDAY); // booked the requested Monday, never 'today'
  });
});

describe("#9 spoken dates in every voice-facing tool field", () => {
  it("check_availability (closed Saturday) surfaces a spoken date and the model message reads 'For <spoken>:'", async () => {
    const res = (await runCheckAvailabilityTool(
      { date: SATURDAY, service_type: "Cleaning" },
      ctxFor(`${RUN}-sd-avail`)
    )) as Record<string, unknown>;

    const spoken = String(res.spoken_date ?? "");
    expect(spoken).toMatch(/^Saturday, /);
    expect(spoken).toMatch(SPOKEN_DATE_RE);
    // The raw voice message names the day in the spoken form, not digits.
    expect(String(res.message)).toContain(spoken);
    expect(String(res.message)).not.toMatch(ISO_DATE_RE);
    expect(String(res.message)).not.toMatch(ABBREV_DATE_RE);

    // The exact string the model is told to say aloud.
    const safe = toAiSafeAvailabilityResult(res);
    expect(safe.spokenDate).toBe(spoken);
    expect(safe.message.startsWith(`For ${spoken}:`)).toBe(true);
    expect(safe.message).not.toMatch(ISO_DATE_RE);
    expect(safe.message).not.toMatch(ABBREV_DATE_RE);
    // Independent oracle: the shared formatter agrees on the Saturday.
    expect(spokenDateInTimeZone(new Date(`${SATURDAY}T19:00:00Z`), "America/Los_Angeles")).toBe(spoken);
  });

  it("book_appointment confirmation speaks the Monday in the spoken form (no numeric/abbreviated date)", async () => {
    const { result } = await bookMonday("sd-book");
    const safe = toAiSafeBookingResult(result as Record<string, unknown>);
    expect(safe.success).toBe(true);
    // The spoken confirmation names Monday in full ordinal words.
    expect(safe.message).toMatch(/Monday, (January|February|March|April|May|June|July|August|September|October|November|December) (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|twenty-fifth|twenty-sixth|twenty-seventh|twenty-eighth|twenty-ninth|thirtieth|thirty-first)/);
    expect(safe.message).not.toMatch(ABBREV_DATE_RE);
  });
});
