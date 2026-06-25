/**
 * Default AI Receptionist / Missed Call Text-Back workflow used as a fallback
 * when no published listing or template workflow exists yet. The shape matches
 * what workflow-runner.ts expects (nodeKind + connector/connectorAction), so a
 * freshly created business is immediately routable end-to-end.
 */

export const RECEPTIONIST_WORKFLOW_NAME = "AI Receptionist – Missed Call Text-Back";
export const RECEPTIONIST_WORKFLOW_DESCRIPTION =
  "Detects missed calls, texts the caller back with per-business context, and captures the lead.";

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
        id: "ai-draft-reply",
        position: { x: 240, y: 0 },
        data: {
          nodeKind: "ai",
          label: "Draft Reply",
          prompt: "Write a friendly, on-brand missed-call text-back for this business."
        }
      },
      {
        id: "connector-send-sms",
        position: { x: 480, y: 0 },
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
        id: "connector-capture-lead",
        position: { x: 720, y: 0 },
        data: {
          nodeKind: "connector",
          label: "Capture Lead",
          connector: "SMS",
          connectorAction: "capture_lead"
        }
      },
      {
        id: "output-result",
        position: { x: 960, y: 0 },
        data: {
          nodeKind: "output",
          label: "Result",
          outputKey: "missedCallTextBackResult"
        }
      }
    ],
    edges: [
      { id: "e1", source: "trigger-missed-call", target: "ai-draft-reply" },
      { id: "e2", source: "ai-draft-reply", target: "connector-send-sms" },
      { id: "e3", source: "connector-send-sms", target: "connector-capture-lead" },
      { id: "e4", source: "connector-capture-lead", target: "output-result" }
    ]
  };
}
