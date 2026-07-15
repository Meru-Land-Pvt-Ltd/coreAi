import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { handleTwilioInboundSms, handleTwilioVoice } from "../architect/twilio-business-routing";
import { businessRoutes } from "./routes";

/**
 * Buyer pause/resume: the endpoints are owner-scoped, and a PAUSED agent
 * actually stops responding on its number (no AI answer, no AI SMS reply).
 * Runs against the local dev database; skipped when it is down. No provider
 * calls — fetch is stubbed.
 */

const RUN = `pausetest-${process.pid}-${Date.now().toString(36)}`;
const agentNumber = `+1781${String(Date.now()).slice(-7)}`;

let dbAvailable = false;
let ownerToken = "";
let strangerToken = "";
let businessId = "";
let installedAgentId = "";

const originalEnv = {
  TWILIO_VALIDATE_SIGNATURE: env.TWILIO_VALIDATE_SIGNATURE,
  TWILIO_SHARED_SMS_NUMBER: env.TWILIO_SHARED_SMS_NUMBER
};

function buildApp() {
  const app = new Hono();
  app.route("/business", businessRoutes);
  app.post("/architect/connectors/twilio/voice", handleTwilioVoice);
  app.post("/architect/connectors/twilio/inbound-sms", handleTwilioInboundSms);
  return app;
}

function postForm(app: Hono, path: string, params: Record<string, string>) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
}

function postJson(app: Hono, path: string, token: string) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: "{}"
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[agent-pause.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}-owner@test.local`, role: "BUSINESS" } });
  const stranger = await prisma.user.create({ data: { email: `${RUN}-other@test.local`, role: "BUSINESS" } });
  ownerToken = await createAuthToken({ id: owner.id, email: owner.email, role: "BUSINESS" });
  strangerToken = await createAuthToken({ id: stranger.id, email: stranger.email, role: "BUSINESS" });

  const business = await prisma.business.create({
    data: { ownerId: owner.id, name: `${RUN} Clinic`, type: "Dental Practice" }
  });
  businessId = business.id;

  const workflow = await prisma.workflowDefinition.create({
    data: { architectUserId: owner.id, name: `${RUN} workflow`, workflowJson: { nodes: [], edges: [] } as never }
  });

  const agent = await prisma.installedAgent.create({
    data: { businessId, workflowId: workflow.id, name: `${RUN} agent`, status: "ACTIVE" }
  });
  installedAgentId = agent.id;

  await prisma.businessPhoneNumber.create({
    data: { businessId, installedAgentId, phoneNumber: agentNumber, isActive: true }
  });
}, 30_000);

afterAll(async () => {
  if (dbAvailable && businessId) {
    await prisma.conversation.deleteMany({ where: { businessId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { businessId } });
    await prisma.installedAgent.deleteMany({ where: { businessId } });
    await prisma.workflowDefinition.deleteMany({ where: { name: `${RUN} workflow` } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  }
  await prisma.$disconnect();
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe("pause/resume endpoints", () => {
  it("another business owner can never pause this agent", async () => {
    if (!dbAvailable) return;
    const response = await postJson(buildApp(), `/business/agents/${installedAgentId}/pause`, strangerToken);
    expect(response.status).toBe(404);
  });

  it("the owner can pause, and the paused agent stops responding on its number", async () => {
    if (!dbAvailable) return;
    env.TWILIO_VALIDATE_SIGNATURE = false;
    env.TWILIO_SHARED_SMS_NUMBER = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = buildApp();

    const paused = await postJson(app, `/business/agents/${installedAgentId}/pause`, ownerToken);
    expect(paused.status).toBe(200);
    const pausedJson = (await paused.json()) as { data?: { status?: string } };
    expect(pausedJson.data?.status).toBe("PAUSED");

    // Voice: the AI never answers a paused agent (no forwarding configured →
    // polite unavailable message, not the "not deployed" copy).
    const voice = await postForm(app, "/architect/connectors/twilio/voice", {
      To: agentNumber,
      From: "+15557654321",
      CallSid: `CA-${RUN}`
    });
    expect(voice.status).toBe(200);
    expect(await voice.text()).toContain("temporarily unavailable");

    // Inbound SMS: recorded for later, but never answered — no Twilio request.
    const sms = await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: agentNumber,
      From: "+15557654321",
      Body: "Are you open tomorrow?"
    });
    expect(sms.status).toBe(200);
    expect(await sms.text()).toBe("<Response></Response>");
    expect(fetchMock).not.toHaveBeenCalled();

    const conversation = await prisma.conversation.findFirst({
      where: { businessId, customerPhone: "+15557654321" },
      include: { messages: true }
    });
    expect(conversation?.messages.some((m) => m.direction === "INBOUND")).toBe(true);
    expect(conversation?.messages.some((m) => m.direction === "OUTBOUND")).toBe(false);
  });

  it("the owner can resume the paused agent", async () => {
    if (!dbAvailable) return;
    const response = await postJson(buildApp(), `/business/agents/${installedAgentId}/resume`, ownerToken);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data?: { status?: string } };
    expect(json.data?.status).toBe("ACTIVE");

    const agent = await prisma.installedAgent.findUnique({ where: { id: installedAgentId } });
    expect(agent?.status).toBe("ACTIVE");
  });
});
