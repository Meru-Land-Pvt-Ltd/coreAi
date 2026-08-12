import { describe, expect, it } from "vitest";
import {
  createDefaultSessionState,
  getV1SessionKey,
  getV2SessionKey,
  getVoiceSession,
  saveVoiceSession
} from "./session";
import { buildCompactBusinessContext, buildUnifiedVoiceSystemPrompt, PLATFORM_VOICE_RUNTIME_POLICY } from "./prompt";
import { executeToolGateway } from "./tools";

describe("VoiceCallSession", () => {
  it("formats versioned v2 session keys", () => {
    expect(getV2SessionKey("biz_123", "call_456")).toBe("call-session:v2:biz_123:call_456");
    expect(getV1SessionKey("biz_123", "call_456")).toBe("call-session:biz_123:call_456");
  });

  it("creates default v2 session state with proper fallback options", () => {
    const session = createDefaultSessionState("biz_123", "call_456", {
      installedAgentId: "agent_789",
      customerPhone: "+15550001111",
      executionMode: "LIVE",
      timeZone: "America/New_York"
    });

    expect(session.businessId).toBe("biz_123");
    expect(session.callId).toBe("call_456");
    expect(session.installedAgentId).toBe("agent_789");
    expect(session.customerPhone).toBe("+15550001111");
    expect(session.executionMode).toBe("LIVE");
    expect(session.timeZone).toBe("America/New_York");
    expect(session.version).toBe("v2");
    expect(session.bookingState).toBe("IDLE");
  });
});

describe("Voice Prompt Engine", () => {
  it("includes immutable Platform Runtime Policy", () => {
    const prompt = buildUnifiedVoiceSystemPrompt({
      businessName: "Acme Dental",
      timeZone: "America/New_York",
      customBusinessPrompt: "Be ultra friendly and book appointments."
    });

    expect(prompt).toContain(PLATFORM_VOICE_RUNTIME_POLICY);
    expect(prompt).toContain("Business: Acme Dental");
    expect(prompt).toContain("Be ultra friendly and book appointments.");
    expect(prompt).toContain("KNOWLEDGE BASE GUIDANCE");
  });

  it("builds compact business context without injecting long FAQs", () => {
    const context = buildCompactBusinessContext({
      businessName: "Acme Dental",
      businessType: "Dental Practice",
      timeZone: "America/New_York",
      formattedHours: "Mon-Fri 9am-5pm",
      services: ["Teeth Cleaning", "Cavity Filling"]
    });

    expect(context).toContain("Business: Acme Dental");
    expect(context).toContain("Type: Dental Practice");
    expect(context).toContain("Hours: Mon-Fri 9am-5pm");
    expect(context).toContain("Teeth Cleaning, Cavity Filling");
  });
});

describe("Tool Gateway", () => {
  it("normalizes unknown tool result into safe response", async () => {
    const response = await executeToolGateway(
      { id: "call_tool_1", name: "unknown_custom_tool", parameters: {} },
      {
        session: createDefaultSessionState("biz_123", "call_456"),
        business: { businessId: "biz_123", businessName: "Acme Dental", timeZone: "UTC" },
        customerPhone: "+15550001111",
        patientPhone: "+15550001111",
        callId: "call_456",
        executionMode: "LIVE",
        timeZone: "UTC"
      }
    );

    expect(response.name).toBe("unknown_custom_tool");
    expect(response.toolCallId).toBe("call_tool_1");
    expect(response.result).toBe(JSON.stringify({ ok: true }));
  });
});
