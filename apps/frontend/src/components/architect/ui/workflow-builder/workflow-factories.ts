import type { BuilderFlow, BuilderNode } from "./types";
import { createFlowEdge } from "./edge-utils";
import { defaultNodeData } from "./node-defaults";

export function createMissedCallTextBackFlow(): BuilderFlow {
  const nodes: BuilderNode[] = [
    {
      id: "trigger",
      type: "coreNode",
      position: { x: 560, y: 60 },
      data: defaultNodeData("trigger", {
        label: "Missed Call Detected",
        title: "Missed Call Detected",
        kind: "TRIGGER",
        icon: "phone-missed",
        accent: "amber",
        subtitle: "When: Business hours missed call",
        footer: "Output: caller_number, timestamp"
      })
    },
    {
      id: "ai",
      type: "coreNode",
      position: { x: 560, y: 280 },
      data: defaultNodeData("ai", {
        label: "Generate Personalized SMS",
        title: "Generate Personalized SMS",
        kind: "AI PROCESS",
        icon: "sparkles",
        accent: "violet",
        subtitle: "Model: GPT-4o - Tone: Friendly",
        footer: "Input: caller_number -> Output: message_text",
        prompt:
          "You are a friendly dental office assistant. A patient just called but we missed their call. Write a brief, warm text message acknowledging their call and offering to help schedule an appointment. Keep it under 160 characters."
      })
    },
    {
      id: "condition",
      type: "coreNode",
      position: { x: 560, y: 500 },
      data: defaultNodeData("condition", {
        label: "Is Business Hours?",
        title: "Is Business Hours?",
        kind: "CONDITION",
        icon: "git-branch",
        accent: "orange",
        subtitle: "Check: 8AM-6PM, Mon-Fri",
        condition: "8:00 AM - 6:00 PM"
      })
    },
    {
      id: "actionYes",
      type: "coreNode",
      position: { x: 360, y: 720 },
      data: defaultNodeData("connector", {
        label: "Send SMS Now",
        title: "Send SMS Now",
        kind: "ACTION",
        icon: "message-square",
        accent: "green",
        subtitle: "To: {caller_number}",
        connector: "SMS",
        connectorAction: "send_sms",
        smsTo: "{{caller_number}}",
        smsBody: "{{message_text}}"
      })
    },
    {
      id: "actionNo",
      type: "coreNode",
      position: { x: 760, y: 720 },
      data: defaultNodeData("connector", {
        label: "Queue for Morning",
        title: "Queue for Morning",
        kind: "ACTION",
        icon: "clock",
        accent: "blue",
        subtitle: "Send at: 8:00 AM next day",
        connector: "SMS",
        connectorAction: "send_sms",
        smsTo: "{{caller_number}}",
        smsBody: "{{message_text}}",
        sendAt: "8:00 AM next business day"
      })
    }
  ];

  return {
    nodes,
    edges: [
      createFlowEdge({ id: "c1", source: "trigger", target: "ai", accent: "amber" }),
      createFlowEdge({ id: "c2", source: "ai", target: "condition", accent: "violet" }),
      createFlowEdge({ id: "c3", source: "condition", sourceHandle: "yes", target: "actionYes", accent: "green", label: "Yes" }),
      createFlowEdge({ id: "c4", source: "condition", sourceHandle: "no", target: "actionNo", accent: "red", label: "No" })
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
