/**
 * LangChain layer for ai-provider-engine (opt-in, standalone).
 *
 * Usage:
 *   import { executeWithLangChain, LangChainModelFactory } from "./langchain";
 *
 *   const result = await executeWithLangChain("gemini", {
 *     systemPrompt: "You are a resume reviewer.",
 *     messages: [{ role: "user", content: "Review this resume..." }],
 *     model: "gemini-2.0-flash",
 *     outputFormat: "json",
 *   });
 *
 * Install once in apps/backend:
 *   npm install @langchain/core @langchain/openai @langchain/anthropic @langchain/google-genai
 */

export {
  PROVIDER_MODEL_CATALOG,
  getProviderCatalog,
  listProviderCatalog,
  isSupportedProviderModel,
  type ProviderCatalogEntry,
} from "./provider-model-catalog";

export {
  LangChainModelFactory,
  type LangChainModelConfig,
  type LangChainModelFactoryResult,
} from "./langchain-model-factory";

export { executeWithLangChain } from "./langchain-executor";
