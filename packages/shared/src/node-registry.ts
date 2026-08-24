export type NodeCategory =
  | "trigger"
  | "action"
  | "logic"
  | "data"
  | "ai"
  | "integration"
  | "product";

export type RunnerNodeKind = "trigger" | "ai" | "condition" | "connector" | "output" | "block";

export type NodeRuntime = {
  nodeKind: RunnerNodeKind;
  connector?: string;
  connectorAction?: string;
};

export type ConnectorRequirement = {
  connector: string;
  label: string;
  ownedBy: "buyer" | "platform";
  scopes?: string[];
  config?: string[];
  optional?: boolean;
  note: string;
};

/**
 * One AI door built into a node, and the standing instruction it is born
 * knowing. The job text IS the door's brain: it is handed to the door model on
 * every run, so it must describe this node's real work precisely — not doors in
 * general.
 */
export type NodeDoorJob = {
  /** Plain-language instruction the door follows every single time it runs. */
  job: string;
  /**
   * THE WHITELIST. Exactly which of this node's settings an entry door may fill
   * in — nothing else it hands back is ever applied.
   *
   * This list is the security boundary, not a hint. A door is fed the run so
   * far, and the run carries whatever a stranger typed into a published page,
   * so its reply must be treated as untrusted: without an explicit list, a
   * visitor's words could steer a setting that decides WHO is paid, WHICH
   * account is used or WHERE a request is sent.
   *
   * The rule for adding a name here: it must be part of the REQUEST this step
   * makes — an address, a parameter, a body, a message, a time. Never a
   * credential, a connection, an account, a media source, a button URL or an
   * output location. Exit doors never write config, so they never carry one.
   */
  fields?: readonly string[];
};

/**
 * The doors built INSIDE a node type. Absent means this node has no doors and
 * nothing about it changes.
 *
 *  - `entry` runs just before the node acts: it turns the customer's words and
 *    the run so far into the exact request this step needs.
 *  - `exit` runs just after: it cleans the raw reply into the smallest useful
 *    thing later steps can read.
 *
 * Doors are never canvas nodes and never appear in the palette.
 */
export type NodeDoorSpec = {
  entry?: NodeDoorJob;
  exit?: NodeDoorJob;
};

export type NodeDefinition = {
  /** Stable type slug, e.g. "action.send_sms". */
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  /** Config fields this node reads at runtime. */
  requiredConfig: string[];
  backendExecutable: boolean;
  launchCritical: boolean;
  comingSoon: boolean;
  /** data-testid friendly slug, e.g. "node-action-send-sms". */
  testId: string;
  runtime: NodeRuntime;
  /**
   * Connectors this node needs to run live, supplied by `getNodeDefinition`
   * from `REQUIRED_CONNECTORS_BY_TYPE`. Empty for platform-only/no-connector nodes.
   */
  requiredConnectors?: ConnectorRequirement[];
  /**
   * The AI doors built into this node, supplied by `getNodeDefinition` from
   * `NODE_DOORS_BY_TYPE`. Undefined for node types that have no doors.
   */
  doors?: NodeDoorSpec;
  /** Default builder config applied when the node is dropped on the canvas. */
  defaultConfig?: Record<string, unknown>;
  /** Agent-runtime capability slug, e.g. "calendar.check_availability". */
  capability?: string;
  /** Variables that must exist in the runtime context before this node can execute. */
  requiredVariables?: string[];
  /** Variables this node writes into the runtime context when it executes. */
  producedVariables?: string[];
  /**
   * This step's door in is written by the architect, in its own prompt, every
   * time it is used — so there is no fixed list of what it needs.
   *
   * True only for the AI nodes. An architect writing {{text}} needs text; one
   * writing {{callerName}} needs that instead, and the same node is correct
   * both times. Needed for the same reason as `producesNothing`: an empty
   * `requiredVariables` on a node nobody has described looks identical to an
   * empty one on a node that genuinely has no fixed needs, and the canvas has
   * to tell those apart before it can claim to have checked anything.
   */
  needsWhateverItsPromptAsksFor?: boolean;
  /**
   * This step genuinely hands nothing to the steps after it, and that is
   * correct rather than unfinished.
   *
   * Needed because silence is ambiguous. A node with no producedVariables
   * might be a trigger that really produces nothing, or one nobody has got
   * round to describing — and the honesty check has to tell those apart, or
   * "we cannot see this" quietly reads as "this is fine".
   */
  producesNothing?: boolean;
};

/** The Triven connector groups platform actions executed directly by the runner. */
export const CORE_CONNECTOR = "Triven";

export const CORE_CONNECTOR_ACTIONS = {
  saveLead: "save_lead",
  saveConversationMessage: "save_conversation_message",
  humanHandoff: "human_handoff",
  triggerNextWorkflow: "trigger_next_workflow"
} as const;

export type CoreConnectorAction =
  (typeof CORE_CONNECTOR_ACTIONS)[keyof typeof CORE_CONNECTOR_ACTIONS];

/** Hard cap on workflow-to-workflow chaining depth to prevent infinite loops. */
export const MAX_WORKFLOW_CHAIN_DEPTH = 3;

export const VOICE_NODE_TYPES = {
  phoneCallTrigger: "trigger.phone_call",
  voiceConversation: "ai.voice_conversation",
  calendarAvailability: "calendar.availability",
  bookAppointment: "calendar.book_appointment",
  sendSms: "communication.send_sms",
  sendEmail: "communication.send_email",
  endFlow: "flow.end"
} as const;

export const TELEGRAM_NODE_TYPES = {
  trigger: "trigger.telegram_message",
  sendMessage: "action.telegram_send_message",
  sendButtons: "action.telegram_send_buttons",
  answerCallback: "action.telegram_answer_callback",
  requestContact: "action.telegram_request_contact",
  sendPhoto: "action.telegram_send_photo",
  sendDocument: "action.telegram_send_document",
  sendVoice: "action.telegram_send_voice",
  sendLocation: "action.telegram_send_location",
  editMessage: "action.telegram_edit_message",
  deleteMessage: "action.telegram_delete_message"
} as const;

export const SCRIPT_NODE_TYPE = "logic.script";

/**
 * The Node Frame node — the one an architect uses to add a service we do not
 * have yet.
 *
 * Drag it in, describe the service, and it becomes that service's node. The
 * description is saved to their own toolkit, so the next agent that needs it
 * has a card in the sidebar instead of a form to fill in again.
 */
export const NODE_FRAME_NODE_TYPE = "tool.node_frame";

export const SCRIPT_LANGUAGES = ["javascript", "python"] as const;
export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];

export function isScriptLanguage(value: unknown): value is ScriptLanguage {
  return typeof value === "string" && (SCRIPT_LANGUAGES as readonly string[]).includes(value);
}

/** Falls back to JavaScript so a node saved before the field existed still runs. */
export function resolveScriptLanguage(value: unknown): ScriptLanguage {
  return isScriptLanguage(value) ? value : "javascript";
}

/** Upper bound on a single script; a runaway paste should fail in the builder, not the runner. */
export const SCRIPT_MAX_SOURCE_LENGTH = 100_000;

/** Wall-clock ceiling per execution, and the range the architect may choose from. */
export const SCRIPT_DEFAULT_TIMEOUT_MS = 10_000;
export const SCRIPT_MIN_TIMEOUT_MS = 1_000;
export const SCRIPT_MAX_TIMEOUT_MS = 60_000;

export function resolveScriptTimeoutMs(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return SCRIPT_DEFAULT_TIMEOUT_MS;
  return Math.min(SCRIPT_MAX_TIMEOUT_MS, Math.max(SCRIPT_MIN_TIMEOUT_MS, Math.round(parsed)));
}

export const SCRIPT_STARTER_CODE: Record<ScriptLanguage, string> = {
  javascript: `// \`input\` holds the workflow context so far (read-only copy).
// Whatever you return becomes this node's output.

const message = input.message ?? "";

return {
  message,
  words: String(message).split(/\\s+/).filter(Boolean).length
};
`,
  python: `# \`input\` holds the workflow context so far (read-only copy).
# Assign \`output\` (or return from main()) to set this node's output.

message = input.get("message", "")

output = {
    "message": message,
    "words": len(str(message).split()),
}
`
};

/** Calendly connector — one trigger + one action; event/action chosen in node props. */
export const CALENDLY_NODE_TYPES = {
  trigger: "trigger.calendly",
  action: "action.calendly"
} as const;

/** Deepgram speech nodes — separate STT and TTS canvas nodes. */
export const DEEPGRAM_NODE_TYPES = {
  stt: "ai.deepgram_stt",
  tts: "ai.deepgram_tts",
  /** Legacy unified node (older canvases). Prefer stt/tts. */
  speech: "ai.deepgram"
} as const;

/**
 * Product blocks — sections of the customer-facing product page (/a/<slug>)
 * and the builder's Test preview. They are Face anchors, not executors:
 * backendExecutable is false and the workflow engine skips nodeKind "block"
 * at run time (see executeSingleNodeInRunner in workflow-runner.ts).
 */
export const BLOCK_NODE_TYPES = {
  promptComposer: "block.prompt_composer",
  presetGallery: "block.preset_gallery",
  modelPicker: "block.model_picker",
  actionButton: "block.action_button",
  outputStage: "block.output_stage",
  continueChain: "block.continue_chain",
  historyShelf: "block.history_shelf"
} as const;

export type BlockNodeType = (typeof BLOCK_NODE_TYPES)[keyof typeof BLOCK_NODE_TYPES];

/** True for any product-block node slug ("block.*"), known or future. */
export function isBlockNodeType(type: string | null | undefined): boolean {
  return (type ?? "").startsWith("block.");
}

/**
 * Design Brain — the architect talks to it and the customer page restyles
 * itself (theme, layout, colors, wording). It is a canvas companion, not a
 * rendered page section and not engine work: the workflow runner skips it and
 * the Face Blueprint ignores it (its output lives in
 * PublishedAgentPage.designJson, applied via the design-chat endpoint).
 */
export const DESIGN_BRAIN_NODE_TYPE = "design.brain";

/** True only for the Design Brain node slug. */
export function isDesignBrainNodeType(type: string | null | undefined): boolean {
  return (type ?? "") === DESIGN_BRAIN_NODE_TYPE;
}

/* ------------------------------------------------------------------------ */
/* API Call node — one universal action that connects an agent to any        */
/* service on the internet (YouTube, weather, stocks…) with zero code. The   */
/* runner injects a stored key, calls the service through the SSRF-hardened   */
/* safeFetch, and saves the reply into the run so a downstream AI Brain can   */
/* read it.                                                                   */
/* ------------------------------------------------------------------------ */

/** Stable registry slug for the API Call action node. */
export const API_CALL_NODE_TYPE = "action.api_call";

/** Stable registry slug for the outbound AI voice call node. */
export const OUTBOUND_CALL_NODE_TYPE = "action.start_vapi_call";

/* ------------------------------------------------------------------------ */
/* The two ways IN. Everything else on the canvas is what an agent DOES once  */
/* something starts it; these two decide WHEN it starts without a human       */
/* typing. The schedule node fires on its own clock; the webhook node hands    */
/* out a private link another app posts to.                                    */
/* ------------------------------------------------------------------------ */

/** Stable registry slug for the schedule (timer) trigger node. */
export const SCHEDULE_NODE_TYPE = "trigger.schedule";

/** Stable registry slug for the inbound-webhook trigger node. */
export const WEBHOOK_NODE_TYPE = "trigger.webhook";

/** How often a scheduled agent runs. Kept small on purpose — v1 clarity. */
export const SCHEDULE_CADENCES = ["hourly", "daily", "weekly"] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

/**
 * The floor between two scheduled runs. A tighter clock multiplies model spend
 * with no human watching, so the smallest step we sell is one hour.
 */
export const SCHEDULE_MIN_INTERVAL_MINUTES = 60;

/** Registry connector name the runner dispatches on (case/separator-insensitive). */
export const API_CALL_CONNECTOR = "API Call";

/** Registry connectorAction for the API Call node. */
export const API_CALL_CONNECTOR_ACTION = "http_request";

/** Where the parsed reply is stored in the run context by default. */
export const API_CALL_DEFAULT_OUTPUT_KEY = "api.response";

/** Hard ceiling on outbound API Call executions per single run (SSRF/abuse guard). */
export const API_CALL_MAX_PER_RUN = 5;

/** How a stored key is supplied to the request. */
export const API_CALL_KEY_SOURCES = ["none", "my_key", "platform_youtube"] as const;
export type ApiCallKeySource = (typeof API_CALL_KEY_SOURCES)[number];

/** Where the key rides on the request. */
export const API_CALL_KEY_INJECTIONS = ["query", "header"] as const;
export type ApiCallKeyInjection = (typeof API_CALL_KEY_INJECTIONS)[number];

/** HTTP methods the API Call node offers (kept small on purpose). */
export const API_CALL_METHODS = ["GET", "POST"] as const;
export type ApiCallMethod = (typeof API_CALL_METHODS)[number];

/** Every config field the API Call node reads — shared by inspector, runtime, defaults. */
export const API_CALL_CONFIG_KEYS = [
  "apiMethod",
  "apiUrl",
  "apiHeaders",
  "apiBody",
  "apiKeySource",
  "apiKeyName",
  "apiKeyInjection",
  "apiKeyParam",
  "apiKeyPrefix",
  "apiOutputKey"
] as const;
export type ApiCallConfigKey = (typeof API_CALL_CONFIG_KEYS)[number];

/** Fresh-node defaults for the API Call node (also its registry defaultConfig). */
export const API_CALL_DEFAULT_CONFIG: Record<ApiCallConfigKey, string> = {
  apiMethod: "GET",
  apiUrl: "",
  apiHeaders: "",
  apiBody: "",
  apiKeySource: "none",
  apiKeyName: "",
  apiKeyInjection: "query",
  apiKeyParam: "",
  apiKeyPrefix: "",
  apiOutputKey: API_CALL_DEFAULT_OUTPUT_KEY
};

/**
 * One-click "YouTube channel stats" preset — a working config using the
 * platform YouTube key pool, so a demo runs out of the box with no key setup.
 * The architect can swap the @handle for any channel.
 */
export const API_CALL_YOUTUBE_PRESET: Record<ApiCallConfigKey, string> = {
  apiMethod: "GET",
  apiUrl: "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=@MrBeast",
  apiHeaders: "",
  apiBody: "",
  apiKeySource: "platform_youtube",
  apiKeyName: "",
  apiKeyInjection: "query",
  apiKeyParam: "key",
  apiKeyPrefix: "",
  apiOutputKey: API_CALL_DEFAULT_OUTPUT_KEY
};

export type DeepgramNodeMode = "stt" | "tts";

export function resolveDeepgramMode(
  type: string | null | undefined,
  mode?: string | null
): DeepgramNodeMode | null {
  const t = (type ?? "").toLowerCase();
  if (t === DEEPGRAM_NODE_TYPES.tts) return "tts";
  if (t === DEEPGRAM_NODE_TYPES.stt) return "stt";
  if (t === DEEPGRAM_NODE_TYPES.speech) {
    return mode === "tts" ? "tts" : "stt";
  }
  if (t.includes("deepgram")) {
    return mode === "tts" ? "tts" : "stt";
  }
  return null;
}

export function isDeepgramNodeType(type: string | null | undefined): boolean {
  const t = (type ?? "").toLowerCase();
  return (
    t === DEEPGRAM_NODE_TYPES.stt ||
    t === DEEPGRAM_NODE_TYPES.tts ||
    t === DEEPGRAM_NODE_TYPES.speech
  );
}

/**
 * Official Deepgram Listen model IDs (see Deepgram Models & Languages Overview).
 * Display as-is (no friendly labels).
 */
export const DEEPGRAM_STT_MODELS = [
  // Flux
  "flux-general-en",
  "flux-general-multi",
  // Nova-3
  "nova-3",
  "nova-3-general",
  "nova-3-medical",
  // Nova-2
  "nova-2",
  "nova-2-general",
  "nova-2-meeting",
  "nova-2-phonecall",
  "nova-2-finance",
  "nova-2-conversationalai",
  "nova-2-voicemail",
  "nova-2-video",
  "nova-2-medical",
  "nova-2-drivethru",
  "nova-2-automotive",
  "nova-2-atc",
  // Nova (legacy)
  "nova",
  "nova-general",
  "nova-phonecall",
  "nova-medical",
  // Enhanced
  "enhanced",
  "enhanced-general",
  "enhanced-meeting",
  "enhanced-phonecall",
  "enhanced-finance",
  // Base
  "base",
  "base-general",
  "base-meeting",
  "base-phonecall",
  "base-finance",
  "base-conversationalai",
  "base-voicemail",
  "base-video",
  // Whisper Cloud (batch / pre-recorded only)
  "whisper",
  "whisper-tiny",
  "whisper-base",
  "whisper-small",
  "whisper-medium",
  "whisper-large"
] as const;

/**
 * Domain / specialized models that only support English (`en` / `en-*`).
 * Pairing these with `multi` or non-English languages returns HTTP 400 from Deepgram.
 */
export const DEEPGRAM_ENGLISH_ONLY_STT_MODELS = [
  "nova-3-medical",
  "nova-2-meeting",
  "nova-2-phonecall",
  "nova-2-finance",
  "nova-2-conversationalai",
  "nova-2-voicemail",
  "nova-2-video",
  "nova-2-medical",
  "nova-2-drivethru",
  "nova-2-automotive",
  "nova-2-atc",
  "nova-phonecall",
  "nova-medical",
  "enhanced-meeting",
  "enhanced-phonecall",
  "enhanced-finance",
  "base-meeting",
  "base-phonecall",
  "base-finance",
  "base-conversationalai",
  "base-voicemail",
  "base-video",
  "flux-general-en"
] as const;

const DEEPGRAM_ENGLISH_ONLY_STT_MODEL_SET = new Set<string>(DEEPGRAM_ENGLISH_ONLY_STT_MODELS);

/** Models that support live microphone streaming. Whisper is batch-only. */
export const DEEPGRAM_LIVE_STT_MODELS = DEEPGRAM_STT_MODELS.filter(
  (model) => !model.startsWith("whisper")
);

export function isDeepgramLiveSttModel(model: string | null | undefined): boolean {
  const normalized = (model ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("whisper")) return false;
  return (DEEPGRAM_STT_MODELS as readonly string[]).includes(normalized);
}

export function isDeepgramEnglishOnlySttModel(model: string | null | undefined): boolean {
  const normalized = (model ?? "").trim().toLowerCase();
  return DEEPGRAM_ENGLISH_ONLY_STT_MODEL_SET.has(normalized);
}

/**
 * Coerce language so English-only models never send unsupported codes like `multi` / `es`.
 * Deepgram returns 400 "No such model/language/tier combination" otherwise.
 */
export function resolveDeepgramListenLanguage(
  model: string | null | undefined,
  language: string | null | undefined
): string {
  const resolvedLanguage = (language ?? "en").trim() || "en";
  if (!isDeepgramEnglishOnlySttModel(model)) {
    return resolvedLanguage;
  }
  if (resolvedLanguage === "en" || resolvedLanguage.toLowerCase().startsWith("en-")) {
    return resolvedLanguage;
  }
  return "en";
}

export function buildDeepgramLiveListenUrl(model: string, language: string): string {
  const resolvedModel = model.trim() || "nova-3";
  const resolvedLanguage = resolveDeepgramListenLanguage(resolvedModel, language);
  const isFlux = resolvedModel.startsWith("flux-");

  if (isFlux) {
    // Flux /v2/listen only accepts a small param set (no channels, interim_results, etc.).
    const params = new URLSearchParams({
      model: resolvedModel,
      encoding: "linear16",
      sample_rate: "16000"
    });
    // Flux English model encodes language in the model id.
    // Multilingual Flux uses language_hint instead of language=.
    if (resolvedModel === "flux-general-multi" && resolvedLanguage && resolvedLanguage !== "multi") {
      params.append("language_hint", resolvedLanguage);
    }
    return `wss://api.deepgram.com/v2/listen?${params.toString()}`;
  }

  const params = new URLSearchParams({
    model: resolvedModel,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    // Finalize trailing words after a short pause (requires interim_results).
    utterance_end_ms: "1000",
    punctuate: "true",
    smart_format: "true",
    // Slightly longer endpointing avoids cutting mid-phrase into dropped segments.
    endpointing: "500",
    mip_opt_out: "true"
  });
  if (resolvedLanguage && resolvedLanguage !== "multi") {
    params.set("language", resolvedLanguage);
  } else if (resolvedLanguage === "multi") {
    params.set("language", "multi");
  }
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

export function describeDeepgramLiveError(raw: string, model?: string | null): string {
  const text = (raw ?? "").trim();
  const modelId = (model ?? "").trim().toLowerCase();
  if (/whisper/i.test(modelId) || /whisper/i.test(text)) {
    return "Whisper models are for file transcription only. Choose nova-3 for live microphone.";
  }
  if (/No such model\/language/i.test(text) || /model\/language\/tier/i.test(text)) {
    if (isDeepgramEnglishOnlySttModel(modelId)) {
      return `${modelId || "This model"} only supports English. Switch language to English (en) and try again.`;
    }
    return "This model does not support the selected language. Switch to English or pick nova-3 / nova-2-general.";
  }
  if (/Unknown query parameters/i.test(text)) {
    return "This speech model rejected a live setting. Try nova-3, or pick another Flux model.";
  }
  if (/Unexpected server response:\s*400/i.test(text) || /\b400\b/.test(text) || /Bad Request/i.test(text)) {
    if (modelId.startsWith("flux-")) {
      return "Live transcription could not start with this Flux model. Try nova-3, or confirm Flux is enabled on your Deepgram plan.";
    }
    if (isDeepgramEnglishOnlySttModel(modelId)) {
      return `${modelId} only supports English. Switch language to English (en) and try again.`;
    }
    return "Live transcription could not start with this model. Try nova-3.";
  }
  if (/Unexpected server response:\s*401/i.test(text) || /unauthorized/i.test(text)) {
    return "Speech service authorization failed. Please try again or contact support.";
  }
  if (/Unexpected server response:\s*503/i.test(text) || /not set|api key/i.test(text)) {
    return "Speech service is temporarily unavailable. Please try again shortly.";
  }
  if (/permission|notallowed|denied/i.test(text)) {
    return "Microphone access was denied. Allow microphone permission and try again.";
  }
  if (text) return text;
  return "Could not start live transcription. Try again.";
}

export const DEEPGRAM_STT_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "hi", label: "Hindi" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "nl", label: "Dutch" },
  { value: "multi", label: "Multilingual (auto)" }
] as const;

/** Language options valid for a given official Deepgram model. */
export function getDeepgramLanguagesForModel(model: string | null | undefined) {
  if (isDeepgramEnglishOnlySttModel(model)) {
    return DEEPGRAM_STT_LANGUAGES.filter(
      (item) => item.value === "en" || item.value.startsWith("en-")
    );
  }
  return DEEPGRAM_STT_LANGUAGES;
}

/** Deepgram Speak model IDs — display as-is (no friendly labels). */
export const DEEPGRAM_TTS_VOICES = [
  // Aura-2 English
  "aura-2-amalthea-en",
  "aura-2-andromeda-en",
  "aura-2-apollo-en",
  "aura-2-arcas-en",
  "aura-2-aries-en",
  "aura-2-asteria-en",
  "aura-2-athena-en",
  "aura-2-atlas-en",
  "aura-2-aurora-en",
  "aura-2-callista-en",
  "aura-2-cora-en",
  "aura-2-cordelia-en",
  "aura-2-delia-en",
  "aura-2-draco-en",
  "aura-2-electra-en",
  "aura-2-harmonia-en",
  "aura-2-helena-en",
  "aura-2-hera-en",
  "aura-2-hermes-en",
  "aura-2-hyperion-en",
  "aura-2-iris-en",
  "aura-2-janus-en",
  "aura-2-juno-en",
  "aura-2-jupiter-en",
  "aura-2-luna-en",
  "aura-2-mars-en",
  "aura-2-minerva-en",
  "aura-2-neptune-en",
  "aura-2-odysseus-en",
  "aura-2-ophelia-en",
  "aura-2-orion-en",
  "aura-2-orpheus-en",
  "aura-2-pandora-en",
  "aura-2-phoebe-en",
  "aura-2-pluto-en",
  "aura-2-saturn-en",
  "aura-2-selene-en",
  "aura-2-thalia-en",
  "aura-2-theia-en",
  "aura-2-vesta-en",
  "aura-2-zeus-en",
  // Aura-2 Spanish
  "aura-2-agustina-es",
  "aura-2-alvaro-es",
  "aura-2-antonia-es",
  "aura-2-aquila-es",
  "aura-2-carina-es",
  "aura-2-celeste-es",
  "aura-2-diana-es",
  "aura-2-estrella-es",
  "aura-2-gloria-es",
  "aura-2-javier-es",
  "aura-2-luciano-es",
  "aura-2-nestor-es",
  "aura-2-olivia-es",
  "aura-2-selena-es",
  "aura-2-silvia-es",
  "aura-2-sirio-es",
  "aura-2-valerio-es",
  // Aura-2 Dutch
  "aura-2-beatrix-nl",
  "aura-2-cornelia-nl",
  "aura-2-daphne-nl",
  "aura-2-hestia-nl",
  "aura-2-lars-nl",
  "aura-2-leda-nl",
  "aura-2-rhea-nl",
  "aura-2-roman-nl",
  "aura-2-sander-nl",
  // Aura-2 French
  "aura-2-agathe-fr",
  "aura-2-hector-fr",
  // Aura-2 German
  "aura-2-aurelia-de",
  "aura-2-elara-de",
  "aura-2-fabian-de",
  "aura-2-julius-de",
  "aura-2-kara-de",
  "aura-2-lara-de",
  "aura-2-viktoria-de",
  // Aura-2 Italian
  "aura-2-cesare-it",
  "aura-2-cinzia-it",
  "aura-2-demetra-it",
  "aura-2-dionisio-it",
  "aura-2-elio-it",
  "aura-2-flavio-it",
  "aura-2-livia-it",
  "aura-2-maia-it",
  "aura-2-melia-it",
  "aura-2-perseo-it",
  // Aura-2 Japanese
  "aura-2-ama-ja",
  "aura-2-ebisu-ja",
  "aura-2-fujin-ja",
  "aura-2-izanami-ja",
  "aura-2-uzume-ja",
  // Aura 1 English
  "aura-asteria-en",
  "aura-luna-en",
  "aura-stella-en",
  "aura-athena-en",
  "aura-hera-en",
  "aura-orion-en",
  "aura-arcas-en",
  "aura-perseus-en",
  "aura-angus-en",
  "aura-orpheus-en",
  "aura-helios-en",
  "aura-zeus-en"
] as const;

/** Webhook / trigger event options for `trigger.calendly` (`data.calendlyEvent`). */
export const CALENDLY_TRIGGER_EVENTS = [
  {
    value: "meeting_booked",
    label: "Meeting booked",
    webhookEvent: "invitee.created",
    description: "Starts when a Calendly meeting is booked."
  },
  {
    value: "meeting_cancelled",
    label: "Meeting cancelled",
    webhookEvent: "invitee.canceled",
    description: "Starts when a Calendly meeting is cancelled."
  },
  {
    value: "meeting_rescheduled",
    label: "Meeting rescheduled",
    webhookEvent: "invitee.created",
    description: "Starts when a Calendly meeting is rescheduled."
  },
  {
    value: "routing_form_submitted",
    label: "Routing form submitted",
    webhookEvent: "routing_form_submission.created",
    description: "Starts when a Calendly routing form is submitted."
  }
] as const;

export type CalendlyTriggerEvent = (typeof CALENDLY_TRIGGER_EVENTS)[number]["value"];

/** Action options for `action.calendly` (`data.connectorAction`). */
export const CALENDLY_ACTION_OPTIONS = [
  // Existing / read helpers
  { value: "find_available_times", label: "Find available times", requiresPaidPlan: false },
  { value: "get_event", label: "Get event details", requiresPaidPlan: false },
  { value: "list_events", label: "List events", requiresPaidPlan: false },
  { value: "get_invitee", label: "Get invitee details", requiresPaidPlan: false },
  { value: "list_invitees", label: "List invitees", requiresPaidPlan: false },
  { value: "get_event_types", label: "Get event types", requiresPaidPlan: false },
  { value: "get_my_profile", label: "Get my profile", requiresPaidPlan: false },
  { value: "create_scheduling_link", label: "Create scheduling link", requiresPaidPlan: false },
  // CREATE
  {
    value: "book_meeting_for_invitee",
    label: "Book meeting for invitee",
    requiresPaidPlan: true,
    paidPlanNote: "Requires a paid Calendly plan (Scheduling API)."
  },
  { value: "cancel_event", label: "Cancel an event", requiresPaidPlan: false },
  { value: "cancel_scheduled_event", label: "Cancel scheduled event", requiresPaidPlan: false },
  {
    value: "create_contact",
    label: "Create contact",
    requiresPaidPlan: true,
    paidPlanNote: "Requires a paid Calendly plan with Contacts."
  },
  { value: "create_one_off_meeting_link", label: "Create one-off meeting link", requiresPaidPlan: false },
  {
    value: "delete_contact",
    label: "Delete contact",
    requiresPaidPlan: true,
    paidPlanNote: "Requires a paid Calendly plan with Contacts."
  },
  { value: "mark_invitee_no_show", label: "Mark invitee as no show", requiresPaidPlan: false },
  {
    value: "update_contact",
    label: "Update contact",
    requiresPaidPlan: true,
    paidPlanNote: "Requires a paid Calendly plan with Contacts."
  },
  // SEARCH
  {
    value: "find_contact",
    label: "Find contact",
    requiresPaidPlan: true,
    paidPlanNote: "Requires a paid Calendly plan with Contacts."
  },
  { value: "find_event", label: "Find event", requiresPaidPlan: false },
  { value: "find_invitee_by_email", label: "Find invitee by email", requiresPaidPlan: false },
  {
    value: "find_meeting_recap",
    label: "Find meeting recap",
    requiresPaidPlan: true,
    paidPlanNote: "Requires a paid Calendly plan with Notetaker."
  },
  {
    value: "find_meeting_recap_transcript",
    label: "Find meeting recap transcript",
    requiresPaidPlan: true,
    paidPlanNote: "Requires a paid Calendly plan with Notetaker."
  },
  { value: "find_user", label: "Find user", requiresPaidPlan: false },
  {
    value: "list_contacts",
    label: "List contacts",
    requiresPaidPlan: true,
    paidPlanNote: "Requires a paid Calendly plan with Contacts."
  }
] as const;

export type CalendlyAction = (typeof CALENDLY_ACTION_OPTIONS)[number]["value"];

export function getCalendlyActionOption(action: string) {
  return CALENDLY_ACTION_OPTIONS.find((option) => option.value === action);
}

export function calendlyActionPaidPlanNote(action: string): string | null {
  const option = getCalendlyActionOption(action);
  if (!option || !option.requiresPaidPlan) return null;
  return "paidPlanNote" in option && typeof option.paidPlanNote === "string"
    ? option.paidPlanNote
    : "Requires a paid Calendly plan.";
}

/** Per-action input/output variables for the Calendly Action node (Telegram-style mapping). */
export type CalendlyActionIo = {
  requiredVariables: string[];
  producedVariables: string[];
};

const CALENDLY_IO_BASE = ["calendly.action", "calendly.result"] as const;

const CALENDLY_IO_EVENT_RESOURCE = [
  ...CALENDLY_IO_BASE,
  "calendly.result.resource.name",
  "calendly.result.resource.status",
  "calendly.result.resource.start_time",
  "calendly.result.resource.end_time",
  "calendly.result.resource.uri"
] as const;

const CALENDLY_IO_INVITEE_RESOURCE = [
  ...CALENDLY_IO_BASE,
  "calendly.result.resource.name",
  "calendly.result.resource.email",
  "calendly.result.resource.status",
  "calendly.result.resource.timezone",
  "calendly.result.resource.uri"
] as const;

const CALENDLY_IO_CONTACT_RESOURCE = [
  ...CALENDLY_IO_BASE,
  "calendly.result.resource.name",
  "calendly.result.resource.email",
  "calendly.result.resource.uri"
] as const;

const CALENDLY_IO_COLLECTION = [
  ...CALENDLY_IO_BASE,
  "calendly.result.collection"
] as const;

const CALENDLY_IO_BOOKING_LINK = [
  ...CALENDLY_IO_BASE,
  "calendly.result.resource.booking_url",
  "calendly.result.resource.scheduling_url",
  "calendly.result.resource.owner"
] as const;

/**
 * What each Calendly `connectorAction` needs as input and publishes as output.
 * Used by the builder Advanced settings panel so mapping matches the selected action.
 */
export const CALENDLY_ACTION_IO: Record<string, CalendlyActionIo> = {
  find_available_times: {
    requiredVariables: ["calendlyEventTypeUri", "calendlyStartTime", "calendlyEndTime", "calendlyTimezone"],
    producedVariables: [...CALENDLY_IO_BASE, "calendly.result.available_times", "calendly.result.collection"]
  },
  get_event: {
    requiredVariables: ["calendlyEventUuid"],
    producedVariables: [...CALENDLY_IO_EVENT_RESOURCE]
  },
  find_event: {
    requiredVariables: ["calendlyEventUuid"],
    producedVariables: [...CALENDLY_IO_EVENT_RESOURCE]
  },
  list_events: {
    requiredVariables: [],
    producedVariables: [...CALENDLY_IO_COLLECTION]
  },
  get_invitee: {
    requiredVariables: ["calendlyEventUuid", "calendlyInviteeUuid"],
    producedVariables: [...CALENDLY_IO_INVITEE_RESOURCE]
  },
  list_invitees: {
    requiredVariables: ["calendlyEventUuid"],
    producedVariables: [...CALENDLY_IO_COLLECTION]
  },
  get_event_types: {
    requiredVariables: [],
    producedVariables: [
      ...CALENDLY_IO_COLLECTION,
      "calendly.result.collection.0.name",
      "calendly.result.collection.0.duration",
      "calendly.result.collection.0.scheduling_url"
    ]
  },
  get_my_profile: {
    requiredVariables: [],
    producedVariables: [
      ...CALENDLY_IO_BASE,
      "calendly.result.resource.name",
      "calendly.result.resource.email",
      "calendly.result.resource.timezone",
      "calendly.result.resource.scheduling_url",
      "calendly.result.resource.uri"
    ]
  },
  create_scheduling_link: {
    requiredVariables: ["calendlyEventTypeUri"],
    producedVariables: [...CALENDLY_IO_BOOKING_LINK]
  },
  book_meeting_for_invitee: {
    requiredVariables: [
      "calendlyEventTypeUri",
      "calendlyStartTime",
      "calendlyInviteeName",
      "calendlyInviteeEmail",
      "calendlyTimezone"
    ],
    producedVariables: [...CALENDLY_IO_INVITEE_RESOURCE, "calendly.result.resource.event"]
  },
  cancel_event: {
    requiredVariables: ["calendlyEventUuid"],
    producedVariables: [...CALENDLY_IO_EVENT_RESOURCE, "calendly.result.resource.cancellation.reason"]
  },
  cancel_scheduled_event: {
    requiredVariables: ["calendlyEventUuid"],
    producedVariables: [...CALENDLY_IO_EVENT_RESOURCE, "calendly.result.resource.cancellation.reason"]
  },
  create_contact: {
    requiredVariables: ["calendlyContactEmail"],
    producedVariables: [...CALENDLY_IO_CONTACT_RESOURCE]
  },
  update_contact: {
    requiredVariables: ["calendlyContactUuid"],
    producedVariables: [...CALENDLY_IO_CONTACT_RESOURCE]
  },
  delete_contact: {
    requiredVariables: ["calendlyContactUuid"],
    producedVariables: [...CALENDLY_IO_BASE]
  },
  find_contact: {
    requiredVariables: ["calendlyContactUuid"],
    producedVariables: [...CALENDLY_IO_CONTACT_RESOURCE]
  },
  list_contacts: {
    requiredVariables: [],
    producedVariables: [...CALENDLY_IO_COLLECTION]
  },
  create_one_off_meeting_link: {
    requiredVariables: [
      "calendlyMeetingName",
      "calendlyDurationMinutes",
      "calendlyOneOffStartDate",
      "calendlyOneOffEndDate",
      "calendlyTimezone"
    ],
    producedVariables: [
      ...CALENDLY_IO_BASE,
      "calendly.result.resource.name",
      "calendly.result.resource.duration",
      "calendly.result.resource.scheduling_url",
      "calendly.result.resource.booking_url",
      "calendly.result.resource.timezone"
    ]
  },
  mark_invitee_no_show: {
    requiredVariables: ["calendlyEventUuid", "calendlyInviteeUuid"],
    producedVariables: [...CALENDLY_IO_INVITEE_RESOURCE]
  },
  find_invitee_by_email: {
    requiredVariables: ["calendlyInviteeEmail"],
    producedVariables: [...CALENDLY_IO_COLLECTION, "calendly.result.resource.name", "calendly.result.resource.email"]
  },
  find_meeting_recap: {
    requiredVariables: ["calendlyMeetingRecapUuid"],
    producedVariables: [...CALENDLY_IO_BASE, "calendly.result.resource.uri", "calendly.result.resource.status"]
  },
  find_meeting_recap_transcript: {
    requiredVariables: ["calendlyMeetingRecapUuid"],
    producedVariables: [...CALENDLY_IO_BASE, "calendly.result.resource.uri"]
  },
  find_user: {
    requiredVariables: ["calendlyUserSearch"],
    producedVariables: [
      ...CALENDLY_IO_BASE,
      "calendly.result.resource.name",
      "calendly.result.resource.email",
      "calendly.result.resource.scheduling_url",
      "calendly.result.resource.timezone",
      "calendly.result.resource.uri"
    ]
  }
};

export function getCalendlyActionIo(action: string): CalendlyActionIo {
  return (
    CALENDLY_ACTION_IO[action] ?? {
      requiredVariables: [],
      producedVariables: [...CALENDLY_IO_BASE]
    }
  );
}

/** Plain-language name + when to use it (builder Advanced settings). */
export type CalendlyVariableGuide = {
  label: string;
  tip: string;
};

const CALENDLY_VARIABLE_GUIDE: Record<string, CalendlyVariableGuide> = {
  calendlyEventTypeUri: {
    label: "Event type",
    tip: "Which Calendly meeting type this step should use"
  },
  calendlyEventUuid: {
    label: "Event",
    tip: "The booked meeting this step should look up or change"
  },
  calendlyInviteeUuid: {
    label: "Invitee",
    tip: "The person who booked (guest) on that meeting"
  },
  calendlyStartTime: {
    label: "Start time",
    tip: "When the meeting window or booking starts"
  },
  calendlyEndTime: {
    label: "End time",
    tip: "When the meeting window ends"
  },
  calendlyTimezone: {
    label: "Timezone",
    tip: "Timezone for the times above (e.g. America/New_York)"
  },
  calendlyInviteeName: {
    label: "Guest name",
    tip: "Name of the person you are booking for"
  },
  calendlyInviteeEmail: {
    label: "Guest email",
    tip: "Email of the person you are booking for"
  },
  calendlyDurationMinutes: {
    label: "Meeting length",
    tip: "How long the meeting should be, in minutes"
  },
  calendlyOneOffStartDate: {
    label: "Window start",
    tip: "First day people can book this one-off link"
  },
  calendlyOneOffEndDate: {
    label: "Window end",
    tip: "Last day people can book this one-off link"
  },
  calendlyCancelReason: {
    label: "Cancel reason",
    tip: "Optional note explaining why the meeting was cancelled"
  },
  calendlyContactUuid: {
    label: "Contact ID",
    tip: "Calendly contact to find, update, or delete"
  },
  calendlyContactEmail: {
    label: "Contact email",
    tip: "Email for the Calendly contact"
  },
  calendlyContactFirstName: {
    label: "Contact first name",
    tip: "First name for the Calendly contact"
  },
  calendlyContactLastName: {
    label: "Contact last name",
    tip: "Last name for the Calendly contact"
  },
  calendlyContactName: {
    label: "Contact full name",
    tip: "Full name for the Calendly contact"
  },
  calendlyLocationKind: {
    label: "Meeting location type",
    tip: "Zoom, phone, in person, etc."
  },
  calendlyLocation: {
    label: "Location details",
    tip: "Address, phone number, or custom meeting link"
  },
  calendlyMeetingName: {
    label: "Meeting name",
    tip: "Title shown on the one-off meeting link"
  },
  calendlyMeetingRecapUuid: {
    label: "Meeting recap ID",
    tip: "Which Calendly meeting recap / transcript to load"
  },
  calendlyUserSearch: {
    label: "User search",
    tip: "Name or email used to find a Calendly user"
  },
  calendlyUserUuid: {
    label: "User ID",
    tip: "Exact Calendly user ID (optional if you search by name/email)"
  },
  "calendly.action": {
    label: "Action that ran",
    tip: "Name of the Calendly action this step just finished"
  },
  "calendly.result": {
    label: "Full result",
    tip: "Complete Calendly response — use when you need the whole object"
  },
  "calendly.result.collection": {
    label: "Result list",
    tip: "List of matches (events, invitees, contacts, etc.)"
  },
  "calendly.result.available_times": {
    label: "Open time slots",
    tip: "Available booking times — use these to offer options to the customer"
  },
  "calendly.result.resource.name": {
    label: "Name",
    tip: "Meeting name, guest name, or contact name from the result"
  },
  "calendly.result.resource.full_name": {
    label: "Full name",
    tip: "Guest or contact full name (backup if Name is empty)"
  },
  "calendly.result.resource.email": {
    label: "Email",
    tip: "Guest, contact, or profile email from the result"
  },
  "calendly.result.resource.status": {
    label: "Status",
    tip: "e.g. active, canceled — useful in confirmation messages"
  },
  "calendly.result.resource.start_time": {
    label: "Starts at",
    tip: "Meeting start time — paste into SMS, email, or AI replies"
  },
  "calendly.result.resource.end_time": {
    label: "Ends at",
    tip: "Meeting end time"
  },
  "calendly.result.resource.duration": {
    label: "Duration",
    tip: "Meeting length from Calendly"
  },
  "calendly.result.resource.duration_minutes": {
    label: "Duration (minutes)",
    tip: "Meeting length in minutes (backup if Duration is empty)"
  },
  "calendly.result.resource.timezone": {
    label: "Timezone",
    tip: "Timezone on the meeting, invitee, or profile"
  },
  "calendly.result.resource.time_zone": {
    label: "Timezone (backup)",
    tip: "Same as Timezone if Calendly used a different field name"
  },
  "calendly.result.resource.uri": {
    label: "Calendly record link",
    tip: "Internal Calendly ID/URL for this record (advanced)"
  },
  "calendly.result.resource.booking_url": {
    label: "Booking link",
    tip: "Send this link to the customer so they can book"
  },
  "calendly.result.resource.scheduling_url": {
    label: "Scheduling page",
    tip: "Public Calendly page / booking URL"
  },
  "calendly.result.resource.join_url": {
    label: "Join link",
    tip: "Video call join link when available"
  },
  "calendly.result.resource.url": {
    label: "Link",
    tip: "Generic URL from the result (backup)"
  },
  "calendly.result.resource.owner": {
    label: "Owner",
    tip: "Which Calendly event type owns this scheduling link"
  },
  "calendly.result.resource.event": {
    label: "Booked event",
    tip: "The meeting that was created for the invitee"
  },
  "calendly.result.resource.cancellation.reason": {
    label: "Cancel reason",
    tip: "Why the meeting was cancelled"
  },
  "calendly.result.collection.0.name": {
    label: "First item name",
    tip: "Name from the first item in the list (e.g. first event type)"
  },
  "calendly.result.collection.0.duration": {
    label: "First item duration",
    tip: "Duration from the first item in the list"
  },
  "calendly.result.collection.0.scheduling_url": {
    label: "First item booking page",
    tip: "Scheduling URL from the first item in the list"
  }
};

export function getCalendlyVariableGuide(key: string): CalendlyVariableGuide {
  const known = CALENDLY_VARIABLE_GUIDE[key];
  if (known) return known;
  const label = key
    .replace(/^calendly\./, "")
    .replace(/[_.]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return {
    label,
    tip: "Copy and paste into a later step’s message or field"
  };
}

/** Legacy multi-node Calendly types — still recognized for older canvases. */
export const CALENDLY_LEGACY_TRIGGER_TYPES: Record<string, CalendlyTriggerEvent> = {
  "trigger.calendly_meeting_booked": "meeting_booked",
  "trigger.calendly_meeting_cancelled": "meeting_cancelled",
  "trigger.calendly_meeting_rescheduled": "meeting_rescheduled",
  "trigger.calendly_routing_form_submitted": "routing_form_submitted"
};

export const VOICE_TEMPLATE_NODE_ORDER: string[] = [
  VOICE_NODE_TYPES.phoneCallTrigger,
  VOICE_NODE_TYPES.voiceConversation,
  VOICE_NODE_TYPES.calendarAvailability,
  VOICE_NODE_TYPES.bookAppointment,
  VOICE_NODE_TYPES.sendEmail,
  VOICE_NODE_TYPES.endFlow
];

export const BROWSER_CALL_START_MESSAGE = "__browser_call_start__";

/** Vapi function-tool names the deployed assistant calls back into our webhook. */
export const VOICE_TOOL_NAMES = {
  checkAvailability: "check_availability",
  bookAppointment: "book_appointment",
  cancelAppointment: "cancel_appointment",
  rescheduleAppointment: "reschedule_appointment",
  updateAppointmentContact: "update_appointment_contact",
  sendNotification: "send_notification",
  recordSmsConsent: "record_sms_consent",
  lookupKnowledge: "lookup_knowledge",
  verifyAndLookupAppointment: "verify_and_lookup_appointment",
  transferToHuman: "transfer_to_human"
} as const;

export const DEFAULT_VOICE_PROVIDER = "11labs";

export const PLATFORM_DEFAULT_VOICE_ID = "triven-default";

export type VoiceProviderId = "11labs" | "cartesia";

export type AgentVoicePreset = {
  id: string;
  name: string;
  provider: VoiceProviderId;
  voiceId: string;
  style: string;
  bestFor: string;
  description: string;
  previewText: string;
  isDefault?: boolean;
};

export const VOICE_PRESETS: AgentVoicePreset[] = [
  {
    id: PLATFORM_DEFAULT_VOICE_ID,
    name: "Triven Default Voice",
    provider: "cartesia",
    voiceId: "",
    style: "Platform default",
    bestFor: "All agent templates",
    description: "Uses CARTESIA_DEFAULT_VOICE_ID from production env.",
    previewText: "Hello, this is your Triven AI agent. How can I help you today?",
    isDefault: true
  },
  {
    id: "skylar",
    name: "Skylar",
    provider: "cartesia",
    voiceId: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
    style: "Friendly guide",
    bestFor: "Customer care, clinics, appointment booking",
    description: "Approachable American female voice for customer care and support.",
    previewText: "Hi, this is Skylar. How can I help you today?"
  },
  {
    id: "ella",
    name: "Ella",
    provider: "cartesia",
    voiceId: "2a12b36c-7f9b-4c3a-9f7a-72731b15323a",
    style: "Caring scout",
    bestFor: "Everyday customer conversations, front desk, support",
    description: "Approachable female voice for bright, lightweight customer conversations.",
    previewText: "Hi there, this is Ella. What can I do for you today?"
  },
  {
    id: "jacqueline",
    name: "Jacqueline",
    provider: "cartesia",
    voiceId: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
    style: "Reassuring agent",
    bestFor: "Empathic support, healthcare, complaint handling",
    description: "Confident young-adult female voice for empathic customer support.",
    previewText: "Hello, this is Jacqueline. I am here to help — what do you need?"
  },
  {
    id: "blake",
    name: "Blake",
    provider: "cartesia",
    voiceId: "a167e0f3-df7e-4d52-a9c3-f949145efdab",
    style: "Helpful agent",
    bestFor: "Home services, retail, high-energy front desk",
    description: "Energetic adult male voice for engaging customer support.",
    previewText: "Hey, this is Blake. Thanks for calling — how can I help?"
  },
  {
    id: "ronald",
    name: "Ronald",
    provider: "cartesia",
    voiceId: "5ee9feff-1265-424a-9d7f-8e4d431a12c7",
    style: "Male conversational",
    bestFor: "Home services, automotive, B2B",
    description: "Deep young-adult male voice for casual conversations.",
    previewText: "Hello, this is Ronald. Thanks for calling. How can I help?"
  }
];

export function getVoicePreset(id: string): AgentVoicePreset | undefined {
  const key = (id || PLATFORM_DEFAULT_VOICE_ID).trim().toLowerCase();
  return VOICE_PRESETS.find((preset) => preset.id === key);
}

export const RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE = `You are {{assistantName}}, the AI receptionist for {{business_name}}.

Your job: answer calls for this {{business_type}}, help callers book appointments, and answer basic questions.

CURRENT DATE & TIME (CRITICAL):
- The current date and time is {{currentDateTime}} ({{timeZone}}).
- For relative dates like "today", "tomorrow", or "next Monday", ALWAYS calculate the exact calendar date from {{currentDateTime}}.
- Pass dates to tools as YYYY-MM-DD computed from {{currentDateTime}} — never a date from memory or training data.
- NEVER call check_availability or book_appointment with a past date. If unsure, ask the caller to confirm the date.
- Always confirm the chosen date and time back to the caller in {{timeZone}} before booking.

BUSINESS DETAILS:
- Name: {{business_name}}
- Contact: {{contact_name}}
- Type: {{business_type}}
- Hours: {{business_hours}}
- Services: {{services_list}}

CALENDAR BOOKING RULES:
{{calendar_booking_rules}}

RULES:
1. Always be warm, friendly, and professional.
2. When a caller wants to book, call check_availability first.
3. Offer the available slots and let the caller choose.
4. After they choose, call book_appointment to confirm.
5. After booking, follow the SMS consent rules: read the SMS consent disclosure, record the answer with record_sms_consent, and only call send_notification if consent was recorded as yes.
6. If you cannot help with something, say: "{{fallback_response}}"
7. Never make up availability. Always check the calendar.
8. To cancel an appointment, use the cancel_appointment tool. It verifies the caller by their incoming caller ID only — never verify by a phone number the caller says out loud, never reveal stored numbers or appointment details when verification fails, and cancel only after the caller clearly says yes.

BEFORE CALLING book_appointment YOU MUST HAVE:
- the caller's REAL full name
- a callback phone number
- the service type
- the date
- the time
Never call book_appointment with a placeholder name (e.g. John Doe, Full Name, or "the caller"). If the caller's name is unclear, ask them to repeat it and confirm the spelling before booking.

SILENCE / NO-ANSWER POLICY:
{{silence_policy}}

CUSTOM INSTRUCTIONS:
{{custom_instructions}}

CONVERSATION STYLE:
- Keep responses short (1-2 sentences max)
- Sound natural, not robotic
- Use the caller's name after they give it
- Confirm details by repeating them back`;

/** Default silence/no-answer reprompt + goodbye copy (buyer can override in setup). */
export const DEFAULT_SILENCE = {
  repromptCount: 2,
  reprompt1: "Are you still there? I can help you book an appointment or answer a quick question.",
  reprompt2: "No problem. If now is not a good time, you can call us back anytime.",
  goodbye: "Thanks for calling. I'll end the call for now. Have a great day."
} as const;

export type SilenceConfig = {
  repromptCount?: number;
  reprompt1?: string;
  reprompt2?: string;
  goodbye?: string;
};

/** Render the silence/no-answer policy block injected into the system prompt. */
export function buildSilencePolicy(cfg?: SilenceConfig): string {
  const count =
    cfg?.repromptCount && cfg.repromptCount > 0 ? Math.min(Math.floor(cfg.repromptCount), 3) : DEFAULT_SILENCE.repromptCount;
  const reprompt1 = (cfg?.reprompt1 || DEFAULT_SILENCE.reprompt1).trim();
  const reprompt2 = (cfg?.reprompt2 || DEFAULT_SILENCE.reprompt2).trim();
  const goodbye = (cfg?.goodbye || DEFAULT_SILENCE.goodbye).trim();

  const lines = [
    `If the caller does not respond or stays silent, re-prompt warmly up to ${count} time(s) before ending the call.`,
    `- 1st silence, say: "${reprompt1}"`
  ];
  if (count >= 2) lines.push(`- 2nd silence, say: "${reprompt2}"`);
  lines.push(`- After ${count} attempt(s) with no response, say: "${goodbye}" and end the call politely.`);
  return lines.join("\n");
}

/** Default calendar booking rules. {{timeZone}} is filled by Vapi at call time. */
export const DEFAULT_CALENDAR_BOOKING_RULES = [
  "- Offer the earliest available slots first and never double-book.",
  "- All times are in the business timezone ({{timeZone}}); confirm the date and time back to the caller before booking.",
  "- Use the default appointment length unless the caller asks for something different."
].join("\n");

/** Quick-add custom-instruction suggestions surfaced as chips in buyer setup. */
export const CUSTOM_INSTRUCTION_SUGGESTIONS: string[] = [
  "Mention parking available in rear",
  "Direct detailed pricing inquiries to website",
  "Escalate urgent calls",
  "Collect insurance provider if caller asks",
  "Mention online portal for test results",
  "Confirm email address for follow-up details"
];

function slug(type: string) {
  return `node-${type.replace(/[._]/g, "-")}`;
}

function def(input: Omit<NodeDefinition, "testId">): NodeDefinition {
  return { ...input, testId: slug(input.type) };
}

export const NODE_DEFINITIONS: NodeDefinition[] = [
  // ---- A. Launch-critical (Missed Call Text-Back) ----
  def({
    type: "trigger.twilio_missed_call",
    label: "Missed call",
    category: "trigger",
    description: "Starts the workflow when a call goes unanswered (no-answer/busy/failed).",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "trigger" }
  }),
  def({
    type: "trigger.twilio_inbound_sms",
    label: "Text message",
    category: "trigger",
    description: "Marks the inbound-SMS entry. Inbound texts are handled by the SMS webhook.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "trigger" }
  }),
  def({
    type: "trigger.whatsapp_message_received",
    label: "WhatsApp message",
    category: "trigger",
    description: "Starts when a WhatsApp message arrives on a connected Meta Cloud API number.",
    requiredConfig: ["connectionId"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "trigger", connector: "WhatsApp" },
    defaultConfig: {
      connectionId: "",
      listenFor: "all",
      ignoreGroups: "true",
      ignoreStatusMessages: "true"
    },
    capability: "trigger.whatsapp",
    requiredVariables: [],
    producedVariables: [
      "contact.name",
      "contact.phone",
      "message.id",
      "message.type",
      "message.text",
      "media.url",
      "timestamp"
    ]
  }),
  def({
    type: TELEGRAM_NODE_TYPES.trigger,
    label: "Telegram message",
    category: "trigger",
    description: "Starts the workflow from a private message, command, callback, contact, media, or location event.",
    requiredConfig: [
      "telegramBotNameTemplate",
      "telegramBotDescription",
      "telegramBotShortDescription",
      "telegramWelcomeMessage",
      "telegramFallbackMessage"
    ],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "trigger", connector: "Telegram" },
    /* Generic by default. Booking is ONE thing a Telegram bot can do, not what
       it is — a gym, a law firm or a shop should be able to drop this trigger in
       and wire it to whatever the workflow does. Turning telegramBookingMode on
       adds the built-in appointment commands on top.

       Only NEW nodes take these defaults; workflows already saved carry their
       own values, and the runtime still falls back to booking mode when the key
       is absent, so existing booking bots are unaffected. */
    defaultConfig: {
      telegramBotNameTemplate: "{{business.name}} Assistant",
      telegramBotDescription: "Chat with {{business.name}} on Telegram.",
      telegramBotShortDescription: "Chat with {{business.name}}.",
      telegramWelcomeMessage: "Hi! You're chatting with {{business.name}}. How can I help?",
      telegramFallbackMessage: "Sorry, I didn't catch that. Send /help to see what I can do.",
      telegramEventType: "message",
      telegramCommand: "",
      telegramKeywords: "",
      telegramMatchType: "contains",
      telegramChatAccess: "private",
      telegramIgnoreBots: "true",
      // Appointment features are opt-in; the workflow itself handles the rest.
      telegramBookingMode: "false",
      telegramServicesCommand: "false",
      telegramBookCommand: "false",
      telegramMyBookingsCommand: "false",
      telegramRescheduleCommand: "false",
      telegramCancelCommand: "false",
      telegramHelpCommand: "true",
      telegramCustomCommands: [],
      telegramRequestPhone: "false",
      telegramRequestEmail: "false",
      telegramRequestNotes: "false"
    },
    capability: "telegram.update.received",
    producedVariables: [
      "trigger.telegram.updateId",
      "trigger.telegram.eventType",
      "trigger.telegram.chat.id",
      "trigger.telegram.chat.type",
      "trigger.telegram.sender.id",
      "trigger.telegram.sender.username",
      "trigger.telegram.sender.firstName",
      "trigger.telegram.sender.lastName",
      "trigger.telegram.message.id",
      "trigger.telegram.message.text",
      "trigger.telegram.message.caption",
      "trigger.telegram.callback.id",
      "trigger.telegram.callback.data",
      "trigger.telegram.contact.phoneNumber",
      "trigger.telegram.media.type",
      "trigger.telegram.media.fileId",
      "trigger.telegram.location.latitude",
      "trigger.telegram.location.longitude",
      "telegram.chat_id",
      "telegram.user_id",
      "telegram.username",
      "telegram.message_id",
      "telegram.text"
    ]
  }),
  def({
    type: TELEGRAM_NODE_TYPES.sendMessage,
    label: "Send Telegram",
    category: "action",
    description: "Sends a text message through the installed business bot.",
    requiredConfig: ["telegramMessageText"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Telegram Bot", connectorAction: "send_message" },
    defaultConfig: {
      telegramRecipientSource: "trigger_chat",
      telegramChatIdExpression: "{{trigger.telegram.chat.id}}",
      telegramMessageText: "{{ai.output}}",
      telegramParseMode: "none",
      telegramDisableNotification: "false",
      telegramProtectContent: "false"
    },
    capability: "telegram.send_message",
    requiredVariables: ["trigger.telegram.chat.id"],
    producedVariables: [
      "telegram.action.success",
      "telegram.action.chatId",
      "telegram.action.messageId",
      "telegram.action.actionType",
      "telegram.action.telegramConnectionId"
    ]
  }),
  def({
    type: TELEGRAM_NODE_TYPES.sendButtons,
    label: "Telegram buttons",
    category: "action",
    description: "Sends text with callback or URL buttons arranged in rows.",
    requiredConfig: ["telegramMessageText", "telegramButtonsJson"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Telegram Bot", connectorAction: "send_buttons" },
    defaultConfig: {
      telegramRecipientSource: "trigger_chat",
      telegramChatIdExpression: "{{trigger.telegram.chat.id}}",
      telegramMessageText: "Choose an option:",
      telegramButtonsJson:
        '[[{"text":"View services","callbackData":"nav:services"},{"text":"Book","callbackData":"nav:book"}]]',
      telegramParseMode: "none"
    },
    capability: "telegram.send_buttons",
    requiredVariables: ["trigger.telegram.chat.id"],
    producedVariables: ["telegram.action.success", "telegram.action.chatId", "telegram.action.messageId"]
  }),
  def({
    type: TELEGRAM_NODE_TYPES.answerCallback,
    label: "Confirm button tap",
    category: "action",
    description: "Acknowledges a Telegram inline-button callback query.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Telegram Bot", connectorAction: "answer_callback" },
    defaultConfig: {
      telegramCallbackIdExpression: "{{trigger.telegram.callback.id}}",
      telegramCallbackText: "",
      telegramShowAlert: "false"
    },
    capability: "telegram.answer_callback",
    requiredVariables: ["trigger.telegram.callback.id"],
    producedVariables: ["telegram.action.success", "telegram.action.actionType"]
  }),
  def({
    type: TELEGRAM_NODE_TYPES.requestContact,
    label: "Ask for phone number",
    category: "action",
    description: "Asks a private-chat user to share their phone contact, with a manual-entry fallback.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Telegram Bot", connectorAction: "request_contact" },
    defaultConfig: {
      telegramRecipientSource: "trigger_chat",
      telegramChatIdExpression: "{{trigger.telegram.chat.id}}",
      telegramMessageText: "Share your phone number or type it in international format.",
      telegramContactButtonText: "Share my phone number"
    },
    capability: "telegram.request_contact",
    requiredVariables: ["trigger.telegram.chat.id"],
    producedVariables: ["telegram.action.success", "telegram.action.chatId", "telegram.action.messageId"]
  }),
  ...([
    [TELEGRAM_NODE_TYPES.sendPhoto, "Send photo", "send_photo", "telegramPhotoSource", "Photo"],
    [TELEGRAM_NODE_TYPES.sendDocument, "Send file", "send_document", "telegramDocumentSource", "Document"],
    [TELEGRAM_NODE_TYPES.sendVoice, "Send voice note", "send_voice", "telegramVoiceSource", "Voice"]
  ] as const).map(([type, label, connectorAction, sourceField, mediaLabel]) =>
    def({
      type,
      label,
      category: "action",
      description: `Sends a ${mediaLabel.toLowerCase()} using a Telegram file ID or public HTTPS URL.`,
      requiredConfig: [sourceField],
      backendExecutable: true,
      launchCritical: false,
      comingSoon: false,
      runtime: { nodeKind: "connector", connector: "Telegram Bot", connectorAction },
      defaultConfig: {
        telegramRecipientSource: "trigger_chat",
        telegramChatIdExpression: "{{trigger.telegram.chat.id}}",
        [sourceField]: "",
        telegramCaption: ""
      },
      capability: `telegram.${connectorAction}`,
      requiredVariables: ["trigger.telegram.chat.id"],
      producedVariables: ["telegram.action.success", "telegram.action.chatId", "telegram.action.messageId"]
    })
  ),
  def({
    type: TELEGRAM_NODE_TYPES.sendLocation,
    label: "Send location",
    category: "action",
    description: "Sends a geographic location through the installed business bot.",
    requiredConfig: ["telegramLatitude", "telegramLongitude"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Telegram Bot", connectorAction: "send_location" },
    defaultConfig: {
      telegramRecipientSource: "trigger_chat",
      telegramChatIdExpression: "{{trigger.telegram.chat.id}}",
      telegramLatitude: "",
      telegramLongitude: ""
    },
    capability: "telegram.send_location",
    requiredVariables: ["trigger.telegram.chat.id"],
    producedVariables: ["telegram.action.success", "telegram.action.chatId", "telegram.action.messageId"]
  }),
  def({
    type: TELEGRAM_NODE_TYPES.editMessage,
    label: "Edit Telegram",
    category: "action",
    description: "Edits text, caption, or buttons on a previously sent Telegram message.",
    requiredConfig: ["telegramMessageIdExpression"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Telegram Bot", connectorAction: "edit_message" },
    defaultConfig: {
      telegramRecipientSource: "trigger_chat",
      telegramChatIdExpression: "{{trigger.telegram.chat.id}}",
      telegramMessageIdExpression: "{{telegram.action.messageId}}",
      telegramMessageText: ""
    },
    capability: "telegram.edit_message",
    requiredVariables: ["trigger.telegram.chat.id"],
    producedVariables: ["telegram.action.success", "telegram.action.chatId", "telegram.action.messageId"]
  }),
  def({
    type: TELEGRAM_NODE_TYPES.deleteMessage,
    label: "Delete Telegram",
    category: "action",
    description: "Deletes a Telegram message when Telegram permissions and age limits allow it.",
    requiredConfig: ["telegramMessageIdExpression"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Telegram Bot", connectorAction: "delete_message" },
    defaultConfig: {
      telegramRecipientSource: "trigger_chat",
      telegramChatIdExpression: "{{trigger.telegram.chat.id}}",
      telegramMessageIdExpression: "{{telegram.action.messageId}}"
    },
    capability: "telegram.delete_message",
    requiredVariables: ["trigger.telegram.chat.id"],
    producedVariables: ["telegram.action.success", "telegram.action.chatId", "telegram.action.messageId"]
  }),
  def({
    type: "trigger.vapi_tool_call",
    label: "Vapi Tool Call",
    category: "trigger",
    description: "Marks the Vapi webhook tool-call entry (e.g. book_appointment).",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "trigger" }
  }),
  def({
    /*
     * THE AI BRAIN.
     *
     * The most-used step on the platform — 146 runs — and until now it was not
     * in this registry at all. The consequence was not cosmetic: nothing could
     * check whether it produced anything, the AI composer could not choose it,
     * and its doors never opened, because all three read from here.
     *
     * It was reachable only because the sidebar builds its card by hand
     * instead of from a definition.
     */
    // NODE THREE. The circuit. See docs/NODE-SOP.md.
    //
    // Switch, circuit, lamp. The Prompt Box is the way in and the Result Viewer
    // is the way out; this is the only node between them that does any work,
    // and its voice cousin sits inside ten of the eleven agents businesses are
    // paying for today. It is the most used node on the platform.
    //
    // Q3 — WHAT IT NEEDS is `text`, and nothing cleverer than that.
    //
    // This carried a special case for a while: "it needs whatever its own
    // prompt asks for". That was an invention. A brain reads text — a file
    // becomes text, audio becomes text, a video becomes text before it ever
    // reaches here. It is the one node that can read anything, which is exactly
    // why its door is the simplest on the platform rather than the cleverest.
    //
    // The special case is gone. Text in, text out, the same shape as every
    // other node.
    type: "ai.llm_call",
    label: "AI Brain",
    category: "ai",
    description: "Thinks about what has happened so far and writes an answer, using the model you pick.",
    // Q5 — every dial, written down. The runner reads exactly these off the
    // node; anything not listed here is not a setting, it is a leftover.
    requiredConfig: ["llmAnswerShouldBe"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "ai" },
    defaultConfig: {
      llmProvider: "",
      llmModel: "",
      llmSystemPrompt: "You are a helpful assistant.",
      /* The two boxes. `llmRequirements` stays for the sixty-seven brains
         written in the single box before this existed — they run unchanged. */
      llmInputIs: "",
      llmAnswerShouldBe: "",
      llmRequirements: "",
      llmTemperature: "0.7",
      llmMaxTokens: "1024",
      llmOutputFormat: "text"
    },
    requiredVariables: ["text"],
    // What it really returns, taken from the runs it has already done.
    producedVariables: ["text"]
  }),
  def({
    type: "ai.context_reply",
    label: "AI Text Reply",
    category: "ai",
    description: "Generates a reply from per-business context (name, services, FAQs, hours, tone).",
    requiredConfig: ["prompt"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "ai" }
  }),
  def({
    type: "ai.memory",
    label: "Memory Node",
    category: "ai",
    description: "Stores and aggregates all previous node execution history + manual document uploads into a compact text memory string.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "ai" },
    defaultConfig: {
      customMemoryNotes: "",
      maxMemoryTokens: "4000"
    },
    capability: "ai.memory",
    producedVariables: ["memory"]
  }),
  def({
    type: "ai.image_generation",
    label: "Create image",
    category: "ai",
    description: "Generates or improves images using AI (Gemini Imagen, DALL-E, Stability). Outputs binary image Buffer and metadata JSON.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "ai" },
    defaultConfig: {
      prompt: "",
      reference_image: "",
      model: "gemini-3.1-flash-image"
    },
    capability: "ai.image_generation",
    producedVariables: ["image", "prompt", "model", "revised_prompt"]
  }),
  def({
    type: DEEPGRAM_NODE_TYPES.stt,
    label: "Deepgram STT",
    category: "ai",
    description:
      "Transcribes audio to text with Deepgram (nova-3 by default). Use the microphone in Test, or audio from a prior step.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "ai" },
    defaultConfig: {
      mode: "stt",
      model: "nova-3",
      language: "en",
      audioSource: "",
      smartFormat: "true",
      punctuate: "true",
      diarize: "false",
      outputKey: "transcript"
    },
    capability: "ai.speech_to_text",
    producedVariables: ["transcript", "confidence", "model", "language"]
  }),
  def({
    type: DEEPGRAM_NODE_TYPES.tts,
    label: "Deepgram TTS",
    category: "ai",
    description:
      "Converts text to speech with Deepgram Aura. Outputs playable audio for confirmations, IVR prompts, or follow-ups.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "ai" },
    defaultConfig: {
      mode: "tts",
      model: "aura-2-thalia-en",
      text: "",
      textSource: "",
      outputKey: "audio"
    },
    capability: "ai.text_to_speech",
    producedVariables: ["audio", "audioMimeType", "model", "text"]
  }),
  // Legacy unified node — still executable for older canvases.
  def({
    type: DEEPGRAM_NODE_TYPES.speech,
    label: "Deepgram",
    category: "ai",
    description: "Legacy unified Deepgram node. Prefer separate Deepgram STT / Deepgram TTS nodes.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "ai" },
    defaultConfig: {
      mode: "stt",
      model: "nova-3",
      language: "en",
      audioSource: "",
      smartFormat: "true",
      punctuate: "true",
      diarize: "false",
      text: "",
      textSource: "",
      outputKey: "transcript"
    },
    capability: "ai.speech",
    producedVariables: ["transcript", "confidence", "model", "language", "audio", "audioMimeType", "text"]
  }),
  def({
    type: "action.send_sms",
    label: "Send SMS",
    category: "action",
    description: "Sends an SMS via Twilio from the business number.",
    requiredConfig: ["smsTo", "smsBody"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "SMS", connectorAction: "send_sms" }
  }),
  def({
    type: API_CALL_NODE_TYPE,
    label: "Connect to a service",
    category: "action",
    description: "Fetch live data from any service on the internet — using your key.",
    requiredConfig: ["apiUrl"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: API_CALL_CONNECTOR,
      connectorAction: API_CALL_CONNECTOR_ACTION
    },
    defaultConfig: { ...API_CALL_DEFAULT_CONFIG },
    producedVariables: [API_CALL_DEFAULT_OUTPUT_KEY, `${API_CALL_DEFAULT_OUTPUT_KEY}_error`]
  }),
  def({
    type: "action.send_whatsapp",
    label: "Send WhatsApp",
    category: "action",
    description: "Sends a WhatsApp text message via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_text" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      whatsappMessageType: "text",
      message: "Hello {{contact.name}}",
      mediaLink: "",
      mediaId: "",
      caption: "",
      filename: "",
      templateName: "",
      languageCode: "en_US"
    },
    capability: "whatsapp.send",
    requiredVariables: ["contact.phone"],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "communication.send_whatsapp",
    label: "Send WhatsApp",
    category: "action",
    description: "Sends a WhatsApp text message via Meta Cloud API (communication group).",
    requiredConfig: ["connectionId", "recipient"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_text" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{customer.phone}}",
      whatsappMessageType: "text",
      message: "Hello {{customer.name}}",
      mediaLink: "",
      mediaId: "",
      caption: "",
      filename: "",
      templateName: "",
      languageCode: "en_US"
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  // ---- WhatsApp media + template + read receipts (service supported) ----
  def({
    type: "action.send_whatsapp_image",
    label: "Send WhatsApp Image",
    category: "action",
    description: "Sends a WhatsApp image via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "mediaLink"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_media" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      mediaType: "image",
      mediaLink: "",
      caption: ""
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.send_whatsapp_pdf",
    label: "Send WhatsApp PDF",
    category: "action",
    description: "Sends a WhatsApp PDF (document) via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "mediaLink"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_media" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      mediaType: "document",
      mediaLink: "",
      filename: "",
      caption: ""
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.send_whatsapp_voice",
    label: "Send WhatsApp Voice",
    category: "action",
    description: "Sends a WhatsApp voice note (audio) via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "mediaLink"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_media" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      mediaType: "audio",
      mediaLink: "",
      caption: ""
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.send_whatsapp_video",
    label: "Send WhatsApp Video",
    category: "action",
    description: "Sends a WhatsApp video via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "mediaLink"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_media" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      mediaType: "video",
      mediaLink: "",
      caption: ""
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.send_whatsapp_template",
    label: "Send WhatsApp Template",
    category: "action",
    description: "Sends a WhatsApp template message via Meta Cloud API.",
    requiredConfig: ["connectionId", "recipient", "templateName"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "WhatsApp", connectorAction: "send_template" },
    defaultConfig: {
      connectionId: "",
      recipient: "{{contact.phone}}",
      templateName: "",
      languageCode: "en_US",
      // Note: components are not currently used by the backend runner for template sending.
    },
    capability: "whatsapp.send",
    requiredVariables: [],
    producedVariables: ["whatsapp.status", "whatsapp.wamid"]
  }),
  def({
    type: "action.start_vapi_call",
    label: "Call this person",
    category: "action",
    description:
      "Phones someone with your AI voice. Only ever calls people who asked to be called.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: "Vapi", connectorAction: "start_voice_call" }
  }),
  def({
    type: "action.google_calendar_create_appointment",
    label: "Create Appointment",
    category: "action",
    description: "Creates a Google Calendar event on the business owner's calendar.",
    requiredConfig: ["calendarId", "appointmentService"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "Google Calendar",
      connectorAction: "book_appointment"
    }
  }),
  def({
    type: "action.save_lead",
    label: "Save customer",
    category: "data",
    description: "Persists/updates the caller as a Lead for this business (idempotent).",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "connector", connector: CORE_CONNECTOR, connectorAction: CORE_CONNECTOR_ACTIONS.saveLead },
    defaultConfig: { leadSource: "WORKFLOW", leadStatus: "CAPTURED" }
  }),
  def({
    type: "action.save_conversation_message",
    label: "Save chat",
    category: "data",
    description: "Stores a conversation message (inbound/outbound/system) for the caller.",
    requiredConfig: ["conversationDirection"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: CORE_CONNECTOR,
      connectorAction: CORE_CONNECTOR_ACTIONS.saveConversationMessage
    },
    defaultConfig: { conversationDirection: "OUTBOUND", conversationBody: "{{sentSms.body}}" }
  }),
  def({
    type: "action.human_handoff",
    label: "Transfer to staff",
    category: "action",
    description: "Escalates the lead to a human and records the handoff with a reason.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: CORE_CONNECTOR,
      connectorAction: CORE_CONNECTOR_ACTIONS.humanHandoff
    },
    defaultConfig: { handoffReason: "{{business.escalationRules}}" }
  }),
  def({
    type: "action.trigger_next_workflow",
    label: "Next Workflow",
    category: "action",
    description: "Runs another workflow, forwarding the current context (depth-capped, loop-safe).",
    requiredConfig: ["nextWorkflowId"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: CORE_CONNECTOR,
      connectorAction: CORE_CONNECTOR_ACTIONS.triggerNextWorkflow
    },
    defaultConfig: { nextWorkflowId: "" }
  }),
  def({
    type: "logic.condition",
    label: "Condition",
    category: "logic",
    description: "Send the flow down one path or the other, based on a rule you choose.",
    requiredConfig: ["condition"],
    backendExecutable: true,
    launchCritical: true,
    comingSoon: false,
    runtime: { nodeKind: "condition" },
    /* The rule is now three fields instead of a sentence. A free-text box was
       what let this node pretend: whatever an architect typed was used as a
       label and the engine always asked the same question underneath. */
    defaultConfig: {
      condition: "Business hours",
      conditionOperator: "business_hours",
      conditionField: "",
      conditionValue: ""
    }
  }),
  def({
    type: "output.result",
    label: "Output",
    category: "data",
    description: "Captures the final workflow result under a named key.",
    requiredConfig: ["outputKey"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "output" }
  }),

  // ---- Executable integrations (not launch-critical) ----

  // ---- Calendly connector (one trigger + one action; options in node props) ----
  def({
    type: CALENDLY_NODE_TYPES.trigger,
    label: "Calendly booking",
    category: "trigger",
    description: "Starts on a Calendly webhook event. Choose the event in node properties.",
    requiredConfig: ["calendlyEvent"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "trigger", connector: "Calendly" },
    defaultConfig: { calendlyEvent: "meeting_booked" },
    producedVariables: ["calendly.invitee", "calendly.event"]
  }),
  def({
    type: CALENDLY_NODE_TYPES.action,
    label: "Calendly action",
    category: "integration",
    description: "Run a Calendly API action. Choose the action in node properties.",
    requiredConfig: ["connectorAction"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "Calendly",
      connectorAction: "get_my_profile"
    },
    defaultConfig: {
      connectorAction: "get_my_profile",
      calendlyTimezone: "America/New_York",
      calendlyStatus: "active"
    },
    // Defaults for get_my_profile; the builder overrides via getCalendlyActionIo(connectorAction).
    requiredVariables: getCalendlyActionIo("get_my_profile").requiredVariables,
    producedVariables: getCalendlyActionIo("get_my_profile").producedVariables
  }),

  // ---- D. Voice-booking capability nodes (generic; reusable by any use case) ----
  // Normal platform nodes. A template (e.g. Dental AI Receptionist) imports them
  // with use-case values in node.data. Deploy builds the Vapi assistant + function
  // tools from these by capability; the Vapi webhook executes the tools at call time.
  def({
    type: VOICE_NODE_TYPES.phoneCallTrigger,
    label: "Incoming call",
    category: "trigger",
    description: "Starts when a customer calls the assigned Twilio number.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "trigger", connector: "Twilio" },
    defaultConfig: { callHandlingMode: "AI_ANSWERS", answerAfterRings: "1", forwardingSchedule: "always" },
    capability: "trigger.phone_call",
    requiredVariables: [],
    producedVariables: ["caller.phone", "caller.name", "call.time", "business.name", "business.type"]
  }),
  def({
    type: VOICE_NODE_TYPES.voiceConversation,
    label: "AI receptionist",
    category: "ai",
    description: "Real-time voice conversation using Vapi / ElevenLabs / model config.",
    requiredConfig: ["systemPrompt"],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "ai", connector: "Vapi" },
    defaultConfig: {
      voice: PLATFORM_DEFAULT_VOICE_ID,
      voiceName: "Triven Default Voice",
      voiceProvider: DEFAULT_VOICE_PROVIDER,
      voiceId: "",
      assistantName: "",
      language: "en-US",
      speakingSpeed: "1.0",
      model: "gpt-4o-mini",
      firstMessage: "",
      fallbackResponse: "",
      systemPrompt: "",
      customInstructions: ""
    },
    capability: "ai.conversation",
    requiredVariables: [],
    producedVariables: ["ai.reply", "customer.name", "customer.phone", "service", "selected.slot"]
  }),
  def({
    type: VOICE_NODE_TYPES.calendarAvailability,
    label: "Check Availability",
    category: "integration",
    description: "Check open Google Calendar slots.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "Google Calendar",
      connectorAction: VOICE_TOOL_NAMES.checkAvailability
    },
    defaultConfig: { bufferMinutes: "10", maxAdvanceDays: "30", slotsToOffer: "3" },
    capability: "calendar.check_availability",
    requiredVariables: [],
    producedVariables: ["calendar.available_slots", "calendar.requested_date", "calendar.timezone"]
  }),
  def({
    type: VOICE_NODE_TYPES.bookAppointment,
    label: "Book appointment",
    category: "integration",
    description: "Create a Google Calendar event.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "Google Calendar",
      connectorAction: VOICE_TOOL_NAMES.bookAppointment
    },
    defaultConfig: {
      eventTitleFormat: "[Service] - [Customer Name]",
      eventDescription: "Phone: [Customer Phone]\nBooked by AI\nService: [Service]",
      reminderEnabled: "true",
      reminderTiming: "120",
      confirmationMessage: "You're all set for [Service] on [Date] at [Time]."
    },
    capability: "calendar.book_appointment",
    requiredVariables: ["customer.name", "customer.phone", "selected.slot", "service"],
    producedVariables: [
      "appointment.status",
      "appointment.confirmation_id",
      "appointment.date",
      "appointment.time",
      "appointment.calendar_event_id"
    ]
  }),
  def({
    type: VOICE_NODE_TYPES.sendSms,
    label: "Send text",
    category: "action",
    description:
      "Optional add-on: send SMS to the customer and/or team via Twilio. May require A2P/10DLC registration — for MVP use Send Email instead.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "SMS",
      connectorAction: VOICE_TOOL_NAMES.sendNotification
    },
    defaultConfig: {
      sendToCustomer: "true",
      customerTemplate: "",
      sendToTeam: "false",
      teamTemplate: ""
    },
    capability: "sms.send",
    requiredVariables: ["customer.phone"],
    producedVariables: ["sms.status", "sms.body"]
  }),
  def({
    type: VOICE_NODE_TYPES.sendEmail,
    label: "Send email",
    category: "action",
    description: "Send confirmations, follow-ups, and internal notifications from the buyer's Triven proxy email.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: {
      nodeKind: "connector",
      connector: "EMAIL",
      connectorAction: VOICE_TOOL_NAMES.sendNotification
    },
    defaultConfig: {
      recipientType: "customer",
      customRecipient: "",
      recipientVariable: "",
      ccTemplate: "",
      bccTemplate: "",
      subjectTemplate: "",
      bodyTemplate: "",
      htmlTemplate: "",
      purpose: "auto",
      includeCallSummary: "false",
      includeBookingDetails: "true",
      continueOnFailure: "true",
      fallbackBehavior: "skip"
    },
    capability: "email.send",
    requiredVariables: [],
    producedVariables: ["email.status", "email.subject"]
  }),
  def({
    type: VOICE_NODE_TYPES.endFlow,
    label: "End",
    category: "logic",
    description: "Ends the conversation/flow with a closing message.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "output" },
    defaultConfig: {
      closingMessage: "",
      afterCallAction: "hangup",
      callRecording: "true"
    },
    capability: "flow.end",
    requiredVariables: [],
    producedVariables: ["flow.status", "flow.closing_message"]
  }),

  // ---- Product blocks ("Your Product" palette group) ----
  // Pre-designed sections of the customer page. The engine skips them at run
  // time; the Face Blueprint (agent-pages/blueprint.ts) reads them to assemble
  // the customer-facing page and the builder's Test preview.
  def({
    // NODE ONE. The switch. See docs/NODE-SOP.md.
    //
    // Needs nothing — it is the first node, and a first node owes nothing to
    // anything before it. Gives exactly one thing, and now says so: `text`,
    // the words the customer typed.
    //
    // Saying so is the whole change. Until this line existed, what the customer
    // typed reached the brain only if the brain happened to ask for something
    // named one of eight hard-coded words, and an architect who named it
    // `userQuestion` got silence with no warning. A door that is not written
    // down is not a door.
    type: BLOCK_NODE_TYPES.promptComposer,
    label: "Prompt Box",
    category: "product",
    description: "Where your customer types what they want.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "block" },
    defaultConfig: { placeholder: "Describe what you want…" },
    producedVariables: ["text"]
  }),
  def({
    type: BLOCK_NODE_TYPES.presetGallery,
    label: "Styles Gallery",
    category: "product",
    description: "Ready-made styles your customer can pick with one tap.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "block" },
    defaultConfig: { presets: [] }
  }),
  def({
    type: BLOCK_NODE_TYPES.modelPicker,
    label: "Model Picker",
    category: "product",
    description: "Lets your customer choose which AI creates their result.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "block" },
    defaultConfig: { options: [] }
  }),
  def({
    type: BLOCK_NODE_TYPES.actionButton,
    label: "Button",
    category: "product",
    description: "A button your customer presses — wire it to the brains it should run.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "block" },
    defaultConfig: { label: "Go" }
  }),
  // NODE TWO. The lamp. See docs/NODE-SOP.md.
  //
  // A switch with no lamp proves nothing — this is the node that lets a human
  // see that anything happened at all, which is why it comes straight after the
  // Prompt Box and before everything else.
  //
  // It NEEDS `text`: the thing the step before it produced. Saying so is the
  // whole of question 3, and until this line it claimed to need nothing, which
  // is how an unwired Result Viewer could sit on a canvas looking healthy while
  // being incapable of showing anything.
  //
  // It GIVES nothing, and says so out loud rather than by silence. It is the
  // end of the line: what it has goes to a person, not to another node.
  def({
    type: BLOCK_NODE_TYPES.outputStage,
    label: "Result Viewer",
    category: "product",
    description: "Shows your customer their finished result — image, video, or words.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "block" },
    defaultConfig: { kind: "auto" },
    requiredVariables: ["text"],
    producedVariables: [],
    producesNothing: true
  }),
  def({
    type: BLOCK_NODE_TYPES.continueChain,
    label: "Continue Button",
    category: "product",
    description: "One tap for your customer to keep going from their last result.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "block" },
    defaultConfig: { label: "Continue" }
  }),
  def({
    type: BLOCK_NODE_TYPES.historyShelf,
    label: "History Shelf",
    category: "product",
    description: "Everything your customer made this visit, ready to bring back.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "block" },
    defaultConfig: {}
  }),
  def({
    type: DESIGN_BRAIN_NODE_TYPE,
    label: "Design Brain",
    category: "product",
    description: "Talk to it to style your product — colors, theme, layout, wording.",
    requiredConfig: [],
    backendExecutable: false,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "block" },
    defaultConfig: {}
  }),

  // ---- B. Near-term marketplace nodes (coming soon) ----
  def({ type: "trigger.manual", label: "Start here", category: "trigger", description: "Start a workflow manually.", requiredConfig: [], backendExecutable: true, launchCritical: false, comingSoon: false, runtime: { nodeKind: "trigger" } }),
  // Two ways IN, both real. Until these shipped, an agent could only start when a
  // human typed on a page — the ceiling on every product the platform could make.
  def({ type: "trigger.webhook", label: "When another app sends data", category: "trigger", description: "Starts when another app or website sends its data to this agent's private link.", requiredConfig: [], backendExecutable: true, launchCritical: false, comingSoon: false, runtime: { nodeKind: "trigger" } }),
  // The code step. It was on the palette once and was taken off, because the
  // editor shipped without anything that ran what was typed into it. It is back
  // only now that there is a container with no network, no keys and no disk to
  // run it in — see apps/sandbox/README.md. Registered here rather than left as
  // a bare palette entry so it has a stable test id, a real label everywhere it
  // is listed, and a row on the admin Nodes page like every other node.
  def({
    type: SCRIPT_NODE_TYPE,
    label: "Code",
    category: "action",
    description:
      "Write a small piece of JavaScript or Python. It runs on its own, away from everything else, and hands what it returns to the next step.",
    requiredConfig: ["scriptCode"],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    // "connector" rather than a kind of its own: the runner matches this node by
    // type and returns before any nodeKind branch, so this only decides how it is
    // grouped and drawn — and "connector" is exactly what the palette already
    // fell back to while this node had no definition. Nothing moves.
    runtime: { nodeKind: "connector" },
    defaultConfig: { scriptLanguage: "javascript", scriptCode: "", codeInput: "" },
    producedVariables: ["script.output"]
  }),
  def({
    type: NODE_FRAME_NODE_TYPE,
    label: "New connection",
    category: "action",
    description:
      "Add a service Triven does not have yet. Describe where it lives and what it gives back, and it becomes a node you can use here and in every agent after this.",
    requiredConfig: [],
    backendExecutable: true,
    launchCritical: false,
    comingSoon: false,
    runtime: { nodeKind: "connector" }
  }),
  def({ type: "trigger.call_list", label: "Call this list", category: "trigger", description: "Works through a list of people one at a time — rings them, waits, tries again, and remembers who picked up.", requiredConfig: [], backendExecutable: true, launchCritical: false, comingSoon: false, runtime: { nodeKind: "trigger" } }),
  def({ type: "trigger.schedule", label: "On a schedule", category: "trigger", description: "Runs by itself — every hour, every day, or every week.", requiredConfig: [], backendExecutable: true, launchCritical: false, comingSoon: false, runtime: { nodeKind: "trigger" } }),

  // ---- C. Later advanced nodes (coming soon) ----
];

/** Template variables allowed in Send Email subject/body templates (shared by builder UI and send-time rendering). */
export const EMAIL_TEMPLATE_VARIABLES = [
  "customerName",
  "customerEmail",
  "businessName",
  "appointmentDate",
  "appointmentTime",
  "businessPhone",
  "businessAddress",
  "callSummary",
  "serviceName"
] as const;

/** Reusable connector-requirement descriptors (single source so nodes stay DRY). */
const REQ = {
  googleCalendarRead: {
    connector: "google_calendar",
    label: "Google Calendar",
    ownedBy: "buyer",
    scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    note: "Requires the buyer to connect their Google Calendar (read availability)."
  },
  googleCalendarWrite: {
    connector: "google_calendar",
    label: "Google Calendar",
    ownedBy: "buyer",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    note: "Requires the buyer to connect their Google Calendar (create events)."
  },
  gmailRead: {
    connector: "gmail",
    label: "Google account",
    ownedBy: "buyer",
    note: "Legacy Gmail node — no longer supported. Google connect grants calendar access only."
  },
  gmailSend: {
    connector: "gmail",
    label: "Google account",
    ownedBy: "buyer",
    note: "Legacy Gmail node — no longer supported. Use the platform Send Email node instead."
  },
  gmailCompose: {
    connector: "gmail",
    label: "Google account",
    ownedBy: "buyer",
    note: "Legacy Gmail node — no longer supported. Use the platform Send Email node instead."
  },
  twilioSms: {
    connector: "twilio",
    label: "Text messaging (SMS)",
    ownedBy: "buyer",
    config: ["senderNumber"],
    note: "Text messaging is included — Triven manages the SMS sender."
  },
  phoneProvider: {
    connector: "phone_provider",
    label: "Phone number / routing",
    ownedBy: "buyer",
    config: ["assignedNumber", "forwarding"],
    note: "Buyer sets up phone routing and the assigned number during install."
  },
  vapi: {
    connector: "vapi",
    label: "Triven voice engine",
    ownedBy: "platform",
    note: "Runs on the Triven AI voice platform — nothing for you to set up."
  },
  elevenlabs: {
    connector: "elevenlabs",
    label: "Premium voice",
    ownedBy: "platform",
    optional: true,
    note: "Optional premium voice delivered through the Triven voice platform."
  },
  trivenMail: {
    connector: "triven_mail",
    label: "Triven proxy email",
    ownedBy: "platform",
    config: ["emailAlias", "forwardToEmail"],
    note: "Sends from the buyer's <alias>@reply.triven.ai proxy address — the buyer picks the alias in Mail Setup."
  },
  whatsapp: {
    connector: "whatsapp",
    label: "WhatsApp Business",
    ownedBy: "platform",
    config: ["connectionId"],
    note: "Architect connects a Meta Cloud API WhatsApp number under Integrations → WhatsApp."
  },
  telegram: {
    connector: "telegram",
    label: "Telegram bot",
    ownedBy: "buyer",
    config: ["botDisplayName", "businessPhone", "calendarConnection", "ownerApproval"],
    note: "A separate managed bot is created for this business during install; Triven applies the commands and webhook automatically."
  },
  calendly: {
    connector: "calendly",
    label: "Calendly",
    ownedBy: "buyer",
    note: "Business connects Calendly during agent setup; webhooks start meeting workflows for that account."
  },
  deepgram: {
    connector: "deepgram",
    label: "Deepgram speech-to-text",
    ownedBy: "platform",
    note: "Speech transcription and Aura text-to-speech run on Triven's Deepgram account — nothing for the buyer to connect."
  }
} satisfies Record<string, ConnectorRequirement>;

/**
 * Connector requirements per node type. Keyed by the node's `data.type` slug.
 * `getNodeDefinition` attaches these so consumers read them off the definition;
 * `requiredConnectorsForWorkflow` aggregates them across a workflow.
 */
export const REQUIRED_CONNECTORS_BY_TYPE: Record<string, ConnectorRequirement[]> = {
  "trigger.twilio_missed_call": [REQ.phoneProvider],
  "trigger.twilio_inbound_sms": [REQ.twilioSms],
  "trigger.whatsapp_message_received": [REQ.whatsapp],
  [TELEGRAM_NODE_TYPES.trigger]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.sendMessage]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.sendButtons]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.answerCallback]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.requestContact]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.sendPhoto]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.sendDocument]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.sendVoice]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.sendLocation]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.editMessage]: [REQ.telegram],
  [TELEGRAM_NODE_TYPES.deleteMessage]: [REQ.telegram],
  "trigger.vapi_tool_call": [REQ.vapi],
  "action.send_sms": [REQ.twilioSms],
  "action.send_whatsapp": [REQ.whatsapp],
  "communication.send_whatsapp": [REQ.whatsapp],
  "action.start_vapi_call": [REQ.vapi],
  "action.google_calendar_create_appointment": [REQ.googleCalendarWrite],
  "action.google_calendar_availability": [REQ.googleCalendarRead],
  "integration.gmail_read_emails": [REQ.gmailRead],
  "integration.gmail_send_email": [REQ.gmailSend],
  "integration.gmail_create_draft": [REQ.gmailCompose],
  "trigger.gmail_new_email": [REQ.gmailRead],
  [VOICE_NODE_TYPES.phoneCallTrigger]: [REQ.phoneProvider],
  [VOICE_NODE_TYPES.voiceConversation]: [REQ.vapi, REQ.elevenlabs],
  [VOICE_NODE_TYPES.calendarAvailability]: [REQ.googleCalendarRead],
  [VOICE_NODE_TYPES.bookAppointment]: [REQ.googleCalendarWrite],
  [VOICE_NODE_TYPES.sendSms]: [REQ.twilioSms],
  [VOICE_NODE_TYPES.sendEmail]: [REQ.trivenMail],
  [CALENDLY_NODE_TYPES.trigger]: [REQ.calendly],
  [CALENDLY_NODE_TYPES.action]: [REQ.calendly],
  [DEEPGRAM_NODE_TYPES.speech]: [REQ.deepgram],
  [DEEPGRAM_NODE_TYPES.stt]: [REQ.deepgram],
  [DEEPGRAM_NODE_TYPES.tts]: [REQ.deepgram],
  // Legacy Calendly node types (older canvases)
  "trigger.calendly_meeting_booked": [REQ.calendly],
  "trigger.calendly_meeting_cancelled": [REQ.calendly],
  "trigger.calendly_meeting_rescheduled": [REQ.calendly],
  "trigger.calendly_routing_form_submitted": [REQ.calendly],
  "action.calendly_find_available_times": [REQ.calendly],
  "action.calendly_get_event_details": [REQ.calendly],
  "action.calendly_list_events": [REQ.calendly],
  "action.calendly_get_invitee_details": [REQ.calendly],
  "action.calendly_list_invitees": [REQ.calendly],
  "action.calendly_get_event_types": [REQ.calendly],
  "action.calendly_get_my_profile": [REQ.calendly],
  "action.calendly_create_scheduling_link": [REQ.calendly]
};

/** Connector requirements declared by a single node type (empty when none). */
export function requiredConnectorsForType(type: string): ConnectorRequirement[] {
  return REQUIRED_CONNECTORS_BY_TYPE[type] ?? [];
}

/* ------------------------------------------------------------------------ */
/* THE TWO DOORS                                                             */
/*                                                                           */
/* Every node that talks to the outside world has an AI entry door and an AI  */
/* exit door built inside it — where translation is needed. The doors belong  */
/* to Triven; the model behind them is a battery the platform can swap        */
/* forever (Admin → door model), and each door is born knowing its job from   */
/* the text below.                                                            */
/*                                                                           */
/* Who gets doors:                                                            */
/*   HANDS      both doors — they take a request out and bring a reply back.  */
/*   FACE-OUT   entry door only — the last step turns the run into what the   */
/*              customer sees.                                                */
/*   FACE-IN    none — the customer's own words ARE the input.                */
/*   BRAINS     none — they already are doors.                                */
/*                                                                           */
/* A node type missing from this map simply has no doors and behaves exactly  */
/* as it always has.                                                          */
/* ------------------------------------------------------------------------ */

export const NODE_DOORS_BY_TYPE: Record<string, NodeDoorSpec> = {
  /* ---- HANDS: both doors ---- */

  [API_CALL_NODE_TYPE]: {
    entry: {
      // Headers, the saved key and the output location are deliberately absent:
      // a door builds the request, it never chooses the credential that signs
      // it or the place the reply is parked.
      fields: ["apiUrl", "apiMethod", "apiBody"],
      job:
        "Turn the customer's words and the run so far into the exact request this step needs: " +
        "build the complete web address, fill in every search term, id, count, date and body field it takes, " +
        "and leave every other setting exactly as the architect saved it. " +
        "Two rules decide whether you change anything at all. First, if the saved request already reads " +
        "correctly for what the customer gave — every placeholder filled with a sensible value — return no " +
        "changes; the architect's own wording is better than a guess. Second, when an earlier step already " +
        "found the exact id, code or reference this step needs, use that value verbatim rather than a name, " +
        "a search or a lookalike: an id that came back from the service is always right, a guessed one is not."
    },
    exit: {
      job:
        "Clean the service's raw reply into the smallest useful object for later steps — " +
        "keep the names, numbers, ids, dates and links that answer what was asked, " +
        "drop wrappers, repeated boilerplate and anything nobody will read."
    }
  },

  [VOICE_NODE_TYPES.sendEmail]: {
    entry: {
      // Subject and body only. Who an email goes to is buyer-owned — the live
      // send reads To/CC/BCC off the installed agent and ignores these node
      // fields entirely — so letting a door touch them could only ever move a
      // dry-run preview, while handing a stranger's words a way to aim mail.
      fields: ["subjectTemplate", "bodyTemplate"],
      job:
        "Compose the exact subject and body this step needs from the run so far. " +
        "Use the real names, times and details, write in the customer's own language, " +
        "and never leave a blank or a leftover placeholder in what gets sent."
    },
    exit: {
      job:
        "Clean the send result into a short plain record — whether the email went out, who it went to, " +
        "and the subject line — and drop the mail provider's internal noise."
    }
  },

  [VOICE_NODE_TYPES.sendSms]: {
    entry: {
      // The number and the words. Not `sendAt` — a door writes messages, it
      // does not decide when the platform sends them.
      fields: ["smsTo", "smsBody", "customerTemplate", "teamTemplate"],
      job:
        "Work out the exact phone number to text and the message to send from the run so far. " +
        "One short complete text with the real names, times and details filled in — " +
        "no placeholders, no cut-off sentences, nothing the person did not agree to."
    },
    exit: {
      job:
        "Clean the send result down to what matters — whether the text went out, the number it went to, " +
        "and the message body — and nothing else."
    }
  },

  "action.send_whatsapp": {
    entry: {
      // The number and the words. `connectionId` picks the WhatsApp account
      // that pays, and `mediaLink`/`mediaId` make Meta fetch a URL — neither is
      // ever a door's to choose.
      fields: ["recipient", "message", "caption"],
      job:
        "Work out the exact WhatsApp number to write to and the message to send from the run so far, " +
        "filling in the real names, times and details, and keeping it short enough to read on a phone."
    },
    exit: {
      job:
        "Clean the send result into a small plain record — whether it was delivered, the message id, " +
        "and the number it went to."
    }
  },

  [TELEGRAM_NODE_TYPES.sendMessage]: {
    entry: {
      // The chat and the words. Not `telegramButtonsJson` or
      // `telegramCallbackUrl` (both put a clickable link in front of a person)
      // and not the photo/document/voice sources (each makes Telegram fetch a
      // URL a door chose).
      fields: ["telegramChatIdExpression", "telegramMessageText", "telegramCaption"],
      job:
        "Work out which chat this message belongs to and write the message to send from the run so far — " +
        "real details filled in, short enough to read in a chat window, in the customer's own language."
    },
    exit: {
      job:
        "Clean the send result into a small plain record — whether it was sent, the chat it went to, " +
        "and the message id."
    }
  },

  [VOICE_NODE_TYPES.calendarAvailability]: {
    entry: {
      // When to look and how long for. Never `calendarId` — which calendar the
      // business runs on is the business's decision, not a translator's.
      fields: ["date", "slotsToOffer", "bufferMinutes", "maxAdvanceDays"],
      job:
        "Work out the exact day or range of days to check from whatever the customer said — " +
        "\"tomorrow\", \"next Tuesday afternoon\", a date they typed — plus how long the visit needs, " +
        "always in the business's own timezone."
    },
    exit: {
      job:
        "Clean the calendar reply into a short ordered list of open times a person could actually be offered — " +
        "real dates and times only, nothing else."
    }
  },

  [VOICE_NODE_TYPES.bookAppointment]: {
    entry: {
      // The booking itself. Never `calendarId`, and never the notify-the-team
      // switches or the team phone number.
      fields: [
        "appointmentStartAt",
        "appointmentEndAt",
        "appointmentService",
        "eventTitleFormat",
        "eventDescription",
        "confirmationMessage"
      ],
      job:
        "Work out the exact date, time, length and title for this booking from whatever the customer said, " +
        "plus the name and contact details to put on it. " +
        "Never invent a time the customer did not agree to — leave it out instead."
    },
    exit: {
      job:
        "Clean the booking reply into the few facts that matter — whether it was booked, the confirmation id, " +
        "the date and the time — so the next step can tell the customer plainly."
    }
  },

  [CALENDLY_NODE_TYPES.action]: {
    entry: {
      // The details of the thing being asked about. Never `connectorAction`
      // (that IS the step — a door must not turn a lookup into a cancellation)
      // and never the connection.
      fields: [
        "calendlyEventTypeUri",
        "calendlyEventUuid",
        "calendlyInviteeUuid",
        "calendlyStartTime",
        "calendlyEndTime",
        "calendlyTimezone",
        "calendlyStatus",
        "calendlyCancelReason",
        "calendlyContactUuid",
        "calendlyContactEmail",
        "calendlyContactFirstName",
        "calendlyContactLastName",
        "calendlyContactName",
        "calendlyInviteeName",
        "calendlyInviteeEmail",
        "calendlyMeetingName",
        "calendlyDurationMinutes",
        "calendlyOneOffStartDate",
        "calendlyOneOffEndDate",
        "calendlyMeetingRecapUuid",
        "calendlyLocationKind",
        "calendlyLocation",
        "calendlyUserSearch",
        "calendlyUserUuid"
      ],
      job:
        "Fill in exactly what this Calendly step needs from the run so far — the event, the person, " +
        "the dates or the link being asked about — whatever form the customer's request arrived in."
    },
    exit: {
      job:
        "Clean Calendly's reply into the small set of facts that matter here — names, times, links and ids — " +
        "and drop the rest."
    }
  },

  /* ---- FACE-OUT: entry door only ---- */

  [BLOCK_NODE_TYPES.outputStage]: {
    entry: {
      // The presentation door writes no settings at all — it builds the picture
      // the customer sees. An empty list says so out loud.
      fields: [],
      job:
        "Turn whatever this run produced into what the customer should see: a short line of plain words, " +
        "plus stat cards, a chart or a table when the result really does contain numbers or rows. " +
        "Use only real values from the run, never invent one, and leave out anything that would not help " +
        "the person reading it."
    }
  }
};

/**
 * Every node type that carries doors, in registry order. Used by tests, the
 * inspector's Advanced toggle and the run log — never by the palette, because
 * doors are never their own node.
 */
export const DOOR_BEARING_NODE_TYPES: string[] = Object.keys(NODE_DOORS_BY_TYPE);

/**
 * Node data key that turns a node's doors off. Stored as the string "true" so
 * it round-trips through the canvas JSON like every other node flag. One
 * constant so the builder toggle and the runtime can never disagree.
 */
export const NODE_DOORS_DISABLED_KEY = "doorsDisabled";

/** The doors built into a node type, or undefined when it has none. */
export function getNodeDoors(type: string | null | undefined): NodeDoorSpec | undefined {
  const key = (type ?? "").trim();
  if (!key) return undefined;

  const direct = NODE_DOORS_BY_TYPE[key];
  if (direct) return direct;

  // Legacy Calendly slugs from older canvases (action.calendly_get_event_details…)
  // run the same Calendly action, so they inherit the same doors.
  if (key.startsWith("action.calendly_")) return NODE_DOORS_BY_TYPE[CALENDLY_NODE_TYPES.action];

  return undefined;
}

/** True when this node type has any door at all. */
export function hasNodeDoors(type: string | null | undefined): boolean {
  return getNodeDoors(type) !== undefined;
}

/**
 * Every setting an entry door on this node type may fill in — the whitelist,
 * and the ONLY answer to "may a door write this field?".
 *
 * Empty for a node with no entry door, and empty for an entry door that
 * declares no list. That default is deliberate: an entry door added to the
 * registry without a field list writes nothing at all, so forgetting the list
 * ships a door that does nothing rather than a door that can write anything.
 */
export function entryDoorSettableFields(type: string | null | undefined): readonly string[] {
  return getNodeDoors(type)?.entry?.fields ?? [];
}

/**
 * Doors are ON by default. They only stop when the architect flipped the quiet
 * "Smart input & output" toggle off in the node's Advanced settings.
 */
export function nodeDoorsEnabled(nodeData: unknown): boolean {
  if (typeof nodeData !== "object" || nodeData === null) return true;
  const flag = (nodeData as Record<string, unknown>)[NODE_DOORS_DISABLED_KEY];
  if (typeof flag === "boolean") return !flag;
  return String(flag ?? "").trim().toLowerCase() !== "true";
}

/** Attach the lookup-table extras (connectors, doors) onto a base definition. */
/**
 * WHAT EACH STEP REALLY HANDS ON.
 *
 * Kept as one table rather than scattered through three thousand lines,
 * because this is the list somebody has to be able to read in one sitting and
 * say "yes, that is true" — it is what the honesty check judges every run
 * against, what the AI composer wires steps together by, and what the wiring
 * check will read.
 *
 * Every entry below was taken from runs that have actually happened, not from
 * what the step is supposed to do. Where the two disagreed, the declaration
 * was wrong: the phone trigger claimed to produce a caller's NAME and the
 * business's name and type, and produced none of the three. A declaration that
 * is not delivered is worse than none, because everything downstream is built
 * on it.
 *
 * `null` means the step genuinely hands on nothing, and that is correct rather
 * than unfinished — a distinction the check needs, or "nobody described this"
 * quietly reads as "this is fine".
 */
const PRODUCES_BY_TYPE: Record<string, string[] | null> = {
  /*
   * These are the names the RUN actually uses, not the tidier ones anybody
   * would have chosen. That is deliberate. A later step reads a value by the
   * name it really has, the AI composer wires steps together by these names,
   * and the honesty check judges against them — so a prettier name here would
   * be a lie in three places at once.
   *
   * The phone trigger is the cautionary tale: it declared caller.phone,
   * caller.name and call.time, produced none of the three, and was recorded as
   * a success thirty-one times.
   */
  [VOICE_NODE_TYPES.phoneCallTrigger]: ["callerNumber"],
  "trigger.twilio_inbound_sms": ["inboundSms"],
  "trigger.twilio_missed_call": ["missedCall"],
  "trigger.call_list": ["callerNumber"],
  [WEBHOOK_NODE_TYPE]: ["webhook"],

  "ai.context_reply": ["text"],
  "action.save_lead": ["leadId"],
  "action.save_conversation_message": ["conversationId"],
  "action.human_handoff": ["conversationId"],

  /*
   * Steps that genuinely hand on nothing, and that is correct rather than
   * unfinished. Saying so out loud is the point: silence is ambiguous, and
   * "nobody described this" must never read as "checked and fine".
   */
  // Started by a person pressing a button.
  // What the architect's own code handed back.
  [SCRIPT_NODE_TYPE]: ["script.output"],

  "trigger.manual": null,
  // Fires on a clock. What happens next is the next step's business.
  [SCHEDULE_NODE_TYPE]: null,
  // Branches the flow. The branch it took is in the run, not in an output.
  "logic.condition": null,
  // Hands the call to Vapi, which reports back through its own webhook rather
  // than by returning something here.
  [OUTBOUND_CALL_NODE_TYPE]: null,
  // A blank form until it is filled in, at which point it becomes the service
  // it describes and takes on that frame's outputs instead.
  [NODE_FRAME_NODE_TYPE]: null
};

function withRegistryExtras(base: NodeDefinition, type: string): NodeDefinition {
  const doors = getNodeDoors(type);
  const declared = PRODUCES_BY_TYPE[type];

  return {
    ...base,
    requiredConnectors: requiredConnectorsForType(type),
    ...(doors ? { doors } : {}),
    ...(declared === null
      ? { producesNothing: true, producedVariables: [] }
      : declared
        ? { producedVariables: declared }
        : {})
  };
}

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  const base = NODE_DEFINITIONS.find((node) => node.type === type);
  if (base) return withRegistryExtras(base, type);

  // Legacy Calendly node types from older canvases (e.g. action.calendly_get_event_details)
  // share the same runtime behavior and output/input variable contracts as the base
  // `action.calendly` / `trigger.calendly` nodes. Provide a metadata fallback so
  // the builder can still show Input/Output mapping variables.
  if (type.startsWith("action.calendly_")) {
    const fallback = NODE_DEFINITIONS.find((node) => node.type === CALENDLY_NODE_TYPES.action);
    if (fallback) return withRegistryExtras(fallback, type);
  }

  if (type.startsWith("trigger.calendly_")) {
    const fallback = NODE_DEFINITIONS.find((node) => node.type === CALENDLY_NODE_TYPES.trigger);
    if (fallback) return withRegistryExtras(fallback, type);
  }

  return undefined;
}

function workflowNodeList(workflowJson: unknown): Array<Record<string, unknown>> {
  const nodes = (workflowJson as { nodes?: unknown } | null | undefined)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((node): node is Record<string, unknown> => typeof node === "object" && node !== null);
}

/** A workflow node's registry type slug — prefers `data.type`, falls back to `type`. */
function workflowNodeType(node: Record<string, unknown>): string {
  const data = node.data;
  if (typeof data === "object" && data !== null) {
    const type = (data as Record<string, unknown>).type;
    if (typeof type === "string" && type) return type;
  }
  return typeof node.type === "string" ? node.type : "";
}

/**
 * Aggregate the unique connectors a whole workflow needs (deduped by connector
 * key). Used to stamp `AgentListing.requiredConnectors` at publish and to drive
 * the buyer install checklist. Accepts a `{ nodes }` workflowJson value.
 */
export function requiredConnectorsForWorkflow(workflowJson: unknown): ConnectorRequirement[] {
  const seen = new Map<string, ConnectorRequirement>();
  for (const node of workflowNodeList(workflowJson)) {
    for (const requirement of requiredConnectorsForType(workflowNodeType(node))) {
      if (!seen.has(requirement.connector)) seen.set(requirement.connector, requirement);
    }
  }
  return Array.from(seen.values());
}

/** The connector keys a workflow needs, e.g. ["google_calendar","twilio","vapi"]. */
export function requiredConnectorKeys(workflowJson: unknown): string[] {
  return requiredConnectorsForWorkflow(workflowJson).map((requirement) => requirement.connector);
}

export function launchCriticalNodes(): NodeDefinition[] {
  return NODE_DEFINITIONS.filter((node) => node.launchCritical);
}

export function comingSoonNodes(): NodeDefinition[] {
  return NODE_DEFINITIONS.filter((node) => node.comingSoon);
}

/** True when (connector, connectorAction) is a Triven platform action. */
export function isCoreConnectorAction(value: string): value is CoreConnectorAction {
  return (Object.values(CORE_CONNECTOR_ACTIONS) as string[]).includes(value);
}

/** The voice-booking capability node definitions, in canvas order. */
export function voiceNodes(): NodeDefinition[] {
  const order = Object.values(VOICE_NODE_TYPES) as string[];
  return order
    .map((type) => getNodeDefinition(type))
    .filter((node): node is NodeDefinition => Boolean(node));
}

/** True when a workflow node type is one of the voice-booking capability nodes. */
export function isVoiceNodeType(type: string): boolean {
  return (Object.values(VOICE_NODE_TYPES) as string[]).includes(type);
}

/** Builder presentation (icon/accent/kind) per voice node so template nodes look like dragged nodes. */
export const VOICE_NODE_PRESENTATION: Record<string, { kind: string; icon: string; accent: string }> = {
  [VOICE_NODE_TYPES.phoneCallTrigger]: { kind: "TWILIO", icon: "phone", accent: "amber" },
  [VOICE_NODE_TYPES.voiceConversation]: { kind: "VAPI · GPT-4o Mini", icon: "sparkles", accent: "violet" },
  [VOICE_NODE_TYPES.calendarAvailability]: { kind: "CALENDAR", icon: "calendar", accent: "blue" },
  [VOICE_NODE_TYPES.bookAppointment]: { kind: "CALENDAR", icon: "calendar", accent: "blue" },
  [VOICE_NODE_TYPES.sendSms]: { kind: "TWILIO SMS", icon: "message", accent: "green" },
  [VOICE_NODE_TYPES.sendEmail]: { kind: "TRIVEN MAIL", icon: "mail", accent: "green" },
  [VOICE_NODE_TYPES.endFlow]: { kind: "END FLOW", icon: "capture", accent: "slate" },
  [SCRIPT_NODE_TYPE]: { kind: "CODE", icon: "code", accent: "slate" },
  "trigger.whatsapp_message_received": { kind: "WHATSAPP", icon: "whatsapp", accent: "green" },
  "action.send_whatsapp": { kind: "WHATSAPP", icon: "whatsapp", accent: "green" },
  "communication.send_whatsapp": { kind: "WHATSAPP", icon: "whatsapp", accent: "green" }
};

/**
 * Build the generic 6-node voice-booking workflow JSON (nodes + edges) from the
 * registry. Templates import this and overlay use-case values in node.data; the
 * nodes are the same reusable platform nodes a user can drag manually.
 */
export function buildVoiceBookingWorkflow(): {
  nodes: Array<{ id: string; type: "coreNode"; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
} {
  // Template chain uses the email-first order — SMS stays a manual add-on node.
  const defs = VOICE_TEMPLATE_NODE_ORDER.map((type) => getNodeDefinition(type)).filter(
    (node): node is NodeDefinition => Boolean(node)
  );
  const nodes = defs.map((def, index) => ({
    id: def.type,
    type: "coreNode" as const,
    position: { x: 80 + index * 280, y: 300 },
    data: {
      type: def.type,
      nodeKind: def.runtime.nodeKind,
      connector: def.runtime.connector,
      connectorAction: def.runtime.connectorAction,
      label: def.label,
      title: def.label,
      subtitle: def.description,
      ...(VOICE_NODE_PRESENTATION[def.type] ?? {}),
      ...(def.defaultConfig ?? {})
    }
  }));

  const edges = defs.slice(1).map((def, index) => ({
    id: `voice-e${index + 1}`,
    source: defs[index].type,
    target: def.type
  }));

  return { nodes, edges };
}

type TemplateWorkflowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

type TemplateWorkflowEdge = {
  id: string;
  source: string;
  target: string;
};

/**
 * Reset a builder node to registry defaults for template gallery storage.
 * Keeps graph identity (id/position/type) and presentation fields, but drops
 * architect-filled values (connection IDs, custom prompts, recipients, etc.).
 */
export function nodeDataForTemplate(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const source: Record<string, unknown> = data && typeof data === "object" ? data : {};
  const type = typeof source.type === "string" ? source.type : "";
  const def = type ? getNodeDefinition(type) : undefined;
  const presentation = type ? VOICE_NODE_PRESENTATION[type] : undefined;
  const nodeKind =
    def?.runtime.nodeKind ?? (typeof source.nodeKind === "string" ? source.nodeKind : "connector");
  const fallbackKind = (def?.label || type || "NODE").toUpperCase();
  const existingKind = typeof source.kind === "string" ? source.kind : "";
  const kind = existingKind || presentation?.kind || fallbackKind;
  const existingLabel = typeof source.label === "string" ? source.label : "";
  const existingTitle = typeof source.title === "string" ? source.title : "";
  const existingSubtitle = typeof source.subtitle === "string" ? source.subtitle : "";
  const existingIcon = typeof source.icon === "string" ? source.icon : "";
  const existingAccent = typeof source.accent === "string" ? source.accent : "";

  return {
    type,
    nodeKind,
    kind,
    label: existingLabel || def?.label || type || "Node",
    title: existingTitle || def?.label || type || "Node",
    subtitle: def?.description || existingSubtitle,
    icon: presentation?.icon || existingIcon || "message",
    accent: presentation?.accent || existingAccent || "slate",
    ...(def?.runtime.connector ? { connector: def.runtime.connector } : {}),
    ...(def?.runtime.connectorAction ? { connectorAction: def.runtime.connectorAction } : {}),
    ...(def?.defaultConfig ?? {})
  };
}

/**
 * Build template-safe workflow JSON: same nodes/edges topology, no filled config values.
 */
export function workflowJsonForTemplate(workflowJson: unknown): {
  nodes: TemplateWorkflowNode[];
  edges: TemplateWorkflowEdge[];
} {
  if (!workflowJson || typeof workflowJson !== "object") {
    return { nodes: [], edges: [] };
  }

  const graph = workflowJson as { nodes?: unknown; edges?: unknown };
  const nodesIn = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edgesIn = Array.isArray(graph.edges) ? graph.edges : [];

  const nodes: TemplateWorkflowNode[] = nodesIn.map((raw, index) => {
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const id = typeof record.id === "string" && record.id ? record.id : `node-${index + 1}`;
    const positionRecord =
      record.position && typeof record.position === "object"
        ? (record.position as Record<string, unknown>)
        : null;
    const position = {
      x: typeof positionRecord?.x === "number" ? positionRecord.x : 80 + index * 280,
      y: typeof positionRecord?.y === "number" ? positionRecord.y : 300
    };
    const data =
      record.data && typeof record.data === "object"
        ? (record.data as Record<string, unknown>)
        : {};

    return {
      id,
      type: typeof record.type === "string" && record.type ? record.type : "coreNode",
      position,
      data: nodeDataForTemplate(data)
    };
  });

  const edges: TemplateWorkflowEdge[] = [];
  edgesIn.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const record = raw as Record<string, unknown>;
    if (typeof record.source !== "string" || typeof record.target !== "string") return;
    edges.push({
      id: typeof record.id === "string" && record.id ? record.id : `e${index + 1}`,
      source: record.source,
      target: record.target
    });
  });

  return { nodes, edges };
}
