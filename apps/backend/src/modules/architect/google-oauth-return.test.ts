import crypto from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { architectRoutes } from "./routes";

/**
 * Google OAuth return-location tests. The callback must send the browser back
 * to the page recorded in the signed state — Business Settings or the exact
 * Agent Setup page — for success, denial, and error paths alike, and must
 * never follow a forged state.
 */

function signState(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function makeState(redirectPath: string, options?: { ageMs?: number }) {
  return signState({
    userId: "user-oauth-test",
    redirectPath,
    createdAt: Date.now() - (options?.ageMs ?? 0)
  });
}

const SETUP_PATH = "/business/agents/setup?listingId=listing-123";
const SETTINGS_PATH = "/business/setting?tab=integrations";

function app() {
  const instance = new Hono();
  instance.route("/architect", architectRoutes);
  return instance;
}

async function callbackLocation(query: string) {
  const response = await app().request(`/architect/connectors/gmail/callback${query}`);
  expect([301, 302]).toContain(response.status);
  return response.headers.get("location") ?? "";
}

describe("Google OAuth callback return location", () => {
  it("returns a denied consent to the originating Agent Setup page", async () => {
    const state = makeState(SETUP_PATH);
    const location = await callbackLocation(
      `?error=access_denied&state=${encodeURIComponent(state)}`
    );

    expect(location).toBe(`${env.FRONTEND_URL}${SETUP_PATH}&gmail=denied`);
  });

  it("returns a denied consent to Business Settings when started there", async () => {
    const state = makeState(SETTINGS_PATH);
    const location = await callbackLocation(
      `?error=access_denied&state=${encodeURIComponent(state)}`
    );

    expect(location).toBe(`${env.FRONTEND_URL}${SETTINGS_PATH}&gmail=denied`);
  });

  it("returns a missing-code failure to the originating page", async () => {
    const state = makeState(SETUP_PATH);
    const location = await callbackLocation(`?state=${encodeURIComponent(state)}`);

    expect(location).toBe(`${env.FRONTEND_URL}${SETUP_PATH}&gmail=failed`);
  });

  it("returns an expired authorization to the originating page, not the architect profile", async () => {
    const state = makeState(SETUP_PATH, { ageMs: 11 * 60 * 1000 });
    const location = await callbackLocation(
      `?code=fake-code&state=${encodeURIComponent(state)}`
    );

    expect(location).toBe(`${env.FRONTEND_URL}${SETUP_PATH}&gmail=failed`);
  });

  it("ignores a forged state and falls back to the architect profile", async () => {
    const [body] = makeState(SETUP_PATH).split(".");
    const forged = `${body}.${"a".repeat(43)}`;
    const location = await callbackLocation(`?state=${encodeURIComponent(forged)}`);

    expect(location).toBe(`${env.FRONTEND_URL}/architect/profile?gmail=failed`);
  });

  it("falls back to the architect profile when state is missing entirely", async () => {
    const location = await callbackLocation("");
    expect(location).toBe(`${env.FRONTEND_URL}/architect/profile?gmail=failed`);
  });
});
