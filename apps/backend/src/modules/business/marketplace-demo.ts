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

/** Public (logged-out) visitors: shorter calls and fewer of them, keyed by IP. */
export const PUBLIC_DEMO_MAX_DURATION_SECONDS = 120;

/** Public demo starts allowed per IP per listing per day. */
export const PUBLIC_DEMO_DAILY_LIMIT = 2;

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

export type DemoCallCustomInfo = {
  businessName?: string;
  doctorName?: string;
  businessType?: string;
  address?: string;
  services?: string;
};

export type MarketplaceDemoSession = {
  publicKey: string;
  assistantId: string;
  assistantOverrides?: Record<string, unknown>;
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

export function buildDemoSystemPrompt(params: {
  assistantName: string;
  demoBusinessName: string;
  industry: string;
  listingName: string;
  listingDescription: string;
  customInfo?: DemoCallCustomInfo;
}): string {
  const bizName = params.customInfo?.businessName?.trim() || params.demoBusinessName;
  const docName = params.customInfo?.doctorName?.trim();
  const bizType = params.customInfo?.businessType?.trim() || params.industry;
  const address = params.customInfo?.address?.trim();
  const services = params.customInfo?.services?.trim();

  const businessIdentity = docName
    ? `${bizName} (Contact / Practitioner: ${docName})`
    : bizName;

  const lines = [
    `You are ${params.assistantName}, the AI voice receptionist for ${businessIdentity}, a ${bizType} practice/business.`,
    `This call is a short LIVE DEMO of "${params.listingName}" on the Triven marketplace, for someone deciding whether to buy this agent.`,
    ``,
    `About this agent: ${params.listingDescription}`,
    ``
  ];

  if (address) {
    lines.push(`Location / Address: ${address}`);
  }
  if (services) {
    lines.push(`Services offered: ${services}`);
  }

  lines.push(
    ``,
    `DEMO RULES & BEHAVIOR:`,
    `- Answer caller inquiries naturally, warmly, and concisely (1-2 natural sentences per turn) as the dedicated AI receptionist for ${bizName}.`,
    `- Use the exact business details provided above: Business Name (${bizName})${docName ? `, Practitioner Name (${docName})` : ""}${address ? `, Address (${address})` : ""}${services ? `, Services (${services})` : ""}.`,
    `- Play the receptionist role for ordinary caller questions — booking, hours, services, directions — exactly as you would for a real ${bizType}.`,
    `- You ARE allowed to talk about being a demo, and you should when it helps the caller evaluate you. If they ask what this is, whether you are real, how you work, what you can do, or what happens on a real call, answer honestly and briefly as a live demo, then offer to keep going.`,
    `- Any details you were not given above (hours, prices, staff) are plausible examples — say so when a caller asks whether they are real.`,
    `- You cannot actually finalize bookings or send texts on this demo call. Walk the caller through what WOULD happen for a real customer, step by step (e.g. "on a real call I'd take your preferred time, book it into the calendar, and text you a confirmation").`,
    `- If asked about buying or configuring this agent: after purchase it is set up with the buyer's real business phone number, their own business details, and Google Calendar integration.`,
    `- Never pretend a text, booking, or email was actually sent on this call.`
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Start a demo call
// ---------------------------------------------------------------------------

/** Authenticated buyer demo: keyed by user id, 3/day, 3-minute cap. */
export async function startMarketplaceDemoCall(
  userId: string,
  listingId: string,
  customInfo?: DemoCallCustomInfo
): Promise<MarketplaceDemoSession> {
  return startDemoCallInternal({
    scopeKey: `user:${userId}`,
    listingId,
    dailyLimit: DEMO_DAILY_LIMIT,
    maxDurationSeconds: DEMO_MAX_DURATION_SECONDS,
    customInfo
  });
}

/** Public (logged-out) visitor demo: keyed by client IP, 2/day, 2-minute cap. */
export async function startPublicMarketplaceDemoCall(
  clientIp: string,
  listingId: string,
  customInfo?: DemoCallCustomInfo
): Promise<MarketplaceDemoSession> {
  const ip = clientIp.trim() || "unknown";
  return startDemoCallInternal({
    scopeKey: `ip:${ip}`,
    listingId,
    dailyLimit: PUBLIC_DEMO_DAILY_LIMIT,
    maxDurationSeconds: PUBLIC_DEMO_MAX_DURATION_SECONDS,
    customInfo
  });
}

async function startDemoCallInternal(params: {
  scopeKey: string;
  listingId: string;
  dailyLimit: number;
  maxDurationSeconds: number;
  customInfo?: DemoCallCustomInfo;
}): Promise<MarketplaceDemoSession> {
  const { scopeKey, listingId, dailyLimit, maxDurationSeconds, customInfo } = params;

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
  const userKey = `demo:${scopeKey}:${listingId}:${bucket}`;
  const globalKey = `demo:global:${bucket}`;
  const counts = await readDemoCounts(userKey, globalKey);

  if (counts.user >= dailyLimit) {
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
  // Default the demo persona's name to the selected voice so the spoken name
  // always matches the voice's gender (e.g. the "adam" preset introduces
  // itself as Adam, never as a female fallback name).
  const voicePresetName = str(voiceNode, "voiceName", str(voiceNode, "voice"));
  const fallbackName =
    voicePresetName && voicePresetName !== "custom" && voicePresetName !== "triven-default"
      ? voicePresetName.replace(/^./, (ch) => ch.toUpperCase())
      : "Alex";
  const assistantName = str(voiceNode, "assistantName", fallbackName);
  const demoBusinessName = customInfo?.businessName?.trim() || `Demo ${industry.replace(/^./, (ch) => ch.toUpperCase())} Studio`;

  const systemPrompt = buildDemoSystemPrompt({
    assistantName,
    demoBusinessName,
    industry,
    listingName: listing.name,
    listingDescription: listing.shortDescription || listing.description || "an AI voice receptionist",
    customInfo
  });

  const customDocName = customInfo?.doctorName?.trim();
  const customBizName = customInfo?.businessName?.trim();
  let firstMessage: string;
  if (customBizName) {
    const docText = customDocName ? ` speaking on behalf of ${customDocName}` : "";
    firstMessage = `Hi! Thanks for calling ${customBizName}. This is ${assistantName}${docText} — this is a live demo, so ask me anything. How can I help?`;
  } else {
    firstMessage = `Hi! Thanks for calling ${demoBusinessName}. This is ${assistantName} — this is a live demo, so feel free to ask me anything. How can I help?`;
  }

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
    includeTools: { checkAvailability: false, bookAppointment: false, sendNotification: false, knowledgeLookup: false },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds,
    recordingEnabled: false
  });

  demoAssistantByListing.set(listing.id, assistant.id);

  // Real-time assistant overrides passed to vapi.start() to guarantee custom form values are applied instantly
  const assistantOverrides = {
    firstMessage,
    model: {
      provider: "openai",
      model: str(voiceNode, "model", "gpt-4o-mini"),
      messages: [
        {
          role: "system",
          content: systemPrompt
        }
      ]
    }
  };

  // Consume the allowance only after the assistant deployed successfully.
  await recordDemoStart(userKey, globalKey);
  const remainingToday = Math.max(0, dailyLimit - (counts.user + 1));

  console.log("[marketplace-demo] session ready", {
    listingId: listing.id,
    assistantId: assistant.id,
    scopeKey,
    remainingToday
  });

  return {
    publicKey: env.VAPI_PUBLIC_KEY,
    assistantId: assistant.id,
    assistantOverrides,
    listingId: listing.id,
    listingName: listing.name,
    assistantName,
    demoBusinessName,
    maxDurationSeconds,
    remainingDemosToday: remainingToday,
    demo: true
  };
}
