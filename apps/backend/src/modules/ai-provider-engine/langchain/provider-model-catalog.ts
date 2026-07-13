/**
 * Central provider + model catalog for LangChain-based execution.
 * Mirrors the existing *.adapter.ts model lists — use this when wiring
 * architect provider/model dropdowns to LangChain without touching adapters.
 *
 * Required npm packages (install in @coreai/backend when ready):
 *   @langchain/core @langchain/openai @langchain/anthropic @langchain/google-genai
 */

export type ProviderCatalogEntry = {
  id: string;
  displayName: string;
  envKey: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_AI_API_KEY";
  defaultModelEnvKey: "OPENAI_DEFAULT_MODEL" | "ANTHROPIC_DEFAULT_MODEL" | "GEMINI_DEFAULT_MODEL";
  models: string[];
};

export const PROVIDER_MODEL_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    envKey: "OPENAI_API_KEY",
    defaultModelEnvKey: "OPENAI_DEFAULT_MODEL",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  {
    id: "claude",
    displayName: "Anthropic Claude",
    envKey: "ANTHROPIC_API_KEY",
    defaultModelEnvKey: "ANTHROPIC_DEFAULT_MODEL",
    models: [
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-haiku-3-5",
      "claude-3-opus",
      "claude-3-sonnet",
      "claude-3-haiku",
    ],
  },
  {
    id: "gemini",
    displayName: "Google Gemini",
    envKey: "GOOGLE_AI_API_KEY",
    defaultModelEnvKey: "GEMINI_DEFAULT_MODEL",
    models: [
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-1.0-pro",
    ],
  },
];

export function getProviderCatalog(providerId: string): ProviderCatalogEntry | null {
  const key = providerId.trim().toLowerCase();
  return PROVIDER_MODEL_CATALOG.find((entry) => entry.id === key) ?? null;
}

export function listProviderCatalog(): ProviderCatalogEntry[] {
  return [...PROVIDER_MODEL_CATALOG];
}

export function isSupportedProviderModel(providerId: string, model: string): boolean {
  const catalog = getProviderCatalog(providerId);
  if (!catalog) return false;
  return catalog.models.includes(model.trim());
}
