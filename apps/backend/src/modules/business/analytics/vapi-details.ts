import { env } from "../../../config/env";
import { isRealId, isVapiConfigured } from "../../architect/vapi-connector";

/**
 * Read-only live lookup of an agent's Vapi assistant.
 *
 * The deployed assistant is the ground truth for HOW an agent answers — model,
 * voice, transcriber, first message, tools it can call. Analytics reads it so
 * the page shows the configuration that actually handled the calls being
 * measured, not a stale local copy of the config.
 *
 * Fail-soft by contract: Vapi being unreachable, unconfigured, or slow must
 * never break the analytics page. Every failure returns a reason string that
 * the UI renders honestly instead of pretending the data is missing.
 */

export interface VapiAssistantDetails {
  id: string;
  name: string | null;
  model: { provider: string | null; model: string | null; temperature: number | null } | null;
  voice: { provider: string | null; voiceId: string | null; speed: number | null } | null;
  transcriber: { provider: string | null; model: string | null; language: string | null } | null;
  firstMessage: string | null;
  endCallMessage: string | null;
  /** Tool names the assistant can call (booking, transfer, notifications, …). */
  toolNames: string[];
  serverUrl: string | null;
  recordingEnabled: boolean | null;
  maxDurationSeconds: number | null;
  silenceTimeoutSeconds: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type VapiAssistantLookup =
  | { state: "ok"; assistant: VapiAssistantDetails }
  | { state: "unavailable"; reason: string };

const LOOKUP_TIMEOUT_MS = 10_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(source: Record<string, unknown>, key: string): number | null {
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : null;
}

function boolish(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];
  return typeof value === "boolean" ? value : null;
}

/**
 * Tool names from either the modern `model.tools[]` shape or the legacy
 * top-level `tools[]`, covering both Vapi assistant payload versions.
 */
function extractToolNames(payload: Record<string, unknown>): string[] {
  const model = record(payload.model);
  const candidates = [
    ...(Array.isArray(model.tools) ? model.tools : []),
    ...(Array.isArray(payload.tools) ? payload.tools : [])
  ];

  const names = new Set<string>();
  for (const entry of candidates) {
    const tool = record(entry);
    const fromFunction = text(record(tool.function), "name");
    const fromTool = text(tool, "name") ?? text(tool, "type");
    const name = fromFunction ?? fromTool;
    if (name) names.add(name);
  }
  return [...names].sort();
}

export async function fetchVapiAssistant(assistantId: string): Promise<VapiAssistantLookup> {
  if (!isVapiConfigured()) {
    return { state: "unavailable", reason: "Voice provider is not configured on this environment." };
  }
  if (!isRealId(assistantId)) {
    return { state: "unavailable", reason: "This agent has not been deployed to the voice provider yet." };
  }

  let response: Response;
  try {
    response = await fetch(
      `${env.VAPI_BASE_URL.replace(/\/$/, "")}/assistant/${encodeURIComponent(assistantId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
      }
    );
  } catch (error) {
    console.error("[analytics] vapi assistant lookup failed", { assistantId, error });
    return { state: "unavailable", reason: "Could not reach the voice provider." };
  }

  if (!response.ok) {
    if (response.status === 404) {
      return { state: "unavailable", reason: "The voice assistant for this agent no longer exists." };
    }
    return {
      state: "unavailable",
      reason: `Voice provider returned ${response.status} for this assistant.`
    };
  }

  const payload = record(await response.json().catch(() => ({})));
  const model = record(payload.model);
  const voice = record(payload.voice);
  const transcriber = record(payload.transcriber);
  const artifactPlan = record(payload.artifactPlan);

  return {
    state: "ok",
    assistant: {
      id: text(payload, "id") ?? assistantId,
      name: text(payload, "name"),
      model: Object.keys(model).length
        ? {
            provider: text(model, "provider"),
            model: text(model, "model"),
            temperature: numeric(model, "temperature")
          }
        : null,
      voice: Object.keys(voice).length
        ? {
            provider: text(voice, "provider"),
            voiceId: text(voice, "voiceId"),
            speed: numeric(voice, "speed")
          }
        : null,
      transcriber: Object.keys(transcriber).length
        ? {
            provider: text(transcriber, "provider"),
            model: text(transcriber, "model"),
            language: text(transcriber, "language")
          }
        : null,
      firstMessage: text(payload, "firstMessage"),
      endCallMessage: text(payload, "endCallMessage"),
      toolNames: extractToolNames(payload),
      serverUrl: text(record(payload.server), "url") ?? text(payload, "serverUrl"),
      recordingEnabled: boolish(artifactPlan, "recordingEnabled") ?? boolish(payload, "recordingEnabled"),
      maxDurationSeconds: numeric(payload, "maxDurationSeconds"),
      silenceTimeoutSeconds: numeric(payload, "silenceTimeoutSeconds"),
      createdAt: text(payload, "createdAt"),
      updatedAt: text(payload, "updatedAt")
    }
  };
}
