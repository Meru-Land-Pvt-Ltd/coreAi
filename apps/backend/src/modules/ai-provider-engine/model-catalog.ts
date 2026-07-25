/**
 * Static LLM model catalog — single source of truth for both backend and frontend.
 *
 * - `id`       → the model string passed directly to the provider API
 * - `provider` → matches adapter.providerId
 * - `input`    → price per 1M input tokens in USD (null = unknown / free tier)
 * - `output`   → price per 1M output tokens in USD (null = unknown / free tier)
 */

export type ModelEntry = {
  id: string;
  provider: string;
  displayName: string;
  input: number | null;   // $ per 1M tokens
  output: number | null;  // $ per 1M tokens
};

export const MODEL_CATALOG: ModelEntry[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  { id: "gpt-5.5",       provider: "openai", displayName: "GPT-5.5",       input: 5.00,  output: 45.00  },
  { id: "gpt-5.5-pro",   provider: "openai", displayName: "GPT-5.5 Pro",   input: 30.00, output: 270.00 },
  { id: "gpt-5.4",       provider: "openai", displayName: "GPT-5.4",       input: 2.50,  output: 22.50  },
  { id: "gpt-5.4-mini",  provider: "openai", displayName: "GPT-5.4 Mini",  input: 0.75,  output: null   },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  { id: "gemini-3.6-flash",      provider: "gemini", displayName: "Gemini 3.6 Flash",      input: null, output: null },
  { id: "gemini-3.5-flash",      provider: "gemini", displayName: "Gemini 3.5 Flash",      input: null, output: null },
  { id: "gemini-3.5-flash-lite", provider: "gemini", displayName: "Gemini 3.5 Flash Lite", input: null, output: null },
  { id: "gemini-3.1-flash-lite", provider: "gemini", displayName: "Gemini 3.1 Flash Lite", input: null, output: null },

  // ── Anthropic Claude ──────────────────────────────────────────────────────
  { id: "claude-fable-5",              provider: "claude", displayName: "Claude Fable 5",     input: 10.00, output: 50.00 },
  { id: "claude-opus-5",               provider: "claude", displayName: "Claude Opus 5",      input: 5.00,  output: 25.00 },
  { id: "claude-sonnet-5",             provider: "claude", displayName: "Claude Sonnet 5",    input: 3.00,  output: 15.00 },
  { id: "claude-haiku-4-5-20251001",   provider: "claude", displayName: "Claude Haiku 4.5",  input: 1.00,  output: 5.00  },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  { id: "DeepSeek-V4-Flash", provider: "deepseek", displayName: "DeepSeek V4 Flash", input: 0.14,  output: 0.28 },
  { id: "DeepSeek-V4-Pro",   provider: "deepseek", displayName: "DeepSeek V4 Pro",   input: 0.435, output: 0.87 },

  // ── Mistral ───────────────────────────────────────────────────────────────
  { id: "mistral-medium-3-5", provider: "mistral", displayName: "Mistral Medium 3.5",          input: 1.50, output: 7.50 },
  { id: "mistral-small-2603", provider: "mistral", displayName: "Mistral Small 4 (2603)",       input: 0.15, output: 0.60 },

  // ── Groq ──────────────────────────────────────────────────────────────────
  { id: "llama-3.1-8b-instant",    provider: "groq", displayName: "Llama 3.1 8B (Groq)",       input: 0.05,  output: 0.08  },
  { id: "llama-3.3-70b-versatile", provider: "groq", displayName: "Llama 3.3 70B (Groq)",      input: 0.59,  output: 0.79  },
  { id: "openai/gpt-oss-120b",     provider: "groq", displayName: "GPT-OSS 120B (Groq)",       input: 0.15,  output: 0.60  },
  { id: "openai/gpt-oss-20b",      provider: "groq", displayName: "GPT-OSS 20B (Groq)",        input: 0.075, output: 0.30  },
];

/** Returns all model IDs for a given provider (used by adapter.models getter). */
export function getModelsForProvider(provider: string): string[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider).map((m) => m.id);
}

/** Returns a pricing lookup table for a given provider (used by adapter.pricing getter). */
export function getPricingForProvider(provider: string): Record<string, { input: number; output: number }> {
  const pricing: Record<string, { input: number; output: number }> = {};
  for (const m of MODEL_CATALOG) {
    if (m.provider === provider && m.input !== null && m.output !== null) {
      pricing[m.id] = { input: m.input, output: m.output };
    }
  }
  return pricing;
}
