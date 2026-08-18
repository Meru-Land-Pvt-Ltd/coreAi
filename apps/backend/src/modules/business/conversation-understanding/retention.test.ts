import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  businessFindMany: vi.fn(),
  vapiCallFindMany: vi.fn(),
  vapiCallUpdate: vi.fn(),
  fetch: vi.fn(),
  env: {
    VAPI_BASE_URL: "https://api.vapi.ai",
    VAPI_API_KEY: "test-vapi-key"
  }
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    business: { findMany: mocks.businessFindMany },
    vapiCall: { findMany: mocks.vapiCallFindMany, update: mocks.vapiCallUpdate }
  }
}));

vi.mock("../../../config/env", () => ({ env: mocks.env }));

import {
  RETENTION_SWEEP_BATCH_LIMIT,
  deleteVapiCallArtifacts,
  sweepExpiredRecordings
} from "./retention";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  mocks.businessFindMany.mockReset();
  mocks.vapiCallFindMany.mockReset();
  mocks.vapiCallUpdate.mockReset();
  mocks.fetch.mockReset();
  mocks.env.VAPI_BASE_URL = "https://api.vapi.ai";
  mocks.env.VAPI_API_KEY = "test-vapi-key";
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.vapiCallUpdate.mockResolvedValue({});
  mocks.businessFindMany.mockResolvedValue([]);
  mocks.vapiCallFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deleteVapiCallArtifacts", () => {
  it("DELETED on a 2xx provider response, with the right URL and auth", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });
    await expect(deleteVapiCallArtifacts("call-1")).resolves.toEqual({ state: "DELETED" });
    expect(mocks.fetch).toHaveBeenCalledWith("https://api.vapi.ai/call/call-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-vapi-key" }
    });
  });

  it("DELETE_FAILED on 404 — never pretends deletion succeeded", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 404 });
    const result = await deleteVapiCallArtifacts("call-404");
    expect(result.state).toBe("DELETE_FAILED");
  });

  it("DELETE_FAILED on 5xx and on network errors", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 500 });
    expect((await deleteVapiCallArtifacts("call-a")).state).toBe("DELETE_FAILED");
    mocks.fetch.mockRejectedValue(new Error("ECONNRESET"));
    expect((await deleteVapiCallArtifacts("call-b")).state).toBe("DELETE_FAILED");
  });

  it("UNSUPPORTED when the endpoint is not supported (405/501)", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 405 });
    expect((await deleteVapiCallArtifacts("call-c")).state).toBe("UNSUPPORTED");
  });

  it("UNSUPPORTED without an API key, and no request is made", async () => {
    mocks.env.VAPI_API_KEY = "";
    expect((await deleteVapiCallArtifacts("call-d")).state).toBe("UNSUPPORTED");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("URL-encodes the call id and trims trailing slash from the base URL", async () => {
    mocks.env.VAPI_BASE_URL = "https://api.vapi.ai/";
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });
    await deleteVapiCallArtifacts("call/with slash");
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.vapi.ai/call/call%2Fwith%20slash");
  });
});

describe("sweepExpiredRecordings", () => {
  it("cleans an expired call locally and attempts provider deletion", async () => {
    mocks.businessFindMany.mockResolvedValue([{ id: "biz-1", recordingRetentionDays: 30 }]);
    mocks.vapiCallFindMany.mockResolvedValue([{ id: "row-1", callId: "call-1" }]);
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await sweepExpiredRecordings({ now: NOW });

    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://api.vapi.ai/call/call-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(mocks.vapiCallUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.vapiCallUpdate).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: {
        transcript: null,
        summary: null,
        recordingUrl: null,
        recordingDeletedAt: NOW,
        providerDeletionState: "DELETED"
      }
    });
    expect(result).toEqual({
      scanned: 1,
      cleaned: 1,
      providerDeleted: 1,
      providerFailed: 0,
      providerUnsupported: 0
    });
  });

  it("queries only not-yet-swept calls older than the per-business cutoff", async () => {
    mocks.businessFindMany.mockResolvedValue([{ id: "biz-1", recordingRetentionDays: 30 }]);

    await sweepExpiredRecordings({ now: NOW });

    expect(mocks.businessFindMany).toHaveBeenCalledWith({
      where: { recordingRetentionDays: { gt: 0 } },
      select: { id: true, recordingRetentionDays: true }
    });
    const where = mocks.vapiCallFindMany.mock.calls[0][0].where;
    expect(where.businessId).toBe("biz-1");
    expect(where.recordingDeletedAt).toBeNull();
    expect(where.createdAt.lt).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
    // Non-expired calls are excluded by the cutoff; nothing returned means
    // nothing is touched.
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.vapiCallUpdate).not.toHaveBeenCalled();
  });

  it("keeps DELETE_FAILED honestly when the provider rejects, but still nulls Triven data", async () => {
    mocks.businessFindMany.mockResolvedValue([{ id: "biz-1", recordingRetentionDays: 7 }]);
    mocks.vapiCallFindMany.mockResolvedValue([{ id: "row-1", callId: "call-1" }]);
    mocks.fetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await sweepExpiredRecordings({ now: NOW });

    const data = mocks.vapiCallUpdate.mock.calls[0][0].data;
    expect(data.providerDeletionState).toBe("DELETE_FAILED");
    expect(data.transcript).toBeNull();
    expect(data.summary).toBeNull();
    expect(data.recordingUrl).toBeNull();
    expect(data.recordingDeletedAt).toEqual(NOW);
    expect(result.providerFailed).toBe(1);
    expect(result.providerDeleted).toBe(0);
  });

  it("records DELETE_FAILED on provider 404 — deletion is never assumed", async () => {
    mocks.businessFindMany.mockResolvedValue([{ id: "biz-1", recordingRetentionDays: 7 }]);
    mocks.vapiCallFindMany.mockResolvedValue([{ id: "row-1", callId: "gone-call" }]);
    mocks.fetch.mockResolvedValue({ ok: false, status: 404 });

    await sweepExpiredRecordings({ now: NOW });

    expect(mocks.vapiCallUpdate.mock.calls[0][0].data.providerDeletionState).toBe("DELETE_FAILED");
  });

  it("records UNSUPPORTED when no VAPI_API_KEY is configured", async () => {
    mocks.env.VAPI_API_KEY = "";
    mocks.businessFindMany.mockResolvedValue([{ id: "biz-1", recordingRetentionDays: 7 }]);
    mocks.vapiCallFindMany.mockResolvedValue([{ id: "row-1", callId: "call-1" }]);

    const result = await sweepExpiredRecordings({ now: NOW });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.vapiCallUpdate.mock.calls[0][0].data.providerDeletionState).toBe("UNSUPPORTED");
    expect(result.providerUnsupported).toBe(1);
  });

  it("touches nothing when no business has retention configured", async () => {
    mocks.businessFindMany.mockResolvedValue([]);

    const result = await sweepExpiredRecordings({ now: NOW });

    expect(mocks.vapiCallFindMany).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.vapiCallUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({
      scanned: 0,
      cleaned: 0,
      providerDeleted: 0,
      providerFailed: 0,
      providerUnsupported: 0
    });
  });

  it("spreads the batch limit across businesses and stops at the cap", async () => {
    mocks.businessFindMany.mockResolvedValue([
      { id: "biz-1", recordingRetentionDays: 30 },
      { id: "biz-2", recordingRetentionDays: 10 },
      { id: "biz-3", recordingRetentionDays: 10 }
    ]);
    mocks.vapiCallFindMany
      .mockResolvedValueOnce([
        { id: "row-1", callId: "call-1" },
        { id: "row-2", callId: "call-2" }
      ])
      .mockResolvedValueOnce([{ id: "row-3", callId: "call-3" }]);
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await sweepExpiredRecordings({ now: NOW, batchLimit: 3 });

    // take shrinks as the budget is consumed; the third business is skipped.
    expect(mocks.vapiCallFindMany).toHaveBeenCalledTimes(2);
    expect(mocks.vapiCallFindMany.mock.calls[0][0].take).toBe(3);
    expect(mocks.vapiCallFindMany.mock.calls[1][0].take).toBe(1);
    expect(mocks.vapiCallUpdate).toHaveBeenCalledTimes(3);
    expect(result.scanned).toBe(3);
    expect(result.cleaned).toBe(3);
  });

  it("a failing row does not stall the sweep and stays eligible for retry", async () => {
    mocks.businessFindMany.mockResolvedValue([{ id: "biz-1", recordingRetentionDays: 30 }]);
    mocks.vapiCallFindMany.mockResolvedValue([
      { id: "row-1", callId: "call-1" },
      { id: "row-2", callId: "call-2" }
    ]);
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });
    mocks.vapiCallUpdate
      .mockRejectedValueOnce(new Error("db write failed"))
      .mockResolvedValueOnce({});

    const result = await sweepExpiredRecordings({ now: NOW });

    expect(result.scanned).toBe(2);
    expect(result.cleaned).toBe(1);
  });

  it("exports a default batch limit of 50", () => {
    expect(RETENTION_SWEEP_BATCH_LIMIT).toBe(50);
  });
});
