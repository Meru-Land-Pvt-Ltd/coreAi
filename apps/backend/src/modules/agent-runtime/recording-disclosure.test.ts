import { describe, expect, it } from "vitest";
import {
  RECORDING_DISCLOSURE_LINE,
  withRecordingDisclosure,
  workflowCallRecordingEnabled
} from "./graph-runner";

describe("recording disclosure", () => {
  it("appends the notice to a normal greeting exactly once", () => {
    const out = withRecordingDisclosure("Thank you for calling Bright Smiles! How can I help?");
    expect(out.endsWith(RECORDING_DISCLOSURE_LINE)).toBe(true);
    expect(out).toContain("Bright Smiles");
    // Idempotent: appending again never doubles the notice.
    expect(withRecordingDisclosure(out)).toBe(out);
  });

  it("respects a custom greeting that already discloses recording", () => {
    const custom = "Hi! Calls are recorded for training. How can I help?";
    expect(withRecordingDisclosure(custom)).toBe(custom);
    const active = "Hi! We may be recording this call. How can I help?";
    expect(withRecordingDisclosure(active)).toBe(active);
  });

  it("a greeting merely mentioning 'records' does NOT suppress the notice", () => {
    const out = withRecordingDisclosure(
      "Thanks for calling — we keep detailed records so your visit is seamless. How can I help?"
    );
    expect(out.endsWith(RECORDING_DISCLOSURE_LINE)).toBe(true);
  });

  it("handles empty and unterminated greetings", () => {
    expect(withRecordingDisclosure("")).toBe(RECORDING_DISCLOSURE_LINE);
    expect(withRecordingDisclosure("Welcome to Acme")).toBe(
      `Welcome to Acme. ${RECORDING_DISCLOSURE_LINE}`
    );
  });

  it("recording defaults on unless the End Flow toggle disables it", () => {
    const withToggleOff = {
      nodes: [{ id: "end", data: { type: "flow.end", callRecording: false } }]
    };
    const withToggleOn = {
      nodes: [{ id: "end", data: { type: "flow.end", callRecording: true } }]
    };
    expect(workflowCallRecordingEnabled(withToggleOff)).toBe(false);
    expect(workflowCallRecordingEnabled(withToggleOn)).toBe(true);
    expect(workflowCallRecordingEnabled({ nodes: [] })).toBe(true);
    expect(workflowCallRecordingEnabled(null)).toBe(true);
  });
});
