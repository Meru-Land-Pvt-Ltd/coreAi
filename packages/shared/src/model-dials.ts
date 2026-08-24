/**
 * WHAT DIALS A MODEL ACTUALLY HAS.
 *
 * Every model is different. Anthropic's thinking models reject `temperature`
 * outright — our Claude adapter has always known that and silently thrown the
 * value away, while the builder went on showing an architect a Temperature
 * slider they could drag and that did nothing. The screen was lying about the
 * platform, which is the same bug as a toggle that changes nothing.
 *
 * So a model declares its dials, the same way a node declares its doors
 * (docs/NODE-SOP.md). A dial a model does not have is not greyed out — it is
 * absent. One fact, one home.
 *
 * And the words are the ones an architect actually thinks in. They are building
 * a receptionist, not reading API documentation: "How much freedom", not
 * `temperature`. If a dial costs money, it says so before they publish, not
 * after the bill arrives.
 */

export type ModelDialOption = {
  value: string;
  /** What an architect picks. Plain words. */
  label: string;
  /** One short line under it. Optional. */
  note?: string;
};

export type ModelDial = {
  /** The field written onto the node, e.g. "llmTemperature". */
  key: string;
  /** Plain words. Never the provider's parameter name. */
  label: string;
  /** One line a person with no training understands. */
  help: string;
  kind: "choice" | "number";
  options?: ModelDialOption[];
  min?: number;
  max?: number;
  default: string;
  /** Shown in amber when this dial moves the bill. */
  costNote?: string;
};

/* ---------------------------------------------------------------- the dials */

const FREEDOM: ModelDial = {
  key: "llmTemperature",
  label: "How much freedom",
  help: "Exact gives the same answer every time. Creative varies its wording.",
  kind: "choice",
  default: "0.7",
  options: [
    { value: "0", label: "Exact", note: "Same answer every time" },
    { value: "0.4", label: "Careful" },
    { value: "0.7", label: "Balanced" },
    { value: "1", label: "Creative", note: "Wording varies each run" }
  ]
};

const LONGEST_ANSWER: ModelDial = {
  key: "llmMaxTokens",
  label: "Longest answer",
  help: "Roughly how much it may write before it has to stop.",
  kind: "choice",
  default: "1024",
  costNote: "A longer answer costs more.",
  options: [
    { value: "256", label: "A sentence or two" },
    { value: "1024", label: "A few paragraphs" },
    { value: "4096", label: "A page or two" },
    { value: "16384", label: "As long as it needs" }
  ]
};

/** Anthropic and OpenAI's reasoning models think before answering. */
const THINKING_DEPTH: ModelDial = {
  key: "llmReasoningEffort",
  label: "How hard it thinks",
  help: "Deeper thinking is slower and costs more, and is worth it for hard problems.",
  kind: "choice",
  default: "medium",
  costNote: "Deep thinking can cost several times more than quick.",
  options: [
    { value: "low", label: "Quick", note: "Fine for simple replies" },
    { value: "medium", label: "Normal" },
    { value: "high", label: "Deep", note: "For genuinely hard problems" }
  ]
};

const ANSWER_AS: ModelDial = {
  key: "llmOutputFormat",
  label: "Answer as",
  help: "Words for anything a person reads. Data when a later step needs to pick values out of it.",
  kind: "choice",
  default: "text",
  options: [
    { value: "text", label: "Words" },
    { value: "json", label: "Data", note: "Structured, for the next step to read" }
  ]
};

/* --------------------------------------------------------------- the families */

/**
 * Which family a model belongs to, from what we know about it.
 *
 * Deliberately narrow: a model we do not recognise gets the safe common set
 * rather than a guess. Showing a dial a model does not have is the bug this
 * file exists to prevent, so a fallback that shows FEWER dials is the correct
 * kind of wrong.
 */
export function modelDials(input: {
  providerId: string;
  /** thinking | flagship | fast | code | legacy */
  category?: string;
  modelId?: string;
}): ModelDial[] {
  const thinks = input.category === "thinking";

  // Anthropic rejects temperature on its thinking models — see
  // claude.adapter.ts, which has been quietly stripping it.
  if (input.providerId === "claude" && thinks) {
    return [THINKING_DEPTH, LONGEST_ANSWER, ANSWER_AS];
  }

  // OpenAI's o-series takes reasoning effort and refuses temperature.
  if (input.providerId === "openai" && (thinks || /^o\d/.test(input.modelId ?? ""))) {
    return [THINKING_DEPTH, LONGEST_ANSWER, ANSWER_AS];
  }

  return [FREEDOM, LONGEST_ANSWER, ANSWER_AS];
}

/** Every dial key the platform knows, for stripping anything stale off a node. */
export const ALL_DIAL_KEYS = [
  FREEDOM.key,
  LONGEST_ANSWER.key,
  THINKING_DEPTH.key,
  ANSWER_AS.key
] as const;
