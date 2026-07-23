/**
 * SMS → execution attribution and the provider-accepted billable rule (real
 * local DB; suite skips when unreachable).
 *
 * Billable rule: FAILED/SUPPRESSED/SIMULATED never bill; QUEUED bills only
 * with a messageSid (a bare local QUEUED row that never reached Twilio must
 * not be billed); UNDELIVERED bills (Twilio accepted + charged). Attribution:
 * direct vapiCallId, legacy send_notification dedupeKey (customer leg only),
 * and appointment-confirmation via the conversation — each SMS counted at most
 * once, never against a different call.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  countBillableCustomerSms,
  countStandaloneBillableSms,
  providerAcceptedSmsWhere
} from "./usage-billing";

const RUN = `smsattr-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let appointmentId = "";

const CONV_ID = `${RUN}-conv-1`;

let sidCounter = 0;
function sid(): string {
  sidCounter += 1;
  return `${RUN}-sid-${sidCounter}`;
}

function callRef(tag: string): string {
  return `${RUN}-call-${tag}-${randomUUID().slice(0, 8)}`;
}

type SmsRowInput = {
  status?: "QUEUED" | "ACCEPTED" | "SENDING" | "SENT" | "DELIVERED" | "UNDELIVERED" | "FAILED" | "SIMULATED" | "SUPPRESSED";
  messageSid?: string | null;
  vapiCallId?: string | null;
  dedupeKey?: string | null;
  appointmentId?: string | null;
  messageType?:
    | "APPOINTMENT_CONFIRMATION"
    | "APPOINTMENT_CANCELLATION"
    | "TEST_SMS"
    | "MISSED_CALL_TEXT_BACK"
    | "WORKFLOW_SMS"
    | "TEAM_NOTIFICATION";
  createdAt?: Date;
};

async function createSms(input: SmsRowInput) {
  return prisma.smsExecution.create({
    data: {
      businessId,
      toPhone: "+15555550111",
      fromPhone: "+17252202182",
      body: `${RUN} test sms`,
      status: input.status ?? "SENT",
      messageSid: input.messageSid === undefined ? sid() : input.messageSid,
      vapiCallId: input.vapiCallId ?? null,
      dedupeKey: input.dedupeKey ?? `${RUN}-dedupe-${randomUUID()}`,
      appointmentId: input.appointmentId ?? null,
      messageType: input.messageType ?? "WORKFLOW_SMS",
      ...(input.createdAt ? { createdAt: input.createdAt } : {})
    }
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[sms-attribution.test] database unreachable — suite skipped");
    return;
  }

  ownerId = (
    await prisma.user.create({ data: { email: `${RUN}-owner@test.local`, role: "BUSINESS" } })
  ).id;
  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} Biz`, type: "dental" } })
  ).id;

  // Appointment.conversationId is a bare scalar (no FK) — no Conversation row
  // is required by the schema for this linkage.
  appointmentId = (
    await prisma.appointment.create({
      data: {
        businessId,
        conversationId: CONV_ID,
        customerPhone: "+15555550111",
        startAt: new Date("2026-08-01T17:00:00.000Z"),
        endAt: new Date("2026-08-01T17:30:00.000Z")
      }
    })
  ).id;
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.smsExecution.deleteMany({ where: { businessId } });
  await prisma.appointment.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("countBillableCustomerSms — attribution", () => {
  it("counts a direct vapiCallId match (SENT + messageSid)", async () => {
    if (!dbAvailable) return;
    const callId = callRef("direct");
    await createSms({ vapiCallId: callId, status: "SENT" });
    expect(await countBillableCustomerSms(callId, null)).toBe(1);
  });

  it("counts a legacy send_notification:{callId}:customer dedupeKey row without vapiCallId", async () => {
    if (!dbAvailable) return;
    const callId = callRef("legacy");
    await createSms({
      vapiCallId: null,
      dedupeKey: `send_notification:${callId}:customer`,
      status: "SENT"
    });
    expect(await countBillableCustomerSms(callId, null)).toBe(1);
  });

  it("a row matched by BOTH vapiCallId and dedupeKey is counted ONCE", async () => {
    if (!dbAvailable) return;
    const callId = callRef("both");
    await createSms({
      vapiCallId: callId,
      dedupeKey: `send_notification:${callId}:customer`,
      status: "DELIVERED"
    });
    expect(await countBillableCustomerSms(callId, null)).toBe(1);
  });

  it("never counts the :team dedupe leg or TEAM_NOTIFICATION rows", async () => {
    if (!dbAvailable) return;
    const callId = callRef("team");
    await createSms({
      vapiCallId: null,
      dedupeKey: `send_notification:${callId}:team`,
      status: "SENT"
    });
    await createSms({ vapiCallId: callId, messageType: "TEAM_NOTIFICATION", status: "SENT" });
    expect(await countBillableCustomerSms(callId, null)).toBe(0);
  });

  it("bare QUEUED without messageSid is NOT billable (crash before the provider call)", async () => {
    if (!dbAvailable) return;
    const callId = callRef("bare-queued");
    await createSms({ vapiCallId: callId, status: "QUEUED", messageSid: null });
    expect(await countBillableCustomerSms(callId, null)).toBe(0);
  });

  it("QUEUED with messageSid and UNDELIVERED are billable; FAILED/SUPPRESSED/SIMULATED never are", async () => {
    if (!dbAvailable) return;
    const queuedCall = callRef("queued-sid");
    await createSms({ vapiCallId: queuedCall, status: "QUEUED" });
    expect(await countBillableCustomerSms(queuedCall, null)).toBe(1);

    const undeliveredCall = callRef("undelivered");
    await createSms({ vapiCallId: undeliveredCall, status: "UNDELIVERED" });
    expect(await countBillableCustomerSms(undeliveredCall, null)).toBe(1);

    const deadCall = callRef("dead");
    await createSms({ vapiCallId: deadCall, status: "FAILED" }); // even with a sid
    await createSms({ vapiCallId: deadCall, status: "SUPPRESSED", messageSid: null });
    await createSms({ vapiCallId: deadCall, status: "SIMULATED", messageSid: null });
    expect(await countBillableCustomerSms(deadCall, null)).toBe(0);
  });

  it("counts appointment confirmations via the conversation, but never one owned by a DIFFERENT call", async () => {
    if (!dbAvailable) return;
    const callId = callRef("confirm");
    const otherCallId = callRef("confirm-other");

    // Unattributed confirmation on the conversation's appointment → counted.
    await createSms({
      appointmentId,
      messageType: "APPOINTMENT_CONFIRMATION",
      status: "DELIVERED",
      vapiCallId: null
    });
    expect(await countBillableCustomerSms(callId, CONV_ID)).toBe(1);

    // Same appointment, but directly attributed to ANOTHER call → still 1 here.
    await createSms({
      appointmentId,
      messageType: "APPOINTMENT_CONFIRMATION",
      status: "DELIVERED",
      vapiCallId: otherCallId
    });
    expect(await countBillableCustomerSms(callId, CONV_ID)).toBe(1);
    // ...and the other call counts its own confirmation exactly once (direct
    // match; the conversation path excludes already-counted rows).
    expect(await countBillableCustomerSms(otherCallId, CONV_ID)).toBe(2);
  });

  it("the dedupeKey unique constraint blocks double-billing: duplicate create → P2002, count stays 1", async () => {
    if (!dbAvailable) return;
    const callId = callRef("dupe");
    const dedupeKey = `send_notification:${callId}:customer`;
    await createSms({ vapiCallId: null, dedupeKey, status: "SENT" });

    let error: unknown = null;
    try {
      await createSms({ vapiCallId: null, dedupeKey, status: "SENT" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");

    expect(await countBillableCustomerSms(callId, null)).toBe(1);
  });
});

describe("countStandaloneBillableSms", () => {
  const start = new Date("2026-05-01T00:00:00.000Z");
  const end = new Date("2026-05-02T00:00:00.000Z");
  const inWindow = new Date("2026-05-01T12:00:00.000Z");

  it("counts provider-accepted period SMS with no call/appointment link; call-linked and send_notification rows are excluded", async () => {
    if (!dbAvailable) return;

    // Standalone provider-accepted → counted.
    await createSms({ status: "SENT", createdAt: inWindow });
    // Same shape but linked to a call → excluded (belongs to that execution).
    await createSms({ status: "SENT", createdAt: inWindow, vapiCallId: callRef("standalone") });
    // Call-scoped send_notification key → excluded.
    await createSms({
      status: "SENT",
      createdAt: inWindow,
      dedupeKey: `send_notification:${callRef("standalone-key")}:customer`
    });
    // Team SMS in window → excluded.
    await createSms({ status: "SENT", createdAt: inWindow, messageType: "TEAM_NOTIFICATION" });
    // Bare local QUEUED in window → excluded (never reached the provider).
    await createSms({ status: "QUEUED", messageSid: null, createdAt: inWindow });

    expect(await countStandaloneBillableSms(businessId, { start, end })).toBe(1);
  });
});

describe("providerAcceptedSmsWhere", () => {
  it("admits provider-reported/sid-carrying rows only — bare QUEUED and terminal non-billables are out", async () => {
    if (!dbAvailable) return;
    const marker = `${RUN}-where-probe`;
    const accepted = await createSms({ status: "ACCEPTED", messageSid: null, dedupeKey: `${marker}-1` });
    const bareQueued = await createSms({ status: "QUEUED", messageSid: null, dedupeKey: `${marker}-2` });
    const failed = await createSms({ status: "FAILED", dedupeKey: `${marker}-3` });

    const matched = await prisma.smsExecution.findMany({
      where: {
        AND: [providerAcceptedSmsWhere(), { dedupeKey: { startsWith: marker } }]
      },
      select: { id: true }
    });
    const matchedIds = matched.map((row) => row.id);
    // ACCEPTED without a sid still counts (provider-reported status).
    expect(matchedIds).toContain(accepted.id);
    expect(matchedIds).not.toContain(bareQueued.id);
    expect(matchedIds).not.toContain(failed.id);
  });
});
