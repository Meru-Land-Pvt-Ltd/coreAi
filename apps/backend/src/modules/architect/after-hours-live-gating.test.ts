/**
 * LIVE Vapi webhook after-hours gating, end to end: sanitized Vapi-shaped
 * payloads → handleVapiWebhook → server-side tool gate + distributed call
 * state. Real local DB (skips when unreachable); fetch stubbed so no Vapi /
 * Twilio / Google request ever leaves the process. Business hours are left
 * unconfigured → hours state UNKNOWN, which engages the same screening gate
 * without depending on the wall clock.
 */

import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { handleVapiWebhook } from "./twilio-business-routing";
import { readAfterHoursCallState, resetAfterHoursCallStateStore } from "../business/after-hours-call-state";
import { AFTER_HOURS_GATE_CODES } from "@coreai/shared";

const RUN = `ahgate-${process.pid}-${Date.now().toString(36)}`;

// config/env re-imports dotenv, so REDIS_URL can leak back in after the test
// setup deletes it. Force the memory store for deterministic tests
// (marketplace-demo.test pattern) and restore afterwards.
const originalRedisUrl = env.REDIS_URL;

let dbAvailable = false;
let userId = "";
let businessId = "";
let workflowId = "";
let agentId = "";

const GREETING =
  "Thank you for calling California Family Dental Center. Our office is currently closed. I hope everything is okay. Are you calling about a dental emergency, or would you like help scheduling the next available appointment?";
const RED_FLAG_QUESTION =
  "Are you having difficulty breathing, speaking, or swallowing, severe or rapidly increasing swelling around your mouth or neck, heavy bleeding that will not stop, or a serious injury to your face or jaw?";
const INSTRUCTION =
  "This may require immediate medical attention. Please call 911 now or go to the nearest emergency department.";

function app() {
  const instance = new Hono();
  instance.post("/architect/connectors/vapi/webhook", handleVapiWebhook);
  return instance;
}

type Turn = { role: "bot" | "user"; message: string };

function toolCallBody(params: { callId: string; toolName: string; args?: Record<string, unknown>; turns: Turn[] }) {
  return {
    message: {
      type: "tool-calls",
      toolCalls: [
        {
          id: `tc_${Math.random().toString(36).slice(2, 10)}`,
          function: { name: params.toolName, arguments: JSON.stringify(params.args ?? {}) }
        }
      ],
      artifact: { messages: params.turns.map((turn, index) => ({ ...turn, time: index })) },
      call: { id: params.callId, type: "inboundPhoneCall", customer: { number: "+15555550123" } }
    },
    metadata: { businessId, installedAgentId: agentId }
  };
}

async function postWebhook(body: Record<string, unknown>) {
  const response = await app().request("/architect/connectors/vapi/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { results?: Array<{ result: string }>; ok?: boolean; paused?: boolean };
}

function firstResult(payload: { results?: Array<{ result: string }> }): Record<string, unknown> {
  return JSON.parse(payload.results?.[0]?.result ?? "{}") as Record<string, unknown>;
}

beforeAll(async () => {
  env.REDIS_URL = undefined;
  resetAfterHoursCallStateStore();
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[after-hours-live-gating.test] database unreachable — suite skipped");
    return;
  }

  const user = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "BUSINESS", roleMemberships: { create: { role: "BUSINESS" } } }
  });
  userId = user.id;

  businessId = (
    await prisma.business.create({ data: { ownerId: userId, name: `${RUN} Dental`, type: "dental practice" } })
  ).id;
  // No hoursJson → business-hours state UNKNOWN (never a false closed claim,
  // screening still engages deterministically).
  await prisma.businessProfile.create({ data: { businessId, timeZone: "America/Los_Angeles" } });

  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: userId }
    })
  ).id;

  agentId = (
    await prisma.installedAgent.create({
      data: {
        businessId,
        workflowId,
        name: `${RUN} agent`,
        status: "ACTIVE",
        configJson: {
          afterHoursPolicy: {
            enabled: true,
            emergencyScreeningEnabled: true,
            emergencyCategory: "DENTAL",
            emergencyContactMethod: "SMS",
            offerAppointmentBooking: true,
            preferEarliestAvailableSlot: true,
            allowUrgentCallbackRequest: true,
            includeCallbackInStaffAlert: true
          }
        } as never
      }
    })
  ).id;
}, 30_000);

afterAll(async () => {
  env.REDIS_URL = originalRedisUrl;
  resetAfterHoursCallStateStore();
  if (!dbAvailable) return;
  await prisma.vapiCall.deleteMany({ where: { businessId } });
  await prisma.appointment.deleteMany({ where: { businessId } });
  await prisma.workflowRun.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.businessProfile.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  resetAfterHoursCallStateStore();
  // No network request may leave the process during these tests.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response)
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("live server-side tool gating", () => {
  it("blocks booking before screening (greeting only) with a non-fatal explicit code", async () => {
    if (!dbAvailable) return;
    const payload = await postWebhook(
      toolCallBody({ callId: `${RUN}-c1`, toolName: "book_appointment", turns: [{ role: "bot", message: GREETING }] })
    );
    const result = firstResult(payload);
    expect(result.success).toBe(false);
    expect(result.code).toBe(AFTER_HOURS_GATE_CODES.screeningRequired);
  });

  it("blocks availability + booking while POSSIBLE_EMERGENCY and while the warning-sign answer is pending", async () => {
    if (!dbAvailable) return;
    const possible = await postWebhook(
      toolCallBody({
        callId: `${RUN}-c2`,
        toolName: "check_availability",
        turns: [
          { role: "bot", message: GREETING },
          { role: "user", message: "yes" }
        ]
      })
    );
    expect(firstResult(possible).code).toBe(AFTER_HOURS_GATE_CODES.screeningRequired);

    const pending = await postWebhook(
      toolCallBody({
        callId: `${RUN}-c2`,
        toolName: "book_appointment",
        turns: [
          { role: "bot", message: GREETING },
          { role: "user", message: "yes" },
          { role: "bot", message: RED_FLAG_QUESTION }
        ]
      })
    );
    expect(firstResult(pending).code).toBe(AFTER_HOURS_GATE_CODES.redFlagResponseRequired);
  });

  it("red flag: booking and customer SMS blocked until the assistant SPEAKS the instruction; caller saying 'call 911' does not unlock", async () => {
    if (!dbAvailable) return;
    const redFlagTurns: Turn[] = [
      { role: "bot", message: GREETING },
      { role: "user", message: "my mouth is bleeding and it will not stop" }
    ];

    const booking = await postWebhook(
      toolCallBody({ callId: `${RUN}-c3`, toolName: "book_appointment", turns: redFlagTurns })
    );
    expect(firstResult(booking).code).toBe(AFTER_HOURS_GATE_CODES.emergencyInstructionRequired);

    // Caller mentioning 911 must not satisfy the requirement.
    const callerSays911 = await postWebhook(
      toolCallBody({
        callId: `${RUN}-c3`,
        toolName: "book_appointment",
        turns: [...redFlagTurns, { role: "user", message: "should I call 911?" }]
      })
    );
    expect(firstResult(callerSays911).code).toBe(AFTER_HOURS_GATE_CODES.emergencyInstructionRequired);

    // Customer SMS path: send_notification reports the customer text as
    // blocked (the internal staff alert path stays available).
    const notify = await postWebhook(
      toolCallBody({
        callId: `${RUN}-c3`,
        toolName: "send_notification",
        args: { urgency: "emergency" },
        turns: redFlagTurns
      })
    );
    const notifyResult = firstResult(notify);
    expect(notifyResult.customer_sms_sent).toBe(false);
    expect(notifyResult.customer_email_sent ?? false).toBe(false);

    // After the assistant SPOKE the instruction, ordinary booking stays blocked.
    const afterInstruction = await postWebhook(
      toolCallBody({
        callId: `${RUN}-c3`,
        toolName: "book_appointment",
        turns: [...redFlagTurns, { role: "bot", message: INSTRUCTION }]
      })
    );
    expect(firstResult(afterInstruction).code).toBe(AFTER_HOURS_GATE_CODES.bookingBlocked);

    const state = await readAfterHoursCallState(businessId, `${RUN}-c3`);
    expect(state?.route).toBe("RED_FLAG_DETECTED");
    expect(state?.emergencyInstructionStatus).toBe("GIVEN");
  });

  it("clear non-emergency answers route to STANDARD_BOOKING — no gate code on availability", async () => {
    if (!dbAvailable) return;
    const payload = await postWebhook(
      toolCallBody({
        callId: `${RUN}-c4`,
        toolName: "check_availability",
        args: { date: "2099-01-05" },
        turns: [
          { role: "bot", message: GREETING },
          { role: "user", message: "no emergency, I'd just like to schedule a cleaning" }
        ]
      })
    );
    const result = firstResult(payload);
    const code = typeof result.code === "string" ? result.code : "";
    expect(code.startsWith("AFTER_HOURS")).toBe(false);
  });

  it("webhook retries are idempotent and call-ended clears the state", async () => {
    if (!dbAvailable) return;
    const body = toolCallBody({
      callId: `${RUN}-c5`,
      toolName: "book_appointment",
      turns: [
        { role: "bot", message: GREETING },
        { role: "user", message: "yes" }
      ]
    });
    await postWebhook(body);
    const first = await readAfterHoursCallState(businessId, `${RUN}-c5`);
    await postWebhook(body); // duplicate delivery
    const second = await readAfterHoursCallState(businessId, `${RUN}-c5`);
    expect(second?.route).toBe(first?.route);
    expect(second?.redFlags).toEqual(first?.redFlags);

    await postWebhook({
      message: { type: "end-of-call-report", call: { id: `${RUN}-c5`, type: "inboundPhoneCall" } },
      metadata: { businessId, installedAgentId: agentId }
    });
    expect(await readAfterHoursCallState(businessId, `${RUN}-c5`)).toBeNull();
  });

  it("business and call state stay isolated; test-mode (webCall) calls are never gated", async () => {
    if (!dbAvailable) return;
    // Call A hits a red flag; call B on the same business stays independent.
    await postWebhook(
      toolCallBody({
        callId: `${RUN}-c6`,
        toolName: "book_appointment",
        turns: [
          { role: "bot", message: GREETING },
          { role: "user", message: "I cannot breathe properly" }
        ]
      })
    );
    const stateB = await readAfterHoursCallState(businessId, `${RUN}-c7`);
    expect(stateB).toBeNull();

    // webCall → BUSINESS_TEST execution mode → the LIVE gate never engages.
    const webCall = {
      message: {
        type: "tool-calls",
        toolCalls: [{ id: "tc_web", function: { name: "book_appointment", arguments: "{}" } }],
        artifact: { messages: [{ role: "bot", message: GREETING }] },
        call: { id: `${RUN}-c8`, type: "webCall" }
      },
      metadata: { businessId, installedAgentId: agentId }
    };
    const testPayload = await postWebhook(webCall);
    const testResult = firstResult(testPayload);
    const code = typeof testResult.code === "string" ? testResult.code : "";
    expect(code.startsWith("AFTER_HOURS")).toBe(false);
  });
});
