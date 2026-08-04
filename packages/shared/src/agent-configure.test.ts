import { describe, expect, it } from "vitest";
import { generateIncludedFeaturesFromWorkflow, getHowItWorksSteps, getHowItWorksSubtitle, hasCallNode } from "./agent-configure";

describe("agent-configure dynamic workflow helpers", () => {
  describe("hasCallNode", () => {
    it("returns true when workflow contains call/voice nodes", () => {
      const voiceWorkflow = {
        nodes: [
          { data: { type: "trigger.phone_call", label: "Incoming Call" } },
          { data: { type: "ai.voice_conversation", label: "Voice Conversation" } }
        ]
      };
      expect(hasCallNode(voiceWorkflow)).toBe(true);
    });

    it("returns false when workflow does not contain any call/voice nodes", () => {
      const nonVoiceWorkflow = {
        nodes: [
          { data: { type: "trigger.gmail_new_email", label: "New Email" } },
          { data: { type: "action.send_sms", label: "Send SMS" } }
        ]
      };
      expect(hasCallNode(nonVoiceWorkflow)).toBe(false);
    });
  });

  describe("getHowItWorksSteps", () => {
    it("dynamically generates steps based on non-call workflow nodes", () => {
      const emailSmsWorkflow = {
        nodes: [
          { data: { type: "trigger.gmail_new_email", label: "Gmail Inquiry" } },
          { data: { type: "ai.prompt", label: "Draft AI Response", prompt: "Summarize email" } },
          { data: { type: "action.send_sms", label: "Send SMS Alert" } }
        ]
      };
      const steps = getHowItWorksSteps([], emailSmsWorkflow);

      expect(steps).toHaveLength(3);
      expect(steps[0].title).toBe("Email Received");
      expect(steps[0].description).toContain("email");
      expect(steps[1].title).toBe("Draft AI Response");
      expect(steps[2].title).toBe("Send SMS Alert");
    });

    it("dynamically generates steps for voice workflow nodes", () => {
      const voiceWorkflow = {
        nodes: [
          { data: { type: "trigger.phone_call", label: "Customer Phone Call" } },
          { data: { type: "ai.voice_conversation", label: "Voice AI" } },
          { data: { type: "calendar.book_appointment", label: "Book Appointment" } }
        ]
      };
      const steps = getHowItWorksSteps([], voiceWorkflow);

      expect(steps).toHaveLength(3);
      expect(steps[0].title).toBe("Customer Calls");
      expect(steps[1].title).toBe("Natural Voice Conversation");
      expect(steps[2].title).toBe("Book Appointment");
    });

    it("handles workflow with no action nodes cleanly without static default claims", () => {
      const promptOnlyWorkflow = {
        nodes: [
          { data: { type: "trigger.manual", label: "Manual Input" } },
          { data: { type: "ai.prompt", label: "AI Analysis", prompt: "Analyze document" } }
        ]
      };
      const steps = getHowItWorksSteps([], promptOnlyWorkflow);

      expect(steps).toHaveLength(3);
      expect(steps[2].title).toBe("Response & Completion");
      expect(steps[2].description).not.toContain("databases are synced");
      expect(steps[2].description).not.toContain("calendar events are created");
    });

    it("uses second-to-last node when last node is End Flow", () => {
      const endFlowWorkflow = {
        nodes: [
          { data: { type: "trigger.phone_call", label: "Phone Call" } },
          { data: { type: "ai.voice_conversation", label: "Voice Assistant" } },
          { data: { type: "flow.end", label: "End Flow" } }
        ]
      };
      const steps = getHowItWorksSteps([], endFlowWorkflow);

      expect(steps).toHaveLength(3);
      expect(steps[2].title).toBe("Action Completed");
      expect(steps[2].description).not.toContain("End Flow");
    });
  });

  describe("getHowItWorksSubtitle", () => {
    it("returns dynamic subtitle reflecting trigger node", () => {
      const emailWorkflow = {
        nodes: [
          { data: { type: "trigger.gmail_new_email", label: "Incoming Email" } }
        ]
      };
      const subtitle = getHowItWorksSubtitle([], emailWorkflow);
      expect(subtitle).toBe("From incoming email to completed task in three automatic steps.");
    });
  });

  describe("generateIncludedFeaturesFromWorkflow", () => {
    it("does NOT output 'Inbound phone call answering' for AI Brain (llm_call) and manual triggers", () => {
      const aiBrainWorkflow = {
        nodes: [
          { id: "n1", data: { type: "trigger.manual", nodeKind: "trigger", title: "Manual Event" } },
          { id: "n2", data: { type: "ai.llm_call", nodeKind: "ai", title: "AI Brain" } }
        ],
        edges: [{ source: "n1", target: "n2" }]
      };
      const features = generateIncludedFeaturesFromWorkflow(aiBrainWorkflow);
      expect(features).not.toContain("Inbound phone call answering");
      expect(features).toContain("Web chat & event trigger");
      expect(features).toContain("Custom AI text generation & reasoning");
    });

    it("generates WhatsApp feature bullets for WhatsApp workflows", () => {
      const whatsappWorkflow = {
        nodes: [
          { id: "w1", data: { type: "trigger.whatsapp_message_received", title: "WhatsApp Trigger" } },
          { id: "w2", data: { type: "action.send_whatsapp", title: "Send WhatsApp" } }
        ],
        edges: [{ source: "w1", target: "w2" }]
      };
      const features = generateIncludedFeaturesFromWorkflow(whatsappWorkflow);
      expect(features).not.toContain("Inbound phone call answering");
      expect(features).toContain("WhatsApp customer messaging");
      expect(features).toContain("Automated WhatsApp notifications & replies");
    });

    it("outputs 'Inbound phone call answering' ONLY when a phone call trigger is present", () => {
      const phoneWorkflow = {
        nodes: [
          { id: "p1", data: { type: "trigger.phone_call", title: "Inbound Call" } },
          { id: "p2", data: { type: "ai.voice_conversation", title: "Voice AI" } }
        ],
        edges: [{ source: "p1", target: "p2" }]
      };
      const features = generateIncludedFeaturesFromWorkflow(phoneWorkflow);
      expect(features).toContain("Inbound phone call answering");
      expect(features).toContain("Natural AI voice conversation");
    });
  });
});
