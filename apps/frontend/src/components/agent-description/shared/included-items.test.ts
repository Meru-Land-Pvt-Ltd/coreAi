import { describe, expect, it } from "vitest";
import { getIncludedItems, type ApiListing } from "./agent-listing";

/**
 * WHAT THE BUY PAGE PROMISES (2026-08-28).
 *
 * "Runs on autopilot to handle customer replies, call routing, and follow-ups"
 * was pushed onto every listing in the marketplace, whatever the agent did.
 * An agent that only wrote to a spreadsheet was sold with call routing on its
 * buy page. A promise on a buy page is a promise.
 */

const listing = (connectors: string[]): ApiListing => ({
  id: "listing-1",
  name: "Test Agent",
  requiredConnectors: connectors
});

describe("what's included", () => {
  it("does not promise call routing to an agent with no phone", () => {
    const items = getIncludedItems(listing(["webhook"]));
    expect(items.join(" ")).not.toContain("call routing");
  });

  it("says nothing about autopilot when the agent has no customer channel", () => {
    const items = getIncludedItems(listing([]));
    expect(items.some((item) => item.startsWith("Runs on autopilot"))).toBe(false);
  });

  it("names call routing when the agent really does route calls", () => {
    const items = getIncludedItems(listing(["twilio"]));
    expect(items.some((item) => item.includes("call routing"))).toBe(true);
  });

  it("names every channel the agent has, and no others", () => {
    const items = getIncludedItems(listing(["twilio", "sms", "google_calendar"]));
    const line = items.find((item) => item.startsWith("Runs on autopilot")) ?? "";

    expect(line).toContain("call routing");
    expect(line).toContain("customer replies");
    expect(line).toContain("appointment reminders");
    expect(line).not.toContain("follow-up emails");
  });

  it("still says the things that are true of every agent", () => {
    const items = getIncludedItems(listing([]));
    expect(items.some((item) => item.includes("private agent instance"))).toBe(true);
  });
});
