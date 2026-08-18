import { createHash, randomBytes } from "crypto";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import { getSharedRedis } from "../../lib/redis";
import { checkUsageCapAndNotify } from "../business/usage-cap";
import { isInstalledAgentActivityPaused } from "../architect/twilio-business-routing";

/**
 * SAFE LIVE MODE for an embedded agent.
 *
 * A published page has always run as a demo: a stranger browsing the
 * marketplace must never be able to book a real appointment or spend a
 * business's money. That was right, and for the marketplace it stays right.
 *
 * But once a business installs an agent and puts it on THEIR website, the same
 * page is no longer a demo — it is their front desk, and a booking that never
 * reaches their calendar is a broken promise.
 *
 * The line between the two is a key the buyer mints for their own site.
 *
 * Three honest facts shape this file:
 *
 * 1. **The key is not a secret.** It sits in the buyer's public HTML; anyone
 *    can read it and call the endpoint directly. So the key answers "whose
 *    widget is this", never "is this caller trustworthy".
 * 2. **Therefore the ceiling is the real guard.** A hard per-install daily and
 *    per-minute cap, checked BEFORE any model runs and never refunded, is what
 *    actually bounds a bad day, a bot, or a page that goes viral.
 * 3. **Every failure degrades to the demo, never to an error.** Paused agent,
 *    ceiling hit, cap reached, Redis down — the visitor still gets an answer.
 *    Only the spending stops. A silent 500 on a customer's homepage would be
 *    worse than a demo answer.
 */

/** Live widget runs allowed per install per day, unless the row overrides it. */
const DEFAULT_EMBED_DAILY_LIMIT = 200;
/** Live widget runs allowed per install per minute. Blunt anti-bot ceiling. */
const EMBED_BURST_PER_MINUTE = 5;

export type EmbedLiveDecision =
  | { live: false; reason: string }
  | {
      live: true;
      install: {
        id: string;
        businessId: string;
        businessOwnerId: string;
        listingId: string | null;
        businessName: string;
        businessType: string | null;
        businessPhoneNumber?: string;
        bookingUrl?: string;
        teamPhone?: string;
        calendarId?: string;
        timeZone?: string;
        services: string[];
      };
    };

export function createEmbedKey(): { key: string; keyHash: string } {
  // "pk_" so a buyer reading their own HTML can tell at a glance that this is
  // the public widget key and not a password.
  const key = `pk_${randomBytes(24).toString("base64url")}`;
  return { key, keyHash: hashEmbedKey(key) };
}

export function hashEmbedKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Mint (or re-read) the key a buyer pastes into their own website. */
export async function ensureEmbedKey(installedAgentId: string): Promise<string> {
  const existing = await prisma.installedAgent.findUnique({
    where: { id: installedAgentId },
    select: { embedKeyCipher: true }
  });
  if (existing?.embedKeyCipher) {
    try {
      return decryptSecret(existing.embedKeyCipher);
    } catch {
      // Unreadable (key rotated) — mint a fresh one below rather than leave the
      // buyer with a snippet nobody can serve.
    }
  }
  const { key, keyHash } = createEmbedKey();
  await prisma.installedAgent.update({
    where: { id: installedAgentId },
    data: { embedKeyHash: keyHash, embedKeyCipher: encryptSecret(key) }
  });
  return key;
}

/** Replace the key — the buyer's answer to an abused widget. */
export async function rotateEmbedKey(installedAgentId: string): Promise<string> {
  const { key, keyHash } = createEmbedKey();
  await prisma.installedAgent.update({
    where: { id: installedAgentId },
    data: { embedKeyHash: keyHash, embedKeyCipher: encryptSecret(key) }
  });
  return key;
}

/**
 * The ceiling. Counted per install, before any model call, and deliberately
 * NOT refunded when a run fails: a failing agent that retries forever is
 * exactly the case this exists to stop.
 *
 * Redis down means we cannot count, and an uncountable live path is one we
 * refuse — the caller degrades to the demo.
 */
async function withinEmbedCeiling(installId: string, dailyLimit: number): Promise<boolean> {
  const redis = getSharedRedis();
  if (!redis) return false;

  try {
    const dayKey = `embed:live:day:${installId}:${new Date().toISOString().slice(0, 10)}`;
    const minKey = `embed:live:min:${installId}`;
    const res = await redis
      .multi()
      .incr(dayKey)
      .expire(dayKey, 172_800)
      .incr(minKey)
      .expire(minKey, 60)
      .exec();
    const dayCount = Number(res?.[0]?.[1] ?? 0);
    const minCount = Number(res?.[2]?.[1] ?? 0);
    return dayCount <= dailyLimit && minCount <= EMBED_BURST_PER_MINUTE;
  } catch {
    return false;
  }
}

/**
 * Decide whether THIS page view may do real work.
 *
 * Returns the business context on a yes, and a reason on a no. A no is never an
 * error: the caller runs the sandbox exactly as it did before this file existed.
 */
export async function resolveEmbedLive(args: {
  installKey: string | null | undefined;
  /** The page being viewed — the key must belong to this agent, not another. */
  workflowId: string;
  listingId: string | null;
}): Promise<EmbedLiveDecision> {
  const key = (args.installKey ?? "").trim();
  if (!key) return { live: false, reason: "no key — marketplace demo" };

  const install = await prisma.installedAgent.findUnique({
    where: { embedKeyHash: hashEmbedKey(key) },
    select: {
      id: true,
      status: true,
      businessId: true,
      workflowId: true,
      listingId: true,
      embedDailyLimit: true,
      business: {
        select: {
          name: true,
          type: true,
          ownerId: true,
          profile: {
            select: {
              calendarId: true,
              timeZone: true,
              services: true,
              bookingUrl: true,
              teamPhone: true
            }
          },
          phoneNumbers: { take: 1, orderBy: { createdAt: "asc" }, select: { phoneNumber: true } }
        }
      }
    }
  });

  if (!install) return { live: false, reason: "unknown key" };

  // The key must belong to the agent whose page this is. Without this check a
  // buyer's key would unlock live mode on every other product on the platform.
  const sameAgent =
    install.workflowId === args.workflowId ||
    (args.listingId !== null && install.listingId === args.listingId);
  if (!sameAgent) return { live: false, reason: "key belongs to a different agent" };

  if (isInstalledAgentActivityPaused(install.status)) {
    return { live: false, reason: "agent paused" };
  }

  const dailyLimit = install.embedDailyLimit ?? DEFAULT_EMBED_DAILY_LIMIT;
  if (!(await withinEmbedCeiling(install.id, dailyLimit))) {
    return { live: false, reason: "daily widget limit reached" };
  }

  const cap = await checkUsageCapAndNotify(install.businessId).catch(() => ({ exceeded: false }));
  if (cap.exceeded) return { live: false, reason: "monthly usage cap reached" };

  const profile = install.business.profile;
  return {
    live: true,
    install: {
      id: install.id,
      businessId: install.businessId,
      businessOwnerId: install.business.ownerId,
      listingId: install.listingId,
      businessName: install.business.name,
      businessType: install.business.type,
      businessPhoneNumber: install.business.phoneNumbers[0]?.phoneNumber,
      bookingUrl: profile?.bookingUrl ?? undefined,
      teamPhone: profile?.teamPhone ?? undefined,
      calendarId: profile?.calendarId ?? undefined,
      timeZone: profile?.timeZone ?? undefined,
      services: profile?.services ?? []
    }
  };
}

/** Kept for the route to read without importing the constant twice. */
export const EMBED_DEFAULTS = {
  dailyLimit: DEFAULT_EMBED_DAILY_LIMIT,
  burstPerMinute: EMBED_BURST_PER_MINUTE
};
