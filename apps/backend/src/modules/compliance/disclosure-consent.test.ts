import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_CALENDAR_DISCLOSURE_VERSION,
  GOOGLE_CALENDAR_INTEGRATION,
  GOOGLE_DISCLOSURE_ACTION_AGREED
} from "@coreai/shared";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    integrationDisclosureConsent: { create: mocks.create, findFirst: mocks.findFirst }
  }
}));

import {
  DisclosureConsentError,
  hasFreshDisclosureConsent,
  recordDisclosureConsent
} from "./disclosure-consent";

beforeEach(() => {
  mocks.create.mockReset();
  mocks.findFirst.mockReset();
  mocks.create.mockResolvedValue({
    id: "consent-1",
    disclosureVersion: GOOGLE_CALENDAR_DISCLOSURE_VERSION,
    createdAt: new Date()
  });
});

describe("recordDisclosureConsent", () => {
  const valid = {
    userId: "user-1",
    businessId: "biz-1",
    integration: GOOGLE_CALENDAR_INTEGRATION,
    disclosureVersion: GOOGLE_CALENDAR_DISCLOSURE_VERSION,
    action: GOOGLE_DISCLOSURE_ACTION_AGREED
  };

  it("persists userId, businessId, integration, version, action — and nothing token-like", async () => {
    await recordDisclosureConsent(valid);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toEqual({
      userId: "user-1",
      businessId: "biz-1",
      integration: GOOGLE_CALENDAR_INTEGRATION,
      disclosureVersion: GOOGLE_CALENDAR_DISCLOSURE_VERSION,
      action: GOOGLE_DISCLOSURE_ACTION_AGREED
    });
    expect(JSON.stringify(data)).not.toMatch(/token|secret|credential/i);
  });

  it("rejects any non-AGREED action — dismissals are never recorded", async () => {
    for (const action of ["DISMISSED", "CANCELLED", "agreed", "", "OTHER"]) {
      await expect(recordDisclosureConsent({ ...valid, action })).rejects.toMatchObject({
        code: "CONSENT_ACTION_INVALID",
        status: 422
      });
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects stale or unknown disclosure versions", async () => {
    await expect(
      recordDisclosureConsent({ ...valid, disclosureVersion: "google-calendar-2020-01-01.1" })
    ).rejects.toBeInstanceOf(DisclosureConsentError);
    await expect(recordDisclosureConsent({ ...valid, disclosureVersion: "" })).rejects.toMatchObject({
      code: "DISCLOSURE_VERSION_STALE",
      status: 409
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects unknown integrations", async () => {
    await expect(recordDisclosureConsent({ ...valid, integration: "DROPBOX" })).rejects.toMatchObject({
      code: "UNKNOWN_INTEGRATION"
    });
  });
});

describe("hasFreshDisclosureConsent", () => {
  it("queries only AGREED records for the CURRENT version within the freshness window", async () => {
    mocks.findFirst.mockResolvedValue({ id: "consent-1" });
    const fresh = await hasFreshDisclosureConsent({ userId: "user-1", integration: GOOGLE_CALENDAR_INTEGRATION });
    expect(fresh).toBe(true);

    const where = mocks.findFirst.mock.calls[0][0].where;
    expect(where.action).toBe(GOOGLE_DISCLOSURE_ACTION_AGREED);
    expect(where.disclosureVersion).toBe(GOOGLE_CALENDAR_DISCLOSURE_VERSION);
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("returns false when no fresh consent exists", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(
      hasFreshDisclosureConsent({ userId: "user-1", integration: GOOGLE_CALENDAR_INTEGRATION })
    ).resolves.toBe(false);
  });
});
