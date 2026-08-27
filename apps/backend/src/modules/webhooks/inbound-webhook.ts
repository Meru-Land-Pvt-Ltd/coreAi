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
import { WEBHOOK_NODE_TYPE, checkHeartResult } from "@coreai/shared";
import { getConnector } from "../connectors/registry";
import { openSecretValues } from "../connectors/buyer-secrets";

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
      connectorId: true,
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

  // A connector address is authenticated by the connector's own receive(),
  // because no two providers prove themselves the same way — Twilio signs the
  // URL, Stripe signs the body with a timestamp, Instantly sends back a header
  // we chose. Running our own generic check here would reject all three.
  if (endpoint.signingSecretCipher && !endpoint.connectorId) {
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
      configJson: true,
      /* The owner is needed to look up a card by id: ids are unique per
         architect, not across the platform. */
      workflow: { select: { workflowJson: true, architectUserId: true } },
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

  // ---- A connector address: the connector reads the knock ------------------
  //
  // Everything above this point is the same for every inbound event on the
  // platform. Everything below is the same too. Only this middle step knows
  // anything about a particular provider, and it lives in the connector's own
  // file, not here.
  let connectorOutputs: Record<string, unknown> | null = null;
  if (endpoint.connectorId) {
    const contract = getConnector(endpoint.connectorId, agent?.workflow?.architectUserId);
    if (!contract?.receive) {
      // The node still exists but the connector no longer does. Acknowledge so
      // the provider stops retrying, and say so in the log.
      console.warn("[webhook-in] address belongs to a connector that is not installed", {
        connectorId: endpoint.connectorId
      });
      return c.json({ ok: true, ignored: "connector not installed" });
    }

    let secret = "";
    if (endpoint.signingSecretCipher) {
      try {
        secret = decryptSecret(endpoint.signingSecretCipher);
      } catch {
        secret = "";
      }
    }

    // Every header, because a provider's proof of identity can be in any of
    // them. This set is used only by receive() and never reaches a run context
    // or a model prompt.
    const allHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(c.req.header())) {
      if (typeof value === "string") allHeaders[name.toLowerCase()] = value;
    }

    const answers = (agent.configJson as Record<string, unknown> | null)?.buyerAnswers;
    const config: Record<string, unknown> = {
      ...(nodeDataFor(agent.workflow.workflowJson, endpoint.nodeId) ?? {}),
      ...(answers && typeof answers === "object"
        ? openSecretValues(
            contract.needs.platform.map((need) => need.key),
            answers as Record<string, unknown>
          )
        : {})
    };

    try {
      const read = await contract.receive({
        rawBody,
        body,
        headers: allHeaders,
        config,
        credentials: {},
        secret,
        log: (message, detail) => console.log(`[connector:${contract.id}] ${message}`, detail ?? "")
      });

      if (!read.accepted) {
        // Providers send far more than anyone asked for. Acknowledging without
        // running is the correct, cheap answer — not a failure.
        return c.json({ ok: true, ignored: read.ignoredReason ?? "not a wanted event" });
      }

      const honest = checkHeartResult(contract, { outputs: read.outputs });
      if (!honest.ok) {
        console.error("[webhook-in] connector accepted an event without returning what it promised", {
          connectorId: contract.id,
          missing: honest.missing
        });
        return c.json({ ok: false, error: "The event could not be read" }, 500);
      }

      connectorOutputs = read.outputs;

      // The provider's own id for the event, so a retry cannot run the agent
      // twice — a second reply handled, a second message sent.
      if (read.eventId && (await alreadyDelivered(`${endpoint.id}:evt:${read.eventId}`))) {
        return c.json({ ok: true, duplicate: true });
      }
    } catch (error) {
      const status = (error as { status?: unknown })?.status;
      if (status === 401 || status === 403) {
        console.warn("[webhook-in] connector rejected a delivery as unauthentic", {
          connectorId: contract.id
        });
        return c.json({ ok: false, error: "Bad signature" }, 401);
      }
      console.error("[webhook-in] connector receive failed", {
        connectorId: contract.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return c.json({ ok: false, error: "The event could not be read" }, 500);
    }
  }

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
        },
        // A connector hands on named values — "reply", "leadEmail" — so the
        // next step reads them by name and never learns the provider's shape.
        ...(connectorOutputs ?? {})
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
/**
 * Does this node need a public address of its own?
 *
 * Two kinds do. The plain Webhook node, which an architect points anything at.
 * And any connector declaring `execution: "inbound"` — Instantly's replies,
 * and every provider that knocks rather than waits. Both get the same address,
 * the same rate limit and the same duplicate filter; only the reading of what
 * arrives differs.
 */
/** The stored config of one node, by id. */
function nodeDataFor(workflowJson: unknown, nodeId: string): Record<string, unknown> | null {
  try {
    const parsed = parseRunnerWorkflowJson(workflowJson);
    const node = parsed.nodes.find((entry) => entry.id === nodeId);
    return (node?.data as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/** The connector id on a node, when it names one. */
function connectorIdOf(data: unknown): string | undefined {
  const value = (data as Record<string, unknown> | null)?.connectorId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function wantsAnAddress(data: unknown): boolean {
  const record = (data ?? {}) as Record<string, unknown>;
  if (String(record.type ?? "") === WEBHOOK_NODE_TYPE) return true;

  const connectorId = typeof record.connectorId === "string" ? record.connectorId : "";
  if (!connectorId) return false;
  return getConnector(connectorId)?.execution === "inbound";
}

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
  const wanted = parsed.nodes
    .filter((node) => wantsAnAddress(node.data))
    .map((node) => ({ nodeId: node.id, connectorId: connectorIdOf(node.data) }));
  const nodeIds = wanted.map((entry) => entry.nodeId);

  const existing = await prisma.agentWebhookEndpoint.findMany({
    where: { installedAgentId: agent.id },
    select: { id: true, nodeId: true, tokenCipher: true, connectorId: true }
  });

  const keep = new Set(nodeIds);
  const stale = existing.filter((row) => !keep.has(row.nodeId)).map((row) => row.id);
  if (stale.length > 0) {
    await prisma.agentWebhookEndpoint.deleteMany({ where: { id: { in: stale } } });
  }

  const links: Array<{ nodeId: string; url: string }> = [];

  for (const { nodeId, connectorId } of wanted) {
    const found = existing.find((row) => row.nodeId === nodeId);
    if (found) {
      // A node can be re-pointed at a different connector between republishes.
      if ((found.connectorId ?? null) !== (connectorId ?? null)) {
        await prisma.agentWebhookEndpoint.update({
          where: { id: found.id },
          data: { connectorId: connectorId ?? null }
        });
      }
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
        connectorId: connectorId ?? null,
        tokenHash,
        tokenCipher: encryptSecret(token),
        // A connector address gets a shared secret whether or not its provider
        // signs anything. Several let you attach a header of your choosing,
        // and having the secret ready means the connector can use it.
        ...(connectorId ? { signingSecretCipher: encryptSecret(randomBytes(24).toString("base64url")) } : {})
      }
    });
    links.push({ nodeId, url: webhookUrlFor(token) });
  }

  return links;
}

/**
 * The addresses a business must paste into somebody else's settings screen.
 *
 * Only for connector-backed inbound nodes: an address a business never sees is
 * an address nobody ever points a provider at, which makes the whole inbound
 * half of a connector decoration. The secret is shown alongside because the
 * business has to copy it too — it is their own webhook secret, minted for
 * this one install, and it is not a platform credential.
 */
export async function connectorAddressesForInstalledAgent(installedAgentId: string): Promise<
  Array<{
    connectorId: string;
    nodeId: string;
    label: string;
    provider: string;
    instructions: string;
    url: string;
    secretHeader: string | null;
    secret: string;
  }>
> {
  const rows = await prisma.agentWebhookEndpoint.findMany({
    where: { installedAgentId, connectorId: { not: null }, status: "ACTIVE" },
    select: { nodeId: true, connectorId: true, tokenCipher: true, signingSecretCipher: true }
  });

  const out: Array<{
    connectorId: string;
    nodeId: string;
    label: string;
    provider: string;
    instructions: string;
    url: string;
    secretHeader: string | null;
    secret: string;
  }> = [];

  for (const row of rows) {
    const contract = getConnector(row.connectorId ?? "");
    if (!contract?.inbound) continue;
    try {
      out.push({
        connectorId: contract.id,
        nodeId: row.nodeId,
        label: contract.label,
        provider: contract.provider.name,
        instructions: contract.inbound.instructions,
        url: webhookUrlFor(decryptSecret(row.tokenCipher)),
        secretHeader: contract.inbound.secretHeader ?? null,
        secret: row.signingSecretCipher ? decryptSecret(row.signingSecretCipher) : ""
      });
    } catch {
      // Unreadable cipher (key rotated). Skipping is better than showing a
      // link that will never work.
      continue;
    }
  }

  return out;
}

/**
 * EVERY ADDRESS THE BUSINESS MUST PASTE SOMEWHERE — including the plain
 * Webhook node's (2026-08-26).
 *
 * The function above deliberately serves connector-backed inbound only, so a
 * business whose agent starts at a plain "When another app sends data" node
 * was never shown the one thing they must copy: their own private link. The
 * link was minted at go-live and returned to nobody. This is the whole list.
 */
export async function inboundAddressesForBusiness(installedAgentId: string): Promise<
  Array<{
    nodeId: string;
    label: string;
    kind: "webhook" | "connector";
    provider: string | null;
    instructions: string;
    url: string;
    secretHeader: string | null;
    secret: string;
  }>
> {
  const rows = await prisma.agentWebhookEndpoint.findMany({
    where: { installedAgentId, status: "ACTIVE" },
    select: { nodeId: true, connectorId: true, tokenCipher: true, signingSecretCipher: true }
  });

  const out: Array<{
    nodeId: string;
    label: string;
    kind: "webhook" | "connector";
    provider: string | null;
    instructions: string;
    url: string;
    secretHeader: string | null;
    secret: string;
  }> = [];

  for (const row of rows) {
    let url: string;
    try {
      url = webhookUrlFor(decryptSecret(row.tokenCipher));
    } catch {
      /* Unreadable cipher (key rotated) — a link that will never work is
         worse than none. */
      continue;
    }
    const secret = (() => {
      try {
        return row.signingSecretCipher ? decryptSecret(row.signingSecretCipher) : "";
      } catch {
        return "";
      }
    })();

    if (row.connectorId) {
      const contract = getConnector(row.connectorId);
      if (!contract?.inbound) continue;
      out.push({
        nodeId: row.nodeId,
        label: contract.label,
        kind: "connector",
        provider: contract.provider.name,
        instructions: contract.inbound.instructions,
        url,
        secretHeader: contract.inbound.secretHeader ?? null,
        secret
      });
      continue;
    }

    out.push({
      nodeId: row.nodeId,
      label: "When another app sends data",
      kind: "webhook",
      provider: null,
      instructions:
        "Paste this address into the other app's webhook or notification settings. Every delivery it sends will wake your agent.",
      url,
      secretHeader: null,
      secret
    });
  }

  return out;
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
