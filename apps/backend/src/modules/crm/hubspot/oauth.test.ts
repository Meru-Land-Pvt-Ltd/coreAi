import { describe, expect, it, vi } from "vitest";
import { safeRedirectPathFromState, verifyStatePayload } from "./oauth";
import { computeHubSpotV3Signature, resolveWebhookSecret, verifyHubSpotSignature } from "./webhook";
import { CRM_CATALOG, findCatalogEntry, isLiveProvider, providerDisplayName } from "../catalog";

/**
 * The OAuth callback is public — the signed `state` is the ONLY thing proving
 * which business is connecting. These tests pin that boundary.
 */

import crypto from "crypto";
import { env } from "../../../config/env";

function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.JWT_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

describe("verifyStatePayload", () => {
  it("accepts a freshly signed state", () => {
    const state = signState({
      businessId: "biz_1",
      userId: "user_1",
      redirectPath: "/business/crm",
      createdAt: Date.now()
    });

    const payload = verifyStatePayload(state);
    expect(payload.businessId).toBe("biz_1");
    expect(payload.redirectPath).toBe("/business/crm");
  });

  it("rejects a tampered payload", () => {
    const state = signState({ businessId: "biz_1", userId: "u", createdAt: Date.now() });
    const [body] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ businessId: "biz_ATTACKER", userId: "u", createdAt: Date.now() }))
      .toString("base64url");

    expect(() => verifyStatePayload(`${forged}.${state.split(".")[1]}`)).toThrow();
    expect(() => verifyStatePayload(`${body}.deadbeef`)).toThrow();
  });

  it("rejects an expired state", () => {
    const state = signState({
      businessId: "biz_1",
      userId: "u",
      createdAt: Date.now() - 11 * 60 * 1000
    });
    expect(() => verifyStatePayload(state)).toThrow(/expired/i);
  });

  it("drops a redirect path that leaves the buyer app (open-redirect guard)", () => {
    const state = signState({
      businessId: "biz_1",
      userId: "u",
      redirectPath: "https://evil.example.com/steal",
      createdAt: Date.now()
    });
    expect(verifyStatePayload(state).redirectPath).toBeNull();

    const architectPath = signState({
      businessId: "biz_1",
      userId: "u",
      redirectPath: "/architect/agents",
      createdAt: Date.now()
    });
    expect(verifyStatePayload(architectPath).redirectPath).toBeNull();
  });
});

describe("safeRedirectPathFromState", () => {
  it("falls back to the CRM page for a garbage state", () => {
    expect(safeRedirectPathFromState("not-a-state")).toBe("/business/crm");
    expect(safeRedirectPathFromState(null)).toBe("/business/crm");
  });

  it("recovers the path even from an expired state", () => {
    const state = signState({
      businessId: "b",
      userId: "u",
      redirectPath: "/business/setting?tab=integrations",
      createdAt: Date.now() - 60 * 60 * 1000
    });
    expect(safeRedirectPathFromState(state)).toBe("/business/setting?tab=integrations");
  });
});

describe("verifyHubSpotSignature", () => {
  const secret = "test-secret";
  const uri = "https://triven.ai/api/webhook/hubspot";
  const body = '[{"subscriptionType":"contact.propertyChange"}]';
  const now = 1_760_000_000_000;

  it("accepts a correctly signed request", () => {
    const timestamp = String(now);
    const signature = computeHubSpotV3Signature({ secret, method: "POST", uri, body, timestamp });

    expect(
      verifyHubSpotSignature({ secret, method: "POST", uri, body, timestamp, signature, now })
    ).toEqual({ valid: true });
  });

  it("rejects a tampered body", () => {
    const timestamp = String(now);
    const signature = computeHubSpotV3Signature({ secret, method: "POST", uri, body, timestamp });

    const verdict = verifyHubSpotSignature({
      secret,
      method: "POST",
      uri,
      body: '[{"subscriptionType":"contact.deletion"}]',
      timestamp,
      signature,
      now
    });
    expect(verdict.valid).toBe(false);
  });

  it("rejects a replayed request outside the timestamp window", () => {
    const timestamp = String(now - 10 * 60 * 1000);
    const signature = computeHubSpotV3Signature({ secret, method: "POST", uri, body, timestamp });

    const verdict = verifyHubSpotSignature({ secret, method: "POST", uri, body, timestamp, signature, now });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/window/i);
  });
});

describe("resolveWebhookSecret", () => {
  it("falls back to the client secret when no webhook secret is set", () => {
    expect(resolveWebhookSecret({ clientSecret: "client-abc" })).toBe("client-abc");
  });

  it("treats a blank KEY= line as absent, not as an empty secret", () => {
    // dotenv parses `HUBSPOT_CLIENT_SECRET_WEBHOOK=` as "", which `??` would
    // have kept — leaving production rejecting every webhook as unsigned.
    expect(resolveWebhookSecret({ webhookSecret: "", clientSecret: "client-abc" })).toBe(
      "client-abc"
    );
    expect(resolveWebhookSecret({ webhookSecret: "   ", clientSecret: "client-abc" })).toBe(
      "client-abc"
    );
  });

  it("prefers an explicitly rotated webhook secret", () => {
    expect(resolveWebhookSecret({ webhookSecret: "rotated", clientSecret: "client-abc" })).toBe(
      "rotated"
    );
  });

  it("returns undefined when neither is configured", () => {
    expect(resolveWebhookSecret({ webhookSecret: "", clientSecret: "" })).toBeUndefined();
    expect(resolveWebhookSecret({})).toBeUndefined();
  });
});

describe("provider catalog", () => {
  it("ships HubSpot live and the rest as coming soon", () => {
    expect(isLiveProvider("HUBSPOT")).toBe(true);
    expect(isLiveProvider("SALESFORCE")).toBe(false);
    expect(isLiveProvider("NOT_A_CRM")).toBe(false);
  });

  it("lists future providers so the UI can show a picker", () => {
    // The product is the AI layer on top of ANY CRM — the switcher must never
    // collapse to a single hardcoded option.
    expect(CRM_CATALOG.length).toBeGreaterThan(1);
    expect(findCatalogEntry("SALESFORCE")?.status).toBe("coming_soon");
  });

  it("renders a readable display name, never a raw enum", () => {
    expect(providerDisplayName("HUBSPOT")).toBe("HubSpot");
    expect(providerDisplayName(null)).toBe("CRM");
  });
});
