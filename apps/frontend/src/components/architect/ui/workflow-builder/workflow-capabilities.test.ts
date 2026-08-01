import { describe, expect, it } from "vitest";
import { VOICE_NODE_TYPES } from "@coreai/shared";
import { deriveWorkflowCapabilities, workflowHasTriggerNode } from "./workflow-capabilities";

describe("deriveWorkflowCapabilities", () => {
  it("detects voice + calendar + email send nodes", () => {
    const caps = deriveWorkflowCapabilities([
      { data: { type: VOICE_NODE_TYPES.phoneCallTrigger } },
      { data: { type: VOICE_NODE_TYPES.voiceConversation } },
      { data: { type: VOICE_NODE_TYPES.calendarAvailability } },
      { data: { type: VOICE_NODE_TYPES.sendEmail } }
    ]);
    expect(caps.hasVoice).toBe(true);
    expect(caps.hasCalendar).toBe(true);
    expect(caps.hasEmailSend).toBe(true);
    expect(caps.hasManualTrigger).toBe(false);
    expect(caps.hasInboundSms).toBe(false);
  });

  it("detects inbound SMS and hides manual trigger", () => {
    const caps = deriveWorkflowCapabilities([
      { data: { type: "trigger.twilio_inbound_sms" } },
      { data: { type: "ai.context_reply" } }
    ]);
    expect(caps.hasInboundSms).toBe(true);
    expect(caps.hasManualTrigger).toBe(false);
  });

  it("detects manual trigger when no call/sms triggers", () => {
    const caps = deriveWorkflowCapabilities([
      { data: { type: "trigger.manual" } },
      { data: { type: "ai.llm_call" } }
    ]);
    expect(caps.hasManualTrigger).toBe(true);
    expect(caps.hasLlm).toBe(true);
    expect(caps.hasVoice).toBe(false);
  });

  it("detects gmail connector and telegram trigger", () => {
    const caps = deriveWorkflowCapabilities([
      { data: { type: "integration.gmail_read_emails", connector: "Gmail" } },
      { data: { type: "trigger.telegram_message" } }
    ]);
    expect(caps.hasGmail).toBe(true);
    expect(caps.hasTelegram).toBe(true);
  });
});

describe("workflowHasTriggerNode", () => {
  it("returns false when canvas has no trigger", () => {
    expect(
      workflowHasTriggerNode([{ data: { type: "ai.llm_call", nodeKind: "ai" } }])
    ).toBe(false);
  });

  it("returns true for phone, manual, and sms triggers", () => {
    expect(
      workflowHasTriggerNode([{ data: { type: VOICE_NODE_TYPES.phoneCallTrigger } }])
    ).toBe(true);
    expect(workflowHasTriggerNode([{ data: { type: "trigger.manual" } }])).toBe(true);
    expect(workflowHasTriggerNode([{ data: { type: "trigger.twilio_inbound_sms" } }])).toBe(true);
  });
});
