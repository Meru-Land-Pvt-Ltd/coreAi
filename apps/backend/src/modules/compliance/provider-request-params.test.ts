import { describe, expect, it } from "vitest";
import { buildQueryString } from "../ai-provider-engine/providers/deepgram.adapter";
import { elevenLabsTtsQuery } from "./elevenlabs-params";

describe("Deepgram request params", () => {
  it("always sends mip_opt_out=true on direct Listen requests", () => {
    const qs = new URLSearchParams(buildQueryString("nova-3", undefined, {}));
    expect(qs.get("mip_opt_out")).toBe("true");
  });

  it("keeps mip_opt_out=true regardless of caller metadata", () => {
    const qs = new URLSearchParams(
      buildQueryString("nova-2", "en", { diarize: true, punctuate: false, mip_opt_out: false })
    );
    expect(qs.get("mip_opt_out")).toBe("true");
    expect(qs.get("language")).toBe("en");
    expect(qs.get("diarize")).toBe("true");
  });

  it("coerces unsupported languages for English-only models like nova-2-medical", () => {
    const qs = new URLSearchParams(
      buildQueryString("nova-2-medical", "multi", { diarize: false })
    );
    expect(qs.get("model")).toBe("nova-2-medical");
    expect(qs.get("language")).toBe("en");
    expect(qs.get("mip_opt_out")).toBe("true");
  });
});

describe("ElevenLabs TTS params", () => {
  it("omits enable_logging unless the ZRM plan support is affirmatively confirmed", () => {
    for (const value of [undefined, "false", "", "TRUE", "yes"]) {
      const qs = new URLSearchParams(
        elevenLabsTtsQuery({ output_format: "mp3_44100_128" }, { ELEVENLABS_ZRM_CONFIRMED: value })
      );
      expect(qs.get("enable_logging")).toBeNull();
      expect(qs.get("output_format")).toBe("mp3_44100_128");
    }
  });

  it("adds enable_logging=false only when ELEVENLABS_ZRM_CONFIRMED is true", () => {
    const qs = new URLSearchParams(
      elevenLabsTtsQuery({ output_format: "mp3_44100_128" }, { ELEVENLABS_ZRM_CONFIRMED: "true" })
    );
    expect(qs.get("enable_logging")).toBe("false");
  });
});
