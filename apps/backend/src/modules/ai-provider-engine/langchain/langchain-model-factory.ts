/**
 * Factory: user-selected provider + model → configured LangChain chat model.
 * Standalone module — does not replace existing *.adapter.ts files.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { env } from "../../../config/env";
import { getProviderCatalog } from "./provider-model-catalog";

export type LangChainModelConfig = {
  providerId: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type LangChainModelFactoryResult = {
  providerId: string;
  model: string;
  chatModel: BaseChatModel;
};

function resolveDefaultModel(providerId: string): string {
  switch (providerId) {
    case "openai":
      return env.OPENAI_DEFAULT_MODEL;
    case "claude":
      return env.ANTHROPIC_DEFAULT_MODEL;
    case "gemini":
      return env.GEMINI_DEFAULT_MODEL;
    default:
      return "";
  }
}

function resolveApiKey(providerId: string): string {
  switch (providerId) {
    case "openai":
      return env.OPENAI_API_KEY?.trim() ?? "";
    case "claude":
      return env.ANTHROPIC_API_KEY?.trim() ?? "";
    case "gemini":
      return env.GOOGLE_AI_API_KEY?.trim() ?? "";
    default:
      return "";
  }
}

export class LangChainModelFactory {
  /** Build a LangChain chat model from architect-selected provider + model. */
  static create(config: LangChainModelConfig): LangChainModelFactoryResult {
    const providerId = config.providerId.trim().toLowerCase();
    const catalog = getProviderCatalog(providerId);
    if (!catalog) {
      throw new Error(`Unsupported LangChain provider: ${providerId}`);
    }

    const apiKey = resolveApiKey(providerId);
    if (!apiKey) {
      throw new Error(`${catalog.envKey} is not set for provider "${providerId}".`);
    }

    const model = config.model?.trim() || resolveDefaultModel(providerId);
    if (!model) {
      throw new Error(`No model configured for provider "${providerId}".`);
    }

    const temperature = config.temperature ?? 0.7;
    const maxTokens = config.maxTokens;
    let chatModel: BaseChatModel;

    switch (providerId) {
      case "openai":
        chatModel = new ChatOpenAI({
          apiKey,
          model,
          temperature,
          maxTokens,
        });
        break;

      case "claude":
        chatModel = new ChatAnthropic({
          apiKey,
          model,
          temperature,
          maxTokens,
        });
        break;

      case "gemini":
        chatModel = new ChatGoogleGenerativeAI({
          apiKey,
          model,
          temperature,
          maxOutputTokens: maxTokens,
        });
        break;

      default:
        throw new Error(`Provider "${providerId}" is not wired in LangChainModelFactory.`);
    }

    return { providerId, model, chatModel };
  }
}
