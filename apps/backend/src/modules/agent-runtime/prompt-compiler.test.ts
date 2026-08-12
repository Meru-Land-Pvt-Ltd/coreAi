import { describe, expect, it } from "vitest";
import { compileCustomInstructions } from "./prompt-compiler";

describe("compileCustomInstructions", () => {
  it("keeps a leading number instead of eating it as a list marker", () => {
    // The old `[\s\-*•\d+.]+` strip turned these into "AM to 5 PM only",
    // "hour cancellation notice" and "% deposit".
    const compiled = compileCustomInstructions(
      ["9 AM to 5 PM only, no weekend bookings", "2 hour cancellation notice required", "50% deposit for cosmetic work"].join(
        "\n"
      )
    );

    expect(compiled).toBe(
      ["- 9 AM to 5 PM only, no weekend bookings", "- 2 hour cancellation notice required", "- 50% deposit for cosmetic work"].join(
        "\n"
      )
    );
  });

  it("keeps a leading plus so dialling codes survive", () => {
    expect(compileCustomInstructions("+91 numbers only for callbacks")).toBe(
      "- +91 numbers only for callbacks"
    );
  });

  it("still strips real list markers", () => {
    const compiled = compileCustomInstructions(
      ["- Ask for the insurance provider", "* Offer the evening slot first", "1. Escalate emergencies to Dr Rao", "2) Never quote prices"].join("\n")
    );

    expect(compiled).toBe(
      ["- Ask for the insurance provider", "- Offer the evening slot first", "- Escalate emergencies to Dr Rao", "- Never quote prices"].join("\n")
    );
  });

  it("does not drop a line that carries real instructions alongside a built-in rule", () => {
    // "keep replies short" matches a built-in pattern, but the monsoon offer is
    // the buyer's actual instruction and used to be discarded with it.
    expect(compileCustomInstructions("Keep replies short and always mention our monsoon offer")).toBe(
      "- Keep replies short and always mention our monsoon offer"
    );
  });

  it("still drops a line that is only a built-in rule", () => {
    expect(compileCustomInstructions("Keep replies short.")).toBe("");
    expect(compileCustomInstructions("Do not say you are an AI")).toBe("");
  });

  it("returns an empty string for blank input", () => {
    expect(compileCustomInstructions("")).toBe("");
    expect(compileCustomInstructions("   \n  ")).toBe("");
    expect(compileCustomInstructions(null)).toBe("");
    expect(compileCustomInstructions(undefined)).toBe("");
  });
});
