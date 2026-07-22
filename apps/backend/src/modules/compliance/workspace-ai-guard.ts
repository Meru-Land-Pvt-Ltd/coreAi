import { env } from "../../config/env";

export const DATA_CLASSIFICATION = {
  GENERAL: "GENERAL",
  GOOGLE_WORKSPACE_RAW: "GOOGLE_WORKSPACE_RAW",
  GOOGLE_WORKSPACE_DERIVED: "GOOGLE_WORKSPACE_DERIVED"
} as const;

export type DataClassification = (typeof DATA_CLASSIFICATION)[keyof typeof DATA_CLASSIFICATION];

export type WorkspaceAiProvider =
  | "vapi"
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepgram"
  | "elevenlabs";


export function isConfirmed(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

const MASTER_FLAG = "GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED";

export const PROVIDER_REQUIRED_CONFIRMATIONS: Record<WorkspaceAiProvider, readonly string[]> = {
  vapi: ["VAPI_WORKSPACE_NO_TRAINING_CONFIRMED", "VAPI_HIPAA_OR_ZDR_CONFIRMED"],
  openai: ["OPENAI_NO_TRAINING_CONFIRMED", "OPENAI_DATA_SHARING_DISABLED_CONFIRMED"],
  anthropic: ["ANTHROPIC_NO_TRAINING_CONFIRMED", "ANTHROPIC_FEEDBACK_SHARING_DISABLED_CONFIRMED"],
  gemini: ["GEMINI_PAID_SERVICE_CONFIRMED", "GEMINI_DATASET_SHARING_DISABLED_CONFIRMED"],
  deepgram: ["DEEPGRAM_MIP_OPT_OUT_CONFIRMED"],
  elevenlabs: ["ELEVENLABS_TRAINING_OPT_OUT_CONFIRMED"]
} as const;

const PROVIDER_ALIASES: Record<string, WorkspaceAiProvider> = {
  vapi: "vapi",
  openai: "openai",
  claude: "anthropic",
  anthropic: "anthropic",
  google: "gemini",
  gemini: "gemini",
  deepgram: "deepgram",
  "11labs": "elevenlabs",
  elevenlabs: "elevenlabs"
};

const NO_CONFIRMATION_PATHWAY_PROVIDERS = new Set(["cartesia", "playht", "azure", "lmnt", "rime-ai", "neets"]);

/** Lowercased/trimmed canonical provider, or the raw value when unknown. */
export function normalizeAiProvider(raw: unknown): string {
  const cleaned = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!cleaned) return "unknown";
  return PROVIDER_ALIASES[cleaned] ?? cleaned;
}

export type WorkspaceGuardConfig = Record<string, unknown>;

function envConfig(): WorkspaceGuardConfig {
  return env as unknown as WorkspaceGuardConfig;
}

export function workspaceAiBlockReason(
  provider: string,
  classification: DataClassification,
  config: WorkspaceGuardConfig = envConfig()
): string | null {
  if (classification === DATA_CLASSIFICATION.GENERAL) return null;
  if (classification === DATA_CLASSIFICATION.GOOGLE_WORKSPACE_RAW) {
    return "RAW_WORKSPACE_DATA_NEVER_AI_ELIGIBLE";
  }

  if (!isConfirmed(config[MASTER_FLAG])) return MASTER_FLAG;

  const normalized = normalizeAiProvider(provider);

  if (NO_CONFIRMATION_PATHWAY_PROVIDERS.has(normalized)) {
    return `NO_CONFIRMATION_PATHWAY:${normalized}`;
  }

  const required = PROVIDER_REQUIRED_CONFIRMATIONS[normalized as WorkspaceAiProvider];
  if (!required) return `UNKNOWN_AI_PROVIDER:${normalized}`;

  for (const flag of required) {
    if (!isConfirmed(config[flag])) return flag;
  }

  return null;
}

export function isWorkspaceAiAllowed(
  provider: string,
  classification: DataClassification,
  config: WorkspaceGuardConfig = envConfig()
): boolean {
  return workspaceAiBlockReason(provider, classification, config) === null;
}

/**
 * Every provider hop in one live Vapi call. Built from the FINAL assistant
 * payload at deploy time (see deployVapiAssistant) and stored on
 * InstalledAgent.configJson.voicePipeline; the env-derived default below is
 * only the fallback for assistants deployed before pipelines were recorded.
 */
export type ResolvedVoicePipeline = {
  orchestrator: "vapi";
  llmProvider: string;
  transcriberProvider: string;
  voiceProvider: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Mirrors deployVapiAssistant's env-level resolution: model.provider comes
 * from VAPI_DEFAULT_LLM_PROVIDER with anthropic env-gated by
 * VAPI_ANTHROPIC_ENABLED (resolveVapiModel falls back to openai when the gate
 * is off), transcriber.provider from VAPI_TRANSCRIBER_PROVIDER, and
 * voice.provider defaults to ElevenLabs ("11labs") via the platform preset.
 */
export function resolveDefaultLiveVoicePipeline(
  config: WorkspaceGuardConfig = envConfig()
): ResolvedVoicePipeline {
  const rawLlm = normalizeAiProvider(str(config["VAPI_DEFAULT_LLM_PROVIDER"]) || "openai");
  return {
    orchestrator: "vapi",
    llmProvider: rawLlm === "anthropic" && !isConfirmed(config["VAPI_ANTHROPIC_ENABLED"]) ? "openai" : rawLlm,
    transcriberProvider: normalizeAiProvider(str(config["VAPI_TRANSCRIBER_PROVIDER"]) || "deepgram"),
    voiceProvider: "elevenlabs"
  };
}

/** Parse a stored InstalledAgent.configJson.voicePipeline; null when absent/malformed. */
export function parseStoredVoicePipeline(configJson: unknown): ResolvedVoicePipeline | null {
  if (!configJson || typeof configJson !== "object" || Array.isArray(configJson)) return null;
  const stored = (configJson as Record<string, unknown>)["voicePipeline"];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const record = stored as Record<string, unknown>;
  const llm = str(record["llmProvider"]);
  const transcriber = str(record["transcriberProvider"]);
  const voice = str(record["voiceProvider"]);
  if (!llm || !transcriber || !voice) return null;
  return {
    orchestrator: "vapi",
    llmProvider: normalizeAiProvider(llm),
    transcriberProvider: normalizeAiProvider(transcriber),
    voiceProvider: normalizeAiProvider(voice)
  };
}

/**
 * Whether Workspace-DERIVED scheduling data may be returned to a live Vapi
 * call. EVERY hop of the resolved pipeline must be confirmed: Vapi
 * (orchestration), the transcriber (Deepgram by default), the LLM, and the
 * voice provider. Unknown or no-pathway providers on any hop block the
 * transfer. Returns the first blocking reason, or null when allowed.
 */
export function liveVoicePipelineBlockReason(
  config: WorkspaceGuardConfig = envConfig(),
  pipeline?: ResolvedVoicePipeline | null
): string | null {
  const resolved = pipeline ?? resolveDefaultLiveVoicePipeline(config);
  const DERIVED = DATA_CLASSIFICATION.GOOGLE_WORKSPACE_DERIVED;
  return (
    workspaceAiBlockReason(resolved.orchestrator, DERIVED, config) ??
    workspaceAiBlockReason(resolved.transcriberProvider, DERIVED, config) ??
    workspaceAiBlockReason(resolved.llmProvider, DERIVED, config) ??
    workspaceAiBlockReason(resolved.voiceProvider, DERIVED, config)
  );
}

export function isWorkspaceDerivedAllowedForLiveVoice(
  config: WorkspaceGuardConfig = envConfig(),
  pipeline?: ResolvedVoicePipeline | null
): boolean {
  return liveVoicePipelineBlockReason(config, pipeline) === null;
}

export function chatRuntimeBlockReason(config: WorkspaceGuardConfig = envConfig()): string | null {
  return workspaceAiBlockReason("openai", DATA_CLASSIFICATION.GOOGLE_WORKSPACE_DERIVED, config);
}

export function isWorkspaceDerivedAllowedForChatRuntime(
  config: WorkspaceGuardConfig = envConfig()
): boolean {
  return chatRuntimeBlockReason(config) === null;
}
