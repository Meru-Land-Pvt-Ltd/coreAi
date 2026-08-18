/**
 * SSRF-hardened outbound HTTP for the API Call node.
 *
 * The API Call node lets an architect point a published agent page at any
 * service on the internet. That request runs on OUR server, so a malicious or
 * careless URL could otherwise reach the machine's own loopback, the private
 * network, or the cloud metadata endpoint (169.254.169.254) and exfiltrate
 * credentials. `safeFetch` is the ONE door every outbound API-call request goes
 * through, and it is deny-by-default:
 *
 *   (a) only http/https schemes;
 *   (b) the hostname is RESOLVED and every resulting IP is checked — any
 *       loopback / private / link-local / reserved / cloud-metadata address is
 *       rejected (not just literal-IP URLs — a public hostname that resolves to
 *       a private address is caught too);
 *   (c) only ports 80 and 443;
 *   (d) redirects are followed MANUALLY, and every hop is re-validated from
 *       scratch (scheme + port + host + DNS), max 3 hops — a 302 to
 *       http://169.254.169.254/ is rejected at the hop, not followed;
 *   (e) a 10s timeout and a 2 MB response cap that aborts the stream mid-body;
 *   (f) NO ambient credentials are ever added. safeFetch sends exactly the
 *       method / headers / body it is given and nothing from our environment.
 *       The caller (API Call node) is responsible for injecting the single
 *       referenced architect/platform key into those headers/query.
 *
 * Residual limitation (documented on purpose): between our DNS check and the
 * kernel's own resolution inside fetch, a hostname's DNS answer could change to
 * a private IP (classic DNS-rebinding / TOCTOU). Pre-resolution + per-hop
 * re-validation shrinks the window but does not close it, because native fetch
 * re-resolves the name itself. Closing it fully requires pinning the connection
 * to the vetted IP; that is a deliberate follow-up, noted here and covered by a
 * test that documents the current behavior.
 *
 * Testability: both the DNS lookup and the underlying fetch are injectable
 * seams (`lookup`, `fetchImpl`) so the guard is unit-tested exhaustively
 * WITHOUT touching the network or real DNS.
 */
import dnsPromises from "dns/promises";
import net from "net";

export const SAFE_FETCH_TIMEOUT_MS = 10_000;
export const SAFE_FETCH_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const SAFE_FETCH_MAX_REDIRECTS = 3;

/** Ports an outbound API call may target. Everything else is refused. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/**
 * Credential headers that are ALWAYS dropped when a redirect crosses to a
 * different origin, so a secret can never ride along to a host the caller did
 * not choose (matches browser behaviour). The caller can name more via
 * `sensitiveHeaders` — the API Call node passes its injected key header here.
 */
const ALWAYS_STRIP_ON_CROSS_ORIGIN = ["authorization", "cookie", "proxy-authorization"];

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "BLOCKED_SCHEME"
  | "BLOCKED_PORT"
  | "BLOCKED_HOST"
  | "DNS_ERROR"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "REDIRECT_INVALID"
  | "NETWORK_ERROR";

/**
 * Every rejection safeFetch raises is a SafeFetchError with a stable `code`, so
 * the API Call node can record a graceful error in the run context instead of
 * crashing the run. Messages are jargon-free and safe to surface to a customer.
 */
export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

/** One resolved address, matching `dns.promises.lookup(host, { all: true })`. */
export interface LookupAddress {
  address: string;
  family: number;
}

/** DNS seam — resolves a hostname to all of its addresses. Injectable for tests. */
export type DnsLookupAll = (hostname: string) => Promise<LookupAddress[]>;

/** fetch seam — a subset of the global fetch signature. Injectable for tests. */
export type FetchLike = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect?: "manual" | "follow" | "error";
  }
) => Promise<Response>;

export interface SafeFetchOptions {
  method?: string;
  /** Request headers — sent verbatim. The caller injects any key here. */
  headers?: Record<string, string>;
  /** Optional request body (already serialized, e.g. a JSON string). */
  body?: string;
  /**
   * Header names (case-insensitive) that must be DROPPED when a redirect
   * crosses to a different origin — e.g. an injected API key on a custom
   * header. authorization / cookie / proxy-authorization are always dropped
   * cross-origin in addition to these.
   */
  sensitiveHeaders?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Test seam: override the DNS resolver. Defaults to the real system resolver. */
  lookup?: DnsLookupAll;
  /** Test seam: override the underlying fetch. Defaults to global fetch. */
  fetchImpl?: FetchLike;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  /** Response headers, lowercased keys. */
  headers: Record<string, string>;
  /** Final URL after any followed redirects. */
  url: string;
  /** Decoded UTF-8 body, guaranteed <= maxBytes. */
  bodyText: string;
  /** Bytes read off the wire. */
  bytesRead: number;
}

/* -------------------------------------------------------------------------- */
/*                              IP range checks                               */
/* -------------------------------------------------------------------------- */

/** Parse "a.b.c.d" to a uint32, or null if not a valid dotted-quad. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** IPv4 CIDR blocklist as [network, prefixBits]. */
const BLOCKED_V4_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network, incl. 0.0.0.0
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4] // reserved / future, incl. 255.255.255.255 broadcast
];

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable → treat as unsafe
  for (const [network, bits] of BLOCKED_V4_CIDRS) {
    const net32 = ipv4ToInt(network);
    if (net32 === null) continue;
    // /0 would match everything; none of ours is /0, so this shift is safe.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (net32 & mask)) return true;
  }
  return false;
}

/**
 * Expand an IPv6 literal to its 16 bytes. Handles "::" compression and an
 * embedded IPv4 tail (e.g. ::ffff:127.0.0.1). Returns null if malformed.
 */
function ipv6ToBytes(ip: string): Uint8Array | null {
  let text = ip;
  // Strip a zone id (fe80::1%eth0) — irrelevant to range classification.
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  // An embedded IPv4 tail contributes the last 4 bytes.
  let tailBytes: number[] | null = null;
  const lastColon = text.lastIndexOf(":");
  const maybeV4 = lastColon === -1 ? "" : text.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = ipv4ToInt(maybeV4);
    if (v4 === null) return null;
    tailBytes = [(v4 >>> 24) & 0xff, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff];
    text = text.slice(0, lastColon + 1) + "0:0"; // placeholder hextets
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (segment: string): number[] | null => {
    if (segment === "") return [];
    const groups: number[] = [];
    for (const g of segment.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      groups.push(Number.parseInt(g, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : head === null ? null : [];
  if (head === null || tail === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  if (tailBytes) {
    bytes[12] = tailBytes[0];
    bytes[13] = tailBytes[1];
    bytes[14] = tailBytes[2];
    bytes[15] = tailBytes[3];
  }
  return bytes;
}

function allZero(bytes: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

function isBlockedIpv6(ip: string): boolean {
  const bytes = ipv6ToBytes(ip);
  if (bytes === null) return true; // unparseable → unsafe

  // ::  (unspecified) and ::1 (loopback)
  if (allZero(bytes, 0, 16)) return true;
  if (allZero(bytes, 0, 15) && bytes[15] === 1) return true;

  // fc00::/7 — unique local addresses (incl. fd00::/8)
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 — link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  // ff00::/8 — multicast
  if (bytes[0] === 0xff) return true;

  // Embedded-IPv4 forms must be checked against the IPv4 rules:
  //   ::ffff:a.b.c.d  (IPv4-mapped, /96)
  //   ::a.b.c.d       (IPv4-compatible, deprecated)
  //   64:ff9b::a.b.c.d (NAT64 well-known prefix)
  const embeddedV4 = () => `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  const isMapped = allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isCompat = allZero(bytes, 0, 12) && !(allZero(bytes, 12, 15) && bytes[15] <= 1);
  const isNat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    allZero(bytes, 4, 12);
  if (isMapped || isCompat || isNat64) {
    if (isBlockedIpv4(embeddedV4())) return true;
  }

  return false;
}

/**
 * Is this literal IP address in a blocked (loopback / private / link-local /
 * reserved / metadata) range? Unrecognized input is treated as blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

/* -------------------------------------------------------------------------- */
/*                            hostname / URL checks                           */
/* -------------------------------------------------------------------------- */

/** Hostnames refused by name regardless of DNS (never even resolved). */
function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".internal")) return true;
  if (host.endsWith(".local")) return true;
  return false;
}

const defaultLookup: DnsLookupAll = (hostname) =>
  dnsPromises.lookup(hostname, { all: true });

/**
 * Validate a single URL and, when it is a real hostname, resolve it and confirm
 * EVERY resolved address is public. Throws SafeFetchError on any failure.
 * Returns the parsed URL for the caller to fetch.
 */
export async function assertUrlSafe(raw: string, lookup: DnsLookupAll = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("INVALID_URL", "That web address is not valid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("BLOCKED_SCHEME", "Only http and https addresses are allowed.");
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new SafeFetchError("BLOCKED_PORT", "Only the standard web ports 80 and 443 are allowed.");
  }

  // URL keeps IPv6 literals bracketed ("[::1]"); strip for classification.
  const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "");

  if (isBlockedHostname(hostname)) {
    throw new SafeFetchError(
      "BLOCKED_HOST",
      "That address points to a private or internal network and cannot be reached."
    );
  }

  // A literal IP in the URL is checked directly — no DNS needed.
  if (net.isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      throw new SafeFetchError(
        "BLOCKED_HOST",
        "That address points to a private or internal network and cannot be reached."
      );
    }
    return url;
  }

  // A real hostname: resolve and confirm every address is public.
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new SafeFetchError("DNS_ERROR", "That web address could not be found.");
  }

  if (!addresses || addresses.length === 0) {
    throw new SafeFetchError("DNS_ERROR", "That web address could not be found.");
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SafeFetchError(
        "BLOCKED_HOST",
        "That address points to a private or internal network and cannot be reached."
      );
    }
  }

  return url;
}

/* -------------------------------------------------------------------------- */
/*                              body size cap                                 */
/* -------------------------------------------------------------------------- */

async function readBodyCapped(res: Response, cap: number): Promise<{ text: string; bytes: number }> {
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > cap) {
    throw new SafeFetchError("TOO_LARGE", "The response was larger than the 2 MB limit.");
  }

  const body = res.body as unknown as AsyncIterable<Uint8Array> | null;
  if (!body || typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function") {
    // No streamable body (e.g. a mock without a stream): buffer, then cap.
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > cap) {
      throw new SafeFetchError("TOO_LARGE", "The response was larger than the 2 MB limit.");
    }
    return { text: buffer.toString("utf8"), bytes: buffer.byteLength };
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > cap) {
      // Stop reading immediately; the caller's AbortController tears down the socket.
      throw new SafeFetchError("TOO_LARGE", "The response was larger than the 2 MB limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  return { text: buffer.toString("utf8"), bytes: buffer.byteLength };
}

/* -------------------------------------------------------------------------- */
/*                                 safeFetch                                  */
/* -------------------------------------------------------------------------- */

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Perform an SSRF-guarded outbound request. Resolves to a SafeFetchResult on
 * success; throws SafeFetchError on any block, timeout, oversize, or transport
 * error. Adds NO ambient credentials — only the supplied method/headers/body
 * are sent.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const {
    method = "GET",
    headers = {},
    body,
    sensitiveHeaders = [],
    timeoutMs = SAFE_FETCH_TIMEOUT_MS,
    maxBytes = SAFE_FETCH_MAX_BYTES,
    maxRedirects = SAFE_FETCH_MAX_REDIRECTS,
    lookup = defaultLookup,
    fetchImpl = fetch as unknown as FetchLike
  } = options;

  // Credentials that must not survive a cross-origin redirect.
  const stripOnCrossOrigin = new Set(ALWAYS_STRIP_ON_CROSS_ORIGIN);
  for (const name of sensitiveHeaders) stripOnCrossOrigin.add(name.toLowerCase());
  // Mutable copy — trimmed as we cross origins so nothing is mutated in place.
  let requestHeaders: Record<string, string> = { ...headers };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let current = await assertUrlSafe(rawUrl, lookup);

    for (let hop = 0; hop <= maxRedirects; hop++) {
      let res: Response;
      try {
        res = await fetchImpl(current.toString(), {
          method,
          headers: requestHeaders,
          body,
          signal: controller.signal,
          redirect: "manual"
        });
      } catch (error) {
        if (timedOut || (error instanceof Error && error.name === "AbortError")) {
          throw new SafeFetchError("TIMEOUT", "The service took too long to respond (10 second limit).");
        }
        throw new SafeFetchError("NETWORK_ERROR", "The service could not be reached.");
      }

      // Manual redirect handling: re-validate the destination before following.
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const location = res.headers.get("location");
        if (!location) {
          throw new SafeFetchError("REDIRECT_INVALID", "The service redirected without a destination.");
        }
        if (hop >= maxRedirects) {
          throw new SafeFetchError("TOO_MANY_REDIRECTS", "The service redirected too many times.");
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new SafeFetchError("REDIRECT_INVALID", "The service redirected to an invalid address.");
        }
        // Release the redirect body WITHOUT buffering it — a malicious server
        // could otherwise stream an unbounded body here, sidestepping the size
        // cap and exhausting memory. Cancel the stream instead of reading it.
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        // Never carry credentials across an origin boundary the caller did not
        // choose (open-redirect / compromised-host key exfiltration guard).
        if (next.origin !== current.origin) {
          requestHeaders = Object.fromEntries(
            Object.entries(requestHeaders).filter(
              ([name]) => !stripOnCrossOrigin.has(name.toLowerCase())
            )
          );
        }
        current = await assertUrlSafe(next.toString(), lookup);
        continue;
      }

      const { text, bytes } = await readBodyCapped(res, maxBytes);
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        statusText: res.statusText,
        headers: headersToRecord(res.headers),
        url: current.toString(),
        bodyText: text,
        bytesRead: bytes
      };
    }

    throw new SafeFetchError("TOO_MANY_REDIRECTS", "The service redirected too many times.");
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    if (timedOut || (error instanceof Error && error.name === "AbortError")) {
      throw new SafeFetchError("TIMEOUT", "The service took too long to respond (10 second limit).");
    }
    throw new SafeFetchError("NETWORK_ERROR", "The service could not be reached.");
  } finally {
    clearTimeout(timer);
  }
}
