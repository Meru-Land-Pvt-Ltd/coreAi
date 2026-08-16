/**
 * "My Keys" locker routes — contract tests.
 *
 * The locker SERVICE is mocked (its own suite covers encryption); here we prove
 * the HTTP layer: values are never echoed, the caller is scoped to their own id,
 * an unauthenticated request is rejected, validation and not-found map to the
 * right status codes, and every mutation writes a value-free audit line.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, createMock, deleteMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  deleteMock: vi.fn()
}));

vi.mock("./architect-secrets", async () => {
  const actual = await vi.importActual<typeof import("./architect-secrets")>("./architect-secrets");
  return {
    ...actual,
    listArchitectSecrets: listMock,
    createArchitectSecret: createMock,
    deleteArchitectSecret: deleteMock
  };
});

import { AppError } from "../../lib/app-error";
import { SECRET_MASK } from "./architect-secrets";
import { architectSecretsRoutes } from "./secrets-routes";

const AUTH_USER = {
  id: "arch-1",
  email: "architect@example.com",
  role: "ARCHITECT",
  roles: ["ARCHITECT"]
};

/** App that mimics the parent router: authUser is present on the context. */
function authedApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authUser", AUTH_USER as never);
    await next();
  });
  app.route("/secrets", architectSecretsRoutes);
  return app;
}

/** App with NO authUser — mimics a request that somehow reached the handler. */
function anonApp() {
  const app = new Hono();
  app.route("/secrets", architectSecretsRoutes);
  return app;
}

const NOW = new Date("2026-08-16T12:00:00.000Z");

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  deleteMock.mockReset();
});

/* ---------------------------------- list ---------------------------------- */

describe("GET /secrets", () => {
  it("returns the caller's keys masked, scoped to their own id", async () => {
    listMock.mockResolvedValue([
      { id: "s1", name: "Weather", maskedValue: SECRET_MASK, createdAt: NOW, updatedAt: NOW }
    ]);

    const res = await authedApp().request("/secrets");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith("arch-1");
    expect(body.data.secrets[0].maskedValue).toBe(SECRET_MASK);
    // No encrypted blob or raw value field ever crosses the wire.
    expect(JSON.stringify(body)).not.toContain("valueEncrypted");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await anonApp().request("/secrets");
    expect(res.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });
});

/* --------------------------------- create --------------------------------- */

describe("POST /secrets", () => {
  it("saves a key and never echoes the plaintext value back", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    createMock.mockResolvedValue({
      id: "s9",
      name: "YouTube",
      maskedValue: SECRET_MASK,
      createdAt: NOW,
      updatedAt: NOW
    });

    const res = await authedApp().request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "YouTube", value: "super-secret-abc-123" })
    });
    const raw = await res.text();
    const body = JSON.parse(raw);

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith("arch-1", "YouTube", "super-secret-abc-123");
    expect(body.data.secret.maskedValue).toBe(SECRET_MASK);
    // The plaintext value must not appear anywhere in the response.
    expect(raw).not.toContain("super-secret-abc-123");

    // An audit line was written, and it does NOT carry the value.
    expect(infoSpy).toHaveBeenCalled();
    const audited = JSON.stringify(infoSpy.mock.calls);
    expect(audited).toContain("SECRET_ADDED");
    expect(audited).not.toContain("super-secret-abc-123");
    infoSpy.mockRestore();
  });

  it("rejects a blank name with 422 and never calls the service", async () => {
    const res = await authedApp().request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   ", value: "v" })
    });
    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("maps a service AppError to its status and code", async () => {
    createMock.mockRejectedValue(new AppError("That value is too long to be an API key.", 422, "SECRET_VALUE_TOO_LONG"));

    const res = await authedApp().request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Big", value: "x" })
    });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("SECRET_VALUE_TOO_LONG");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await anonApp().request("/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", value: "y" })
    });
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });
});

/* --------------------------------- delete --------------------------------- */

describe("DELETE /secrets/:id", () => {
  it("removes the caller's key and writes a value-free audit line", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    deleteMock.mockResolvedValue(true);

    const res = await authedApp().request("/secrets/s9", { method: "DELETE" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith("arch-1", "s9");
    expect(body.data.deleted).toBe(true);
    expect(JSON.stringify(infoSpy.mock.calls)).toContain("SECRET_DELETED");
    infoSpy.mockRestore();
  });

  it("returns 404 when the key is not the caller's (nothing deleted)", async () => {
    deleteMock.mockResolvedValue(false);
    const res = await authedApp().request("/secrets/not-mine", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await anonApp().request("/secrets/s9", { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
