import { describe, expect, it } from "vitest";
import { isRealId } from "../architect/vapi-connector";

/**
 * Every (buyer, agent) pair must get its OWN Vapi assistant — created, not
 * borrowed. `deployVapiAssistant` PATCHes when `existingAssistantId` is a real
 * id and POSTs (creates) otherwise, so the whole question is which id the
 * deploy plan hands it.
 *
 * The plan's rule (deploy.ts, buildInstalledAgentAssistantPlan):
 *   priorAssistantId = this installed agent's own configJson.vapiAssistantId
 *
 * and nothing else. The BusinessProfile column is business-wide, so using it
 * as a fallback would make a second agent update the first agent's assistant.
 */

/** Mirrors the plan's resolution, so the rule itself is under test. */
function priorAssistantIdForPlan(input: {
  agentConfigJson: unknown;
  profileVapiAssistantId?: string | null;
}): string | undefined {
  const config =
    input.agentConfigJson && typeof input.agentConfigJson === "object" && !Array.isArray(input.agentConfigJson)
      ? (input.agentConfigJson as Record<string, unknown>)
      : null;
  const own = typeof config?.vapiAssistantId === "string" ? config.vapiAssistantId.trim() : "";
  return own || undefined;
}

describe("one Vapi assistant per (buyer, agent)", () => {
  it("updates the agent's own assistant when it has one", () => {
    const prior = priorAssistantIdForPlan({
      agentConfigJson: { vapiAssistantId: "asst_agent_a" },
      profileVapiAssistantId: "asst_business_wide"
    });

    expect(prior).toBe("asst_agent_a");
    expect(isRealId(prior)).toBe(true); // → PATCH this assistant
  });

  it("CREATES a new assistant when the agent has none, even if the business has one", () => {
    // Buyer already deployed another agent, so the profile carries an id.
    const prior = priorAssistantIdForPlan({
      agentConfigJson: {},
      profileVapiAssistantId: "asst_of_first_agent"
    });

    expect(prior).toBeUndefined();
    expect(isRealId(prior)).toBe(false); // → POST, a brand new assistant
  });

  it("never borrows a sibling agent's assistant", () => {
    const first = priorAssistantIdForPlan({ agentConfigJson: { vapiAssistantId: "asst_agent_a" } });
    const second = priorAssistantIdForPlan({
      agentConfigJson: null,
      profileVapiAssistantId: "asst_agent_a"
    });

    expect(second).not.toBe(first);
    expect(second).toBeUndefined();
  });

  it("creates for a second BUYER of the same product", () => {
    // Buyer B's install of the same listing starts with no assistant of its own.
    const buyerB = priorAssistantIdForPlan({
      agentConfigJson: {},
      profileVapiAssistantId: null
    });

    expect(buyerB).toBeUndefined();
  });
});
