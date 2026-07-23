import { describe, expect, it } from "vitest";
import { isInstalledAgentActivityPaused } from "./twilio-business-routing";

describe("billing suspension routing guard", () => {
  it("blocks both buyer-paused and billing-suspended agents", () => {
    expect(isInstalledAgentActivityPaused("PAUSED")).toBe(true);
    expect(isInstalledAgentActivityPaused(" suspended_billing ")).toBe(true);
    expect(isInstalledAgentActivityPaused("ACTIVE")).toBe(false);
    expect(isInstalledAgentActivityPaused(null)).toBe(false);
  });
});
