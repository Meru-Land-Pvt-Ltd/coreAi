import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../../config/env";
import type {
  AIProviderAdapter,
  AIExecuteRequest,
  AIContinueRequest,
  AIExecuteResponse,
  CostEstimate,
  ValidationResult,
  AIIntent,
  AIMessage,
  ProviderCapability,
} from "../types";
import {
  checkEnvKey,
  buildCostEstimate,
  retryOnTransient,
  parseJsonFromText,
  errorResponse,
  enrichContinueRequest,
  getCleanBase64,
  type PricingTable,
} from "./base-adapter";
import { getModelsForProvider, getPricingForProvider } from "../model-catalog";
import { findLlmModel } from "@coreai/shared";

/**
 * Anthropic rejects `temperature` outright for its thinking-generation models
 * (live probe: 400 "temperature is deprecated for this model" on
 * claude-opus-5). The claude-5 family and every Claude model the shared
 * catalog marks "thinking" therefore get NO temperature; older models keep
 * their exact behaviour.
 */
const CLAUDE_5_FAMILY = /^claude-[a-z]+-5(?:$|[.-])/;

export function modelRejectsTemperature(model: string): boolean {
  if (CLAUDE_5_FAMILY.test(model)) return true;
  const meta = findLlmModel(model);
  return meta?.providerId === "claude" && meta.category === "thinking";
}

/**
 * The defensive net for models the list above does not know yet: exactly the
 * 400 that names temperature as unsupported/deprecated — never a rate limit,
 * never an auth failure — earns one retry without the parameter.
 */
export function isTemperatureRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: unknown } | null | undefined)?.status;
  const isBadRequest = status === 400 || /\b400\b/.test(message);
  return isBadRequest && /temperature/i.test(message) && /deprecat|not supported|unsupported|unexpected|invalid/i.test(message);
}


/**
 * The architect's three words turned into a thinking budget.
 *
 * Only a model our catalog calls "thinking" gets one — sending a budget to a
 * model without the ability is a 400, and a stale dial left on a node whose
 * model has since changed must not fail the run.
 */
function thinkingBudgetFor(
  model: string,
  effort: "low" | "medium" | "high" | undefined
): number | null {
  if (!effort || !modelRejectsTemperature(model)) return null;
  if (effort === "low") return 1024;
  if (effort === "high") return 8192;
  return 4096;
}

class ClaudeAdapter implements AIProviderAdapter {
  readonly providerId = "claude";
  readonly displayName = "Anthropic Claude";
  readonly capabilities: ProviderCapability[] = ["llm"];
  readonly scores: Partial<Record<AIIntent, number>> = {
    chat: 9,
    reasoning: 10,
    code: 8,
  };

  get models(): string[] {
    return getModelsForProvider("claude");
  }

  get pricing(): PricingTable {
    return getPricingForProvider("claude");
  }

  private _client: Anthropic | null = null;
  private _clientKey: string | null = null;
  /* The client is cached, so the key it was built with is remembered next to
     it. Without this, an admin who rotates a key in the dashboard keeps
     talking to the old one until someone restarts the server — which is
     exactly what the rotation feature exists to avoid. */
  private get client(): Anthropic {
    const apiKey = env.ANTHROPIC_API_KEY ?? "";
    if (!this._client || this._clientKey !== apiKey) {
      this._client = new Anthropic({ apiKey });
      this._clientKey = apiKey;
    }
    return this._client;
  }

  private get defaultModel() {
    return "claude-sonnet-5";
  }

  async validate(): Promise<ValidationResult> {
    return checkEnvKey("ANTHROPIC_API_KEY");
  }

  async execute(request: AIExecuteRequest): Promise<AIExecuteResponse> {

    const startMs = Date.now();
    const model = request.model ?? this.defaultModel;

    try {
      const { system, messages } = this.buildPayload(request);

      // maxTokens passes straight through, so callers doing big structured
      // generations (a composed product spec runs 8k+ tokens) get what they
      // ask for; 1024 is only the floor for callers that never said.
      /* "HOW HARD IT THINKS" REACHED NOTHING. The node inspector shows this
         dial on Anthropic's thinking models, warns it can cost several times
         more, and no adapter ever sent it — every model kept its own default
         while the architect believed they had chosen. Anthropic takes it as a
         thinking budget, and the answer must have room left after the
         thinking, so the ceiling is raised to fit rather than erroring. */
      const thinkingBudget = thinkingBudgetFor(model, request.reasoningEffort);
      const maxTokens = Math.max(
        request.maxTokens ?? 1024,
        thinkingBudget ? thinkingBudget + 1024 : 0
      );

      const params = (withTemperature: boolean): Anthropic.MessageCreateParamsNonStreaming => ({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        ...(thinkingBudget
          ? { thinking: { type: "enabled" as const, budget_tokens: thinkingBudget } }
          : {}),
        /* Anthropic refuses temperature whenever thinking is on. */
        ...(withTemperature && !thinkingBudget ? { temperature: request.temperature ?? 0.7 } : {}),
      });

      let response: Anthropic.Message;
      try {
        response = await retryOnTransient(() => this.client.messages.create(params(!modelRejectsTemperature(model))));
      } catch (err) {
        // A model newer than our list just told us it rejects temperature —
        // honor that once instead of failing the caller's whole run.
        if (!modelRejectsTemperature(model) && isTemperatureRejection(err)) {
          response = await retryOnTransient(() => this.client.messages.create(params(false)));
        } else {
          throw err;
        }
      }

      const rawText = response.content.find((b) => b.type === "text")?.text ?? "";
      const usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };

      return {
        status: "success",
        capability: "llm",
        text: rawText,
        structuredOutput: request.outputFormat === "json" ? parseJsonFromText(rawText) : null,
        attachments: [],
        usage,
        cost: buildCostEstimate(request, this.pricing, this.defaultModel, usage),
        conversationId: null,
        providerMetadata: { model, stopReason: response.stop_reason ?? null, anthropicId: response.id },
        providerId: this.providerId,
        modelName: model,
        durationMs: Date.now() - startMs,
        error: null,
      };
    } catch (err) {
      return errorResponse(this.providerId, model, err instanceof Error ? err.message : String(err), Date.now() - startMs);
    }
  }

  async continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse> {
    return this.execute(enrichContinueRequest(request));
  }

  async estimateCost(request: AIExecuteRequest): Promise<CostEstimate> {
    return buildCostEstimate(request, this.pricing, this.defaultModel);
  }

  private buildPayload(request: AIExecuteRequest): {
    system: string | undefined;
    messages: Anthropic.MessageParam[];
  } {
    const history: AIMessage[] = [
      ...(request.conversationHistory ?? []),
      ...(request.messages ?? []),
    ];

    const systemParts: string[] = [];
    if (request.systemPrompt) systemParts.push(request.systemPrompt);

    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const isLast = i === history.length - 1;

      if (msg.role === "system") {
        systemParts.push(msg.content);
        continue;
      }

      const role = msg.role === "assistant" ? "assistant" : "user";

      if (role === "user" && isLast && request.attachments?.length) {
        const parts: Anthropic.ContentBlockParam[] = [{ type: "text", text: msg.content }];

        for (const att of request.attachments) {
          const data = getCleanBase64(att.data);
          if (att.mimeType.startsWith("image/")) {
            parts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: att.mimeType as Anthropic.Base64ImageSource["media_type"],
                data,
              },
            });
          } else if (att.mimeType === "application/pdf") {
            parts.push({
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data },
            });
          }
        }
        anthropicMessages.push({ role, content: parts });
      } else {
        anthropicMessages.push({ role, content: msg.content });
      }
    }

    return {
      system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages: anthropicMessages,
    };
  }
}

export default new ClaudeAdapter();
