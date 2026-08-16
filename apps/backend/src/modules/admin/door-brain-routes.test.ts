import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin → door model routes, exercised through the REAL auth middleware:
 * requireAuth + requireRole(["ADMIN"]) are not mocked, so these tests prove the
 * endpoints really are behind the admin guard. Only token verification, the
 * session check and the database are stubbed.
 */

const {
  verifyAuthTokenMock,
  assertActiveSessionMock,
  userFindUniqueMock,
  settingFindUniqueMock,
  settingFindManyMock,
  settingUpsertMock,
  settingDeleteManyMock,
  logAdminActionMock
} = vi.hoisted(() => ({
  verifyAuthTokenMock: vi.fn(),
  assertActiveSessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  settingFindUniqueMock: vi.fn(),
  settingFindManyMock: vi.fn(),
  settingUpsertMock: vi.fn(),
  settingDeleteManyMock: vi.fn(),
  logAdminActionMock: vi.fn()
}));

vi.mock("../../lib/jwt", () => ({ verifyAuthToken: verifyAuthTokenMock }));
vi.mock("../../lib/user-session", () => ({ assertActiveSession: assertActiveSessionMock }));
vi.mock("../../lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    platformApiSetting: {
      findUnique: settingFindUniqueMock,
      findMany: settingFindManyMock,
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
import { encryptSecret } from "../../lib/crypto";
import {
  DOOR_BRAIN_MODEL_KEY,
  DOOR_BRAIN_PROVIDER_KEY,
  invalidateDoorBrainConfigCache
} from "./door-brain-settings";

const USERS: Record<string, { id: string; email: string; role: string }> = {
  "admin-user": { id: "admin-user", email: "admin@example.com", role: "ADMIN" },
  "business-user": { id: "business-user", email: "biz@example.com", role: "BUSINESS" }
};

type Row = { key: string; valueEncrypted: string; updatedAt: Date; secret: boolean; updatedByUserId: string };
let rows = new Map<string, Row>();

function request(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return adminRoutes.request(path, { ...init, headers });
}

function patch(body: unknown, token = "admin-user") {
  return request("/door-brain", { method: "PATCH", body: JSON.stringify(body) }, token);
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = new Map();
  invalidateDoorBrainConfigCache();

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

  settingFindUniqueMock.mockResolvedValue(null);
  settingFindManyMock.mockImplementation(async ({ where }: { where: { key: { in: string[] } } }) =>
    where.key.in.map((key) => rows.get(key)).filter(Boolean)
  );
  settingUpsertMock.mockImplementation(
    async ({ create }: { create: { key: string; valueEncrypted: string; secret: boolean; updatedByUserId: string } }) => {
      const row: Row = { ...create, updatedAt: new Date() };
      rows.set(create.key, row);
      return row;
    }
  );
  settingDeleteManyMock.mockImplementation(async ({ where }: { where: { key: string } }) => ({
    count: rows.delete(where.key) ? 1 : 0
  }));
  logAdminActionMock.mockResolvedValue(undefined);
});

describe("guard", () => {
  it("rejects requests without a login", async () => {
    expect((await request("/door-brain")).status).toBe(401);
    expect(settingFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects logged-in non-admins", async () => {
    expect((await request("/door-brain", {}, "business-user")).status).toBe(403);
    expect((await patch({ provider: "openai" }, "business-user")).status).toBe(403);
    expect(settingUpsertMock).not.toHaveBeenCalled();
  });
});

describe("GET /door-brain", () => {
  it("returns the safe default and the choices an admin has", async () => {
    const response = await request("/door-brain", {}, "admin-user");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.doorBrain.providerId).toBe("gemini");
    expect(body.data.doorBrain.modelId).toBeNull();
    expect(body.data.doorBrain.isDefault).toBe(true);
    expect(body.data.doorBrain.defaultProviderId).toBe("gemini");
    expect(body.data.doorBrain.providers.map((p: { id: string }) => p.id)).toContain("claude");
    expect(body.data.doorBrain.models.length).toBeGreaterThan(0);
  });

  it("returns the saved battery once one is stored", async () => {
    rows.set(DOOR_BRAIN_PROVIDER_KEY, {
      key: DOOR_BRAIN_PROVIDER_KEY,
      valueEncrypted: encryptSecret("claude"),
      updatedAt: new Date("2026-08-16T09:00:00.000Z"),
      secret: false,
      updatedByUserId: "admin-user"
    });

    const body = await (await request("/door-brain", {}, "admin-user")).json();
    expect(body.data.doorBrain.providerId).toBe("claude");
    expect(body.data.doorBrain.isDefault).toBe(false);
    expect(body.data.doorBrain.updatedAt).toBe("2026-08-16T09:00:00.000Z");
  });
});

describe("PATCH /door-brain", () => {
  it("swaps the battery for the whole platform", async () => {
    const response = await patch({ provider: "claude", model: "claude-haiku-4-5-20251001" });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.doorBrain.providerId).toBe("claude");
    expect(body.data.doorBrain.modelId).toBe("claude-haiku-4-5-20251001");
    expect(body.data.restoredDefault).toBe(false);

    // Stored under the right keys, encrypted, never as a secret credential.
    const keys = settingUpsertMock.mock.calls.map((call) => call[0].where.key);
    expect(keys).toEqual([DOOR_BRAIN_PROVIDER_KEY, DOOR_BRAIN_MODEL_KEY]);
    for (const call of settingUpsertMock.mock.calls) {
      expect(call[0].create.secret).toBe(false);
      expect(call[0].create.valueEncrypted).not.toContain("claude");
    }
  });

  it("audits the change without writing the chosen values", async () => {
    await patch({ provider: "claude" });

    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: "admin-user", action: "DOOR_BRAIN_MODEL_UPDATED" })
    );
    const meta = logAdminActionMock.mock.calls[0][0].meta;
    expect(JSON.stringify(meta)).not.toContain("claude");
    expect(meta).toMatchObject({ providerChanged: true, modelChanged: false });
  });

  it("refuses a provider we cannot run doors on", async () => {
    const response = await patch({ provider: "some-startup-llm" });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("UNSUPPORTED_PROVIDER");
    expect(settingUpsertMock).not.toHaveBeenCalled();
  });

  it("refuses a model that belongs to a different service", async () => {
    const response = await patch({ provider: "gemini", model: "gpt-4o" });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("PROVIDER_MODEL_MISMATCH");
    expect(settingUpsertMock).not.toHaveBeenCalled();
  });

  it("blank restores the default", async () => {
    await patch({ provider: "claude", model: "claude-sonnet-5" });
    settingUpsertMock.mockClear();

    const body = await (await patch({ provider: "", model: "" })).json();
    expect(body.data.restoredDefault).toBe(true);
    expect(body.data.doorBrain.providerId).toBe("gemini");
    expect(body.data.doorBrain.isDefault).toBe(true);
    expect(rows.size).toBe(0);
  });

  it("rejects malformed bodies", async () => {
    for (const body of [{}, { provider: 42 }, { model: [] }]) {
      expect((await patch(body)).status).toBe(422);
    }
    expect((await request("/door-brain", { method: "PATCH", body: "not json" }, "admin-user")).status).toBe(422);
    expect(settingUpsertMock).not.toHaveBeenCalled();
  });
});
