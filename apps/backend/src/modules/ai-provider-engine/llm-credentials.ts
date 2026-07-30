import { env } from "../../config/env";
import { llmProviderBlockReason } from "./llm-health";

const LLM_PROVIDER_ENV_KEYS = {
  openai: ["OPENAI_API_KEY"],
  claude: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY", "OPENAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY", "OPENAI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
} as const satisfies Record<string, readonly LlmEnvKey[]>;

type LlmEnvKey =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "GEMINI_API_KEY"
  | "GOOGLE_API_KEY"
  | "GROQ_API_KEY"
  | "DEEPSEEK_API_KEY"
  | "MISTRAL_API_KEY";

const FALLBACK_ORDER = ["openai", "claude", "gemini", "groq", "deepseek", "mistral"] as const;

export const MISSING_LLM_CREDENTIALS_MESSAGE =
  "No LLM provider key is configured on the backend. Set OPENAI_API_KEY (or ANTHROPIC_API_KEY / GEMINI_API_KEY) in apps/backend/.env and restart the backend.";

export type LlmCredentialStatus = "configured" | "missing" | "unknown";

function keyIsSet(key: LlmEnvKey): boolean {
  return Boolean((env[key] ?? process.env[key])?.trim());
}

export function llmProviderApiKey(providerId: string): string {
  const keys = (LLM_PROVIDER_ENV_KEYS as Record<string, readonly LlmEnvKey[]>)[providerId];
  if (!keys) return "";

  for (const key of keys) {
    const value = (env[key] ?? process.env[key])?.trim();
    if (value) return value;
  }
  return "";
}

export function llmCredentialStatus(providerId: string): LlmCredentialStatus {
  const keys = (LLM_PROVIDER_ENV_KEYS as Record<string, readonly LlmEnvKey[]>)[providerId];
  if (!keys) return "unknown";
  return keys.some(keyIsSet) ? "configured" : "missing";
}

export type ResolvedLlmProvider = {
  providerId: string;
  fallbackFrom?: string;
};

export function resolveConfiguredLlmProvider(preferred: string): ResolvedLlmProvider | null {
  const isUsable = (candidate: string) => {
    const status = llmCredentialStatus(candidate);
    if (status === "missing") return false;
    if (status === "unknown") return true;
    return !llmProviderBlockReason(candidate);
  };

  if (isUsable(preferred)) return { providerId: preferred };

  const alternative = FALLBACK_ORDER.find(
    (candidate) => candidate !== preferred && isUsable(candidate)
  );

  if (alternative) return { providerId: alternative, fallbackFrom: preferred };

  const status = llmCredentialStatus(preferred);
  if (status !== "missing") return { providerId: preferred };

  const configuredAlt = FALLBACK_ORDER.find(
    (candidate) => candidate !== preferred && llmCredentialStatus(candidate) === "configured"
  );

  return configuredAlt ? { providerId: configuredAlt, fallbackFrom: preferred } : null;
}

export function hasAnyLlmCredentials(): boolean {
  return FALLBACK_ORDER.some((providerId) => llmCredentialStatus(providerId) === "configured");
}
