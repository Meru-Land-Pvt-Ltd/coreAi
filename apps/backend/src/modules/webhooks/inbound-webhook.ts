import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { env } from "../../config/env";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import { getSharedRedis } from "../../lib/redis";
import { checkUsageCapAndNotify } from "../business/usage-cap";
import { isInstalledAgentActivityPaused } from "../architect/twilio-business-routing";
import { parseRunnerWorkflowJson, runWorkflowTest } from "../architect/workflow-runner";
import { WEBHOOK_NODE_TYPE } from "@coreai/shared";

/**
 * THE WEBHOOK — the second way an agent starts with no human present.
 *
 * The timer answers "when"; this answers "when something happened somewhere
 * else". A business pastes one private link into whatever software they already
 * run — their store, their forms, their booking tool — and that software starts
 * the agent. We never read their code, never hold their password, never install
 * anything on their side. A link is the whole contract.
 *
 * Security, in order of how much it matters:
 *
 * - **The token IS the credential**, so it is 32 random bytes and only its
 *   SHA-256 lives in an indexed column. A database leak yields hashes, and the
 *   lookup never decrypts anything.
 * - **A signature is optional and enforced only when set.** Most SMB tools
 *   cannot sign; demanding it would make the feature unusable for the people it
 *   is for. When a secret exists we check it in constant time.
 * - **Deliveries are deduped twice** — a cheap Redis claim first, then the hard
 *   guarantee of WorkflowRun's unique (callProvider, externalCallId). A tool
 *   that retries cannot charge the business twice for one event.
 * - **Bounded** — body size, per-endpoint rate limits, paused agents and
 *   over-cap businesses all stop the run before any model is called.
 */

/** Same 256KB ceiling the public agent-page routes use. */
export const webhookBodyLimit = bodyLimit({
  maxSize: 256 * 1024,
  onError: (c) => c.json({ ok: false, error: "Payload too large" }, 413)
});

/** Deliveries accepted per endpoint per minute before we start refusing. */
const BURST_PER_MINUTE = 60;
/** Deliveries accepted per endpoint per day. */
const DAILY_LIMIT = 1000;

export function createWebhookToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashWebhookToken(token) };
}

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The link a business pastes into their other software. */
export function webhookUrlFor(token: string): string {
  const base = (env.BACKEND_URL || "https://triven.ai").replace(/\/$/, "");
  return `${base}/api/webhook/in/${token}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * First-line duplicate filter. Returns true when this delivery was already
 * seen. Redis is a convenience here, not the guarantee — the unique index on
 * WorkflowRun is what actually prevents a double run.
 */
async function alreadyDelivered(key: string): Promise<boolean> {
  try {
    const redis = getSharedRedis();
    if (!redis) return false;
    const claimed = await redis.set(`webhook:seen:${key}`, "1", "PX", 86_400_000, "NX");
    return claimed === null;
  } catch {
    return false;
  }
}

/** Per-endpoint rate limit. Fails open on a Redis outage — never blocks work. */
async function withinRateLimit(endpointId: string): Promise<boolean> {
  try {
    const redis = getSharedRedis();
    if (!redis) return true;
    const minuteKey = `webhook:rate:min:${endpointId}`;
    const dayKey = `webhook:rate:day:${endpointId}`;
    const [minuteCount, dayCount] = await redis
      .multi()
      .incr(minuteKey)
      .expire(minuteKey, 60)
      .incr(dayKey)
      .expire(dayKey, 86_400)
      .exec()
      .then((res: Array<[Error | null, unknown]> | null) => [
        Number(res?.[0]?.[1] ?? 0),
        Number(res?.[2]?.[1] ?? 0)
      ]);
    return minuteCount <= BURST_PER_MINUTE && dayCount <= DAILY_LIMIT;
  } catch {
    return true;
  }
}

/**
 * A GET on the link answers politely instead of 404ing. Half the tools a
 * business uses will "test" a webhook URL with a GET first, and a dead-looking
 * link makes them think we are broken.
 */
export async function handleInboundAgentWebhookProbe(c: Context) {
  const token = c.req.param("token") ?? "";
  const endpoint = await prisma.agentWebhookEndpoint.findUnique({
    where: { tokenHash: hashWebhookToken(token) },
    select: { id: true, status: true }
  });
  if (!endpoint) return c.json({ ok: false, error: "Unknown link" }, 404);
  return c.json({
    ok: true,
    message: "This link is live. Send a POST with your JSON to start the agent."
  });
}

export async function handleInboundAgentWebhookPost(c: Context) {
  // Raw text first: the bytes are needed for the signature, and the body
  // stream can only be read once.
  const rawBody = await c.req.text();

  const token = c.req.param("token") ?? "";
  const endpoint = await prisma.agentWebhookEndpoint.findUnique({
    where: { tokenHash: hashWebhookToken(token) },
    select: {
      id: true,
      status: true,
      nodeId: true,
      businessId: true,
      installedAgentId: true,
      workflowId: true,
      signingSecretCipher: true
    }
  });

  // One shape of answer for "no such link" and "wrong link", so the endpoint
  // cannot be used to discover which tokens exist.
  if (!endpoint) return c.json({ ok: false, error: "Unknown link" }, 404);
  if (endpoint.status !== "ACTIVE") {
    return c.json({ ok: false, error: "This link is switched off" }, 403);
  }

  if (endpoint.signingSecretCipher) {
    const provided = c.req.header("x-triven-signature") ?? "";
    let expected = "";
    try {
      const secret = decryptSecret(endpoint.signingSecretCipher);
      expected = `sha256=${createHash("sha256").update(`${secret}.${rawBody}`).digest("hex")}`;
    } catch {
      expected = "";
    }
    if (!expected || !safeEqual(provided, expected)) {
      return c.json({ ok: false, error: "Bad signature" }, 401);
    }
  }

  if (!(await withinRateLimit(endpoint.id))) {
    return c.json({ ok: false, error: "Too many deliveries — slow down" }, 429);
  }

  let body: unknown = null;
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      // Not JSON? Take it as plain text rather than refusing — a form post or
      // a bare string is still a perfectly good reason to start an agent.
      body = rawBody;
    }
  }

  const deliveryId =
    c.req.header("x-triven-delivery-id") ||
    c.req.header("x-request-id") ||
    createHash("sha256").update(`${endpoint.id}:${rawBody}:${Date.now()}`).digest("hex").slice(0, 32);

  if (await alreadyDelivered(`${endpoint.id}:${deliveryId}`)) {
    return c.json({ ok: true, duplicate: true });
  }

  const agent = await prisma.installedAgent.findUnique({
    where: { id: endpoint.installedAgentId },
    select: {
      id: true,
      status: true,
      businessId: true,
      workflowId: true,
      listingId: true,
      workflow: { select: { workflowJson: true } },
      business: {
        select: {
          id: true,
          name: true,
          type: true,
          ownerId: true,
          profile: {
            select: { calendarId: true, timeZone: true, services: true, bookingUrl: true, teamPhone: true }
          },
          phoneNumbers: { take: 1, orderBy: { createdAt: "asc" }, select: { phoneNumber: true } }
        }
      }
    }
  });

  if (!agent) return c.json({ ok: false, error: "Unknown link" }, 404);
  if (isInstalledAgentActivityPaused(agent.status)) {
    return c.json({ ok: false, error: "This agent is paused" }, 409);
  }

  const cap = await checkUsageCapAndNotify(agent.businessId).catch(() => ({ exceeded: false }));
  if (cap.exceeded) {
    return c.json({ ok: false, error: "Monthly usage limit reached" }, 402);
  }

  // Only the headers an architect might legitimately branch on. Authorization,
  // cookies and signatures are deliberately not copied into the run context,
  // where they would end up inside model prompts.
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "user-agent", "x-triven-delivery-id", "x-request-id"]) {
    const value = c.req.header(name);
    if (value) headers[name] = value.slice(0, 200);
  }

  const profile = agent.business.profile;
  const receivedAt = new Date().toISOString();

  try {
    const result = await runWorkflowTest({
      userId: agent.business.ownerId,
      workflowId: agent.workflowId,
      workflowJson: agent.workflow.workflowJson,
      mode: "live",
      executionMode: "LIVE",
      callProvider: "WEBHOOK",
      externalCallId: `${endpoint.id}:${deliveryId}`,
      input: {
        businessId: agent.businessId,
        businessOwnerId: agent.business.ownerId,
        installedAgentId: agent.id,
        listingId: agent.listingId ?? undefined,
        businessName: agent.business.name,
        businessType: agent.business.type ?? undefined,
        businessPhoneNumber: agent.business.phoneNumbers[0]?.phoneNumber,
        bookingUrl: profile?.bookingUrl ?? undefined,
        teamPhone: profile?.teamPhone ?? undefined,
        calendarId: profile?.calendarId ?? undefined,
        timeZone: profile?.timeZone ?? undefined,
        services: profile?.services ?? [],
        webhook: {
          endpointId: endpoint.id,
          deliveryId,
          receivedAt,
          headers,
          body
        }
      }
    });

    await prisma.agentWebhookEndpoint.update({
      where: { id: endpoint.id },
      data: { lastDeliveryAt: new Date(), deliveryCount: { increment: 1 } }
    });

    return c.json({ ok: true, runId: result.workflowRunId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A retrying sender that hits the duplicate guard deserves a success, not
    // an error — the event was already handled.
    if (message.toLowerCase().includes("duplicate")) {
      return c.json({ ok: true, duplicate: true });
    }
    console.error("[webhook-in] run failed", {
      endpointId: endpoint.id,
      installedAgentId: endpoint.installedAgentId,
      message: message.slice(0, 300)
    });
    return c.json({ ok: false, error: "The agent could not run this event" }, 500);
  }
}

/**
 * Mint (or reuse) one link per webhook node for an installed agent, and drop
 * links whose node the architect deleted. Called when an agent is installed and
 * whenever its workflow changes.
 */
export async function syncWebhookEndpointsForInstalledAgent(
  installedAgentId: string
): Promise<Array<{ nodeId: string; url: string }>> {
  const agent = await prisma.installedAgent.findUnique({
    where: { id: installedAgentId },
    select: {
      id: true,
      businessId: true,
      workflowId: true,
      workflow: { select: { workflowJson: true } }
    }
  });
  if (!agent) return [];

  const parsed = parseRunnerWorkflowJson(agent.workflow.workflowJson);
  const nodeIds = parsed.nodes
    .filter((node) => String((node.data as Record<string, unknown>)?.type ?? "") === WEBHOOK_NODE_TYPE)
    .map((node) => node.id);

  const existing = await prisma.agentWebhookEndpoint.findMany({
    where: { installedAgentId: agent.id },
    select: { id: true, nodeId: true, tokenCipher: true }
  });

  const keep = new Set(nodeIds);
  const stale = existing.filter((row) => !keep.has(row.nodeId)).map((row) => row.id);
  if (stale.length > 0) {
    await prisma.agentWebhookEndpoint.deleteMany({ where: { id: { in: stale } } });
  }

  const links: Array<{ nodeId: string; url: string }> = [];

  for (const nodeId of nodeIds) {
    const found = existing.find((row) => row.nodeId === nodeId);
    if (found) {
      // The link never rotates on its own — a business has pasted it somewhere.
      try {
        links.push({ nodeId, url: webhookUrlFor(decryptSecret(found.tokenCipher)) });
      } catch {
        // Unreadable cipher (key rotated) — mint a fresh link rather than
        // leaving the buyer with a URL nobody can serve.
        const { token, tokenHash } = createWebhookToken();
        await prisma.agentWebhookEndpoint.update({
          where: { id: found.id },
          data: { tokenHash, tokenCipher: encryptSecret(token) }
        });
        links.push({ nodeId, url: webhookUrlFor(token) });
      }
      continue;
    }

    const { token, tokenHash } = createWebhookToken();
    await prisma.agentWebhookEndpoint.create({
      data: {
        businessId: agent.businessId,
        installedAgentId: agent.id,
        workflowId: agent.workflowId,
        nodeId,
        tokenHash,
        tokenCipher: encryptSecret(token)
      }
    });
    links.push({ nodeId, url: webhookUrlFor(token) });
  }

  return links;
}

/** Every install of a workflow re-reads the graph — used after a republish. */
export async function syncWebhookEndpointsForWorkflow(workflowId: string): Promise<void> {
  const installs = await prisma.installedAgent.findMany({
    where: { workflowId },
    select: { id: true }
  });
  for (const install of installs) {
    await syncWebhookEndpointsForInstalledAgent(install.id).catch((error) => {
      console.error("[webhook-in] sync failed", {
        installedAgentId: install.id,
        error: String(error)
      });
    });
  }
}
