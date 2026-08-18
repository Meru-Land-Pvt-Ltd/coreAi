import { describe, expect, it } from "vitest";
import {
  SALES_TUNING_CONTROLS,
  resolveSalesTuning,
  vapiSpeechPlansFor,
  elevenLabsVoiceSettingsFor,
  salesBehaviourPromptFor
} from "@coreai/shared";

describe("sales tuning", () => {
  it("falls back to the researched defaults for a node saved before the dials existed", () => {
    const tuning = resolveSalesTuning({});
    for (const control of SALES_TUNING_CONTROLS) {
      expect(tuning[control.key]).toBe(control.default);
    }
  });

  it("clamps a value someone typed outside the range instead of shipping it to Vapi", () => {
    const tuning = resolveSalesTuning({ responseDelay: 99, interruptSensitivity: -4 });
    expect(tuning.responseDelay).toBe(1.5);
    expect(tuning.interruptSensitivity).toBe(0);
  });

  it("ignores junk and keeps the default rather than sending NaN", () => {
    const tuning = resolveSalesTuning({ responseDelay: "abc", empathy: null });
    expect(tuning.responseDelay).toBe(0.2);
    expect(tuning.empathy).toBe(3);
  });

  it("never lets barge-in trigger on background noise", () => {
    for (let level = 0; level <= 3; level += 1) {
      const plans = vapiSpeechPlansFor(resolveSalesTuning({ interruptSensitivity: level }));
      expect(plans.stopSpeakingPlan.voiceSeconds as number).toBeGreaterThanOrEqual(0.2);
    }
  });

  it("makes the sensitivity dial actually change barge-in", () => {
    const eager = vapiSpeechPlansFor(resolveSalesTuning({ interruptSensitivity: 3 }));
    const patient = vapiSpeechPlansFor(resolveSalesTuning({ interruptSensitivity: 0 }));
    expect(eager.stopSpeakingPlan.numWords).toBe(0);
    expect(patient.stopSpeakingPlan.numWords).toBe(4);
  });

  it("keeps ElevenLabs stability inside the range where it does not drift mid-sentence", () => {
    for (const value of [0, 0.5, 1]) {
      const settings = elevenLabsVoiceSettingsFor(resolveSalesTuning({ expressiveness: value }));
      expect(settings.stability).toBeGreaterThanOrEqual(0.3);
      expect(settings.stability).toBeLessThanOrEqual(0.75);
    }
  });

  it("emits clean numbers, not floating point noise, into the call payload", () => {
    const plans = vapiSpeechPlansFor(resolveSalesTuning({ responseDelay: 0.2 }));
    const endpointing = plans.startSpeakingPlan.transcriptionEndpointingPlan as Record<string, number>;
    for (const value of Object.values(endpointing)) {
      expect(String(value).replace("-", "").split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it("puts the rules that lost us the last call into the prompt", () => {
    const prompt = salesBehaviourPromptFor(resolveSalesTuning({}));
    expect(prompt).toContain("STOP TALKING");
    expect(prompt).toMatch(/never .*list price|"list price"/i);
    expect(prompt).toContain("does that sound good?");
    expect(prompt).toContain("Thursday at three");
  });

  it("moves the prompt when the dials move", () => {
    const gentle = salesBehaviourPromptFor(resolveSalesTuning({ assertiveness: 0, empathy: 0, maxQuestions: 12 }));
    const hard = salesBehaviourPromptFor(resolveSalesTuning({ assertiveness: 3, empathy: 3, maxQuestions: 2 }));
    expect(gentle).not.toBe(hard);
    expect(gentle).toContain("12 questions");
    expect(hard).toContain("2 questions");
    expect(hard).toContain("completely free to say no");
  });
});
