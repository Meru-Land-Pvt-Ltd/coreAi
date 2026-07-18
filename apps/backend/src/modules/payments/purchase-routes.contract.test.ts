import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routesSource = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

describe("agent purchase authentication contract", () => {
  it("keeps buyer-present checkout on-session so India and SCA cards can authenticate", () => {
    expect(routesSource).toContain('payment_method_types: ["card"]');
    expect(routesSource).toContain("off_session: false");
    expect(routesSource).toContain("use_stripe_sdk: true");
    expect(routesSource).toContain('setup_future_usage: "off_session"');
  });

  it("retains the browser-action response and secure confirmation endpoint", () => {
    expect(routesSource).toContain('intent.status === "requires_action" && intent.client_secret');
    expect(routesSource).toContain('paymentRoutes.post("/purchase/confirm"');
    expect(routesSource.match(/finalizePaidAgentPurchase\(\{/g)).toHaveLength(2);
    expect(routesSource).toContain('metadata.userId !== authUser.id');
    expect(routesSource).toContain('metadata.listingId !== parsed.data.listingId');
  });
});
