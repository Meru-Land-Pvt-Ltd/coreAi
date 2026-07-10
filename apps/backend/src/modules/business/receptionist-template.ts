import { buildVoiceBookingWorkflow, VOICE_NODE_TYPES } from "@coreai/shared";

export const RECEPTIONIST_WORKFLOW_NAME = "AI Receptionist Template";
export const RECEPTIONIST_WORKFLOW_DESCRIPTION =
  "Answers inbound calls, uses buyer-provided business context, checks calendar availability, books appointments, sends email follow-up, and ends the call cleanly.";

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
      voiceProvider: "",
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
    // Email-first MVP: the template ships with Send Email (proxy alias) —
    // Send SMS stays a manual add-on node in the builder palette.
    [VOICE_NODE_TYPES.sendEmail]: {
      recipientType: "customer",
      subjectTemplate: "Appointment confirmation with [Business Name]",
      bodyTemplate:
        "Hi [Customer Name],\nYour appointment with [Business Name] is confirmed for [Date] at [Time].\nIf you need to reply, just respond to this email.",
      includeCallSummary: "false",
      includeBookingDetails: "true"
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
