import { describe, expect, it } from "vitest";
import {
  DATA_CLASSIFICATION,
  PROVIDER_REQUIRED_CONFIRMATIONS,
  chatRuntimeBlockReason,
  isConfirmed,
  isWorkspaceAiAllowed,
  isWorkspaceDerivedAllowedForChatRuntime,
  isWorkspaceDerivedAllowedForLiveVoice,
  liveVoicePipelineBlockReason,
  normalizeAiProvider,
  parseStoredVoicePipeline,
  resolveDefaultLiveVoicePipeline,
  workspaceAiBlockReason,
  type ResolvedVoicePipeline
} from "./workspace-ai-guard";

const ALL_CONFIRMED = {
  GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED: "true",
  VAPI_WORKSPACE_NO_TRAINING_CONFIRMED: "true",
  VAPI_HIPAA_OR_ZDR_CONFIRMED: "true",
  OPENAI_NO_TRAINING_CONFIRMED: "true",
  OPENAI_DATA_SHARING_DISABLED_CONFIRMED: "true",
  ANTHROPIC_NO_TRAINING_CONFIRMED: "true",
  ANTHROPIC_FEEDBACK_SHARING_DISABLED_CONFIRMED: "true",
  GEMINI_PAID_SERVICE_CONFIRMED: "true",
  GEMINI_DATASET_SHARING_DISABLED_CONFIRMED: "true",
  DEEPGRAM_MIP_OPT_OUT_CONFIRMED: "true",
  ELEVENLABS_TRAINING_OPT_OUT_CONFIRMED: "true",
  ELEVENLABS_ZRM_CONFIRMED: "true",
  CARTESIA_NO_TRAINING_CONFIRMED: "true"
};

describe("isConfirmed (fail-closed parse)", () => {
  it("confirms only true, 'true', and '1'", () => {
    expect(isConfirmed(true)).toBe(true);
    expect(isConfirmed("true")).toBe(true);
    expect(isConfirmed("1")).toBe(true);
  });

  it("treats false, missing, undefined, and malformed values as NOT confirmed", () => {
    for (const value of [false, "false", undefined, null, "", "TRUE", "True", " true", "true ", "yes", "on", 1, 0, {}, []]) {
      expect(isConfirmed(value)).toBe(false);
    }
  });
});

describe("classifications", () => {
  it("exposes exactly the three centralized classifications", () => {
    expect(DATA_CLASSIFICATION).toEqual({
      GENERAL: "GENERAL",
      GOOGLE_WORKSPACE_RAW: "GOOGLE_WORKSPACE_RAW",
      GOOGLE_WORKSPACE_DERIVED: "GOOGLE_WORKSPACE_DERIVED"
    });
  });

  it("GENERAL data is always allowed, even with nothing confirmed", () => {
    expect(isWorkspaceAiAllowed("openai", DATA_CLASSIFICATION.GENERAL, {})).toBe(true);
    expect(isWorkspaceAiAllowed("unknown-provider", DATA_CLASSIFICATION.GENERAL, {})).toBe(true);
  });

  it("RAW Workspace data is NEVER allowed, even with everything confirmed", () => {
    for (const provider of Object.keys(PROVIDER_REQUIRED_CONFIRMATIONS)) {
      expect(isWorkspaceAiAllowed(provider, DATA_CLASSIFICATION.GOOGLE_WORKSPACE_RAW, ALL_CONFIRMED)).toBe(false);
    }
    expect(workspaceAiBlockReason("openai", DATA_CLASSIFICATION.GOOGLE_WORKSPACE_RAW, ALL_CONFIRMED)).toBe(
      "RAW_WORKSPACE_DATA_NEVER_AI_ELIGIBLE"
    );
  });
});

describe("derived-data provider gating (fail-closed)", () => {
  const DERIVED = DATA_CLASSIFICATION.GOOGLE_WORKSPACE_DERIVED;

  it("blocks everything when the master switch is off, missing, or malformed", () => {
    expect(workspaceAiBlockReason("openai", DERIVED, {})).toBe("GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED");
    expect(workspaceAiBlockReason("openai", DERIVED, { ...ALL_CONFIRMED, GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED: "yes" })).toBe(
      "GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED"
    );
    expect(workspaceAiBlockReason("openai", DERIVED, { ...ALL_CONFIRMED, GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED: undefined })).toBe(
      "GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED"
    );
  });

  it("requires EVERY confirmation flag for the provider", () => {
    for (const [provider, flags] of Object.entries(PROVIDER_REQUIRED_CONFIRMATIONS)) {
      expect(workspaceAiBlockReason(provider, DERIVED, ALL_CONFIRMED)).toBeNull();
      for (const flag of flags) {
        const withOneMissing = { ...ALL_CONFIRMED, [flag]: "false" };
        expect(workspaceAiBlockReason(provider, DERIVED, withOneMissing)).toBe(flag);
        const withOneMalformed = { ...ALL_CONFIRMED, [flag]: "TRUE" };
        expect(workspaceAiBlockReason(provider, DERIVED, withOneMalformed)).toBe(flag);
      }
    }
  });

  it("gemini requires the billing-enabled paid-service confirmation — no free fallback", () => {
    expect(
      workspaceAiBlockReason("gemini", DERIVED, { ...ALL_CONFIRMED, GEMINI_PAID_SERVICE_CONFIRMED: "false" })
    ).toBe("GEMINI_PAID_SERVICE_CONFIRMED");
  });

  it("blocks unknown providers outright", () => {
    expect(workspaceAiBlockReason("mistral", DERIVED, ALL_CONFIRMED)).toBe("UNKNOWN_AI_PROVIDER:mistral");
    expect(workspaceAiBlockReason("llama", DERIVED, ALL_CONFIRMED)).toBe("UNKNOWN_AI_PROVIDER:llama");
  });
});

describe("provider alias normalization", () => {
  it("maps every canonical alias", () => {
    expect(normalizeAiProvider("11labs")).toBe("elevenlabs");
    expect(normalizeAiProvider("elevenlabs")).toBe("elevenlabs");
    expect(normalizeAiProvider("claude")).toBe("anthropic");
    expect(normalizeAiProvider("anthropic")).toBe("anthropic");
    expect(normalizeAiProvider("google")).toBe("gemini");
    expect(normalizeAiProvider("gemini")).toBe("gemini");
    expect(normalizeAiProvider("OpenAI")).toBe("openai");
    expect(normalizeAiProvider(" Deepgram ")).toBe("deepgram");
    expect(normalizeAiProvider("vapi")).toBe("vapi");
  });

  it("passes unknown providers through for the block layer to reject", () => {
    expect(normalizeAiProvider("cartesia")).toBe("cartesia");
    expect(normalizeAiProvider("brand-new-tts")).toBe("brand-new-tts");
    expect(normalizeAiProvider("")).toBe("unknown");
    expect(normalizeAiProvider(undefined)).toBe("unknown");
  });
});

describe("live voice pipeline gate (Vapi + Deepgram + LLM + voice)", () => {
  it("the CURRENT production pipeline is Vapi → Deepgram → OpenAI → ElevenLabs", () => {
    expect(resolveDefaultLiveVoicePipeline({})).toEqual({
      orchestrator: "vapi",
      llmProvider: "openai",
      transcriberProvider: "deepgram",
      voiceProvider: "elevenlabs",
      llmModel: "gpt-4o-mini",
      transcriberModel: "nova-3",
      voiceModel: "eleven_flash_v2_5"
    });
  });

  it("allows only when every hop is confirmed", () => {
    expect(isWorkspaceDerivedAllowedForLiveVoice(ALL_CONFIRMED)).toBe(true);
  });

  it("REQUIRES the Deepgram confirmation in the default pipeline", () => {
    expect(liveVoicePipelineBlockReason({ ...ALL_CONFIRMED, DEEPGRAM_MIP_OPT_OUT_CONFIRMED: "false" })).toBe(
      "DEEPGRAM_MIP_OPT_OUT_CONFIRMED"
    );
    expect(isWorkspaceDerivedAllowedForLiveVoice({ ...ALL_CONFIRMED, DEEPGRAM_MIP_OPT_OUT_CONFIRMED: undefined })).toBe(false);
  });

  it("blocks on the first missing hop and names the flag", () => {
    expect(liveVoicePipelineBlockReason({})).toBe("GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED");
    expect(liveVoicePipelineBlockReason({ ...ALL_CONFIRMED, VAPI_HIPAA_OR_ZDR_CONFIRMED: "false" })).toBe(
      "VAPI_HIPAA_OR_ZDR_CONFIRMED"
    );
    expect(liveVoicePipelineBlockReason({ ...ALL_CONFIRMED, OPENAI_NO_TRAINING_CONFIRMED: "" })).toBe(
      "OPENAI_NO_TRAINING_CONFIRMED"
    );
    expect(liveVoicePipelineBlockReason({ ...ALL_CONFIRMED, ELEVENLABS_TRAINING_OPT_OUT_CONFIRMED: "false" })).toBe(
      "ELEVENLABS_TRAINING_OPT_OUT_CONFIRMED"
    );
  });

  it("checks OpenAI when the resolved model provider is OpenAI, Anthropic when it is Claude/Anthropic", () => {
    const openAiPipeline: ResolvedVoicePipeline = {
      orchestrator: "vapi",
      llmProvider: "openai",
      transcriberProvider: "deepgram",
      voiceProvider: "11labs"
    };
    expect(liveVoicePipelineBlockReason({ ...ALL_CONFIRMED, OPENAI_NO_TRAINING_CONFIRMED: "false" }, openAiPipeline)).toBe(
      "OPENAI_NO_TRAINING_CONFIRMED"
    );

    const claudePipeline: ResolvedVoicePipeline = { ...openAiPipeline, llmProvider: "claude" };
    expect(
      liveVoicePipelineBlockReason({ ...ALL_CONFIRMED, ANTHROPIC_NO_TRAINING_CONFIRMED: "false" }, claudePipeline)
    ).toBe("ANTHROPIC_NO_TRAINING_CONFIRMED");
    // With Anthropic confirmed, the OpenAI flags are irrelevant on this pipeline.
    expect(
      liveVoicePipelineBlockReason(
        { ...ALL_CONFIRMED, OPENAI_NO_TRAINING_CONFIRMED: "false", OPENAI_DATA_SHARING_DISABLED_CONFIRMED: "false" },
        claudePipeline
      )
    ).toBeNull();
  });

  it("env fallback resolves anthropic only when configured AND gated on", () => {
    const anthropicEnv = { ...ALL_CONFIRMED, VAPI_DEFAULT_LLM_PROVIDER: "anthropic", VAPI_ANTHROPIC_ENABLED: "true" };
    expect(resolveDefaultLiveVoicePipeline(anthropicEnv).llmProvider).toBe("anthropic");
    expect(liveVoicePipelineBlockReason({ ...anthropicEnv, ANTHROPIC_FEEDBACK_SHARING_DISABLED_CONFIRMED: "false" })).toBe(
      "ANTHROPIC_FEEDBACK_SHARING_DISABLED_CONFIRMED"
    );
    // Gate off → resolveVapiModel falls back to openai; the guard mirrors that.
    expect(
      resolveDefaultLiveVoicePipeline({ ...anthropicEnv, VAPI_ANTHROPIC_ENABLED: "false" }).llmProvider
    ).toBe("openai");
  });

  it("checks ElevenLabs ONLY when the resolved voice is ElevenLabs", () => {
    const vapiVoicePipeline: ResolvedVoicePipeline = {
      orchestrator: "vapi",
      llmProvider: "openai",
      transcriberProvider: "deepgram",
      voiceProvider: "vapi"
    };
    // Vapi-hosted voice: the ElevenLabs flag is NOT required…
    expect(
      liveVoicePipelineBlockReason({ ...ALL_CONFIRMED, ELEVENLABS_TRAINING_OPT_OUT_CONFIRMED: "false" }, vapiVoicePipeline)
    ).toBeNull();
    // …but the Vapi confirmations still are (explicit Vapi Voice policy).
    expect(
      liveVoicePipelineBlockReason({ ...ALL_CONFIRMED, VAPI_WORKSPACE_NO_TRAINING_CONFIRMED: "false" }, vapiVoicePipeline)
    ).toBe("VAPI_WORKSPACE_NO_TRAINING_CONFIRMED");
  });

  it("OpenAI Voice runs under the OpenAI confirmations (explicit policy)", () => {
    const openAiVoicePipeline: ResolvedVoicePipeline = {
      orchestrator: "vapi",
      llmProvider: "openai",
      transcriberProvider: "deepgram",
      voiceProvider: "openai"
    };
    expect(liveVoicePipelineBlockReason(ALL_CONFIRMED, openAiVoicePipeline)).toBeNull();
    expect(
      liveVoicePipelineBlockReason({ ...ALL_CONFIRMED, OPENAI_DATA_SHARING_DISABLED_CONFIRMED: "false" }, openAiVoicePipeline)
    ).toBe("OPENAI_DATA_SHARING_DISABLED_CONFIRMED");
  });

  it("Cartesia can never silently bypass policy — blocked until its confirmation flag is set", () => {
    /* Cartesia became the platform default voice (2026-08-06), so it moved from
       the no-pathway blocklist to a confirmation pathway like ElevenLabs. The
       invariant this test protects is unchanged: without the operator's explicit
       flag, workspace-derived data never reaches Cartesia. */
    const cartesiaPipeline: ResolvedVoicePipeline = {
      orchestrator: "vapi",
      llmProvider: "openai",
      transcriberProvider: "deepgram",
      voiceProvider: "cartesia"
    };
    expect(
      liveVoicePipelineBlockReason(
        { ...ALL_CONFIRMED, CARTESIA_NO_TRAINING_CONFIRMED: "false" },
        cartesiaPipeline
      )
    ).toBe("CARTESIA_NO_TRAINING_CONFIRMED");
    // Default env state (flag absent) is just as blocked.
    const withoutFlag = { ...ALL_CONFIRMED } as Record<string, string>;
    delete withoutFlag.CARTESIA_NO_TRAINING_CONFIRMED;
    expect(liveVoicePipelineBlockReason(withoutFlag, cartesiaPipeline)).toBe("CARTESIA_NO_TRAINING_CONFIRMED");
    // With the operator's confirmation, the platform default voice is usable.
    expect(liveVoicePipelineBlockReason(ALL_CONFIRMED, cartesiaPipeline)).toBeNull();
  });

  it("unknown voice/transcriber/model providers fail closed even with everything confirmed", () => {
    const base: ResolvedVoicePipeline = {
      orchestrator: "vapi",
      llmProvider: "openai",
      transcriberProvider: "deepgram",
      voiceProvider: "11labs"
    };
    expect(liveVoicePipelineBlockReason(ALL_CONFIRMED, { ...base, voiceProvider: "brand-new-tts" })).toBe(
      "UNKNOWN_AI_PROVIDER:brand-new-tts"
    );
    expect(liveVoicePipelineBlockReason(ALL_CONFIRMED, { ...base, transcriberProvider: "gladia" })).toBe(
      "UNKNOWN_AI_PROVIDER:gladia"
    );
    expect(liveVoicePipelineBlockReason(ALL_CONFIRMED, { ...base, llmProvider: "some-llm" })).toBe(
      "UNKNOWN_AI_PROVIDER:some-llm"
    );
  });
});

describe("parseStoredVoicePipeline", () => {
  it("parses and normalizes a stored deploy-time pipeline", () => {
    expect(
      parseStoredVoicePipeline({
        voicePipeline: { llmProvider: "claude", transcriberProvider: "deepgram", voiceProvider: "11labs" }
      })
    ).toEqual({
      orchestrator: "vapi",
      llmProvider: "anthropic",
      transcriberProvider: "deepgram",
      voiceProvider: "elevenlabs"
    });
  });

  it("returns null for absent or malformed configs (guard then uses the env fallback)", () => {
    expect(parseStoredVoicePipeline(null)).toBeNull();
    expect(parseStoredVoicePipeline({})).toBeNull();
    expect(parseStoredVoicePipeline({ voicePipeline: "broken" })).toBeNull();
    expect(parseStoredVoicePipeline({ voicePipeline: { llmProvider: "openai" } })).toBeNull();
  });
});

describe("chat runtime gate (OpenAI)", () => {
  it("fails closed by default and opens only with both OpenAI confirmations", () => {
    expect(isWorkspaceDerivedAllowedForChatRuntime({})).toBe(false);
    expect(chatRuntimeBlockReason({ ...ALL_CONFIRMED, OPENAI_DATA_SHARING_DISABLED_CONFIRMED: "nope" })).toBe(
      "OPENAI_DATA_SHARING_DISABLED_CONFIRMED"
    );
    expect(isWorkspaceDerivedAllowedForChatRuntime(ALL_CONFIRMED)).toBe(true);
  });
});
