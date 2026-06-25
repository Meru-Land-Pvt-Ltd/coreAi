import { CORE_CONNECTOR, CORE_CONNECTOR_ACTIONS, comingSoonNodes } from "@coreai/shared";
import type { AgentTemplate, ComingSoonItem, LibraryGroup } from "./types";
import { createGmailReplyFlow, createMissedCallTextBackFlow } from "./workflow-factories";

export const libraryGroups: LibraryGroup[] = [
  {
    title: "Triggers",
    items: [
      {
        nodeKind: "trigger",
        label: "Customer Calls",
        helper: "Twilio missed-call webhook",
        icon: "phone",
        accent: "amber",
        overrides: {
          title: "Customer Calls",
          subtitle: "When someone calls and no one picks up",
          footer: "Twilio detects the missed call instantly"
        }
      },
      {
        nodeKind: "trigger",
        label: "Inbound SMS",
        helper: "Twilio inbound text",
        icon: "message",
        accent: "amber",
        testId: "node-trigger-twilio-inbound-sms",
        overrides: {
          title: "Inbound SMS",
          subtitle: "When a customer replies by text",
          footer: "Handled by the Twilio SMS webhook"
        }
      },
      {
        nodeKind: "trigger",
        label: "Vapi Tool Call",
        helper: "Voice booking webhook",
        icon: "phone-call",
        accent: "violet",
        testId: "node-trigger-vapi-tool-call",
        overrides: {
          title: "Vapi Tool Call",
          subtitle: "When Vapi calls a tool (e.g. book_appointment)",
          footer: "Handled by the Vapi webhook"
        }
      }
    ]
  },
  {
    title: "AI",
    items: [
      {
        nodeKind: "ai",
        label: "Personalize Text",
        helper: "Generate human reply",
        icon: "sparkles",
        accent: "violet",
        overrides: {
          title: "Personalize Text",
          subtitle: "Friendly message based on business and caller context"
        }
      }
    ]
  },
  {
    title: "Logic",
    items: [
      {
        nodeKind: "condition",
        label: "Business Hours",
        helper: "Send now or queue",
        icon: "diamond",
        accent: "orange",
        overrides: {
          title: "Business Hours?",
          subtitle: "If open: text now · If closed: queue morning",
          condition: "8AM–6PM, Monday–Friday"
        }
      }
    ]
  },
  {
    title: "Actions",
    items: [
      {
        nodeKind: "connector",
        label: "Auto Text in 5 Seconds",
        helper: "Send SMS immediately",
        icon: "message",
        accent: "green",
        overrides: {
          title: "Auto Text in 5 Seconds",
          subtitle: "Customer knows they were not ignored",
          connector: "SMS",
          connectorAction: "send_sms",
          smsTo: "{{caller_number}}",
          smsBody:
            "Hi {{caller_name}}, this is {{business.name}}. Sorry we missed your call. We can help by text right now. Would you like to book an appointment or ask a quick question?"
        }
      },
      {
        nodeKind: "connector",
        label: "Lead Captured",
        helper: "Continue conversation",
        icon: "capture",
        accent: "blue",
        overrides: {
          title: "Lead Captured",
          subtitle: "Book appointments, answer FAQs, or route to team",
          connector: "SMS",
          connectorAction: "capture_lead"
        }
      }
    ]
  },
  {
    title: "Save & Route",
    items: [
      {
        nodeKind: "connector",
        label: "Save Lead",
        helper: "Persist the caller as a lead",
        icon: "capture",
        accent: "blue",
        testId: "node-action-save-lead",
        overrides: {
          title: "Save Lead",
          subtitle: "Store or update the caller as a lead for this business",
          connector: CORE_CONNECTOR,
          connectorAction: CORE_CONNECTOR_ACTIONS.saveLead,
          leadSource: "WORKFLOW",
          leadStatus: "CAPTURED"
        }
      },
      {
        nodeKind: "connector",
        label: "Save Conversation",
        helper: "Store a conversation message",
        icon: "message",
        accent: "green",
        testId: "node-action-save-conversation-message",
        overrides: {
          title: "Save Conversation",
          subtitle: "Record an inbound, outbound, or system message",
          connector: CORE_CONNECTOR,
          connectorAction: CORE_CONNECTOR_ACTIONS.saveConversationMessage,
          conversationDirection: "OUTBOUND",
          conversationBody: "{{sentSms.body}}"
        }
      },
      {
        nodeKind: "connector",
        label: "Human Handoff",
        helper: "Escalate to a team member",
        icon: "phone-call",
        accent: "red",
        testId: "node-action-human-handoff",
        overrides: {
          title: "Human Handoff",
          subtitle: "Escalate the lead and notify the team",
          connector: CORE_CONNECTOR,
          connectorAction: CORE_CONNECTOR_ACTIONS.humanHandoff,
          handoffReason: "{{business.escalationRules}}"
        }
      },
      {
        nodeKind: "connector",
        label: "Next Workflow",
        helper: "Trigger another workflow",
        icon: "diamond",
        accent: "orange",
        testId: "node-action-trigger-next-workflow",
        overrides: {
          title: "Next Workflow",
          subtitle: "Run a follow-up workflow with the same context",
          connector: CORE_CONNECTOR,
          connectorAction: CORE_CONNECTOR_ACTIONS.triggerNextWorkflow,
          nextWorkflowId: ""
        }
      }
    ]
  },

  {
    title: "Voice + Calendar",
    items: [
      {
        nodeKind: "connector",
        label: "AI Voice Callback",
        helper: "Vapi talks to the patient",
        icon: "phone-call",
        accent: "violet",
        overrides: {
          title: "AI Voice Callback",
          subtitle: "Vapi calls the patient and answers questions using business context",
          connector: "Vapi",
          connectorAction: "start_voice_call",
          vapiAssistantId: "{{business.vapiAssistantId}}",
          vapiPhoneNumberId: "{{business.vapiPhoneNumberId}}"
        }
      },
      {
        nodeKind: "connector",
        label: "Book Appointment",
        helper: "Create Google Calendar event",
        icon: "calendar",
        accent: "blue",
        overrides: {
          title: "Book Appointment",
          subtitle: "Google Calendar creates the booked appointment",
          connector: "Google Calendar",
          connectorAction: "book_appointment",
          calendarId: "{{business.calendarId}}",
          appointmentService: "Consultation"
        }
      }
    ]
  },
  {
    title: "Gmail",
    items: [
      {
        nodeKind: "connector",
        label: "Read Gmail Emails",
        helper: "Search inbox with query",
        icon: "mail",
        accent: "blue",
        overrides: {
          title: "Read Gmail Emails",
          subtitle: "Find the latest email matching a Gmail query",
          connector: "Gmail",
          connectorAction: "read_emails",
          gmailQuery: "newer_than:7d"
        }
      },
      {
        nodeKind: "ai",
        label: "Draft Email Reply",
        helper: "Generate response from email",
        icon: "sparkles",
        accent: "violet",
        overrides: {
          title: "Draft Email Reply",
          subtitle: "Create a helpful reply from the email context",
          prompt:
            "Read the Gmail email and write a concise, professional reply that answers the customer clearly."
        }
      },
      {
        nodeKind: "connector",
        label: "Create Gmail Draft",
        helper: "Safe reply draft",
        icon: "mail",
        accent: "blue",
        overrides: {
          title: "Create Gmail Draft",
          subtitle: "Creates a draft instead of sending immediately",
          connector: "Gmail",
          connectorAction: "draft_reply",
          gmailTo: "{{gmail.senderEmail}}",
          gmailSubject: "Re: {{gmail.subject}}",
          gmailBody: "{{ai.output}}"
        }
      },
      {
        nodeKind: "connector",
        label: "Send Gmail Email",
        helper: "Send real email",
        icon: "mail",
        accent: "green",
        overrides: {
          title: "Send Gmail Email",
          subtitle: "Sends email from the connected Gmail account",
          connector: "Gmail",
          connectorAction: "send_email",
          gmailTo: "{{gmail.senderEmail}}",
          gmailSubject: "Re: {{gmail.subject}}",
          gmailBody: "{{ai.output}}"
        }
      }
    ]
  }
];

export const agentTemplates: AgentTemplate[] = [
  {
    id: "missed-call",
    title: "Build Missed Call Text-Back",
    description: "Twilio missed call → Vapi voice → Calendar booking → SMS follow-up",
    accent: "amber",
    icon: "phone",
    flow: createMissedCallTextBackFlow
  },
  {
    id: "gmail-reply",
    title: "Build Gmail Reply Flow",
    description: "Read email → AI reply → Create draft",
    accent: "blue",
    icon: "mail",
    flow: createGmailReplyFlow
  }
];

// Future nodes surfaced in the builder as non-executable "Coming soon" chips.
// They cannot be added to the canvas, so they can never end up in a published
// or executed workflow.
export const comingSoonItems: ComingSoonItem[] = comingSoonNodes().map((node) => ({
  type: node.type,
  label: node.label,
  description: node.description,
  testId: node.testId
}));
