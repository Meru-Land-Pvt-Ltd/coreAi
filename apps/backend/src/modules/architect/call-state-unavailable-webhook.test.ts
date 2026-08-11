/**
 * #8 Distributed call-state outage → deterministic fail-closed dispatch.
 *
 * Drives the REAL Vapi webhook (handleVapiWebhook) with the call-contact store
 * forced into production-outage mode (production semantics + no Redis client),
 * so every tool that touches per-call state throws CallStateUnavailableError.
 * The dispatch MUST catch it and return a deterministic safe payload
 * (code CALL_STATE_UNAVAILABLE, HTTP 200 — never an unhandled 500) that tells
 * the assistant NOT to book, change a number, record consent, or send anything.
 * We also prove the outage fails closed BEFORE any write: no Appointment row,
 * no SmsConsent row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { resetSharedRedisForTests } from "../../lib/redis";
import { handleVapiWebhook } from "./twilio-business-routing";
import {
  setCallStateProductionModeForTests,
  resetCallContactStoreForTests
} from "./call-contact-store";

const RUN = `callstate-out-${process.pid}-${Date.now().toString(36)}`;
const CALLER = "+16505551234";

let dbAvailable = false;
let businessId = "";
let installedAgentId = "";
let ownerId = "";
let workflowId = "";

const ALWAYS_OPEN = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
].map((day) => ({ day, closed: false, open: "00:00", close: "23:59" }));

function bookingDateWithinAdvanceWindow(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(date);
}

function buildApp() {
  const app = new Hono();
  app.post("/architect/connectors/vapi/webhook", handleVapiWebhook);
  return app;
}

async function postTool(app: Hono, callId: string, name: string, args: Record<string, unknown>) {
  const payload = {
    message: {
      type: "tool-calls",
      toolCalls: [{ id: `tc_${callId}`, function: { name, arguments: JSON.stringify(args) } }],
      call: { id: callId, customer: { number: CALLER } }
    },
    metadata: { businessId, installedAgentId }
  };
  const response = await app.request("/architect/connectors/vapi/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = (await response.json()) as { results?: Array<{ result: string }> };
  const raw = json.results?.[0]?.result;
  return { status: response.status, result: raw ? (JSON.parse(raw) as Record<string, unknown>) : null };
}

beforeAll(async () => {
  // REQUIRED DB — fail loudly rather than skip silently (#2).
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;

  // No Redis client anywhere; the store's memory fallback is the ONLY backing
  // in test mode — which the production override then refuses to use.
  env.REDIS_URL = undefined;
  resetSharedRedisForTests();
  resetCallContactStoreForTests();

  ownerId = (await prisma.user.create({ data: { email: `${RUN}@t.local`, role: "BUSINESS" } })).id;
  businessId = (await prisma.business.create({ data: { ownerId, name: `${RUN} biz`, type: "dental" } })).id;
  await prisma.businessProfile.create({
    data: {
      businessId,
      timeZone: "America/Los_Angeles",
      services: ["Cleaning"],
      hoursJson: ALWAYS_OPEN as never,
      hoursConfirmedAt: new Date()
    }
  });
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: ownerId }
    })
  ).id;
  installedAgentId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId, name: `${RUN} agent`, status: "ACTIVE" }
    })
  ).id;
});

afterEach(() => {
  // Never let the production override leak into another test.
  setCallStateProductionModeForTests(null);
});

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.smsConsent.deleteMany({ where: { businessId } });
  await prisma.appointment.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { id: installedAgentId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.businessProfile.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("#8 call-state outage — deterministic fail-closed dispatch", () => {
  it("a sanity booking succeeds while the store is healthy (memory fallback, test mode)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const app = buildApp();
    const { status, result } = await postTool(app, `${RUN}-ok`, "book_appointment", {
      customer_name: "Jim Test",
      customer_phone: CALLER,
      date: bookingDateWithinAdvanceWindow(),
      time: "10:00",
      service_type: "Cleaning"
    });
    expect(status).toBe(200);
    // Booking works when the store is available — proves the outage (below) is
    // what fails it, not a broken fixture.
    expect(result?.success).toBe(true);
    const rows = await prisma.appointment.findMany({ where: { businessId, customerName: "Jim Test" } });
    expect(rows.length).toBe(1);
    await prisma.appointment.deleteMany({ where: { businessId, customerName: "Jim Test" } });
  });

  it("book_appointment under outage returns CALL_STATE_UNAVAILABLE, HTTP 200, and writes NO appointment", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    setCallStateProductionModeForTests(true); // production semantics + no Redis => store throws
    const app = buildApp();
    const before = await prisma.appointment.count({ where: { businessId } });
    const { status, result } = await postTool(app, `${RUN}-book-out`, "book_appointment", {
      customer_name: "Outage Caller",
      customer_phone: CALLER,
      date: bookingDateWithinAdvanceWindow(),
      time: "11:00",
      service_type: "Cleaning"
    });

    expect(status).toBe(200); // deterministic tool result, NOT an unhandled 500
    expect(result?.code).toBe("CALL_STATE_UNAVAILABLE");
    expect(result?.success).toBe(false);
    expect(result?.customerSpeechCode).toBe("SYSTEM_UNAVAILABLE");
    expect(String(result?.message)).toMatch(/do not book/i);

    const after = await prisma.appointment.count({ where: { businessId } });
    expect(after).toBe(before); // fail-closed BEFORE any write — no phantom booking
    const named = await prisma.appointment.findMany({ where: { businessId, customerName: "Outage Caller" } });
    expect(named.length).toBe(0);
  });

  it("update_appointment_contact under outage fails closed — CALL_STATE_UNAVAILABLE, never mutates a number", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    // update_appointment_contact reads the per-call state before ANY DB work,
    // so a store outage must fail closed with no phone-number change.
    setCallStateProductionModeForTests(true);
    const app = buildApp();
    const { status, result } = await postTool(app, `${RUN}-update-out`, "update_appointment_contact", {
      appointment_id: "does-not-matter-store-is-down",
      corrected_phone: "+16505559999"
    });

    expect(status).toBe(200);
    expect(result?.code).toBe("CALL_STATE_UNAVAILABLE");
    expect(result?.updated).toBe(false);
    expect(result?.success).toBe(false);
    expect(String(result?.message)).toMatch(/do not book|update a phone number/i);
  });

  it("record_sms_consent under outage records NO consent and never authorizes a send (fail-closed)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    // The consent handler refuses BEFORE it touches per-call state when the
    // disclosure wasn't offered, so it returns a safe non-consent result rather
    // than CALL_STATE_UNAVAILABLE — but either way NO consent is recorded and no
    // send is authorized while the store is down.
    setCallStateProductionModeForTests(true);
    const app = buildApp();
    const before = await prisma.smsConsent.count({ where: { businessId } });
    const { status, result } = await postTool(app, `${RUN}-consent-out`, "record_sms_consent", {
      appointment_id: "does-not-matter-store-is-down",
      affirmative: true
    });

    expect(status).toBe(200);
    expect(result?.consent_recorded).not.toBe(true);
    expect(result?.sms_allowed).not.toBe(true);
    const after = await prisma.smsConsent.count({ where: { businessId } });
    expect(after).toBe(before); // no consent recorded while state is unavailable
  });
});
