import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE SPARE-DOMAIN POOL. The main domain never carries agent mail: one spammy
 * agent could blacklist triven.ai and kill everything, login mails included.
 */

const sesSend = vi.fn();
vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: class { send(command: unknown) { return sesSend(command); } },
  CreateEmailIdentityCommand: class { constructor(public input: unknown) {} },
  GetEmailIdentityCommand: class { constructor(public input: unknown) {} },
  DeleteEmailIdentityCommand: class { constructor(public input: unknown) {} }
}));

const findUnique = vi.fn();
const upsert = vi.fn();
vi.mock("../../lib/prisma", () => ({
  prisma: { platformApiSetting: { findUnique: (...a: unknown[]) => findUnique(...a), upsert: (...a: unknown[]) => upsert(...a) } }
}));

import { addMailDomain, getDefaultSendingDomain, invalidateMailDomainCache, isValidDomainName } from "./mail-domains";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateMailDomainCache();
});

describe("the domain pool", () => {
  it("knows a domain from a typo", () => {
    expect(isValidDomainName("trivenmail.com")).toBe(true);
    expect(isValidDomainName("not a domain")).toBe(false);
    expect(isValidDomainName("no-dots")).toBe(false);
  });

  it("adding a domain returns exactly the three DNS lines to paste", async () => {
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({});
    sesSend
      .mockResolvedValueOnce({ DkimAttributes: { Tokens: ["tok1", "tok2", "tok3"] } })
      .mockResolvedValueOnce({ DkimAttributes: { Status: "PENDING" } });

    const added = await addMailDomain("trivenmail.com", "admin-1");
    expect(added.dnsRecords).toHaveLength(3);
    expect(added.dnsRecords[0]).toEqual({
      type: "CNAME",
      name: "tok1._domainkey.trivenmail.com",
      value: "tok1.dkim.amazonses.com"
    });
    expect(added.isDefault).toBe(true);
    expect(added.status).toBe("waiting");
  });

  it("an unverified default never carries mail — the shipped sender does", async () => {
    // A half-set-up spare domain must not silently break every agent's email.
    findUnique.mockResolvedValue({
      valueEncrypted: JSON.stringify([
        { domain: "trivenmail.com", dnsRecords: [], isDefault: true, addedAt: "2026-08-25" }
      ])
    });
    sesSend.mockResolvedValueOnce({ DkimAttributes: { Status: "PENDING" } });
    expect(await getDefaultSendingDomain()).toBeNull();
  });

  it("a verified default carries the mail", async () => {
    findUnique.mockResolvedValue({
      valueEncrypted: JSON.stringify([
        { domain: "trivenmail.com", dnsRecords: [], isDefault: true, addedAt: "2026-08-25" }
      ])
    });
    sesSend.mockResolvedValueOnce({ DkimAttributes: { Status: "SUCCESS" }, VerifiedForSendingStatus: true });
    expect(await getDefaultSendingDomain()).toBe("trivenmail.com");
  });
});
