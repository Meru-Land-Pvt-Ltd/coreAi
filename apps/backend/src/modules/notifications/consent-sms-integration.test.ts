/**
 * #5 Consent + SMS database integration (real Prisma + real services, SIMULATED
 * SMS mode — no provider request). Proves recipient integrity across
 * Appointment / SmsConsent / SmsExecution, that a pre-consent send is
 * suppressed (never a successful customer execution), that the confirmation is
 * dedupe-keyed and idempotent, and that consent for one full number never
 * authorizes a different number that merely shares the last four digits.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { resetSharedRedisForTests } from "../../lib/redis";
import {
  sendAppointmentConfirmationSms,
  appointmentConfirmationDedupeKey
} from "./sms-notification-service";
import { recordVerbalSmsConsent, getSmsConsentStatusLabel } from "./sms-consent";
import { runUpdateAppointmentContactTool } from "../architect/twilio-business-routing";
import { updateCallContact, resetCallContactStoreForTests } from "../architect/call-contact-store";

const RUN = `consent-int-${process.pid}-${Date.now().toString(36)}`;
// Two DIFFERENT full E.164 numbers that share the last four (1234).
const PHONE_A = "+16505551234";
const PHONE_B = "+15557891234";

let dbAvailable = false;
let businessId = "";
let installedAgentId = "";
let ownerId = "";
let workflowId = "";
let appointmentId = "";
const savedSmsMode = env.TWILIO_SMS_MODE;

async function makeAppointment(phone: string): Promise<string> {
  const appt = await prisma.appointment.create({
    data: {
      businessId,
      customerPhone: phone,
      customerName: "Jim Test",
      service: "Cleaning",
      startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      status: "BOOKED",
      executionMode: "LIVE",
      timeZone: "America/Los_Angeles"
    },
    select: { id: true }
  });
  return appt.id;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[consent-sms-integration.test] database unreachable — suite skipped");
    return;
  }
  env.TWILIO_SMS_MODE = "SIMULATED"; // never contacts Twilio
  env.REDIS_URL = undefined; // force the call-state store's memory fallback
  resetSharedRedisForTests();
  resetCallContactStoreForTests();

  ownerId = (await prisma.user.create({ data: { email: `${RUN}@t.local`, role: "BUSINESS" } })).id;
  businessId = (await prisma.business.create({ data: { ownerId, name: `${RUN} biz`, type: "dental" } })).id;
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
  appointmentId = await makeAppointment(PHONE_A);
});

afterAll(async () => {
  env.TWILIO_SMS_MODE = savedSmsMode;
  if (!dbAvailable) return;
  await prisma.smsExecution.deleteMany({ where: { businessId } });
  await prisma.smsConsent.deleteMany({ where: { businessId } });
  await prisma.appointment.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

const confirmationArgs = () => ({
  appointmentId,
  businessId,
  installedAgentId,
  vapiCallId: `${RUN}-call`,
  customerName: "Jim Test",
  customerPhone: PHONE_A,
  serviceName: "Cleaning",
  appointmentDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  timeZone: "America/Los_Angeles"
});

describe("#5 consent + SMS integration", () => {
  it("T13: BUSINESS_TEST / ARCHITECT_DRY_RUN + SIMULATED never makes a real provider send", async () => {
    if (!dbAvailable) return;
    const outcome = await sendAppointmentConfirmationSms(confirmationArgs());
    // Either suppressed (no consent yet) or simulated — either way no real sid.
    expect(outcome.messageSid).toBeNull();
  });

  it("T7: a pre-consent confirmation is SUPPRESSED — never a successful customer execution", async () => {
    if (!dbAvailable) return;
    // Fresh appointment so no prior execution/consent interferes.
    const apptId = await makeAppointment(PHONE_A);
    const outcome = await sendAppointmentConfirmationSms({ ...confirmationArgs(), appointmentId: apptId });
    expect(outcome.sent).toBe(false);
    expect(outcome.suppressed).toBe(true);
    expect(outcome.errorCode).toBe("SMS_CONSENT_REQUIRED");
    const exec = await prisma.smsExecution.findUnique({ where: { dedupeKey: appointmentConfirmationDedupeKey(apptId) } });
    expect(exec?.status).toBe("SUPPRESSED");
    expect(exec?.messageSid).toBeNull();
  });

  it("T4/T16: consent persists the appointment's canonical recipient + installedAgentId + vapiCallId", async () => {
    if (!dbAvailable) return;
    const result = await recordVerbalSmsConsent({
      businessId,
      installedAgentId,
      phoneNumber: PHONE_A,
      businessName: "Test Dental",
      vapiCallId: `${RUN}-call`,
      appointmentId,
      affirmative: true
    });
    expect(result.ok).toBe(true);

    const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    const consent = await prisma.smsConsent.findFirst({ where: { businessId, phoneNumber: PHONE_A } });
    expect(consent?.status).toBe("OPTED_IN");
    // Appointment.customerPhone === SmsConsent.phoneNumber (full E.164).
    expect(appt?.customerPhone).toBe(consent?.phoneNumber);
    expect(consent?.appointmentId).toBe(appointmentId);
    expect(consent?.installedAgentId).toBe(installedAgentId);
    expect(consent?.vapiCallId).toBe(`${RUN}-call`);
  });

  it("T3/T6: consent for PHONE_A does NOT authorize PHONE_B (same last-4, different full number)", async () => {
    if (!dbAvailable) return;
    expect(PHONE_A.slice(-4)).toBe(PHONE_B.slice(-4)); // last-4 collide…
    expect(PHONE_A).not.toBe(PHONE_B); // …but they are different numbers.
    expect(await getSmsConsentStatusLabel(businessId, PHONE_A)).toBe("granted");
    expect(await getSmsConsentStatusLabel(businessId, PHONE_B)).toBe("none");
  });

  it("T8/T5: affirmative consent produces exactly ONE confirmation execution whose recipient equals the appointment", async () => {
    if (!dbAvailable) return;
    const outcome = await sendAppointmentConfirmationSms(confirmationArgs());
    expect(outcome.suppressed).toBe(false);
    const execs = await prisma.smsExecution.findMany({
      where: { dedupeKey: appointmentConfirmationDedupeKey(appointmentId) }
    });
    expect(execs).toHaveLength(1);
    // Appointment.customerPhone === SmsExecution.recipient (toPhone), full E.164.
    expect(execs[0]?.toPhone).toBe(PHONE_A);
    expect(execs[0]?.appointmentId).toBe(appointmentId);
    expect(execs[0]?.installedAgentId).toBe(installedAgentId);
  });

  it("T9: a duplicate retry (same dedupeKey) creates NO second SMS", async () => {
    if (!dbAvailable) return;
    await sendAppointmentConfirmationSms(confirmationArgs());
    await sendAppointmentConfirmationSms(confirmationArgs());
    const execs = await prisma.smsExecution.findMany({
      where: { dedupeKey: appointmentConfirmationDedupeKey(appointmentId) }
    });
    expect(execs).toHaveLength(1);
  });

  it("dedupe key is exactly appointment-confirmation:{appointmentId}", () => {
    expect(appointmentConfirmationDedupeKey("abc123")).toBe("appointment-confirmation:abc123");
  });

  it("T-atomic/T2: update_appointment_contact commit atomically moves the recipient + unbinds old-number consent (never transfers)", async () => {
    if (!dbAvailable) return;
    const apptId = await makeAppointment(PHONE_A);
    // Consent granted on the OLD number, bound to this appointment.
    await recordVerbalSmsConsent({
      businessId,
      installedAgentId,
      phoneNumber: PHONE_A,
      businessName: "Test Dental",
      vapiCallId: `${RUN}-upd-call`,
      appointmentId: apptId,
      affirmative: true
    });

    const callId = `${RUN}-upd-call`;
    await updateCallContact(businessId, callId, {
      appointmentId: apptId,
      canonicalPhoneE164: PHONE_A,
      phoneSource: "confirmed"
    });
    const ctx = {
      business: { businessId, businessName: "Test Dental", installedAgentId },
      callId,
      executionMode: "LIVE" as const,
      timeZone: "America/Los_Angeles",
      customerPhone: PHONE_A,
      patientPhone: PHONE_A,
      summary: "",
      transcript: ""
    } as unknown as Parameters<typeof runUpdateAppointmentContactTool>[1];

    // PREPARE: validate corrected number → distributed pending, NO db change.
    const prep = (await runUpdateAppointmentContactTool({ corrected_phone: PHONE_B }, ctx)) as {
      needs_confirmation?: boolean;
    };
    expect(prep.needs_confirmation).toBe(true);
    expect((await prisma.appointment.findUnique({ where: { id: apptId } }))?.customerPhone).toBe(PHONE_A);

    // COMMIT: no phone re-sent — loaded from distributed pending state.
    const commit = (await runUpdateAppointmentContactTool({ confirmed: true }, ctx)) as { updated?: boolean };
    expect(commit.updated).toBe(true);

    // Appointment moved to the new number, atomically.
    expect((await prisma.appointment.findUnique({ where: { id: apptId } }))?.customerPhone).toBe(PHONE_B);
    // OLD-number consent unbound from this appointment; the NEW number has none.
    const oldConsent = await prisma.smsConsent.findFirst({ where: { businessId, phoneNumber: PHONE_A } });
    expect(oldConsent?.appointmentId).toBeNull();
    expect(await getSmsConsentStatusLabel(businessId, PHONE_B)).toBe("none");
  });
});
