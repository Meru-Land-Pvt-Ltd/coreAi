import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import {
  canBusinessDeployAgent,
  isAgentSubscriptionEnforcementEnabled,
  isDeployableSubscriptionStatus
} from "./deployment-access";
import { businessRoutes } from "./routes";

/**
 * Deployment access policy tests. DB-backed cases run against the local dev
 * database (unique fixtures, removed afterwards) and skip when it is down —
 * same convention as the email/SMS suites. No Stripe/Twilio network calls:
 * fetch is stubbed wherever a route could reach a provider.
 */

const RUN = `deploytest-${process.pid}-${Date.now().toString(36)}`;

const originalEnv = {
  ENFORCE_AGENT_SUBSCRIPTION: env.ENFORCE_AGENT_SUBSCRIPTION,
  STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY: env.STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY
};

function enableEnforcement() {
  env.ENFORCE_AGENT_SUBSCRIPTION = true;
  env.STRIPE_SECRET_KEY = "sk_test_deployment_access_policy";
  env.STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY = "price_deployment_access_policy";
}

function disableEnforcement() {
  env.ENFORCE_AGENT_SUBSCRIPTION = false;
}

let dbAvailable = false;

type Fixture = { userId: string; businessId: string | null; token: string };

const fixtures: Record<string, Fixture> = {};
const createdBusinessIds: string[] = [];
const createdUserIds: string[] = [];
let sharedSenderNumber = "";
let sharedSenderId = "";
let architectToken = "";

async function createOwner(
  key: string,
  business: { subscriptionStatus: string | null; stripeSubscriptionId?: string | null } | null
): Promise<Fixture> {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${key}@test.local`, role: "BUSINESS" }
  });
  createdUserIds.push(user.id);

  let businessId: string | null = null;
  if (business) {
    const row = await prisma.business.create({
      data: {
        ownerId: user.id,
        name: `${RUN} ${key}`,
        type: "Dental Practice",
        subscriptionStatus: business.subscriptionStatus,
        stripeSubscriptionId: business.stripeSubscriptionId ?? null
      }
    });
    businessId = row.id;
    createdBusinessIds.push(row.id);
  }

  const token = await createAuthToken({ id: user.id, email: user.email, role: "BUSINESS" });
  const fixture = { userId: user.id, businessId, token };
  fixtures[key] = fixture;
  return fixture;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[deployment-access.test] database unreachable — DB suites skipped");
    return;
  }

  await Promise.all([
    createOwner("active", { subscriptionStatus: "active" }),
    createOwner("trialing", { subscriptionStatus: "trialing" }),
    createOwner("inactive", { subscriptionStatus: "inactive" }),
    createOwner("canceled", { subscriptionStatus: "canceled" }),
    createOwner("past-due", { subscriptionStatus: "past_due" }),
    createOwner("unpaid", { subscriptionStatus: "unpaid" }),
    createOwner("null-status", { subscriptionStatus: null }),
    createOwner("no-sub-id", { subscriptionStatus: "active", stripeSubscriptionId: null }),
    createOwner("one-time-paid", { subscriptionStatus: "inactive" }),
    createOwner("no-business", null),
    // Newest business is an unbilled placeholder; the older one is billed.
    createOwner("shadowed", { subscriptionStatus: "active" })
  ]);

  // One-time successful payment, no subscription.
  await prisma.payment.create({
    data: {
      userId: fixtures["one-time-paid"].userId,
      businessId: fixtures["one-time-paid"].businessId,
      amountCents: 14900,
      status: "SUCCEEDED",
      description: `${RUN} one-time agent purchase`
    }
  });

  // The shadowing case: a NEWER placeholder row with an inactive status.
  const placeholder = await prisma.business.create({
    data: {
      ownerId: fixtures["shadowed"].userId,
      name: `${RUN} placeholder (newer)`,
      type: "Pending Setup",
      subscriptionStatus: "inactive",
      createdAt: new Date(Date.now() + 60_000)
    }
  });
  createdBusinessIds.push(placeholder.id);

  // Reserved shared Triven SMS sender (route-level rejection test).
  sharedSenderNumber = `+1779${String(Date.now()).slice(-7)}`;
  const shared = await prisma.platformPhoneNumber.create({
    data: {
      phoneNumber: sharedSenderNumber,
      e164: sharedSenderNumber,
      provider: "TWILIO",
      status: "AVAILABLE",
      voiceEnabled: true,
      smsEnabled: true,
      isPlatformSmsSender: true
    }
  });
  sharedSenderId = shared.id;

  const architect = await prisma.user.create({
    data: { email: `${RUN}-architect@test.local`, role: "ARCHITECT" }
  });
  createdUserIds.push(architect.id);
  architectToken = await createAuthToken({ id: architect.id, email: architect.email, role: "ARCHITECT" });
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.payment.deleteMany({ where: { userId: { in: createdUserIds } } });
    if (sharedSenderId) await prisma.platformPhoneNumber.deleteMany({ where: { id: sharedSenderId } });
    await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe("isDeployableSubscriptionStatus", () => {
  it("accepts active/trialing including casing and whitespace drift", () => {
    expect(isDeployableSubscriptionStatus("active")).toBe(true);
    expect(isDeployableSubscriptionStatus("trialing")).toBe(true);
    expect(isDeployableSubscriptionStatus(" Active ")).toBe(true);
    expect(isDeployableSubscriptionStatus("TRIALING")).toBe(true);
  });

  it("rejects every non-deployable status", () => {
    for (const status of ["inactive", "canceled", "past_due", "unpaid", "", null, undefined]) {
      expect(isDeployableSubscriptionStatus(status)).toBe(false);
    }
  });
});

describe("isAgentSubscriptionEnforcementEnabled", () => {
  it("is off when the flag is false, even with Stripe configured", () => {
    disableEnforcement();
    env.STRIPE_SECRET_KEY = "sk_test_configured";
    env.STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY = "price_configured";
    expect(isAgentSubscriptionEnforcementEnabled()).toBe(false);
  });

  it("is off when the flag is true but Stripe is not configured", () => {
    env.ENFORCE_AGENT_SUBSCRIPTION = true;
    env.STRIPE_SECRET_KEY = undefined;
    expect(isAgentSubscriptionEnforcementEnabled()).toBe(false);
  });

  it("is on only with flag + configured Stripe", () => {
    enableEnforcement();
    expect(isAgentSubscriptionEnforcementEnabled()).toBe(true);
  });
});

describe("canBusinessDeployAgent — enforcement DISABLED (current platform policy)", () => {
  const allowedKeys = [
    "active",
    "trialing",
    "inactive",
    "canceled",
    "past-due",
    "unpaid",
    "null-status",
    "no-sub-id",
    "one-time-paid",
    "no-business"
  ];

  for (const key of allowedKeys) {
    it(`${key} owner → allowed`, async () => {
      if (!dbAvailable) return;
      disableEnforcement();
      const access = await canBusinessDeployAgent(fixtures[key].userId);
      expect(access).toEqual({ allowed: true, subscriptionEnforcementEnabled: false, reason: null });
    });
  }
});

describe("canBusinessDeployAgent — enforcement ENABLED", () => {
  it("active business → allowed", async () => {
    if (!dbAvailable) return;
    enableEnforcement();
    const access = await canBusinessDeployAgent(fixtures["active"].userId);
    expect(access.allowed).toBe(true);
    expect(access.subscriptionEnforcementEnabled).toBe(true);
  });

  it("trialing business → allowed", async () => {
    if (!dbAvailable) return;
    enableEnforcement();
    expect((await canBusinessDeployAgent(fixtures["trialing"].userId)).allowed).toBe(true);
  });

  for (const key of ["inactive", "canceled", "null-status"]) {
    it(`${key} business → rejected with SUBSCRIPTION_REQUIRED`, async () => {
      if (!dbAvailable) return;
      enableEnforcement();
      const access = await canBusinessDeployAgent(fixtures[key].userId);
      expect(access.allowed).toBe(false);
      expect(access.reason).toBe("SUBSCRIPTION_REQUIRED");
    });
  }

  it("a newer unbilled placeholder business does not shadow the billed one", async () => {
    if (!dbAvailable) return;
    enableEnforcement();
    // The production bug: the old gate read only the NEWEST business row.
    const access = await canBusinessDeployAgent(fixtures["shadowed"].userId);
    expect(access.allowed).toBe(true);
  });
});

describe("POST /business/setup route gate", () => {
  function buildApp() {
    const app = new Hono();
    app.route("/business", businessRoutes);
    return app;
  }

  function deployBody(extra: Record<string, unknown> = {}) {
    return {
      deploy: true,
      businessName: `${RUN} Clinic`,
      businessType: "Dental Practice",
      ...extra
    };
  }

  function postSetup(app: Hono, token: string | null, body: Record<string, unknown>) {
    return app.request("/business/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
  }

  it("unauthenticated user → 401", async () => {
    if (!dbAvailable) return;
    const response = await postSetup(buildApp(), null, deployBody());
    expect(response.status).toBe(401);
  });

  it("non-BUSINESS role → 403", async () => {
    if (!dbAvailable) return;
    const response = await postSetup(buildApp(), architectToken, deployBody());
    expect(response.status).toBe(403);
  });

  it("enforcement ON + inactive business + deploy → 402 SUBSCRIPTION_REQUIRED", async () => {
    if (!dbAvailable) return;
    enableEnforcement();
    const response = await postSetup(buildApp(), fixtures["inactive"].token, deployBody());
    expect(response.status).toBe(402);
    const json = (await response.json()) as { code?: string };
    expect(json.code).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("enforcement OFF + inactive business + deploy → passes the gate (and the reserved shared SMS sender is still rejected)", async () => {
    if (!dbAvailable) return;
    disableEnforcement();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    // Selecting the reserved sender makes the route deterministic: the request
    // clears the subscription gate, then fails on the shared-sender guard —
    // proving both the access policy and the sender protection in one pass.
    const response = await postSetup(
      buildApp(),
      fixtures["inactive"].token,
      deployBody({ selectedPlatformPhoneNumberId: sharedSenderId })
    );
    const json = (await response.json()) as { code?: string };
    expect(response.status).toBe(409);
    expect(json.code).toBe("PLATFORM_SMS_SENDER_NOT_ASSIGNABLE");
    expect(json.code).not.toBe("SUBSCRIPTION_REQUIRED");
  });

  it("null subscription status + missing stripeSubscriptionId + deploy → not blocked by the gate", async () => {
    if (!dbAvailable) return;
    disableEnforcement();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    const response = await postSetup(
      buildApp(),
      fixtures["null-status"].token,
      deployBody({ selectedPlatformPhoneNumberId: sharedSenderId })
    );
    const json = (await response.json()) as { code?: string };
    expect(response.status).toBe(409); // shared-sender guard, NOT the billing gate
    expect(json.code).toBe("PLATFORM_SMS_SENDER_NOT_ASSIGNABLE");
  });

  it("one owner can never read another owner's business through setup", async () => {
    if (!dbAvailable) return;
    const app = buildApp();
    const response = await app.request("/business/setup", {
      headers: { Authorization: `Bearer ${fixtures["no-business"].token}` }
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data?: { business?: { id?: string } | null } };
    // This owner has no business — other owners' rows must never leak in.
    expect(json.data?.business ?? null).toBeNull();
  });
});
