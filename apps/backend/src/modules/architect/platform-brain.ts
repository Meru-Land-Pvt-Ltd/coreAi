/**
 * THE PLATFORM'S OWN VOICE — one way to ask a model, shared by the AI Builder
 * and the Check button.
 *
 * Always a provider's strongest model, never its cheapest: these calls are the
 * platform's face at the exact moment an architect is most confused, and a dumb
 * answer there does more damage than the model saves in pennies.
 *
 * And always patient. The Check button runs an agent, judges it, and answers
 * follow-ups in one burst — exactly the shape that trips a provider's rate
 * limit — and the first proof run showed it: two judges "could not be reached"
 * and the follow-up went silent, all one root cause. So a failed ask waits and
 * tries once more before giving up. One retry, not a loop: a provider that is
 * down stays down, and an architect deserves an answer or an honest failure
 * inside seconds, not a spinner.
 */

import { getProviderEngine } from "../ai-provider-engine/provider-engine";
import { resolveConfiguredLlmProvider } from "../ai-provider-engine/llm-credentials";
import type { AIExecuteRequest } from "../ai-provider-engine/types";

const FLAGSHIP: Record<string, string> = {
  mistral: "mistral-large-latest",
  claude: "claude-opus-4-5",
  openai: "gpt-5.4"
};

const RETRY_AFTER_MS = 2_500;

export async function askPlatformBrain(input: {
  instruction: string;
  message: string;
  maxTokens: number;
  timeoutMs: number;
  task: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<string | null> {
  const resolved = resolveConfiguredLlmProvider("mistral");
  if (!resolved) return null;

  const request: AIExecuteRequest = {
    capability: "llm",
    systemPrompt: input.instruction,
    conversationHistory: (input.history ?? []).slice(-10).map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, 2000)
    })),
    messages: [{ role: "user", content: input.message.slice(0, 24_000) }],
    temperature: 0,
    maxTokens: input.maxTokens,
    task: input.task,
    ...(FLAGSHIP[resolved.providerId] ? { model: FLAGSHIP[resolved.providerId] } : {})
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await Promise.race([
        getProviderEngine().executeWithProvider(resolved.providerId, request),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), input.timeoutMs)
        )
      ]);
      if (response.status !== "error") {
        const text = String(response.text ?? "").trim();
        if (text) return text;
      }
    } catch (error) {
      console.warn(`[${input.task}] ask failed (attempt ${attempt + 1})`, (error as Error).message);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  }
  return null;
}
