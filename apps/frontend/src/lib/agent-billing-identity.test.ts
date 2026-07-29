import { describe, expect, it } from "vitest";
import { billingAgentMatchesUsage } from "./agent-billing-identity";

describe("billingAgentMatchesUsage", () => {
  it("matches execution usage by the exact installed-agent id", () => {
    expect(
      billingAgentMatchesUsage(
        {
          id: "agent-a",
          installedAgentId: "agent-a",
          listingId: "listing-a"
        },
        {
          agentId: "agent-a",
          installedAgentId: "agent-a",
          listingId: "listing-a"
        }
      )
    ).toBe(true);
  });

  it("does not assign one agent's usage to a different installed agent", () => {
    expect(
      billingAgentMatchesUsage(
        {
          id: "agent-b",
          installedAgentId: "agent-b",
          listingId: "listing-b"
        },
        {
          agentId: "agent-a",
          installedAgentId: "agent-a",
          listingId: "listing-a"
        }
      )
    ).toBe(false);
  });

  it("never needs a name fallback, even when two agents have the same display name", () => {
    const usage = {
      agentId: "agent-a",
      installedAgentId: "agent-a",
      listingId: "listing-a"
    };

    expect(
      billingAgentMatchesUsage(
        { id: "agent-a", installedAgentId: "agent-a" },
        usage
      )
    ).toBe(true);
    expect(
      billingAgentMatchesUsage(
        { id: "agent-b", installedAgentId: "agent-b" },
        usage
      )
    ).toBe(false);
  });

  it("uses listing id only for legacy rows where both installed ids are absent", () => {
    expect(
      billingAgentMatchesUsage(
        { id: "listing-a", listingId: "listing-a" },
        { listingId: "listing-a" }
      )
    ).toBe(true);
    expect(
      billingAgentMatchesUsage(
        { id: "listing-a", listingId: "listing-a" },
        { agentId: "agent-a", listingId: "listing-a" }
      )
    ).toBe(false);
  });
});
