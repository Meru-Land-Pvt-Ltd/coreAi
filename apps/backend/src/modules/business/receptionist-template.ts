import { CORE_CONNECTOR, CORE_CONNECTOR_ACTIONS } from "@coreai/shared";

/**
 * Default AI Receptionist / Missed Call Text-Back workflow used as a fallback
 * when no published listing or template workflow exists yet. The shape matches
 * what workflow-runner.ts expects (nodeKind + connector/connectorAction), so a
 * freshly created business is immediately routable end-to-end and persists the
 * lead + conversation through the runner's launch-critical nodes.
 */

export const RECEPTIONIST_WORKFLOW_NAME = "AI Receptionist – Missed Call Text-Back";
export const RECEPTIONIST_WORKFLOW_DESCRIPTION =
  "Detects missed calls, saves the lead, texts the caller back with per-business context, and stores the conversation.";

export function buildReceptionistWorkflowJson() {
  return {
    nodes: [
      {
        id: "trigger-missed-call",
        position: { x: 0, y: 0 },
        data: {
          nodeKind: "trigger",
          label: "Missed Call",
          description: "Twilio missed-call event"
        }
      },
      {
        id: "save-lead",
        position: { x: 240, y: 0 },
        data: {
          nodeKind: "connector",
          label: "Save Lead",
          connector: CORE_CONNECTOR,
          connectorAction: CORE_CONNECTOR_ACTIONS.saveLead,
          leadSource: "TWILIO_MISSED_CALL",
          leadStatus: "CAPTURED"
        }
      },
      {
        id: "ai-draft-reply",
        position: { x: 480, y: 0 },
        data: {
          nodeKind: "ai",
          label: "AI Context Reply",
          prompt: "Write a friendly, on-brand missed-call text-back for this business."
        }
      },
      {
        id: "send-sms",
        position: { x: 720, y: 0 },
        data: {
          nodeKind: "connector",
          label: "Send SMS",
          connector: "SMS",
          connectorAction: "send_sms",
          smsTo: "{{caller_number}}",
          smsBody: "{{ai.output}}"
        }
      },
      {
        id: "save-conversation",
        position: { x: 960, y: 0 },
        data: {
          nodeKind: "connector",
          label: "Save Conversation",
          connector: CORE_CONNECTOR,
          connectorAction: CORE_CONNECTOR_ACTIONS.saveConversationMessage,
          conversationDirection: "OUTBOUND",
          conversationBody: "{{sentSms.body}}"
        }
      },
      {
        id: "output-result",
        position: { x: 1200, y: 0 },
        data: {
          nodeKind: "output",
          label: "Result",
          outputKey: "missedCallTextBackResult"
        }
      }
    ],
    edges: [
      { id: "e1", source: "trigger-missed-call", target: "save-lead" },
      { id: "e2", source: "save-lead", target: "ai-draft-reply" },
      { id: "e3", source: "ai-draft-reply", target: "send-sms" },
      { id: "e4", source: "send-sms", target: "save-conversation" },
      { id: "e5", source: "save-conversation", target: "output-result" }
    ]
  };
}
