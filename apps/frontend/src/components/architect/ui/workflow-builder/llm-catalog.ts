export type TaskCategory = "thinking" | "flagship" | "fast" | "code";

export type LLMModelMeta = {
  id: string;
  providerId: string;
  displayName: string;
  category: TaskCategory;
  badge: "Thinking" | "Flagship" | "Fast" | "Coding";
};

export const LLM_MODELS: LLMModelMeta[] = [
  // OpenAI (Latest Models)
  { id: "gpt-5.5", providerId: "openai", displayName: "GPT-5.5", category: "flagship", badge: "Flagship" },
  { id: "gpt-4.5", providerId: "openai", displayName: "GPT-4.5", category: "flagship", badge: "Flagship" },
  { id: "o3-mini", providerId: "openai", displayName: "OpenAI o3-mini", category: "thinking", badge: "Thinking" },
  { id: "o1", providerId: "openai", displayName: "OpenAI o1", category: "thinking", badge: "Thinking" },
  { id: "gpt-4o", providerId: "openai", displayName: "GPT-4o", category: "flagship", badge: "Flagship" },
  { id: "gpt-4o-mini", providerId: "openai", displayName: "GPT-4o mini", category: "fast", badge: "Fast" },

  // Anthropic Claude (Latest Models)
  { id: "claude-4.6-sonnet", providerId: "claude", displayName: "Claude 4.6 Sonnet", category: "flagship", badge: "Flagship" },
  { id: "claude-opus-4.5", providerId: "claude", displayName: "Claude 4.5 Opus", category: "thinking", badge: "Thinking" },
  { id: "claude-3-5-haiku", providerId: "claude", displayName: "Claude 3.5 Haiku", category: "fast", badge: "Fast" },

  // Google Gemini (Latest Models)
  { id: "gemini-3.5-flash", providerId: "gemini", displayName: "Gemini 3.5 Flash", category: "flagship", badge: "Flagship" },
  { id: "gemini-3.1-flash-lite", providerId: "gemini", displayName: "Gemini 3.1 Flash Lite", category: "fast", badge: "Fast" },
  { id: "gemini-2.0-flash", providerId: "gemini", displayName: "Gemini 2.0 Flash", category: "fast", badge: "Fast" },
  { id: "gemini-1.5-pro", providerId: "gemini", displayName: "Gemini 1.5 Pro", category: "thinking", badge: "Thinking" },

  // DeepSeek (Latest Models)
  { id: "deepseek-r1", providerId: "deepseek", displayName: "DeepSeek R1", category: "thinking", badge: "Thinking" },
  { id: "deepseek-v3", providerId: "deepseek", displayName: "DeepSeek V3", category: "flagship", badge: "Flagship" },
  { id: "deepseek-coder", providerId: "deepseek", displayName: "DeepSeek Coder", category: "code", badge: "Coding" },

  // Groq (Latest Fast Hardware Models)
  { id: "deepseek-r1-distill-llama-70b", providerId: "groq", displayName: "DeepSeek R1 70B (Groq)", category: "thinking", badge: "Thinking" },
  { id: "llama-3.3-70b-versatile", providerId: "groq", displayName: "Llama 3.3 70B (Groq)", category: "flagship", badge: "Flagship" },
  { id: "llama-3.1-8b-instant", providerId: "groq", displayName: "Llama 3.1 8B (Groq)", category: "fast", badge: "Fast" },

  // Mistral AI
  { id: "codestral-latest", providerId: "mistral", displayName: "Codestral 22B", category: "code", badge: "Coding" },
  { id: "mistral-large-latest", providerId: "mistral", displayName: "Mistral Large", category: "flagship", badge: "Flagship" },
];
