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

  it("detects Calendly without treating it as Google Calendar", () => {
    const caps = deriveWorkflowCapabilities([
      { data: { type: "trigger.calendly", connector: "Calendly", calendlyEvent: "meeting_booked" } }
    ]);
    expect(caps.hasCalendly).toBe(true);
    expect(caps.hasCalendlyTrigger).toBe(true);
    expect(caps.hasCalendar).toBe(false);
  });

  it("detects Deepgram STT vs TTS modes", () => {
    const sttCaps = deriveWorkflowCapabilities([
      { data: { type: "ai.deepgram_stt" } }
    ]);
    expect(sttCaps.hasDeepgram).toBe(true);
    expect(sttCaps.hasDeepgramStt).toBe(true);
    expect(sttCaps.hasDeepgramTts).toBe(false);

    const ttsCaps = deriveWorkflowCapabilities([
      { data: { type: "ai.deepgram_tts" } }
    ]);
    expect(ttsCaps.hasDeepgramTts).toBe(true);
    expect(ttsCaps.hasDeepgramStt).toBe(false);
  });

  it("detects WhatsApp trigger and action", () => {
    const caps = deriveWorkflowCapabilities([
      { data: { type: "trigger.whatsapp_message_received", connector: "WhatsApp" } },
      { data: { type: "action.send_whatsapp", connector: "WhatsApp" } }
    ]);
    expect(caps.hasWhatsApp).toBe(true);
    expect(caps.hasWhatsAppTrigger).toBe(true);
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
