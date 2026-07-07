import type { AIExecuteRequest, AIProviderAdapter, AIIntent, SelectionExplanation } from "./types";
import { NoAvailableProviderError } from "./errors";

export class ProviderSelector {
  static select(
    request: AIExecuteRequest,
    adapters: AIProviderAdapter[],
    validProviderIds: Set<string>
  ): AIProviderAdapter {
    const intent = this.classifyIntent(request);
    let bestAdapter: AIProviderAdapter | null = null;
    let bestScore = -1;

    for (const adapter of adapters) {
      if (!validProviderIds.has(adapter.providerId)) continue;

      const score = adapter.scores[intent] ?? 0;

      // Skip unsupported intents
      if (score <= 0) continue;

      if (score > bestScore) {
        bestScore = score;
        bestAdapter = adapter;
      }
    }

    if (!bestAdapter) {
      throw new NoAvailableProviderError(`No active provider supports intent '${intent}'.`);
    }

    return bestAdapter;
  }

  static explain(
    request: AIExecuteRequest,
    adapters: AIProviderAdapter[],
    validProviderIds: Set<string>
  ): SelectionExplanation {
    const intent = this.classifyIntent(request);
    const scores: Record<string, number> = {};

    for (const adapter of adapters) {
      if (!validProviderIds.has(adapter.providerId)) continue;
      scores[adapter.providerId] = adapter.scores[intent] ?? 0;
    }

    const selected = this.select(request, adapters, validProviderIds);
    return {
      selectedProviderId: selected.providerId,
      scores,
      intent,
      reason: `Selected '${selected.providerId}' (score: ${scores[selected.providerId]}) for classified intent '${intent}'.`,
    };
  }

  // Simple intent classification based on prompt/message keywords
  private static classifyIntent(request: AIExecuteRequest): AIIntent {
    const task = request.task?.toLowerCase();
    if (task === "image" || task === "image-generation") return "image";
    if (task === "code" || task === "coding") return "code";
    if (task === "reasoning" || task === "logic") return "reasoning";

    const content = [
      request.systemPrompt ?? "",
      ...request.messages.map((m) => m.content),
    ]
      .join(" ")
      .toLowerCase();

    if (content.includes("image") || content.includes("draw") || content.includes("paint") || content.includes("picture")) {
      return "image";
    }
    if (content.includes("code") || content.includes("function") || content.includes("bug") || content.includes("script")) {
      return "code";
    }
    if (content.includes("solve") || content.includes("explain step") || content.includes("logic") || content.includes("analyze")) {
      return "reasoning";
    }

    return "chat";
  }
}
