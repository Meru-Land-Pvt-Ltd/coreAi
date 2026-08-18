import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin → Design Brain rules routes, exercised through the REAL auth middleware:
 * requireAuth + requireRole(["ADMIN"]) are not mocked, so these tests prove the
 * endpoints are actually behind the admin guard — not just that handlers work.
 * Only the token verification, session check and database are stubbed.
 */

const {
  verifyAuthTokenMock,
  assertActiveSessionMock,
  userFindUniqueMock,
  settingFindUniqueMock,
  settingUpsertMock,
  settingDeleteManyMock,
  logAdminActionMock
} = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
  assertActiveSessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  settingFindUniqueMock: vi.fn(),
  settingUpsertMock: vi.fn(),
  settingDeleteManyMock: vi.fn(),
  logAdminActionMock: vi.fn()
}));

vi.mock("../../lib/jwt", () => ({
  verifyAuthToken: verifyAuthTokenMock
}));
vi.mock("../../lib/user-session", () => ({
  assertActiveSession: assertActiveSessionMock
}));
vi.mock("../../lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    platformApiSetting: {
      findUnique: settingFindUniqueMock,
      upsert: settingUpsertMock,
      deleteMany: settingDeleteManyMock
    }
  }
}));

// Sibling routers and services the admin module pulls in at import time — none
// of them are under test here.
vi.mock("./phone-numbers", async () => {
  const { Hono } = await import("hono");
  return { adminPhoneNumberRoutes: new Hono() };
});
vi.mock("./payout-routes", async () => {
  const { Hono } = await import("hono");
  return { adminPayoutRoutes: new Hono() };
});
vi.mock("./pricing-routes", async () => {
  const { Hono } = await import("hono");
  return { adminPricingRoutes: new Hono() };
});
vi.mock("../email/ses-mail-service", () => ({ sendBusinessEmail: vi.fn() }));
vi.mock("./registered-business-accounts", () => ({ listRegisteredBusinessAccounts: vi.fn() }));
vi.mock("./admin-summary", () => ({ getAdminLiveSummaryData: vi.fn() }));
vi.mock("../compliance/disclosure-consent", () => ({
  pseudonymizeDisclosureConsentsForUser: vi.fn()
}));
vi.mock("../auth/workspace-deletion", () => ({ deleteUserWorkspace: vi.fn() }));
vi.mock("./audit", () => ({ logAdminAction: logAdminActionMock }));

import { adminRoutes } from "./routes";
import {
  DEFAULT_DESIGN_BRAIN_RULES,
  DESIGN_BRAIN_RULES_KEY,
  invalidateDesignBrainRulesCache
} from "./design-brain-rules";

const USERS: Record<string, { id: string; email: string; role: string }> = {
  "admin-user": { id: "admin-user", email: "admin@example.com", role: "ADMIN" },
  "business-user": { id: "business-user", email: "biz@example.com", role: "BUSINESS" }
};

/** In-memory stand-in for the designBrainRules row, kept consistent across calls. */
let storedRow: { valueEncrypted: string; updatedAt: Date } | null = null;

function request(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return adminRoutes.request(path, { ...init, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  storedRow = null;
  invalidateDesignBrainRulesCache();

  verifyAuthTokenMock.mockImplementation(async (token: string) => {
    if (!USERS[token]) throw new Error("bad token");
    return { sub: token, sid: "session-1" };
  });
  assertActiveSessionMock.mockResolvedValue(true);
  userFindUniqueMock.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const user = USERS[where.id];
    if (!user) return null;
    return { ...user, fullName: null, isSuspended: false, roleMemberships: [] };
  });

  settingFindUniqueMock.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key === DESIGN_BRAIN_RULES_KEY && storedRow ? { ...storedRow } : null
  );
  settingUpsertMock.mockImplementation(
    async ({ create }: { create: { valueEncrypted: string } }) => {
      storedRow = { valueEncrypted: create.valueEncrypted, updatedAt: new Date() };
      return storedRow;
    }
  );
  settingDeleteManyMock.mockImplementation(async () => {
    const count = storedRow ? 1 : 0;
    storedRow = null;
    return { count };
  });
  logAdminActionMock.mockResolvedValue(undefined);
});

describe("guard", () => {
  it("rejects requests without a login", async () => {
    const response = await request("/design-rules");
    expect(response.status).toBe(401);
    expect(settingFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects logged-in non-admins", async () => {
    const response = await request("/design-rules", {}, "business-user");
    expect(response.status).toBe(403);
    expect(settingFindUniqueMock).not.toHaveBeenCalled();

    const patch = await request(
      "/design-rules",
      { method: "PATCH", body: JSON.stringify({ value: "hacked" }) },
      "business-user"
    );
    expect(patch.status).toBe(403);
    expect(settingUpsertMock).not.toHaveBeenCalled();
  });
});

describe("GET /design-rules", () => {
  it("returns the platform default while nothing is saved", async () => {
    const response = await request("/design-rules", {}, "admin-user");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.rules.value).toBe(DEFAULT_DESIGN_BRAIN_RULES);
    expect(body.data.rules.isDefault).toBe(true);
    expect(body.data.rules.defaultValue).toBe(DEFAULT_DESIGN_BRAIN_RULES);
    expect(body.data.rules.updatedAt).toBeNull();
  });
});

describe("PATCH /design-rules", () => {
  it("persists new rules and returns them", async () => {
    const value = "Always answer in the customer's language.";
    const response = await request(
      "/design-rules",
      { method: "PATCH", body: JSON.stringify({ value }) },
      "admin-user"
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.rules.value).toBe(value);
    expect(body.data.rules.isDefault).toBe(false);
    expect(body.data.restoredDefault).toBe(false);

    // Stored encrypted, under the right key, never as a secret credential.
    expect(settingUpsertMock).toHaveBeenCalledTimes(1);
    const args = settingUpsertMock.mock.calls[0][0];
    expect(args.where.key).toBe(DESIGN_BRAIN_RULES_KEY);
    expect(args.create.secret).toBe(false);
    expect(args.create.valueEncrypted).not.toContain("customer's language");

    // Audited — without leaking the text itself.
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: "admin-user",
        action: "DESIGN_BRAIN_RULES_UPDATED"
      })
    );
    const meta = logAdminActionMock.mock.calls[0][0].meta;
    expect(JSON.stringify(meta)).not.toContain("customer's language");
  });

  it("blank restores the default", async () => {
    storedRow = { valueEncrypted: "iv.tag.cipher", updatedAt: new Date() };

    const response = await request(
      "/design-rules",
      { method: "PATCH", body: JSON.stringify({ value: "   " }) },
      "admin-user"
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.restoredDefault).toBe(true);
    expect(body.data.rules.isDefault).toBe(true);
    expect(body.data.rules.value).toBe(DEFAULT_DESIGN_BRAIN_RULES);
    expect(settingDeleteManyMock).toHaveBeenCalledWith({
      where: { key: DESIGN_BRAIN_RULES_KEY }
    });
  });

  it("rejects malformed bodies", async () => {
    for (const body of [JSON.stringify({ value: 42 }), JSON.stringify({}), "not json"]) {
      const response = await request(
        "/design-rules",
        { method: "PATCH", body },
        "admin-user"
      );
      expect(response.status).toBe(422);
    }
    expect(settingUpsertMock).not.toHaveBeenCalled();
    expect(settingDeleteManyMock).not.toHaveBeenCalled();
  });
});
