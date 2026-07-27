export type LlmTaskCategory = "thinking" | "flagship" | "fast" | "code";

export type LlmModelMeta = {
  id: string;
  providerId: string;
  displayName: string;
  category: LlmTaskCategory;
  badge: "Thinking" | "Flagship" | "Fast" | "Coding";
  inputPricePer1M: number | null;
  outputPricePer1M: number | null;
};

export type LlmProviderMeta = {
  id: string;
  displayName: string;
  /** Backend env var that must hold this provider's key. */
  envKey: string;
  /** Preselected when a node switches to this provider — the balanced tier. */
  defaultModelId: string;
};

/** Dropdown order in the builder. */
export const LLM_PROVIDERS: LlmProviderMeta[] = [
  { id: "openai", displayName: "OpenAI", envKey: "OPENAI_API_KEY", defaultModelId: "gpt-5.4-mini" },
  { id: "claude", displayName: "Anthropic Claude", envKey: "ANTHROPIC_API_KEY", defaultModelId: "claude-sonnet-5" },
  { id: "gemini", displayName: "Google Gemini", envKey: "GEMINI_API_KEY", defaultModelId: "gemini-3.5-flash" },
  { id: "deepseek", displayName: "DeepSeek", envKey: "DEEPSEEK_API_KEY", defaultModelId: "DeepSeek-V4-Flash" },
  { id: "mistral", displayName: "Mistral", envKey: "MISTRAL_API_KEY", defaultModelId: "mistral-small-2603" },
  { id: "groq", displayName: "Groq", envKey: "GROQ_API_KEY", defaultModelId: "llama-3.3-70b-versatile" }
];

export const LLM_MODELS: LlmModelMeta[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  { id: "gpt-5.5",      providerId: "openai", displayName: "GPT-5.5",      category: "flagship", badge: "Flagship", inputPricePer1M: 5.00,  outputPricePer1M: 45.00  },
  { id: "gpt-5.5-pro",  providerId: "openai", displayName: "GPT-5.5 Pro",  category: "flagship", badge: "Flagship", inputPricePer1M: 30.00, outputPricePer1M: 270.00 },
  { id: "gpt-5.4",      providerId: "openai", displayName: "GPT-5.4",      category: "flagship", badge: "Flagship", inputPricePer1M: 2.50,  outputPricePer1M: 22.50  },
  { id: "gpt-5.4-mini", providerId: "openai", displayName: "GPT-5.4 Mini", category: "fast",     badge: "Fast",     inputPricePer1M: 0.75,  outputPricePer1M: null   },

  // ── Anthropic Claude ──────────────────────────────────────────────────────
  { id: "claude-fable-5",            providerId: "claude", displayName: "Claude Fable 5",   category: "thinking", badge: "Thinking", inputPricePer1M: 10.00, outputPricePer1M: 50.00 },
  { id: "claude-opus-5",             providerId: "claude", displayName: "Claude Opus 5",    category: "thinking", badge: "Thinking", inputPricePer1M: 5.00,  outputPricePer1M: 25.00 },
  { id: "claude-sonnet-5",           providerId: "claude", displayName: "Claude Sonnet 5",  category: "flagship", badge: "Flagship", inputPricePer1M: 3.00,  outputPricePer1M: 15.00 },
  { id: "claude-haiku-4-5-20251001", providerId: "claude", displayName: "Claude Haiku 4.5", category: "fast",     badge: "Fast",     inputPricePer1M: 1.00,  outputPricePer1M: 5.00  },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  { id: "gemini-3.6-flash",      providerId: "gemini", displayName: "Gemini 3.6 Flash",      category: "flagship", badge: "Flagship", inputPricePer1M: null, outputPricePer1M: null },
  { id: "gemini-3.5-flash",      providerId: "gemini", displayName: "Gemini 3.5 Flash",      category: "flagship", badge: "Flagship", inputPricePer1M: null, outputPricePer1M: null },
  { id: "gemini-3.5-flash-lite", providerId: "gemini", displayName: "Gemini 3.5 Flash Lite", category: "fast",     badge: "Fast",     inputPricePer1M: null, outputPricePer1M: null },
  { id: "gemini-3.1-flash-lite", providerId: "gemini", displayName: "Gemini 3.1 Flash Lite", category: "fast",     badge: "Fast",     inputPricePer1M: null, outputPricePer1M: null },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  { id: "DeepSeek-V4-Flash", providerId: "deepseek", displayName: "DeepSeek V4 Flash", category: "fast",     badge: "Fast",     inputPricePer1M: 0.14,  outputPricePer1M: 0.28 },
  { id: "DeepSeek-V4-Pro",   providerId: "deepseek", displayName: "DeepSeek V4 Pro",   category: "flagship", badge: "Flagship", inputPricePer1M: 0.435, outputPricePer1M: 0.87 },

  // ── Mistral ───────────────────────────────────────────────────────────────
  { id: "mistral-medium-3-5", providerId: "mistral", displayName: "Mistral Medium 3.5",     category: "flagship", badge: "Flagship", inputPricePer1M: 1.50, outputPricePer1M: 7.50 },
  { id: "mistral-small-2603", providerId: "mistral", displayName: "Mistral Small 4 (2603)", category: "fast",     badge: "Fast",     inputPricePer1M: 0.15, outputPricePer1M: 0.60 },

  // ── Groq ──────────────────────────────────────────────────────────────────
  { id: "llama-3.1-8b-instant",    providerId: "groq", displayName: "Llama 3.1 8B (Groq)",  category: "fast",     badge: "Fast",     inputPricePer1M: 0.05,  outputPricePer1M: 0.08 },
  { id: "llama-3.3-70b-versatile", providerId: "groq", displayName: "Llama 3.3 70B (Groq)", category: "flagship", badge: "Flagship", inputPricePer1M: 0.59,  outputPricePer1M: 0.79 },
  { id: "openai/gpt-oss-120b",     providerId: "groq", displayName: "GPT-OSS 120B (Groq)",  category: "flagship", badge: "Flagship", inputPricePer1M: 0.15,  outputPricePer1M: 0.60 },
  { id: "openai/gpt-oss-20b",      providerId: "groq", displayName: "GPT-OSS 20B (Groq)",   category: "fast",     badge: "Fast",     inputPricePer1M: 0.075, outputPricePer1M: 0.30 }
];

/** Provider names workflows have been saved with over time. */
const PROVIDER_ALIASES: Record<string, string> = {
  openai: "openai",
  gpt: "openai",
  chatgpt: "openai",
  claude: "claude",
  anthropic: "claude",
  gemini: "gemini",
  google: "gemini",
  deepseek: "deepseek",
  mistral: "mistral",
  groq: "groq"
};

export const DEFAULT_LLM_PROVIDER_ID = "openai";

/** Maps saved aliases onto adapter provider ids; unknown values pass through. */
export function normalizeLlmProviderId(raw: unknown): string {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return DEFAULT_LLM_PROVIDER_ID;
  return PROVIDER_ALIASES[key] ?? key;
}

/** False for self-hosted or custom adapters this catalog says nothing about. */
export function isCatalogedLlmProvider(providerId: string): boolean {
  return LLM_PROVIDERS.some((provider) => provider.id === providerId);
}

export function getLlmProvider(providerId: string): LlmProviderMeta | null {
  return LLM_PROVIDERS.find((provider) => provider.id === providerId) ?? null;
}

export function getLlmModelsForProvider(providerId: string): LlmModelMeta[] {
  return LLM_MODELS.filter((model) => model.providerId === providerId);
}

export function findLlmModel(modelId: unknown): LlmModelMeta | null {
  const id = String(modelId ?? "").trim();
  return id ? LLM_MODELS.find((model) => model.id === id) ?? null : null;
}

/** What the builder preselects when a node switches to this provider. */
export function defaultLlmModelForProvider(providerId: string): string | null {
  const declared = getLlmProvider(providerId)?.defaultModelId;
  if (declared && findLlmModel(declared)) return declared;
  return getLlmModelsForProvider(providerId)[0]?.id ?? null;
}

export type LlmSelection = {
  providerId: string;
  /** null means "no usable model on the node" — let the adapter choose. */
  modelId: string | null;
};

export function resolveLlmSelection(rawProvider: unknown, rawModel: unknown): LlmSelection {
  const providerId = normalizeLlmProviderId(rawProvider);
  const modelId = String(rawModel ?? "").trim() || null;

  if (!isCatalogedLlmProvider(providerId)) return { providerId, modelId };

  const model = findLlmModel(modelId);
  if (model && model.providerId !== providerId) return { providerId, modelId: null };

  return { providerId, modelId };
}
