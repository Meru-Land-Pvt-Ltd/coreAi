import { buildVoiceBookingWorkflow, VOICE_NODE_TYPES } from "@coreai/shared";

export const RECEPTIONIST_WORKFLOW_NAME = "AI Receptionist Template";
export const RECEPTIONIST_WORKFLOW_DESCRIPTION =
  "Answers inbound calls, uses buyer-provided business context, checks calendar availability, books appointments, sends SMS follow-up, and ends the call cleanly.";

/**
 * Default buyer-install workflow.
 *
 * Important: this workflow is only STRUCTURE. Live identity is never taken from
 * these template defaults. apps/backend/src/modules/business/deploy.ts builds
 * the Vapi assistant from buyer setup: businessName, businessType,
 * assistantName, services, timezone, customInstructions and voice.
 */
export function buildReceptionistWorkflowJson() {
  const base = buildVoiceBookingWorkflow();

  const overrides: Record<string, Record<string, unknown>> = {
    [VOICE_NODE_TYPES.phoneCallTrigger]: {
      callHandlingMode: "AI_ANSWERS",
      answerAfterRings: "1",
      forwardingSchedule: "always"
    },
    [VOICE_NODE_TYPES.voiceConversation]: {
      assistantName: "{{assistant_name}}",
      firstMessage: "Hello, this is {{assistant_name}} from {{business_name}}. How can I help you today?",
      model: "gpt-4o-mini",
      voice: "triven-default",
      voiceName: "Triven Voice",
      voiceProvider: "11labs",
      voiceId: "",
      practiceName: "",
      doctorName: "",
      practiceHours: "",
      services: "",
      fallbackResponse: "Let me take a message and have the team call you back shortly.",
      customInstructions: ""
    },
    [VOICE_NODE_TYPES.calendarAvailability]: {
      bufferMinutes: "10",
      maxAdvanceDays: "30",
      slotsToOffer: "3"
    },
    [VOICE_NODE_TYPES.bookAppointment]: {
      eventTitleFormat: "[Service] - [Customer Name]",
      confirmationMessage: "Perfect, you are all set for [Service] on [Date] at [Time]."
    },
    [VOICE_NODE_TYPES.sendSms]: {
      sendToCustomer: "true",
      customerTemplate: "Confirmed: [Service] on [Date] at [Time]. Reply if you need to change it.",
      teamTemplate: "New booking: [Customer Name], [Date] [Time], [Service]. Phone: [Customer Phone]"
    },
    [VOICE_NODE_TYPES.endFlow]: {
      closingMessage: "Thank you for calling. Have a great day.",
      callRecording: "true"
    }
  };

  return {
    nodes: base.nodes.map((node) => {
      const nodeType = String(node.data.type ?? "");
      return {
        ...node,
        data: {
          ...node.data,
          ...(overrides[nodeType] ?? {})
        }
      };
    }),
    edges: base.edges
  };
}
