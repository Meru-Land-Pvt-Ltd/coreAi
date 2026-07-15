import { describe, expect, it } from "vitest";
import { workflowSupportsSmsReplies } from "./twilio-business-routing";

/**
 * Inbound-SMS auto-replies run only for workflows that opted into SMS via an
 * SMS-capable node. Legacy installs without a graph keep replying.
 */

function graph(...types: string[]) {
  return { nodes: types.map((type, index) => ({ id: `n${index}`, data: { type } })), edges: [] };
}

describe("workflowSupportsSmsReplies", () => {
  it("allows workflows with the Inbound SMS Trigger node", () => {
    expect(workflowSupportsSmsReplies(graph("trigger.twilio_inbound_sms", "voice_conversation"))).toBe(true);
  });

  it("allows the missed-call text-back flow (send_sms / missed-call trigger)", () => {
    expect(workflowSupportsSmsReplies(graph("trigger.twilio_missed_call", "voice_conversation"))).toBe(true);
    expect(workflowSupportsSmsReplies(graph("voice_conversation", "send_sms"))).toBe(true);
  });

  it("blocks voice-only workflows with no SMS-capable node", () => {
    expect(workflowSupportsSmsReplies(graph("trigger.phone_call", "voice_conversation", "end_flow"))).toBe(false);
  });

  it("keeps replying for legacy installs without a graph", () => {
    expect(workflowSupportsSmsReplies(null)).toBe(true);
    expect(workflowSupportsSmsReplies({})).toBe(true);
    expect(workflowSupportsSmsReplies({ nodes: [] })).toBe(true);
  });
});
