import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  deleteMany: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    connectorCredential: { findUnique: mocks.findUnique, deleteMany: mocks.deleteMany }
  }
}));

vi.mock("../../lib/crypto", () => ({
  encryptSecret: vi.fn((value: string) => `enc:${value}`),
  decryptSecret: vi.fn((value: string) => value.replace(/^enc:/, ""))
}));

import { disconnectGmail } from "./gmail-connector";

const fetchMock = vi.fn();

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.deleteMany.mockReset();
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("disconnectGmail (revoke-then-delete)", () => {
  it("revokes the Google grant BEFORE deleting local encrypted credentials", async () => {
    const order: string[] = [];
    mocks.findUnique.mockResolvedValue({
      refreshTokenEnc: "enc:refresh-token-value",
      accessTokenEnc: "enc:access-token-value"
    });
    fetchMock.mockImplementation(async () => {
      order.push("revoke");
      return { ok: true } as Response;
    });
    mocks.deleteMany.mockImplementation(async () => {
      order.push("delete");
      return { count: 1 };
    });

    await disconnectGmail("user-1");

    expect(order).toEqual(["revoke", "delete"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init.body).toContain("refresh-token-value");
  });

  it("is idempotent: no credential → no revoke call, delete still runs", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await disconnectGmail("user-1");
    await disconnectGmail("user-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("still deletes local credentials when revocation fails (already revoked / network down)", async () => {
    mocks.findUnique.mockResolvedValue({ refreshTokenEnc: "enc:r", accessTokenEnc: null });
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(disconnectGmail("user-1")).resolves.toBeUndefined();
    expect(mocks.deleteMany).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue({ ok: false, status: 400 } as Response);
    mocks.findUnique.mockResolvedValue({ refreshTokenEnc: "enc:r", accessTokenEnc: "enc:a" });
    await expect(disconnectGmail("user-1")).resolves.toBeUndefined();
    expect(mocks.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("never logs token values", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.findUnique.mockResolvedValue({
      refreshTokenEnc: "enc:super-secret-refresh",
      accessTokenEnc: "enc:super-secret-access"
    });
    fetchMock.mockResolvedValue({ ok: true } as Response);

    await disconnectGmail("user-1");

    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => JSON.stringify(call)).join("\n");
    expect(logged).not.toContain("super-secret-refresh");
    expect(logged).not.toContain("super-secret-access");
  });
});
