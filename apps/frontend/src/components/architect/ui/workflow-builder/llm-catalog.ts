/**
 * Builder view of the LLM catalog. The data lives in @coreai/shared so the
 * provider/model dropdowns here and the backend adapters stay in sync — add or
 * remove models there, not here.
 */
export {
  DEFAULT_LLM_PROVIDER_ID,
  LLM_MODELS,
  LLM_PROVIDERS,
  defaultLlmModelForProvider,
  findLlmModel,
  getLlmModelsForProvider,
  getLlmProvider,
  normalizeLlmProviderId,
  resolveLlmSelection,
} from "@coreai/shared";

export type {
  LlmModelMeta,
  LlmProviderMeta,
  LlmSelection,
  LlmTaskCategory,
} from "@coreai/shared";

/** Legacy aliases kept so existing builder imports keep compiling. */
export type { LlmModelMeta as LLMModelMeta, LlmTaskCategory as TaskCategory } from "@coreai/shared";
