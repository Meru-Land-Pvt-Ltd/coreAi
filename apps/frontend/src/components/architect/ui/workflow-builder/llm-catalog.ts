/**
 * LLM Model Catalog — static list shared across frontend and backend.
 * Add/remove models here; the rest of the UI updates automatically.
 */

export type TaskCategory = "thinking" | "flagship" | "fast" | "code";

export type LLMModelMeta = {
  id: string;
  providerId: string;
  displayName: string;
  category: TaskCategory;
  badge: "Thinking" | "Flagship" | "Fast" | "Coding";
  inputPricePer1M: number | null;   // USD, null = unknown / free tier
  outputPricePer1M: number | null;  // USD, null = unknown / free tier
};

export const LLM_MODELS: LLMModelMeta[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  { id: "gpt-5.5",      providerId: "openai", displayName: "GPT-5.5",      category: "flagship", badge: "Flagship", inputPricePer1M: 5.00,  outputPricePer1M: 45.00  },
  { id: "gpt-5.5-pro",  providerId: "openai", displayName: "GPT-5.5 Pro",  category: "flagship", badge: "Flagship", inputPricePer1M: 30.00, outputPricePer1M: 270.00 },
  { id: "gpt-5.4",      providerId: "openai", displayName: "GPT-5.4",      category: "flagship", badge: "Flagship", inputPricePer1M: 2.50,  outputPricePer1M: 22.50  },
  { id: "gpt-5.4-mini", providerId: "openai", displayName: "GPT-5.4 Mini", category: "fast",     badge: "Fast",     inputPricePer1M: 0.75,  outputPricePer1M: null   },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  { id: "gemini-3.6-flash",      providerId: "gemini", displayName: "Gemini 3.6 Flash",      category: "flagship", badge: "Flagship", inputPricePer1M: null, outputPricePer1M: null },
  { id: "gemini-3.5-flash",      providerId: "gemini", displayName: "Gemini 3.5 Flash",      category: "flagship", badge: "Flagship", inputPricePer1M: null, outputPricePer1M: null },
  { id: "gemini-3.5-flash-lite", providerId: "gemini", displayName: "Gemini 3.5 Flash Lite", category: "fast",     badge: "Fast",     inputPricePer1M: null, outputPricePer1M: null },
  { id: "gemini-3.1-flash-lite", providerId: "gemini", displayName: "Gemini 3.1 Flash Lite", category: "fast",     badge: "Fast",     inputPricePer1M: null, outputPricePer1M: null },

  // ── Anthropic Claude ──────────────────────────────────────────────────────
  { id: "claude-fable-5",            providerId: "claude", displayName: "Claude Fable 5",    category: "thinking", badge: "Thinking", inputPricePer1M: 10.00, outputPricePer1M: 50.00 },
  { id: "claude-opus-5",             providerId: "claude", displayName: "Claude Opus 5",     category: "thinking", badge: "Thinking", inputPricePer1M: 5.00,  outputPricePer1M: 25.00 },
  { id: "claude-sonnet-5",           providerId: "claude", displayName: "Claude Sonnet 5",   category: "flagship", badge: "Flagship", inputPricePer1M: 3.00,  outputPricePer1M: 15.00 },
  { id: "claude-haiku-4-5-20251001", providerId: "claude", displayName: "Claude Haiku 4.5",  category: "fast",     badge: "Fast",     inputPricePer1M: 1.00,  outputPricePer1M: 5.00  },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  { id: "DeepSeek-V4-Flash", providerId: "deepseek", displayName: "DeepSeek V4 Flash", category: "fast",     badge: "Fast",     inputPricePer1M: 0.14,  outputPricePer1M: 0.28 },
  { id: "DeepSeek-V4-Pro",   providerId: "deepseek", displayName: "DeepSeek V4 Pro",   category: "flagship", badge: "Flagship", inputPricePer1M: 0.435, outputPricePer1M: 0.87 },

  // ── Mistral ───────────────────────────────────────────────────────────────
  { id: "mistral-medium-3-5", providerId: "mistral", displayName: "Mistral Medium 3.5",    category: "flagship", badge: "Flagship", inputPricePer1M: 1.50, outputPricePer1M: 7.50 },
  { id: "mistral-small-2603", providerId: "mistral", displayName: "Mistral Small 4 (2603)", category: "fast",     badge: "Fast",     inputPricePer1M: 0.15, outputPricePer1M: 0.60 },

  // ── Groq ──────────────────────────────────────────────────────────────────
  { id: "llama-3.1-8b-instant",    providerId: "groq", displayName: "Llama 3.1 8B (Groq)",  category: "fast",     badge: "Fast",     inputPricePer1M: 0.05,  outputPricePer1M: 0.08 },
  { id: "llama-3.3-70b-versatile", providerId: "groq", displayName: "Llama 3.3 70B (Groq)", category: "flagship", badge: "Flagship", inputPricePer1M: 0.59,  outputPricePer1M: 0.79 },
  { id: "openai/gpt-oss-120b",     providerId: "groq", displayName: "GPT-OSS 120B (Groq)",  category: "flagship", badge: "Flagship", inputPricePer1M: 0.15,  outputPricePer1M: 0.60 },
  { id: "openai/gpt-oss-20b",      providerId: "groq", displayName: "GPT-OSS 20B (Groq)",   category: "fast",     badge: "Fast",     inputPricePer1M: 0.075, outputPricePer1M: 0.30 },
];
