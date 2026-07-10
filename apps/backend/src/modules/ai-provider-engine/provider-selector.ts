import type { AIExecuteRequest, AIProviderAdapter, AIIntent, SelectionExplanation } from "./types";
import { NoAvailableProviderError } from "./errors";

export class ProviderSelector {
  static select(
    request: AIExecuteRequest,
    adapters: AIProviderAdapter[],
    validProviderIds: Set<string>
  ): AIProviderAdapter {
    const capability = request.capability ?? "llm";

    // filter to providers that are active and support the requested capability
    const capable = adapters.filter(
      (a) => validProviderIds.has(a.providerId) && a.capabilities.includes(capability)
    );

    if (capable.length === 0) {
      throw new NoAvailableProviderError(`No active provider supports capability '${capability}'.`);
    }

    // non-LLM capabilities don't use intent scoring — pick first available
    if (capability !== "llm") return capable[0]!;

    const intent = this.classifyIntent(request);
    let best: AIProviderAdapter | null = null;
    let bestScore = -1;

    for (const adapter of capable) {
      const score = adapter.scores[intent] ?? 0;
      if (score > 0 && score > bestScore) {
        bestScore = score;
        best = adapter;
      }
    }

    if (!best) throw new NoAvailableProviderError(`No active provider supports intent '${intent}'.`);
    return best;
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
      reason: `Selected '${selected.providerId}' (score: ${scores[selected.providerId]}) for intent '${intent}'.`,
    };
  }

  private static classifyIntent(request: AIExecuteRequest): AIIntent {
    const task = request.task?.toLowerCase();
    if (task === "image" || task === "image-generation") return "image";
    if (task === "code" || task === "coding") return "code";
    if (task === "reasoning" || task === "logic") return "reasoning";

    const content = [
      request.systemPrompt ?? "",
      ...(request.messages ?? []).map((m) => m.content),
    ]
      .join(" ")
      .toLowerCase();

    if (content.includes("image") || content.includes("draw") || content.includes("picture")) return "image";
    if (content.includes("code") || content.includes("function") || content.includes("bug")) return "code";
    if (content.includes("solve") || content.includes("explain step") || content.includes("analyze")) return "reasoning";

    return "chat";
  }
}
