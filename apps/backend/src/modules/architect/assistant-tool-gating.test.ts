import { VOICE_TOOL_NAMES } from "@coreai/shared";
import { describe, expect, it } from "vitest";
import { shouldIncludeAssistantTool, type AssistantIncludeTools } from "./vapi-connector";

function toolsFor(includeTools: AssistantIncludeTools): string[] {
  return Object.values(VOICE_TOOL_NAMES).filter((name) => shouldIncludeAssistantTool(name, includeTools));
}

const base = { checkAvailability: true, bookAppointment: true };

describe("assistant tool gating (SMS / Email capability matrix)", () => {
  it("SMS-only workflow: send_notification AND record_sms_consent", () => {
    const tools = toolsFor({ ...base, sendNotification: true, recordSmsConsent: true });
    expect(tools).toContain(VOICE_TOOL_NAMES.sendNotification);
    expect(tools).toContain(VOICE_TOOL_NAMES.recordSmsConsent);
  });

  it("Email-only workflow: send_notification WITHOUT record_sms_consent", () => {
    const tools = toolsFor({ ...base, sendNotification: true, recordSmsConsent: false });
    expect(tools).toContain(VOICE_TOOL_NAMES.sendNotification);
    expect(tools).not.toContain(VOICE_TOOL_NAMES.recordSmsConsent);
  });

  it("SMS + Email workflow: both tools present, independent flags", () => {
    const tools = toolsFor({ ...base, sendNotification: true, recordSmsConsent: true });
    expect(tools).toContain(VOICE_TOOL_NAMES.sendNotification);
    expect(tools).toContain(VOICE_TOOL_NAMES.recordSmsConsent);
  });

  it("neither SMS nor Email: neither notification nor consent tool", () => {
    const tools = toolsFor({ ...base, sendNotification: false, recordSmsConsent: false });
    expect(tools).not.toContain(VOICE_TOOL_NAMES.sendNotification);
    expect(tools).not.toContain(VOICE_TOOL_NAMES.recordSmsConsent);
  });

  it("record_sms_consent is NEVER inferred from sendNotification — fails closed on omitted/legacy values", () => {
    // Email-only workflow with notifications enabled but no explicit SMS flag.
    expect(shouldIncludeAssistantTool(VOICE_TOOL_NAMES.recordSmsConsent, { sendNotification: true })).toBe(false);
    expect(shouldIncludeAssistantTool(VOICE_TOOL_NAMES.recordSmsConsent, { sendNotification: false })).toBe(false);
    // Legacy caller passing no includeTools at all.
    expect(shouldIncludeAssistantTool(VOICE_TOOL_NAMES.recordSmsConsent, undefined)).toBe(false);
    // Explicit false and explicit true.
    expect(shouldIncludeAssistantTool(VOICE_TOOL_NAMES.recordSmsConsent, { sendNotification: true, recordSmsConsent: false })).toBe(false);
    expect(shouldIncludeAssistantTool(VOICE_TOOL_NAMES.recordSmsConsent, { recordSmsConsent: true })).toBe(true);
  });

  it("booking tools follow the booking capability; knowledge lookup is independent", () => {
    const noBooking = toolsFor({ checkAvailability: false, bookAppointment: false, sendNotification: false, recordSmsConsent: false });
    expect(noBooking).not.toContain(VOICE_TOOL_NAMES.bookAppointment);
    expect(noBooking).not.toContain(VOICE_TOOL_NAMES.cancelAppointment);
    expect(noBooking).not.toContain(VOICE_TOOL_NAMES.rescheduleAppointment);
    expect(noBooking).toContain(VOICE_TOOL_NAMES.lookupKnowledge);
  });
});
