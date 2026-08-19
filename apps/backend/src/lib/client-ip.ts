/**
 * WHO IS ACTUALLY CALLING — the one place that answers it.
 *
 * Every free limit on this platform is keyed on the caller's identity, so a
 * caller who can choose their own identity has no limit at all. Two separate
 * routes each rolled their own version of this and each trusted a header the
 * client controls:
 *
 *  - the free-preview limit on published agent pages read `cf-connecting-ip`
 *    first. We do not sit behind Cloudflare — `curl -sI https://triven.ai`
 *    returns nginx with no CF headers — so nothing strips that header from an
 *    inbound request. Anyone could send `cf-connecting-ip: 1.2.3.4`, change it
 *    each time, and run the AI free forever.
 *  - the marketplace demo-call limit read the LEFTMOST `x-forwarded-for` entry.
 *    Our nginx uses `$proxy_add_x_forwarded_for`, which APPENDS the real
 *    address to whatever the client already sent, so the leftmost value is
 *    exactly the attacker's invention. That one bought free Vapi voice minutes.
 *
 * The only value our own infrastructure guarantees is `X-Real-IP`: nginx sets
 * it with `proxy_set_header X-Real-IP $remote_addr` on every location block,
 * which REPLACES any value the client sent. That is what we trust, and the
 * rightmost `x-forwarded-for` hop — the one our proxy appended — is the only
 * fallback.
 *
 * If Cloudflare is ever put in front of this, add `cf-connecting-ip` back HERE
 * and nowhere else, and only together with an ingress rule that drops the
 * header from untrusted sources.
 */

import type { Context } from "hono";

/** A syntactically plausible address, so junk cannot become a rate-limit key. */
function plausible(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.length > 45) return null;
  // IPv4, IPv6, or an IPv4-mapped IPv6 address. Deliberately loose on IPv6
  // shapes and strict about characters — the point is to reject header
  // injection and control characters, not to validate every RFC form.
  if (!/^[0-9a-fA-F:.]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * The caller's real address, for rate limiting and abuse controls.
 *
 * Never reads a header a client can set. Returns "unknown" rather than a
 * fabricated default, so a misconfigured proxy shows up as one shared bucket
 * that visibly throttles instead of silently letting everyone through.
 */
export function getClientIp(c: Context): string {
  const realIp = plausible(c.req.header("x-real-ip"));
  if (realIp) return realIp;

  // Rightmost hop only: our proxy appended it, the client cannot control it.
  const forwarded = c.req.header("x-forwarded-for");
  const lastHop = plausible(forwarded?.split(",").at(-1));
  if (lastHop) return lastHop;

  return "unknown";
}

/**
 * A rate-limit key that survives a shared address.
 *
 * Offices, phone networks and universities put hundreds of people behind one
 * address, so IP alone either punishes a whole building or lets a single
 * machine through. Where the caller has any stable second signal — a session,
 * an agent slug, a device id — mixing it in keeps honest neighbours apart
 * while still costing an attacker a new address per identity.
 */
export function rateLimitKey(c: Context, scope: string, extra?: string | null): string {
  const ip = getClientIp(c);
  const suffix = (extra ?? "").trim().slice(0, 80);
  return suffix ? `${scope}:${ip}:${suffix}` : `${scope}:${ip}`;
}
