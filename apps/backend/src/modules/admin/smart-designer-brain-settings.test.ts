import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Smart Designer battery — the admin-picked brain the AI Composer runs on.
 *
 * The contract that matters:
 *   saved value wins → otherwise Claude Opus 5 → the composer is never
 * model-less, a mismatched model is never shipped, and a database problem can
 * never block an architect mid-design. The admin routes are exercised through
 * the REAL auth middleware so the endpoints are proven to sit behind the admin
 * guard — only token verification, the session check and the database are
 * stubbed.
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
  DEFAULT_SMART_DESIGNER_BRAIN_MODEL,
  DEFAULT_SMART_DESIGNER_BRAIN_PROVIDER,
  SMART_DESIGNER_BRAIN_MODEL_KEY,
  SMART_DESIGNER_BRAIN_PROVIDER_KEY,
  getSmartDesignerBrainConfig,
  getSmartDesignerBrainSetting,
  invalidateSmartDesignerBrainConfigCache,
  saveSmartDesignerBrainConfig,
  smartDesignerBrainModelMismatch
} from "./smart-designer-brain-settings";

const ADMIN_ID = "admin-user";

const USERS: Record<string, { id: string; email: string; role: string }> = {
  "admin-user": { id: "admin-user", email: "admin@example.com", role: "ADMIN" },
  "business-user": { id: "business-user", email: "biz@example.com", role: "BUSINESS" }
};

type Row = { key: string; valueEncrypted: string; updatedAt: Date; secret: boolean; updatedByUserId: string };
let rows = new Map<string, Row>();

function seed(key: string, value: string): void {
  rows.set(key, {
    key,
    valueEncrypted: encryptSecret(value),
    updatedAt: new Date("2026-08-16T10:00:00.000Z"),
    secret: false,
    updatedByUserId: ADMIN_ID
  });
}

function request(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return adminRoutes.request(path, { ...init, headers });
}

function patch(body: unknown, token = "admin-user") {
  return request("/smart-designer-brain", { method: "PATCH", body: JSON.stringify(body) }, token);
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = new Map();
  invalidateSmartDesignerBrainConfigCache();

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

describe("the slot", () => {
  it("defaults to Claude Opus 5 while nothing is saved", async () => {
    expect(DEFAULT_SMART_DESIGNER_BRAIN_PROVIDER).toBe("claude");
    expect(DEFAULT_SMART_DESIGNER_BRAIN_MODEL).toBe("claude-opus-5");
    expect(await getSmartDesignerBrainConfig()).toEqual({
      providerId: "claude",
      modelId: "claude-opus-5"
    });

    const setting = await getSmartDesignerBrainSetting();
    expect(setting.isDefault).toBe(true);
    expect(setting.updatedAt).toBeNull();
  });

  it("round-trips a saved battery and restores the default on blank", async () => {
    const result = await saveSmartDesignerBrainConfig(
      { provider: "openai", model: "gpt-5.5" },
      ADMIN_ID
    );
    expect(result).toMatchObject({ providerId: "openai", modelId: "gpt-5.5", restoredDefault: false });
    expect(await getSmartDesignerBrainConfig()).toEqual({ providerId: "openai", modelId: "gpt-5.5" });

    // Stored under its own keys — the door/design batteries are never touched.
    for (const key of [SMART_DESIGNER_BRAIN_PROVIDER_KEY, SMART_DESIGNER_BRAIN_MODEL_KEY]) {
      const row = rows.get(key);
      expect(row?.secret).toBe(false);
      expect(row?.valueEncrypted).not.toContain("openai");
    }

    const cleared = await saveSmartDesignerBrainConfig({ provider: "", model: "" }, ADMIN_ID);
    expect(cleared.restoredDefault).toBe(true);
    expect(rows.size).toBe(0);
    expect(await getSmartDesignerBrainConfig()).toEqual({
      providerId: "claude",
      modelId: "claude-opus-5"
    });
  });

  it("never sends a stored model that belongs to another provider", async () => {
    expect(smartDesignerBrainModelMismatch("claude", "gpt-4o")).toBe(true);
    expect(smartDesignerBrainModelMismatch("claude", "claude-opus-5")).toBe(false);

    seed(SMART_DESIGNER_BRAIN_PROVIDER_KEY, "gemini");
    seed(SMART_DESIGNER_BRAIN_MODEL_KEY, "claude-opus-5");
    expect(await getSmartDesignerBrainConfig()).toEqual({ providerId: "gemini", modelId: null });
  });

  it("returns the default when the database is unreachable", async () => {
    settingFindManyMock.mockRejectedValue(new Error("connection refused"));

    await expect(getSmartDesignerBrainConfig()).resolves.toEqual({
      providerId: "claude",
      modelId: "claude-opus-5"
    });
  });
});

describe("the admin routes", () => {
  it("sits behind the admin guard", async () => {
    expect((await request("/smart-designer-brain")).status).toBe(401);
    expect((await request("/smart-designer-brain", {}, "business-user")).status).toBe(403);
    expect((await patch({ provider: "openai" }, "business-user")).status).toBe(403);
    expect(settingUpsertMock).not.toHaveBeenCalled();
  });

  it("GET returns the default battery and the choices an admin has", async () => {
    const response = await request("/smart-designer-brain", {}, "admin-user");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.smartDesignerBrain.providerId).toBe("claude");
    expect(body.data.smartDesignerBrain.modelId).toBe("claude-opus-5");
    expect(body.data.smartDesignerBrain.isDefault).toBe(true);
    expect(body.data.smartDesignerBrain.defaultProviderId).toBe("claude");
    expect(body.data.smartDesignerBrain.defaultModelId).toBe("claude-opus-5");
    expect(body.data.smartDesignerBrain.providers.map((p: { id: string }) => p.id)).toContain("claude");
    expect(body.data.smartDesignerBrain.models.length).toBeGreaterThan(0);
  });

  it("PATCH swaps the battery and audits without writing the chosen values", async () => {
    const response = await patch({ provider: "openai", model: "gpt-5.5" });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.smartDesignerBrain.providerId).toBe("openai");
    expect(body.data.smartDesignerBrain.modelId).toBe("gpt-5.5");
    expect(body.data.restoredDefault).toBe(false);

    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: "admin-user", action: "SMART_DESIGNER_BRAIN_MODEL_UPDATED" })
    );
    const meta = logAdminActionMock.mock.calls[0][0].meta;
    expect(JSON.stringify(meta)).not.toContain("openai");
    expect(meta).toMatchObject({ providerChanged: true, modelChanged: true });
  });

  it("refuses an unknown provider and a mismatched model", async () => {
    const unsupported = await patch({ provider: "some-startup-llm" });
    expect(unsupported.status).toBe(422);
    expect((await unsupported.json()).code).toBe("UNSUPPORTED_PROVIDER");

    const mismatched = await patch({ provider: "gemini", model: "gpt-4o" });
    expect(mismatched.status).toBe(422);
    expect((await mismatched.json()).code).toBe("PROVIDER_MODEL_MISMATCH");

    expect(settingUpsertMock).not.toHaveBeenCalled();
  });

  it("blank restores the Opus 5 default", async () => {
    await patch({ provider: "openai", model: "gpt-5.5" });
    settingUpsertMock.mockClear();

    const body = await (await patch({ provider: "", model: "" })).json();
    expect(body.data.restoredDefault).toBe(true);
    expect(body.data.smartDesignerBrain.providerId).toBe("claude");
    expect(body.data.smartDesignerBrain.modelId).toBe("claude-opus-5");
    expect(rows.size).toBe(0);
  });

  it("rejects malformed bodies", async () => {
    for (const body of [{}, { provider: 42 }, { model: [] }]) {
      expect((await patch(body)).status).toBe(422);
    }
    expect(settingUpsertMock).not.toHaveBeenCalled();
  });
});
