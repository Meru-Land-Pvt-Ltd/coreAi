import type { BuilderFlow, BuilderNode } from "./types";
import { createFlowEdge } from "./edge-utils";
import { defaultNodeData } from "./node-defaults";

export function createMissedCallTextBackFlow(): BuilderFlow {
  const nodes: BuilderNode[] = [
    {
      id: "customer-calls",
      type: "coreNode",
      position: { x: 100, y: 260 },
      data: defaultNodeData("trigger")
    },
    {
      id: "auto-text",
      type: "coreNode",
      position: { x: 430, y: 260 },
      data: defaultNodeData("connector", {
        title: "Auto Text in 5 Seconds",
        label: "Auto Text in 5 Seconds",
        subtitle: "Personalized SMS through Twilio",
        connector: "SMS",
        connectorAction: "send_sms",
        smsTo: "{{caller_number}}",
        smsBody:
          "Hi {{caller_name}}, this is {{business.name}}. Sorry we missed your call. We can help by text right now. Would you like to book an appointment or ask a quick question?"
      })
    },
    {
      id: "lead-captured",
      type: "coreNode",
      position: { x: 760, y: 260 },
      data: defaultNodeData("connector", {
        title: "Lead Captured",
        label: "Lead Captured",
        kind: "CAPTURE",
        icon: "capture",
        accent: "blue",
        subtitle: "Conversation continues via text, booking, FAQ, or team routing",
        connector: "SMS",
        connectorAction: "capture_lead",
        smsTo: undefined,
        smsBody: undefined
      })
    }
  ];

  return {
    nodes,
    edges: [
      createFlowEdge({
        id: "e1",
        source: "customer-calls",
        target: "auto-text",
        accent: "amber"
      }),
      createFlowEdge({
        id: "e2",
        source: "auto-text",
        target: "lead-captured",
        accent: "green"
      })
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
      createFlowEdge({
        id: "g1",
        source: "gmail-read",
        target: "gmail-ai-reply",
        accent: "blue"
      }),
      createFlowEdge({
        id: "g2",
        source: "gmail-ai-reply",
        target: "gmail-draft",
        accent: "violet"
      }),
      createFlowEdge({
        id: "g3",
        source: "gmail-draft",
        target: "gmail-output",
        accent: "green"
      })
    ]
  };
}
