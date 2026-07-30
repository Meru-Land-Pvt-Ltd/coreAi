/**
 * Builder view of the LLM catalog. The data lives in @coreai/shared so the
 * provider/model dropdowns here and the backend adapters stay in sync — add or
 * remove models there, not here.
 */
import * as Shared from "@coreai/shared";

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

export const isMultimodalModel =
  typeof Shared.isMultimodalModel === "function"
    ? Shared.isMultimodalModel
    : function (modelOrId?: unknown, providerId?: unknown): boolean {
        if (!modelOrId && !providerId) return true;
        const found = Shared.findLlmModel(modelOrId);
        if (found && typeof (found as any).multimodal === "boolean") {
          return Boolean((found as any).multimodal);
        }
        const pid = Shared.normalizeLlmProviderId(providerId || (found ? found.providerId : modelOrId));
        return ["openai", "claude", "gemini"].includes(pid);
      };

export type {
  LlmModelMeta,
  LlmProviderMeta,
  LlmSelection,
  LlmTaskCategory,
} from "@coreai/shared";

/** Legacy aliases kept so existing builder imports keep compiling. */
export type { LlmModelMeta as LLMModelMeta, LlmTaskCategory as TaskCategory } from "@coreai/shared";
