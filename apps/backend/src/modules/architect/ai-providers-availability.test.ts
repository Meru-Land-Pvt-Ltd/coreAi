import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { initProviderEngine } from "../ai-provider-engine/ai-provider-engine";
import { architectRoutes } from "./routes";

/**
 * GET /architect/ai/providers tells the builder which providers can actually
 * run, so unusable ones are greyed out instead of failing mid-run. It must
 * never leak a key value.
 */

const RUN = `aiproviders-${process.pid}-${Date.now().toString(36)}`;
const LLM_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY"] as const;

const saved = new Map<string, { env: unknown; process: string | undefined }>();

let dbAvailable = false;
let architectToken = "";
let userId = "";

type ProviderRow = {
  id: string;
  displayName: string;
  models: string[];
  configured: boolean;
  envKey: string | null;
};

function setKey(key: string, value: string | undefined): void {
  (env as Record<string, unknown>)[key] = value;
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function buildApp() {
  const app = new Hono();
  app.route("/architect", architectRoutes);
  return app;
}

async function fetchProviders(): Promise<ProviderRow[]> {
  const response = await buildApp().request("/architect/ai/providers", {
    headers: { Authorization: `Bearer ${architectToken}` }
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data?: { providers?: ProviderRow[] } };
  return body.data?.providers ?? [];
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[ai-providers-availability.test] database unreachable — suite skipped");
    return;
  }

  await initProviderEngine().catch(() => {});

  const user = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "ARCHITECT" }
  });
  userId = user.id;
  await prisma.userRoleMembership.create({ data: { userId: user.id, role: "ARCHITECT" } });
  architectToken = await createAuthToken({ id: user.id, email: user.email, role: "ARCHITECT" });
}, 30_000);

afterAll(async () => {
  if (dbAvailable && userId) {
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

beforeEach(() => {
  for (const key of LLM_KEYS) {
    saved.set(key, { env: (env as Record<string, unknown>)[key], process: process.env[key] });
    setKey(key, undefined);
  }
});

afterEach(() => {
  for (const key of LLM_KEYS) {
    const previous = saved.get(key);
    (env as Record<string, unknown>)[key] = previous?.env;
    if (previous?.process === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous.process;
    }
  }
});

describe("GET /architect/ai/providers", () => {
  it("reports which providers have a key, and names the env var", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    setKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const providers = await fetchProviders();

    const claude = providers.find((provider) => provider.id === "claude");
    const openai = providers.find((provider) => provider.id === "openai");

    expect(claude?.configured).toBe(true);
    expect(claude?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(openai?.configured).toBe(false);
    expect(openai?.envKey).toBe("OPENAI_API_KEY");
  });

  it("reads groq's own key rather than the adapter's wrong validate()", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    setKey("GROQ_API_KEY", "gsk-test");
    const providers = await fetchProviders();

    expect(providers.find((provider) => provider.id === "groq")?.configured).toBe(true);
    expect(providers.find((provider) => provider.id === "openai")?.configured).toBe(false);
  });

  it("never returns a key value", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    setKey("OPENAI_API_KEY", "sk-secret-value-do-not-leak");
    const providers = await fetchProviders();

    expect(JSON.stringify(providers)).not.toContain("sk-secret-value-do-not-leak");
  });

  it("requires an architect session", async () => {
    const response = await buildApp().request("/architect/ai/providers");
    expect([401, 403]).toContain(response.status);
  });
});
