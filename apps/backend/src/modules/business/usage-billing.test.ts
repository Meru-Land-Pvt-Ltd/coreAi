import { describe, expect, it } from "vitest";
import { extractRecordingUrl } from "./usage-billing";

const RECORDING_URL = "https://storage.vapi.ai/recordings/abc123.wav";

describe("extractRecordingUrl", () => {
  it("reads the artifact recording url from an end-of-call-report", () => {
    expect(extractRecordingUrl({ artifact: { recordingUrl: RECORDING_URL } })).toBe(RECORDING_URL);
  });

  it("falls back to legacy top-level recording fields", () => {
    expect(extractRecordingUrl({ recordingUrl: RECORDING_URL })).toBe(RECORDING_URL);
    expect(extractRecordingUrl({ stereoRecordingUrl: RECORDING_URL })).toBe(RECORDING_URL);
  });

  it("prefers the artifact url over legacy fields", () => {
    expect(
      extractRecordingUrl({
        artifact: { recordingUrl: RECORDING_URL },
        recordingUrl: "https://example.com/other.wav"
      })
    ).toBe(RECORDING_URL);
  });

  it("returns null when recording was disabled (no artifact url present)", () => {
    expect(extractRecordingUrl({ artifact: {} })).toBeNull();
    expect(extractRecordingUrl({})).toBeNull();
  });

  it("rejects non-https values", () => {
    expect(extractRecordingUrl({ recordingUrl: "javascript:alert(1)" })).toBeNull();
    expect(extractRecordingUrl({ recordingUrl: "http://insecure.example.com/a.wav" })).toBeNull();
    expect(extractRecordingUrl({ recordingUrl: 42 })).toBeNull();
  });
});
