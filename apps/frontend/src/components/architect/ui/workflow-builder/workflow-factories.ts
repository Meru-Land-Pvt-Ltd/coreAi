import { DENTAL_NODE_TYPES, getNodeDefinition } from "@coreai/shared";
import type { BuilderFlow, BuilderNode, NodeKind } from "./types";
import { createFlowEdge } from "./edge-utils";
import { defaultNodeData } from "./node-defaults";

/** Build a dental builder node, seeding its data from the shared registry defaults. */
function dentalNode(
  id: string,
  type: string,
  nodeKind: NodeKind,
  position: { x: number; y: number },
  overrides: Partial<BuilderNode["data"]>
): BuilderNode {
  const def = getNodeDefinition(type);
  return {
    id,
    type: "coreNode",
    position,
    data: defaultNodeData(nodeKind, {
      type,
      label: def?.label ?? id,
      title: def?.label ?? id,
      subtitle: def?.description ?? "",
      ...(def?.defaultConfig ?? {}),
      ...overrides
    })
  };
}

/**
 * The 6-node Dental AI Receptionist (Triven). Drag/connect these in the builder,
 * configure the AI Conversation node, then Deploy. The Deploy endpoint reads each
 * node by `data.type` (the registry slug) to build the live Vapi assistant.
 */
export function createDentalReceptionistFlow(): BuilderFlow {
  const nodes: BuilderNode[] = [
    dentalNode("incoming_phone_call", DENTAL_NODE_TYPES.incomingPhoneCall, "trigger", { x: 80, y: 300 }, {
      kind: "TWILIO",
      icon: "phone",
      accent: "amber"
    }),
    dentalNode("ai_conversation", DENTAL_NODE_TYPES.aiConversation, "ai", { x: 360, y: 300 }, {
      kind: "VAPI · GPT-4o",
      icon: "sparkles",
      accent: "violet"
    }),
    dentalNode("check_calendar", DENTAL_NODE_TYPES.checkCalendar, "connector", { x: 640, y: 300 }, {
      kind: "CALENDAR",
      icon: "calendar",
      accent: "blue",
      connector: "Google Calendar",
      connectorAction: "check_availability"
    }),
    dentalNode("book_appointment", DENTAL_NODE_TYPES.bookAppointment, "connector", { x: 920, y: 300 }, {
      kind: "CALENDAR",
      icon: "calendar",
      accent: "blue",
      connector: "Google Calendar",
      connectorAction: "book_appointment"
    }),
    dentalNode("send_sms_notification", DENTAL_NODE_TYPES.sendSmsNotification, "connector", { x: 1200, y: 300 }, {
      kind: "TWILIO SMS",
      icon: "message",
      accent: "green",
      connector: "SMS",
      connectorAction: "send_notification"
    }),
    dentalNode("end_call", DENTAL_NODE_TYPES.endCall, "output", { x: 1480, y: 300 }, {
      kind: "END CALL",
      icon: "capture",
      accent: "slate"
    })
  ];

  return {
    nodes,
    edges: [
      createFlowEdge({ id: "d1", source: "incoming_phone_call", target: "ai_conversation", accent: "amber" }),
      createFlowEdge({ id: "d2", source: "ai_conversation", target: "check_calendar", accent: "violet" }),
      createFlowEdge({ id: "d3", source: "check_calendar", target: "book_appointment", accent: "blue", label: "Slots" }),
      createFlowEdge({ id: "d4", source: "book_appointment", target: "send_sms_notification", accent: "blue", label: "Booked" }),
      createFlowEdge({ id: "d5", source: "send_sms_notification", target: "end_call", accent: "green" })
    ]
  };
}

export function createMissedCallTextBackFlow(): BuilderFlow {
  const nodes: BuilderNode[] = [
    {
      id: "trigger",
      type: "coreNode",
      position: { x: 560, y: 40 },
      data: defaultNodeData("trigger", {
        label: "Missed Call Detected",
        title: "Missed Call Detected",
        kind: "TWILIO",
        icon: "phone-missed",
        accent: "amber",
        subtitle: "Twilio detects no-answer, busy, failed, or canceled calls",
        footer: "Output: caller_number, business context, timestamp"
      })
    },
    {
      id: "ai",
      type: "coreNode",
      position: { x: 560, y: 250 },
      data: defaultNodeData("ai", {
        label: "Context-Aware Reply",
        title: "Context-Aware Reply",
        kind: "AI PROCESS",
        icon: "sparkles",
        accent: "violet",
        subtitle: "Uses business type, services, FAQs, booking URL, and rules",
        footer: "Input: business profile + caller -> Output: ai.output",
        prompt:
          "You are the AI receptionist for {{business.name}}. Use business type, services, FAQs, hours, booking URL, and escalation rules. Keep responses helpful and concise."
      })
    },
    {
      id: "vapi-call",
      type: "coreNode",
      position: { x: 240, y: 480 },
      data: defaultNodeData("connector", {
        label: "AI Voice Callback",
        title: "AI Voice Callback",
        kind: "VAPI AI",
        icon: "phone-call",
        accent: "violet",
        subtitle: "Vapi calls the patient and handles the voice conversation",
        connector: "Vapi",
        connectorAction: "start_voice_call",
        vapiAssistantId: "{{business.vapiAssistantId}}",
        vapiPhoneNumberId: "{{business.vapiPhoneNumberId}}"
      })
    },
    {
      id: "sms-follow-up",
      type: "coreNode",
      position: { x: 560, y: 480 },
      data: defaultNodeData("connector", {
        label: "Text Back in 5 Seconds",
        title: "Text Back in 5 Seconds",
        kind: "TWILIO SMS",
        icon: "message-square",
        accent: "green",
        subtitle: "Twilio sends the context-aware follow-up text",
        connector: "SMS",
        connectorAction: "send_sms",
        smsTo: "{{caller_number}}",
        smsBody: "{{ai.output}}"
      })
    },
    {
      id: "calendar-booking",
      type: "coreNode",
      position: { x: 880, y: 480 },
      data: defaultNodeData("connector", {
        label: "Book Appointment",
        title: "Book Appointment",
        kind: "GOOGLE CALENDAR",
        icon: "calendar",
        accent: "blue",
        subtitle: "Google Calendar creates the appointment when a slot is chosen",
        connector: "Google Calendar",
        connectorAction: "book_appointment",
        calendarId: "{{business.calendarId}}",
        appointmentService: "Consultation",
        calendarSummary: "{{appointmentService}} - {{caller_number}}",
        calendarDescription: "Booked by CORE AI Receptionist after missed-call follow-up."
      })
    },
    {
      id: "lead-captured",
      type: "coreNode",
      position: { x: 560, y: 720 },
      data: defaultNodeData("connector", {
        label: "Lead Captured",
        title: "Lead Captured",
        kind: "CAPTURE",
        icon: "capture",
        accent: "blue",
        subtitle: "Conversation, call summary, SMS, and appointment are stored",
        connector: "SMS",
        connectorAction: "capture_lead"
      })
    }
  ];

  return {
    nodes,
    edges: [
      createFlowEdge({ id: "c1", source: "trigger", target: "ai", accent: "amber" }),
      createFlowEdge({ id: "c2", source: "ai", target: "vapi-call", accent: "violet", label: "Voice" }),
      createFlowEdge({ id: "c3", source: "ai", target: "sms-follow-up", accent: "green", label: "SMS" }),
      createFlowEdge({ id: "c4", source: "vapi-call", target: "calendar-booking", accent: "blue", label: "Books" }),
      createFlowEdge({ id: "c5", source: "sms-follow-up", target: "lead-captured", accent: "green" }),
      createFlowEdge({ id: "c6", source: "calendar-booking", target: "lead-captured", accent: "blue" })
    ]
  };
}

export function createGmailReplyFlow(): BuilderFlow {
  const nodes: BuilderNode[] = [
    {
      id: "gmail-read",
      type: "coreNode",
      position: { x: 120, y: 260 },
      data: defaultNodeData("connector", {
        label: "Read Gmail Emails",
        title: "Read Gmail Emails",
        kind: "GMAIL",
        icon: "mail",
        accent: "blue",
        subtitle: "Search inbox and pull the latest matching email",
        connector: "Gmail",
        connectorAction: "read_emails",
        gmailQuery: "newer_than:7d"
      })
    },
    {
      id: "gmail-ai-reply",
      type: "coreNode",
      position: { x: 450, y: 260 },
      data: defaultNodeData("ai", {
        label: "Draft Email Reply",
        title: "Draft Email Reply",
        subtitle: "Generate a professional response from email context",
        prompt:
          "Read the Gmail email and draft a concise, professional response. Answer clearly, keep a friendly tone, and do not overpromise."
      })
    },
    {
      id: "gmail-draft",
      type: "coreNode",
      position: { x: 780, y: 260 },
      data: defaultNodeData("connector", {
        label: "Create Gmail Draft",
        title: "Create Gmail Draft",
        kind: "GMAIL",
        icon: "mail",
        accent: "blue",
        subtitle: "Creates a safe draft reply in Gmail",
        connector: "Gmail",
        connectorAction: "draft_reply",
        gmailTo: "{{gmail.senderEmail}}",
        gmailSubject: "Re: {{gmail.subject}}",
        gmailBody: "{{ai.output}}"
      })
    },
    {
      id: "gmail-output",
      type: "coreNode",
      position: { x: 1110, y: 260 },
      data: defaultNodeData("output", {
        label: "Email Ready",
        title: "Email Ready",
        kind: "OUTPUT",
        icon: "capture",
        accent: "green",
        subtitle: "Draft is ready for review in Gmail",
        outputKey: "gmailReplyResult"
      })
    }
  ];

  return {
    nodes,
    edges: [
      createFlowEdge({ id: "g1", source: "gmail-read", target: "gmail-ai-reply", accent: "blue" }),
      createFlowEdge({ id: "g2", source: "gmail-ai-reply", target: "gmail-draft", accent: "violet" }),
      createFlowEdge({ id: "g3", source: "gmail-draft", target: "gmail-output", accent: "green" })
    ]
  };
}
