import { Redis } from "ioredis";
import { VOICE_NODE_TYPES } from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { deployVapiAssistant, isVapiConfigured } from "../architect/vapi-connector";

export const MARKETPLACE_DEMO_PURPOSE = "MARKETPLACE_DEMO";

/** Hard cap per demo call — long enough to evaluate, too short to abuse. */
export const DEMO_MAX_DURATION_SECONDS = 180;

/** Demo starts allowed per buyer per listing per day. */
export const DEMO_DAILY_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export class MarketplaceDemoError extends Error {
  status: 404 | 422 | 429 | 503;
  code: string;

  constructor(message: string, status: 404 | 422 | 429 | 503, code: string) {
    super(message);
    this.name = "MarketplaceDemoError";
    this.status = status;
    this.code = code;
  }
}

export type MarketplaceDemoSession = {
  publicKey: string;
  assistantId: string;
  listingId: string;
  listingName: string;
  assistantName: string;
  demoBusinessName: string;
  maxDurationSeconds: number;
  remainingDemosToday: number;
  demo: true;
};

// ---------------------------------------------------------------------------
// Rate limiting: per buyer+listing daily limit plus a platform-wide daily cap
// (cost control). Counters live in Redis when REDIS_URL is configured so they
// survive restarts and multiple instances; otherwise an in-memory fallback.
// ---------------------------------------------------------------------------
const memoryCounters = new Map<string, { count: number; expiresAt: number }>();

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  if (!env.REDIS_URL) {
    redisClient = null;
    return null;
  }

  try {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false
    });
    redisClient.on("error", (error) => {
      console.warn("[marketplace-demo] redis error (falling back to memory)", error.message);
    });
  } catch (error) {
    console.warn("[marketplace-demo] redis init failed (memory fallback)", error);
    redisClient = null;
  }

  return redisClient;
}

function dayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

function memoryCount(key: string): number {
  const entry = memoryCounters.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    memoryCounters.delete(key);
    return 0;
  }
  return entry.count;
}

function memoryIncrement(key: string) {
  const entry = memoryCounters.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    memoryCounters.set(key, { count: 1, expiresAt: Date.now() + DAY_MS });
    return;
  }
  entry.count += 1;
}

async function readDemoCounts(userKey: string, globalKey: string): Promise<{ user: number; global: number }> {
  const redis = getRedis();

  if (redis) {
    try {
      const [user, global] = await redis.mget(userKey, globalKey);
      return { user: Number(user ?? 0), global: Number(global ?? 0) };
    } catch {
      // Redis down — degrade to the in-memory counters below.
    }
  }

  return { user: memoryCount(userKey), global: memoryCount(globalKey) };
}

async function recordDemoStart(userKey: string, globalKey: string): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      await redis
        .multi()
        .incr(userKey)
        .expire(userKey, DAY_MS / 1000, "NX")
        .incr(globalKey)
        .expire(globalKey, DAY_MS / 1000, "NX")
        .exec();
      return;
    } catch {
      // Redis down — record in memory so the limit still applies locally.
    }
  }

  memoryIncrement(userKey);
  memoryIncrement(globalKey);
}

/** Exposed for tests: clears counters and re-resolves the Redis client. */
export function resetMarketplaceDemoLimits() {
  memoryCounters.clear();
  redisClient?.disconnect();
  redisClient = undefined;
}

// ---------------------------------------------------------------------------
// Per-listing demo assistant reuse — cached in memory, recovered from Vapi by
// metadata on cold start so restarts don't accumulate stray assistants.
// ---------------------------------------------------------------------------
const demoAssistantByListing = new Map<string, string>();

async function findExistingDemoAssistant(listingId: string): Promise<string | null> {
  const cached = demoAssistantByListing.get(listingId);
  if (cached) return cached;

  try {
    const response = await fetch(`${env.VAPI_BASE_URL.replace(/\/$/, "")}/assistant?limit=100`, {
      headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return null;

    const list = (await response.json().catch(() => [])) as Array<Record<string, unknown>>;

    for (const assistant of Array.isArray(list) ? list : []) {
      const metadata =
        assistant.metadata && typeof assistant.metadata === "object"
          ? (assistant.metadata as Record<string, unknown>)
          : {};

      if (
        metadata.purpose === MARKETPLACE_DEMO_PURPOSE &&
        metadata.listingId === listingId &&
        typeof assistant.id === "string"
      ) {
        demoAssistantByListing.set(listingId, assistant.id);
        return assistant.id;
      }
    }
  } catch {
    // Lookup is an optimization only — a fresh assistant is created below.
  }

  return null;
}

// ---------------------------------------------------------------------------
// Demo persona
// ---------------------------------------------------------------------------
type NodeLike = { data?: Record<string, unknown> };

function voiceNodeOf(workflowJson: unknown): Record<string, unknown> | null {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return null;

  const node = (nodes as NodeLike[]).find(
    (n) => (n.data?.type as string) === VOICE_NODE_TYPES.voiceConversation
  );

  return node?.data ? (node.data as Record<string, unknown>) : null;
}

function str(data: Record<string, unknown> | null, key: string, fallback = ""): string {
  const value = data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function demoIndustry(listing: { category: string | null; industryTags: string[] }): string {
  return listing.industryTags[0]?.trim() || listing.category?.trim() || "service";
}

function buildDemoSystemPrompt(params: {
  assistantName: string;
  demoBusinessName: string;
  industry: string;
  listingName: string;
  listingDescription: string;
}): string {
  return [
    `You are ${params.assistantName}, the AI receptionist for ${params.demoBusinessName}, a fictional ${params.industry} business used to demo "${params.listingName}" on the Triven marketplace.`,
    ``,
    `About this agent: ${params.listingDescription}`,
    ``,
    `DEMO RULES:`,
    `- This is a short live demo for a potential buyer. Greet callers warmly and answer questions the way you would for a real ${params.industry} business.`,
    `- Use plausible sample details (opening hours, common services and prices) for ${params.demoBusinessName}. Make clear they are examples when asked.`,
    `- You cannot actually book appointments, send texts, or send emails in this demo. If the caller asks, walk them through what WOULD happen for a real customer, step by step.`,
    `- If asked about buying the agent: after purchase, the agent is configured with the buyer's real business details, phone number, and calendar.`,
    `- Keep replies short and natural — this is a phone conversation.`
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Start a demo call
// ---------------------------------------------------------------------------
export async function startMarketplaceDemoCall(
  userId: string,
  listingId: string
): Promise<MarketplaceDemoSession> {
  if (!isVapiConfigured() || !env.VAPI_PUBLIC_KEY) {
    throw new MarketplaceDemoError(
      "Live demos are not configured on the server.",
      503,
      "DEMO_NOT_CONFIGURED"
    );
  }

  const listing = await prisma.agentListing.findFirst({
    where: { id: listingId, status: { in: ["APPROVED", "PENDING_REVIEW"] } },
    select: {
      id: true,
      name: true,
      shortDescription: true,
      description: true,
      category: true,
      industryTags: true,
      workflow: { select: { workflowJson: true } }
    }
  });

  if (!listing) {
    throw new MarketplaceDemoError("Listing not found.", 404, "LISTING_NOT_FOUND");
  }

  const voiceNode = voiceNodeOf(listing.workflow?.workflowJson ?? null);

  if (!voiceNode) {
    throw new MarketplaceDemoError(
      "This agent has no voice conversation to demo.",
      422,
      "DEMO_NOT_AVAILABLE"
    );
  }

  const bucket = dayBucket();
  const userKey = `demo:user:${userId}:${listingId}:${bucket}`;
  const globalKey = `demo:global:${bucket}`;
  const counts = await readDemoCounts(userKey, globalKey);

  if (counts.user >= DEMO_DAILY_LIMIT) {
    throw new MarketplaceDemoError(
      "Demo limit reached for today. Buy the agent to keep testing with your own business details.",
      429,
      "DEMO_LIMIT_REACHED"
    );
  }

  if (counts.global >= env.MARKETPLACE_DEMO_GLOBAL_DAILY_LIMIT) {
    throw new MarketplaceDemoError(
      "Live demos are temporarily unavailable — please try again tomorrow, or buy the agent to test it with your own business details.",
      429,
      "DEMO_GLOBAL_LIMIT_REACHED"
    );
  }

  const industry = demoIndustry(listing);
  const assistantName = str(voiceNode, "assistantName", "Ava");
  const demoBusinessName = `Demo ${industry.replace(/^./, (ch) => ch.toUpperCase())} Studio`;

  const systemPrompt = buildDemoSystemPrompt({
    assistantName,
    demoBusinessName,
    industry,
    listingName: listing.name,
    listingDescription: listing.shortDescription || listing.description || "an AI receptionist",
  });

  const firstMessage = `Hi! Thanks for calling ${demoBusinessName}. This is ${assistantName} — this is a live demo, so feel free to ask me anything. How can I help?`;

  const existingAssistantId = await findExistingDemoAssistant(listing.id);

  const assistant = await deployVapiAssistant({
    name: `Marketplace Demo — ${listing.name}`,
    firstMessage,
    systemPrompt,
    model: str(voiceNode, "model", "gpt-4o-mini"),
    voice: str(voiceNode, "voice"),
    voiceProvider: str(voiceNode, "voiceProvider"),
    voiceId: str(voiceNode, "voiceId"),
    language: str(voiceNode, "language"),
    speakingSpeed: str(voiceNode, "speakingSpeed"),
    serverUrl: `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/vapi/webhook`,
    existingAssistantId,
    metadata: { purpose: MARKETPLACE_DEMO_PURPOSE, listingId: listing.id },
    // The demo converses only: no booking, no SMS, no notifications.
    includeTools: { checkAvailability: false, bookAppointment: false, sendNotification: false },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: DEMO_MAX_DURATION_SECONDS,
    recordingEnabled: false
  });

  demoAssistantByListing.set(listing.id, assistant.id);

  // Consume the allowance only after the assistant deployed successfully.
  await recordDemoStart(userKey, globalKey);
  const remainingToday = Math.max(0, DEMO_DAILY_LIMIT - (counts.user + 1));

  console.log("[marketplace-demo] session ready", {
    listingId: listing.id,
    assistantId: assistant.id,
    userId,
    remainingToday
  });

  return {
    publicKey: env.VAPI_PUBLIC_KEY,
    assistantId: assistant.id,
    listingId: listing.id,
    listingName: listing.name,
    assistantName,
    demoBusinessName,
    maxDurationSeconds: DEMO_MAX_DURATION_SECONDS,
    remainingDemosToday: remainingToday,
    demo: true
  };
}
