import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { VOICE_NODE_TYPES } from "@coreai/shared";
import { env } from "../../config/env";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { businessRoutes } from "./routes";
import {
  DEMO_DAILY_LIMIT,
  DEMO_MAX_DURATION_SECONDS,
  MARKETPLACE_DEMO_PURPOSE,
  PUBLIC_DEMO_DAILY_LIMIT,
  PUBLIC_DEMO_MAX_DURATION_SECONDS,
  resetMarketplaceDemoLimits,
  startMarketplaceDemoCall,
  startPublicMarketplaceDemoCall,
  buildDemoSystemPrompt,
  normalizeDemoCallCustomInfo
} from "./marketplace-demo";


const RUN = `demotest-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;

const createdUserIds: string[] = [];
const createdWorkflowIds: string[] = [];
const createdListingIds: string[] = [];

let buyer = { userId: "", token: "" };
let architectId = "";
let demoListingId = "";
let noVoiceListingId = "";

const originalEnv = {
  VAPI_API_KEY: env.VAPI_API_KEY,
  VAPI_PUBLIC_KEY: env.VAPI_PUBLIC_KEY,
  REDIS_URL: env.REDIS_URL,
  MARKETPLACE_DEMO_GLOBAL_DAILY_LIMIT: env.MARKETPLACE_DEMO_GLOBAL_DAILY_LIMIT
};

type CapturedRequest = { url: string; method: string; body: Record<string, unknown> | null };

function stubVapi(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      captured.push({
        url: String(url),
        method,
        body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null
      });

      if (method === "GET") {
        return { ok: true, status: 200, json: async () => [] };
      }

      return { ok: true, status: 201, json: async () => ({ id: "demo-assistant-test" }) };
    })
  );

  return captured;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[marketplace-demo.test] database unreachable — DB suites skipped");
    return;
  }

  const user = await prisma.user.create({
    data: { email: `${RUN}-buyer@test.local`, role: "BUSINESS" }
  });
  createdUserIds.push(user.id);
  buyer = {
    userId: user.id,
    token: await createAuthToken({ id: user.id, email: user.email, role: "BUSINESS" })
  };

  const architect = await prisma.user.create({
    data: { email: `${RUN}-architect@test.local`, role: "ARCHITECT" }
  });
  createdUserIds.push(architect.id);
  architectId = architect.id;

  const voiceWorkflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: architectId,
      name: `${RUN} voice workflow`,
      workflowJson: {
        nodes: [
          {
            id: "voice-1",
            data: {
              type: VOICE_NODE_TYPES.voiceConversation,
              assistantName: "Demo Ava",
              voice: "adam",
              voiceProvider: "11labs",
              model: "gpt-4o-mini"
            }
          }
        ],
        edges: []
      } as never
    }
  });
  createdWorkflowIds.push(voiceWorkflow.id);

  const emptyWorkflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: architectId,
      name: `${RUN} empty workflow`,
      workflowJson: { nodes: [], edges: [] } as never
    }
  });
  createdWorkflowIds.push(emptyWorkflow.id);

  const demoListing = await prisma.agentListing.create({
    data: {
      name: `${RUN} demo listing`,
      shortDescription: "AI receptionist for demos",
      status: "APPROVED",
      pricingModel: "ONE_TIME",
      priceCents: 4900,
      category: "Dental Clinics",
      industryTags: ["Healthcare", "Dental Clinics", "Dental"],
      architectUserId: architectId,
      workflowId: voiceWorkflow.id,
      requiredConnectors: [],
      supportedLlms: [],
      tags: []
    }
  });
  demoListingId = demoListing.id;
  createdListingIds.push(demoListing.id);

  const noVoiceListing = await prisma.agentListing.create({
    data: {
      name: `${RUN} no-voice listing`,
      shortDescription: "no voice node",
      status: "APPROVED",
      pricingModel: "ONE_TIME",
      priceCents: 4900,
      architectUserId: architectId,
      workflowId: emptyWorkflow.id,
      requiredConnectors: [],
      supportedLlms: [],
      tags: []
    }
  });
  noVoiceListingId = noVoiceListing.id;
  createdListingIds.push(noVoiceListing.id);
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.agentListing.deleteMany({ where: { id: { in: createdListingIds } } });
    await prisma.workflowDefinition.deleteMany({ where: { id: { in: createdWorkflowIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
  resetMarketplaceDemoLimits();
});

function enableVapi() {
  env.VAPI_API_KEY = "vapi-test-key";
  env.VAPI_PUBLIC_KEY = "vapi-test-public";
  // Hermetic tests: force the in-memory counter path (no live Redis).
  env.REDIS_URL = undefined;
}

describe("startMarketplaceDemoCall (DB)", () => {
  it("lets an unpurchased buyer start a sandboxed demo", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    enableVapi();
    const captured = stubVapi();

    const session = await startMarketplaceDemoCall(buyer.userId, demoListingId);

    expect(session.demo).toBe(true);
    expect(session.assistantId).toBe("demo-assistant-test");
    expect(session.publicKey).toBe("vapi-test-public");
    expect(session.maxDurationSeconds).toBe(DEMO_MAX_DURATION_SECONDS);

    const create = captured.find((request) => request.method === "POST");
    expect(create).toBeTruthy();

    const body = create!.body as {
      model: { tools: unknown[] };
      maxDurationSeconds: number;
      artifactPlan: { recordingEnabled: boolean };
      metadata: { purpose: string; listingId: string };
      voice: { provider: string };
    };

    // The demo must give away the experience, not the product.
    expect(body.model.tools).toEqual([]);
    expect(body.maxDurationSeconds).toBe(DEMO_MAX_DURATION_SECONDS);
    expect(body.artifactPlan.recordingEnabled).toBe(false);
    expect(body.metadata.purpose).toBe(MARKETPLACE_DEMO_PURPOSE);
    expect(body.metadata.listingId).toBe(demoListingId);
    expect(body.voice.provider).toBe("11labs");
  });

  it("enforces the per-buyer daily demo limit", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    enableVapi();
    stubVapi();

    for (let index = 0; index < DEMO_DAILY_LIMIT; index += 1) {
      await startMarketplaceDemoCall(buyer.userId, demoListingId);
    }

    await expect(startMarketplaceDemoCall(buyer.userId, demoListingId)).rejects.toMatchObject({
      status: 429,
      code: "DEMO_LIMIT_REACHED"
    });
  });

  it("enforces the platform-wide daily cap across buyers", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    enableVapi();
    env.MARKETPLACE_DEMO_GLOBAL_DAILY_LIMIT = 2;
    stubVapi();

    await startMarketplaceDemoCall(`${RUN}-other-user-1`, demoListingId);
    await startMarketplaceDemoCall(`${RUN}-other-user-2`, demoListingId);

    await expect(startMarketplaceDemoCall(`${RUN}-other-user-3`, demoListingId)).rejects.toMatchObject({
      status: 429,
      code: "DEMO_GLOBAL_LIMIT_REACHED"
    });
  });

  it("rejects listings without a voice conversation", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    enableVapi();
    stubVapi();

    await expect(startMarketplaceDemoCall(buyer.userId, noVoiceListingId)).rejects.toMatchObject({
      status: 422,
      code: "DEMO_NOT_AVAILABLE"
    });
  });

  it("rejects unknown listings", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    enableVapi();
    stubVapi();

    await expect(startMarketplaceDemoCall(buyer.userId, "nonexistent-listing")).rejects.toMatchObject({
      status: 404,
      code: "LISTING_NOT_FOUND"
    });
  });
});

describe("startPublicMarketplaceDemoCall (DB)", () => {
  it("lets a public visitor start a 2-minute IP-limited demo", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    enableVapi();
    stubVapi();

    const session = await startPublicMarketplaceDemoCall("203.0.113.50", demoListingId);

    expect(session.demo).toBe(true);
    expect(session.maxDurationSeconds).toBe(PUBLIC_DEMO_MAX_DURATION_SECONDS);
    expect(session.remainingDemosToday).toBe(PUBLIC_DEMO_DAILY_LIMIT - 1);
  });

  it("supports personalized business details for public demo calls", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    enableVapi();
    const calls = stubVapi();

    const customInfo = {
      businessName: "City General Hospital",
      contactName: "Dr. Gregory House",
      address: "100 Princeton Ave, NJ",
      services: "Diagnostics, Consultations"
    };

    const session = await startPublicMarketplaceDemoCall("203.0.113.88", demoListingId, customInfo);

    expect(session.demo).toBe(true);
    expect(session.demoBusinessName).toBe("City General Hospital");

    // Check captured Vapi payload contains custom firstMessage and system prompt
    const vapiCall = calls.find((c) => c.method === "POST" && c.url.includes("/assistant"));
    if (vapiCall?.body) {
      expect(String(vapiCall.body.firstMessage)).toContain("City General Hospital");
      const model = vapiCall.body.model as { messages?: Array<{ content?: string }> } | undefined;
      expect(String(model?.messages?.[0]?.content ?? "")).toContain("Dr. Gregory House");
    }
  });

  it("enforces 2 demos per IP per listing per day", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    enableVapi();
    stubVapi();

    const ip = "203.0.113.91";
    for (let index = 0; index < PUBLIC_DEMO_DAILY_LIMIT; index += 1) {
      await startPublicMarketplaceDemoCall(ip, demoListingId);
    }

    await expect(startPublicMarketplaceDemoCall(ip, demoListingId)).rejects.toMatchObject({
      status: 429,
      code: "DEMO_LIMIT_REACHED"
    });
  });
});

describe("POST /business/marketplace/listings/:listingId/demo-call (DB)", () => {
  it("returns a demo session for an authenticated buyer without purchase", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    enableVapi();
    stubVapi();

    const app = new Hono();
    app.route("/business", businessRoutes);

    const response = await app.request(`/business/marketplace/listings/${demoListingId}/demo-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${buyer.token}`
      },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data?: { session?: { demo?: boolean; maxDurationSeconds?: number } };
    };
    expect(body.data?.session?.demo).toBe(true);
    expect(body.data?.session?.maxDurationSeconds).toBe(DEMO_MAX_DURATION_SECONDS);
  });
});


describe("normalizeDemoCallCustomInfo", () => {
  it("uses contactName canonically and sanitizes oversized/control-character input", () => {
    const normalized = normalizeDemoCallCustomInfo({
      businessName: "  Morgan\n& Lee Law  ",
      contactName: "Alex\tMorgan",
      services: "x".repeat(800)
    });

    expect(normalized.businessName).toBe("Morgan & Lee Law");
    expect(normalized.contactName).toBe("Alex Morgan");
    expect(normalized.services?.length).toBe(600);
  });

  it("accepts doctorName only as a backward-compatible alias", () => {
    const normalized = normalizeDemoCallCustomInfo({ doctorName: "Dr. Rao" });
    expect(normalized.contactName).toBe("Dr. Rao");
    expect(normalized.doctorName).toBeUndefined();
  });
});

describe("buildDemoSystemPrompt", () => {
  const base = {
    assistantName: "June",
    demoBusinessName: "Demo Dental Studio",
    industry: "Healthcare",
    subindustry: "Dental Clinics",
    listingName: "AI Receptionist",
    listingDescription: "Answers missed calls and books appointments."
  };

  it("frames the call as a live demo and describes the agent", () => {
    const prompt = buildDemoSystemPrompt(base);

    expect(prompt).toContain("LIVE DEMO");
    expect(prompt).toContain("Answers missed calls and books appointments.");
    expect(prompt).toContain("Triven Marketplace browser demo");
    expect(prompt).toContain("hypothetical example");
    expect(prompt).toContain("Subindustry: Dental Clinics");
  });

  it("never tells the agent to deflect questions about itself", () => {
    const prompt = buildDemoSystemPrompt(base);

    expect(prompt).not.toContain("Stay strictly in character");
    expect(prompt).toContain("answer honestly that this is a Triven Marketplace browser demo");
  });

  it("keeps the buyer's personalized details alongside the demo framing", () => {
    const prompt = buildDemoSystemPrompt({
      ...base,
      customInfo: {
        businessName: "Bright Smile Dental",
        contactName: "Dr. Rao",
        address: "12 Park Street",
        services: "Cleaning, Whitening"
      }
    });

    expect(prompt).toContain("Bright Smile Dental");
    expect(prompt).toContain("Dr. Rao");
    expect(prompt).toContain("12 Park Street");
    expect(prompt).toContain("Cleaning, Whitening");
    expect(prompt).toContain("LIVE DEMO");
  });

  it("forbids claiming a text or booking actually happened", () => {
    const prompt = buildDemoSystemPrompt(base);

    expect(prompt).toContain("SANDBOXED in Marketplace Demo");
    expect(prompt).toContain("never claim that a real appointment, message, email, or CRM record was created");
  });

  it("preserves architect safety instructions while adding demo isolation", () => {
    const prompt = buildDemoSystemPrompt({
      ...base,
      industry: "Legal",
      subindustry: "Law Firms",
      baseSystemPrompt: "Never provide legal advice. Escalate requests outside administrative intake."
    });

    expect(prompt).toContain("Never provide legal advice");
    expect(prompt).toContain("Law Firms");
    expect(prompt).toContain("Preserve all safety, compliance, escalation, and scope boundaries");
  });
});
