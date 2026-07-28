import { describe, expect, it } from "vitest";
import { usageSuspensionTargets } from "./billing-cycle";

describe("usage debt suspension scope", () => {
  it("targets only the installed agent and phone routing on the invoice", () => {
    expect(
      usageSuspensionTargets({
        businessId: "business-1",
        installedAgentId: "agent-1"
      })
    ).toEqual({
      installedAgentId: "agent-1",
      agentWhere: {
        id: "agent-1",
        businessId: "business-1"
      },
      phoneWhere: {
        businessId: "business-1",
        installedAgentId: "agent-1"
      }
    });
  });

  it("does not fall back to business-wide suspension for a legacy invoice", () => {
    expect(
      usageSuspensionTargets({
        businessId: "business-1",
        installedAgentId: null
      })
    ).toBeNull();
  });
});
