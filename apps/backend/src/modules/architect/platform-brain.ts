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
import { llmProviderApiKey, resolveConfiguredLlmProvider } from "../ai-provider-engine/llm-credentials";
import { getBuilderBrainConfig, getBuilderEyesConfig, serviceCanSee } from "../admin/builder-brain-settings";
import type { AIExecuteRequest } from "../ai-provider-engine/types";

const FLAGSHIP: Record<string, string> = {
  mistral: "mistral-large-latest",
  claude: "claude-opus-4-5",
  openai: "gpt-5.4"
};

/**
 * SMALL JOBS GET A SMALL BRAIN (2026-08-26).
 *
 * Not every call is a judgement. Deciding which of three words a message is
 * — build, page, explain — is a reflex, and running a reflex on the flagship
 * is how an architect ends up watching a blank box: the flagship was measured
 * taking 92 seconds on one call while the router waited on a 12-second leash
 * and gave up. The rule the big labs follow and we now do: the strongest
 * model for the answer that matters, the fastest for the one that does not.
 */
const QUICK: Record<string, string> = {
  mistral: "mistral-small-latest",
  claude: "claude-haiku-4-5-20251001",
  openai: "gpt-5.4-mini"
};

/**
 * THE SEEING BRAIN — chosen by the ADMIN, never by this file.
 *
 * It was hard-coded here for exactly one afternoon (2026-08-27) as
 * "pixtral-large-latest", the platform's key did not carry that model, and
 * every screenshot an architect sent was refused — with only a developer
 * able to correct it. A model name in code is a decision the founder cannot
 * make. The eyes now read their service and model from the admin screen,
 * beside the door and page batteries.
 */

const RETRY_AFTER_MS = 2_500;

/**
 * THE SAME QUESTION, ANSWERED OUT LOUD (2026-08-26).
 *
 * A person waiting twenty-five seconds at a silent box assumes the thing is
 * broken and leaves — the fastest way to lose a customer is to make them
 * doubt the machine is alive. So the answer arrives as it is written, word
 * by word, exactly as this platform's compose hand already does.
 *
 * The provider is spoken to directly here because streaming is a different
 * shape from one-shot execution: the engine returns a finished answer, and a
 * finished answer cannot be shown while it is being thought. Everything else
 * — the model choice, the temperature, the retry — stays identical, so a
 * streamed answer and a waited-for answer are the same answer.
 */
export async function streamPlatformBrain(input: {
  instruction: string;
  message: string;
  maxTokens: number;
  task: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Screenshots the person attached — data URLs, already size-checked. */
  images?: string[];
  onWord: (chunk: string) => void;
}): Promise<string | null> {
  const resolved = resolveConfiguredLlmProvider("mistral");
  if (!resolved) return null;
  const apiKey = llmProviderApiKey(resolved.providerId);
  if (!apiKey || resolved.providerId !== "mistral") {
    /* Only Mistral speaks this shape today. Anything else falls back to the
       waited-for answer rather than pretending to stream. */
    return askPlatformBrain({ ...input, timeoutMs: 60_000 });
  }

  const images = (input.images ?? []).slice(0, 5);

  /* Pictures ride the ADMIN's chosen eyes; words ride the flagship. When the
     chosen service cannot see at all, the platform says so honestly rather
     than sending the picture into a refusal. */
  let seeingModel: string | null = null;
  if (images.length > 0) {
    const eyes = await getBuilderEyesConfig().catch(() => null);
    if (!eyes || !serviceCanSee(eyes.providerId)) {
      input.onWord(
        "I can read your words, but I cannot look at pictures yet — the seeing service is not switched on. An admin sets it in Design Brain rules → The Builder's Eyes."
      );
      return null;
    }
    if (eyes.providerId !== resolved.providerId) {
      /* The eyes live on a different service than the voice. Falling back to
         the waited-for path keeps this honest rather than sending a picture
         to the wrong provider. */
      return askPlatformBrain({ ...input, timeoutMs: 60_000 });
    }
    seeingModel = eyes.modelId || null;
  }
  const messages = [
    { role: "system", content: input.instruction },
    ...(input.history ?? []).slice(-10).map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, 2000)
    })),
    images.length > 0
      ? {
          role: "user",
          content: [
            { type: "text", text: input.message.slice(0, 24_000) },
            ...images.map((dataUrl) => ({ type: "image_url", image_url: dataUrl }))
          ]
        }
      : { role: "user", content: input.message.slice(0, 24_000) }
  ];

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        /* The admin's eyes when there are pictures; the flagship otherwise. */
        model: seeingModel ?? FLAGSHIP.mistral,
        messages,
        temperature: 0,
        max_tokens: input.maxTokens,
        stream: true
      })
    });
    if (!response.ok || !response.body) {
      console.warn(`[${input.task}] stream refused (${response.status}) — falling back`);
      return askPlatformBrain({ ...input, timeoutMs: 60_000 });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let whole = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf("\n");
      while (split !== -1) {
        const line = buffer.slice(0, split).trim();
        buffer = buffer.slice(split + 1);
        split = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const piece = parsed.choices?.[0]?.delta?.content ?? "";
          if (piece) {
            whole += piece;
            input.onWord(piece);
          }
        } catch {
          /* A half-arrived frame: the next read completes it. */
        }
      }
    }
    return whole.trim() || null;
  } catch (error) {
    console.warn(`[${input.task}] stream failed — falling back`, (error as Error).message);
    return askPlatformBrain({ ...input, timeoutMs: 60_000 });
  }
}

/** The Builder's brain, as the admin set it — blank means "the service's own". */
async function adminChosenBrainModel(): Promise<string | null> {
  const config = await getBuilderBrainConfig().catch(() => null);
  return config?.modelId || null;
}

export async function askPlatformBrain(input: {
  instruction: string;
  message: string;
  maxTokens: number;
  timeoutMs: number;
  task: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** A reflex, not a judgement — runs on the fast model. */
  quick?: boolean;
}): Promise<string | null> {
  const resolved = resolveConfiguredLlmProvider("mistral");
  if (!resolved) return null;

  const chosenModel = input.quick ? null : await adminChosenBrainModel();
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
    ...(() => {
      /* THE ADMIN'S CHOICE WINS (the founder's ruling, 2026-08-27). The
         Builder's own brain is a slot on the admin screen; only the quick
         reflex keeps its small model, because a one-word routing decision is
         not worth a flagship call. */
      const table = input.quick ? QUICK : FLAGSHIP;
      const model =
        (!input.quick && chosenModel) || table[resolved.providerId] || FLAGSHIP[resolved.providerId];
      return model ? { model } : {};
    })()
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
