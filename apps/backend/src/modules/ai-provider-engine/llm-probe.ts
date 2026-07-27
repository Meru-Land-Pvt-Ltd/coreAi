import { llmProviderApiKey } from "./llm-credentials";
import {
  llmProviderBlockReason,
  recordLlmProviderFailure,
  recordLlmProviderSuccess
} from "./llm-health";

const PROBE_TIMEOUT_MS = 6000;
const PROBE_TTL_MS = 5 * 60 * 1000;

type ProbeVerdict = { usable: boolean; reason: string | null };

const cache = new Map<string, { verdict: ProbeVerdict; until: number }>();

type ProbeRequest = { url: string; headers: Record<string, string> };

/** Cheapest authenticated read each provider offers. */
const PROBES: Record<string, (apiKey: string) => ProbeRequest> = {
  openai: (k) => ({ url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${k}` } }),
  claude: (k) => ({
    url: "https://api.anthropic.com/v1/models",
    headers: { "x-api-key": k, "anthropic-version": "2023-06-01" }
  }),
  gemini: (k) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`,
    headers: {}
  }),
  // Balance, not models: DeepSeek lists models happily on an empty account.
  deepseek: (k) => ({ url: "https://api.deepseek.com/user/balance", headers: { Authorization: `Bearer ${k}` } }),
  groq: (k) => ({ url: "https://api.groq.com/openai/v1/models", headers: { Authorization: `Bearer ${k}` } }),
  mistral: (k) => ({ url: "https://api.mistral.ai/v1/models", headers: { Authorization: `Bearer ${k}` } })
};

export function verdictFromStatus(status: number): ProbeVerdict {
  if (status === 402) return { usable: false, reason: "out of credit" };
  if (status === 401 || status === 403) return { usable: false, reason: "key rejected" };
  if (status === 429) return { usable: false, reason: "over quota" };
  // Anything else — including 5xx and unexpected codes — is not proof the
  // provider is unusable, so it stays enabled.
  return { usable: true, reason: null };
}

/** DeepSeek reports an exhausted balance in the body, with HTTP 200. */
export function verdictFromDeepSeekBalance(body: unknown): ProbeVerdict {
  const available = (body as { is_available?: unknown } | null)?.is_available;
  return available === false ? { usable: false, reason: "out of credit" } : { usable: true, reason: null };
}

async function runProbe(providerId: string, apiKey: string): Promise<ProbeVerdict> {
  const build = PROBES[providerId];
  if (!build) return { usable: true, reason: null };

  const { url, headers } = build(apiKey);

  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const verdict = verdictFromStatus(response.status);
    if (!verdict.usable) return verdict;

    if (providerId === "deepseek" && response.ok) {
      return verdictFromDeepSeekBalance(await response.json().catch(() => null));
    }
    return verdict;
  } catch {
    // Timeout / DNS / offline — say nothing rather than grey out a working provider.
    return { usable: true, reason: null };
  }
}

/**
 * Probe result for one provider, cached briefly so opening the builder
 * repeatedly does not hammer every provider's API.
 */
export async function probeLlmProvider(
  providerId: string,
  options: { force?: boolean; now?: number } = {}
): Promise<ProbeVerdict> {
  const now = options.now ?? Date.now();

  const apiKey = llmProviderApiKey(providerId);
  if (!apiKey) return { usable: false, reason: "no API key" };

  const hit = cache.get(providerId);
  if (!options.force && hit && hit.until > now) return hit.verdict;

  const verdict = await runProbe(providerId, apiKey);
  cache.set(providerId, { verdict, until: now + PROBE_TTL_MS });

  // Keep the run-failure record in step: a healthy probe means a top-up
  // landed, so the provider stops being blocked without waiting out the TTL.
  if (verdict.usable) {
    recordLlmProviderSuccess(providerId);
  } else if (verdict.reason) {
    recordLlmProviderFailure(providerId, verdict.reason);
  }

  return verdict;
}

/** Probe result combined with any failure a real run already proved. */
export async function llmProviderAvailability(
  providerId: string
): Promise<ProbeVerdict> {
  const probe = await probeLlmProvider(providerId);
  if (!probe.usable) return probe;

  const blocked = llmProviderBlockReason(providerId);
  return blocked ? { usable: false, reason: blocked } : probe;
}

/** Test seam. */
export function resetLlmProbeCache(): void {
  cache.clear();
}
