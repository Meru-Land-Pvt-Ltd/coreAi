import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn()
  });
  const prisma = {
    customer: model(),
    customerIdentity: model(),
    customerMergeSuggestion: model(),
    customerMergeEvent: model(),
    conversation: model(),
    vapiCall: model(),
    appointment: model(),
    lead: model(),
    handoffEvent: model(),
    emailMessage: model(),
    $transaction: vi.fn()
  };
  return { prisma, logBusinessActivity: vi.fn() };
});

vi.mock("../../../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../activity-log", () => ({ logBusinessActivity: mocks.logBusinessActivity }));

import {
  CustomerServiceError,
  deleteCustomerData,
  ensureCustomerByIdentity,
  getCustomerTimeline,
  isGenericInboxEmail,
  mergeCustomers,
  splitCustomers,
  suggestWeakMatch
} from "./customer-service";

const MODEL_NAMES = [
  "customer",
  "customerIdentity",
  "customerMergeSuggestion",
  "customerMergeEvent",
  "conversation",
  "vapiCall",
  "appointment",
  "lead",
  "handoffEvent",
  "emailMessage"
] as const;

beforeEach(() => {
  for (const name of MODEL_NAMES) {
    const model = mocks.prisma[name] as Record<string, ReturnType<typeof vi.fn>>;
    for (const fn of Object.values(model)) fn.mockReset();
    model.findUnique.mockResolvedValue(null);
    model.findFirst.mockResolvedValue(null);
    model.findMany.mockResolvedValue([]);
    model.create.mockResolvedValue({ id: `${name}-created` });
    model.update.mockResolvedValue({ id: `${name}-updated` });
    model.updateMany.mockResolvedValue({ count: 0 });
    model.delete.mockResolvedValue({ id: `${name}-deleted` });
    model.deleteMany.mockResolvedValue({ count: 0 });
  }
  mocks.prisma.$transaction.mockReset();
  // Interactive-transaction mock: run the callback against the same mock client.
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(mocks.prisma)
  );
  mocks.logBusinessActivity.mockReset();
  mocks.logBusinessActivity.mockResolvedValue(undefined);
});

describe("ensureCustomerByIdentity — strong identities", () => {
  it("auto-links the same phone identity to the same customer twice", async () => {
    // First contact: no identity yet — customer + identity created in a transaction.
    mocks.prisma.customer.create.mockResolvedValueOnce({ id: "cust-1" });
    const first = await ensureCustomerByIdentity({
      businessId: "biz-1",
      kind: "PHONE",
      value: "+17252202182"
    });
    expect(first).toEqual({ outcome: "LINKED", customerId: "cust-1", created: true });
    expect(mocks.prisma.customerIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "biz-1",
        customerId: "cust-1",
        kind: "PHONE",
        value: "+17252202182",
        confidence: "STRONG"
      })
    });

    // Second contact: identity hit — same customer, lastSeenAt refreshed.
    mocks.prisma.customerIdentity.findUnique.mockResolvedValueOnce({
      id: "ident-1",
      customer: { id: "cust-1", status: "ACTIVE", mergedIntoId: null }
    });
    const second = await ensureCustomerByIdentity({
      businessId: "biz-1",
      kind: "PHONE",
      value: "+17252202182"
    });
    expect(second).toEqual({ outcome: "LINKED", customerId: "cust-1", created: false });
    expect(mocks.prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { lastSeenAt: expect.any(Date) }
    });
  });

  it("normalizes phone formats onto one E.164 identity value and skips unusable phones", async () => {
    mocks.prisma.customerIdentity.findUnique.mockResolvedValueOnce({
      id: "ident-1",
      customer: { id: "cust-1", status: "ACTIVE", mergedIntoId: null }
    });
    await ensureCustomerByIdentity({ businessId: "biz-1", kind: "PHONE", value: "(555) 010-2030" });
    expect(mocks.prisma.customerIdentity.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId_kind_value: { businessId: "biz-1", kind: "PHONE", value: "+15550102030" } }
      })
    );

    const skipped = await ensureCustomerByIdentity({ businessId: "biz-1", kind: "PHONE", value: "12" });
    expect(skipped.outcome).toBe("SKIPPED");
  });

  it("auto-links a personal email (STRONG) on identity hit", async () => {
    mocks.prisma.customerIdentity.findUnique.mockResolvedValueOnce({
      id: "ident-9",
      customer: { id: "cust-9", status: "ACTIVE", mergedIntoId: null }
    });
    const result = await ensureCustomerByIdentity({
      businessId: "biz-1",
      kind: "EMAIL",
      value: "Jane.Doe@Example.com"
    });
    expect(result).toEqual({ outcome: "LINKED", customerId: "cust-9", created: false });
    // Lookup used the lowercased value.
    expect(mocks.prisma.customerIdentity.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId_kind_value: { businessId: "biz-1", kind: "EMAIL", value: "jane.doe@example.com" }
        }
      })
    );
    expect(mocks.prisma.customer.create).not.toHaveBeenCalled();
  });

  it("resolves a MERGED alias identity to the surviving customer", async () => {
    mocks.prisma.customerIdentity.findUnique.mockResolvedValueOnce({
      id: "ident-2",
      customer: { id: "cust-old", status: "MERGED", mergedIntoId: "cust-survivor" }
    });
    const result = await ensureCustomerByIdentity({
      businessId: "biz-1",
      kind: "PHONE",
      value: "+17252202182"
    });
    expect(result).toEqual({ outcome: "LINKED", customerId: "cust-survivor", created: false });
  });

  it("survives the create race: P2002 in the transaction re-reads the winning identity", async () => {
    mocks.prisma.customerIdentity.findUnique
      .mockResolvedValueOnce(null) // initial miss
      .mockResolvedValueOnce({
        id: "ident-race",
        customer: { id: "cust-race", status: "ACTIVE", mergedIntoId: null }
      }); // re-read after P2002
    mocks.prisma.$transaction.mockRejectedValueOnce({ code: "P2002" });

    const result = await ensureCustomerByIdentity({
      businessId: "biz-1",
      kind: "PHONE",
      value: "+17252202182"
    });
    expect(result).toEqual({ outcome: "LINKED", customerId: "cust-race", created: false });
  });
});

describe("ensureCustomerByIdentity — weak identities never auto-link", () => {
  it("generic-prefix email held by an existing customer creates a NEW customer plus a suggestion", async () => {
    mocks.prisma.customerIdentity.findUnique.mockResolvedValueOnce({
      id: "ident-info",
      customer: { id: "cust-existing", status: "ACTIVE", mergedIntoId: null }
    });
    mocks.prisma.customer.create.mockResolvedValueOnce({ id: "cust-new" });
    mocks.prisma.customerMergeSuggestion.create.mockResolvedValueOnce({ id: "sugg-1", status: "PENDING" });

    const result = await ensureCustomerByIdentity({
      businessId: "biz-1",
      kind: "EMAIL",
      value: "info@acme.com"
    });

    expect(result).toEqual({
      outcome: "SUGGESTED",
      customerId: "cust-new",
      existingCustomerId: "cust-existing",
      suggestionId: "sugg-1"
    });
    // Never linked: the existing customer was not touched, no identity moved.
    expect(mocks.prisma.customer.update).not.toHaveBeenCalled();
    expect(mocks.prisma.customerIdentity.create).not.toHaveBeenCalled();
  });

  it("generic-prefix email with no existing holder still gets its own customer with a WEAK identity", async () => {
    mocks.prisma.customer.create.mockResolvedValueOnce({ id: "cust-generic" });
    const result = await ensureCustomerByIdentity({
      businessId: "biz-1",
      kind: "EMAIL",
      value: "office@acme.com"
    });
    expect(result).toEqual({ outcome: "LINKED", customerId: "cust-generic", created: true });
    expect(mocks.prisma.customerIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "EMAIL", value: "office@acme.com", confidence: "WEAK" })
    });
    expect(mocks.prisma.customerMergeSuggestion.create).not.toHaveBeenCalled();
  });

  it("NAME identities never auto-link: an exact name hit yields a new customer and a suggestion", async () => {
    mocks.prisma.customerIdentity.findUnique.mockResolvedValueOnce({
      id: "ident-name",
      customer: { id: "cust-named", status: "ACTIVE", mergedIntoId: null }
    });
    mocks.prisma.customer.create.mockResolvedValueOnce({ id: "cust-name-new" });
    mocks.prisma.customerMergeSuggestion.create.mockResolvedValueOnce({ id: "sugg-2", status: "PENDING" });

    const result = await ensureCustomerByIdentity({
      businessId: "biz-1",
      kind: "NAME",
      value: "  John   Smith "
    });
    expect(result.outcome).toBe("SUGGESTED");
    if (result.outcome === "SUGGESTED") {
      expect(result.customerId).toBe("cust-name-new");
      expect(result.existingCustomerId).toBe("cust-named");
    }
    // Lookup used the normalized (collapsed, lowercased) name value.
    expect(mocks.prisma.customerIdentity.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId_kind_value: { businessId: "biz-1", kind: "NAME", value: "john smith" } }
      })
    );
  });

  it("NAME miss creates a WEAK identity on its own new customer", async () => {
    mocks.prisma.customer.create.mockResolvedValueOnce({ id: "cust-n1" });
    const result = await ensureCustomerByIdentity({
      businessId: "biz-1",
      kind: "NAME",
      value: "Jane Roe"
    });
    expect(result).toEqual({ outcome: "LINKED", customerId: "cust-n1", created: true });
    expect(mocks.prisma.customerIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "NAME", value: "jane roe", confidence: "WEAK" })
    });
  });

  it("classifies generic inbox prefixes (including +tags) and leaves personal emails STRONG", () => {
    expect(isGenericInboxEmail("info@acme.com")).toBe(true);
    expect(isGenericInboxEmail("sales+quotes@acme.com")).toBe(true);
    expect(isGenericInboxEmail("jane.doe@acme.com")).toBe(false);
    expect(isGenericInboxEmail("information@acme.com")).toBe(false);
  });
});

describe("suggestWeakMatch", () => {
  it("stores the pair in canonical order and skips pairs already MERGED/DISMISSED", async () => {
    mocks.prisma.customerMergeSuggestion.findUnique.mockResolvedValueOnce({
      id: "sugg-done",
      status: "DISMISSED"
    });
    const skipped = await suggestWeakMatch("biz-1", "cust-b", "cust-a", "same email");
    expect(skipped).toBeNull();
    expect(mocks.prisma.customerMergeSuggestion.create).not.toHaveBeenCalled();
    // Lookup used sorted (canonical) pair order despite reversed arguments.
    expect(mocks.prisma.customerMergeSuggestion.findUnique).toHaveBeenCalledWith({
      where: {
        businessId_customerAId_customerBId: {
          businessId: "biz-1",
          customerAId: "cust-a",
          customerBId: "cust-b"
        }
      }
    });

    mocks.prisma.customerMergeSuggestion.findUnique.mockResolvedValueOnce(null);
    mocks.prisma.customerMergeSuggestion.create.mockResolvedValueOnce({ id: "sugg-new", status: "PENDING" });
    const created = await suggestWeakMatch("biz-1", "cust-b", "cust-a", "same email", 0.4);
    expect(created).toEqual({ id: "sugg-new", status: "PENDING" });
    expect(mocks.prisma.customerMergeSuggestion.create).toHaveBeenCalledWith({
      data: {
        businessId: "biz-1",
        customerAId: "cust-a",
        customerBId: "cust-b",
        reason: "same email",
        score: 0.4
      }
    });
  });
});

describe("mergeCustomers", () => {
  function primeMergeCustomers() {
    mocks.prisma.customer.findFirst.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === "surv") {
        return {
          id: "surv",
          businessId: "biz-1",
          status: "ACTIVE",
          displayName: "Survivor",
          primaryPhone: "+15550001111",
          primaryEmail: null,
          lastSeenAt: new Date("2026-01-01T00:00:00Z")
        };
      }
      if (args.where.id === "merged") {
        return {
          id: "merged",
          businessId: "biz-1",
          status: "ACTIVE",
          displayName: "Dup",
          primaryPhone: "+15550002222",
          primaryEmail: "dup@example.com",
          lastSeenAt: new Date("2026-02-01T00:00:00Z")
        };
      }
      return null;
    });
  }

  it("moves refs per table, records movedRefsJson, marks the alias, resolves the suggestion, and logs", async () => {
    primeMergeCustomers();
    mocks.prisma.customerIdentity.findMany.mockImplementation(async (args: { where: { customerId: string } }) =>
      args.where.customerId === "surv"
        ? [{ id: "i-s", kind: "PHONE", value: "+15550001111", confidence: "STRONG", source: null }]
        : [{ id: "i-m", kind: "PHONE", value: "+15550002222", confidence: "STRONG", source: null }]
    );
    mocks.prisma.conversation.findMany.mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]);
    mocks.prisma.vapiCall.findMany.mockResolvedValueOnce([{ id: "v1" }]);
    mocks.prisma.customerMergeEvent.create.mockResolvedValueOnce({ id: "evt-1" });

    const result = await mergeCustomers({
      businessId: "biz-1",
      survivingId: "surv",
      mergedId: "merged",
      actorUserId: "user-1"
    });

    expect(result.mergeEventId).toBe("evt-1");
    expect(result.movedRefs.conversations).toEqual(["c1", "c2"]);
    expect(result.movedRefs.vapiCalls).toEqual(["v1"]);
    expect(result.movedRefs.identities).toEqual(["i-m"]);

    // Refs captured BEFORE the update, then moved with a tenant-scoped filter.
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { businessId: "biz-1", customerId: "merged" },
      data: { customerId: "surv" }
    });
    // Empty tables are not touched.
    expect(mocks.prisma.appointment.updateMany).not.toHaveBeenCalled();

    // Alias kept for reversibility.
    expect(mocks.prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "merged" },
      data: { status: "MERGED", mergedIntoId: "surv" }
    });

    // The merge event records exactly what moved.
    const eventData = mocks.prisma.customerMergeEvent.create.mock.calls[0][0].data;
    expect(eventData.movedRefsJson).toMatchObject({
      conversations: ["c1", "c2"],
      vapiCalls: ["v1"],
      identities: ["i-m"]
    });

    // Pending pair suggestion resolved in either stored order.
    expect(mocks.prisma.customerMergeSuggestion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: "biz-1", status: "PENDING" }),
        data: expect.objectContaining({ status: "MERGED", resolvedByUserId: "user-1" })
      })
    );

    expect(mocks.logBusinessActivity).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "biz-1", action: "CUSTOMER_MERGED", targetId: "surv" })
    );
  });

  it("tenant guard: refuses to merge a customer that belongs to another business", async () => {
    mocks.prisma.customer.findFirst.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === "surv"
        ? { id: "surv", businessId: "biz-1", status: "ACTIVE", displayName: null, primaryPhone: null, primaryEmail: null, lastSeenAt: null }
        : null // "merged" belongs to biz-2 → findFirst({id, businessId: "biz-1"}) misses
    );

    await expect(
      mergeCustomers({ businessId: "biz-1", survivingId: "surv", mergedId: "foreign", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND", httpStatus: 404 });

    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.customerMergeEvent.create).not.toHaveBeenCalled();
    expect(mocks.logBusinessActivity).not.toHaveBeenCalled();
  });

  it("deletes duplicate identities from the merged side instead of violating the unique index", async () => {
    primeMergeCustomers();
    mocks.prisma.customerIdentity.findMany.mockImplementation(async (args: { where: { customerId: string } }) =>
      args.where.customerId === "surv"
        ? [{ id: "i-s", kind: "PHONE", value: "+15550009999", confidence: "STRONG", source: null }]
        : [{ id: "i-dup", kind: "PHONE", value: "+15550009999", confidence: "STRONG", source: "voice" }]
    );
    mocks.prisma.customerMergeEvent.create.mockResolvedValueOnce({ id: "evt-2" });

    const result = await mergeCustomers({
      businessId: "biz-1",
      survivingId: "surv",
      mergedId: "merged"
    });

    expect(mocks.prisma.customerIdentity.delete).toHaveBeenCalledWith({ where: { id: "i-dup" } });
    expect(mocks.prisma.customerIdentity.update).not.toHaveBeenCalled();
    expect(result.movedRefs.identities).toEqual([]);
    expect(result.movedRefs.deletedDuplicateIdentities).toEqual([
      { kind: "PHONE", value: "+15550009999", confidence: "STRONG", source: "voice" }
    ]);
  });

  it("refuses self-merge", async () => {
    await expect(
      mergeCustomers({ businessId: "biz-1", survivingId: "same", mergedId: "same" })
    ).rejects.toMatchObject({ code: "MERGE_SELF" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("splitCustomers", () => {
  it("restores moved refs (only rows still on the survivor), reactivates the alias, and logs", async () => {
    mocks.prisma.customerMergeEvent.findFirst.mockResolvedValueOnce({
      id: "evt-1",
      businessId: "biz-1",
      survivingCustomerId: "surv",
      mergedCustomerId: "merged",
      reversedAt: null,
      movedRefsJson: {
        conversations: ["c1"],
        vapiCalls: ["v1"],
        appointments: [],
        leads: [],
        handoffEvents: [],
        emailMessages: [],
        identities: ["i-m"],
        deletedDuplicateIdentities: []
      }
    });

    const result = await splitCustomers({ businessId: "biz-1", mergeEventId: "evt-1", actorUserId: "user-1" });
    expect(result).toEqual({ mergeEventId: "evt-1", restoredCustomerId: "merged" });

    // Only rows whose customerId STILL equals the survivor move back —
    // data re-linked after the merge is never clobbered.
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1"] }, businessId: "biz-1", customerId: "surv" },
      data: { customerId: "merged" }
    });
    expect(mocks.prisma.vapiCall.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["v1"] }, businessId: "biz-1", customerId: "surv" },
      data: { customerId: "merged" }
    });
    expect(mocks.prisma.appointment.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.customerIdentity.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["i-m"] }, businessId: "biz-1", customerId: "surv" },
      data: { customerId: "merged" }
    });
    expect(mocks.prisma.customer.updateMany).toHaveBeenCalledWith({
      where: { id: "merged", businessId: "biz-1" },
      data: { status: "ACTIVE", mergedIntoId: null }
    });
    expect(mocks.prisma.customerMergeEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: { reversedAt: expect.any(Date) }
    });
    expect(mocks.logBusinessActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CUSTOMER_SPLIT", targetId: "merged" })
    );
  });

  it("refuses an already-reversed merge event and a foreign-business event", async () => {
    mocks.prisma.customerMergeEvent.findFirst.mockResolvedValueOnce({
      id: "evt-1",
      businessId: "biz-1",
      survivingCustomerId: "surv",
      mergedCustomerId: "merged",
      reversedAt: new Date(),
      movedRefsJson: {}
    });
    await expect(
      splitCustomers({ businessId: "biz-1", mergeEventId: "evt-1" })
    ).rejects.toMatchObject({ code: "MERGE_ALREADY_REVERSED", httpStatus: 409 });

    mocks.prisma.customerMergeEvent.findFirst.mockResolvedValueOnce(null);
    await expect(
      splitCustomers({ businessId: "biz-1", mergeEventId: "evt-other-biz" })
    ).rejects.toMatchObject({ code: "MERGE_EVENT_NOT_FOUND", httpStatus: 404 });

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("getCustomerTimeline", () => {
  it("merges all sources, sorts desc on our stored timestamps, and includes phone-fallback history", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValueOnce({
      id: "cust-1",
      businessId: "biz-1",
      displayName: "Jane",
      primaryPhone: "+15550001111",
      primaryEmail: null,
      status: "ACTIVE",
      mergedIntoId: null,
      notes: null,
      firstSeenAt: new Date("2025-12-01T00:00:00Z"),
      lastSeenAt: new Date("2026-03-01T00:00:00Z"),
      identities: [
        { id: "i1", kind: "PHONE", value: "+15550001111", confidence: "STRONG", source: null }
      ]
    });
    mocks.prisma.conversation.findMany.mockResolvedValueOnce([
      {
        id: "c1",
        channel: "SMS",
        status: "OPEN",
        outcome: null,
        sentiment: null,
        summary: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        lastInboundAt: null,
        lastOutboundAt: null
      }
    ]);
    mocks.prisma.vapiCall.findMany.mockResolvedValueOnce([
      {
        id: "v1",
        callId: "call-1",
        status: "ENDED",
        outcome: "BOOKED",
        sentiment: null,
        summary: null,
        durationSeconds: 120,
        executionMode: "LIVE",
        startedAt: new Date("2026-03-01T00:00:00Z"),
        endedAt: new Date("2026-03-01T00:02:00Z")
      }
    ]);
    mocks.prisma.appointment.findMany.mockResolvedValueOnce([
      {
        id: "a1",
        service: "Cleaning",
        status: "BOOKED",
        startAt: new Date("2026-02-01T00:00:00Z"),
        endAt: new Date("2026-02-01T00:30:00Z"),
        timeZone: "America/Los_Angeles",
        source: "voice",
        cancelledAt: null,
        createdAt: new Date("2026-01-15T00:00:00Z")
      }
    ]);

    const result = await getCustomerTimeline({ businessId: "biz-1", customerId: "cust-1" });

    expect(result.events.map((e) => e.type)).toEqual(["CALL", "APPOINTMENT", "CONVERSATION"]);
    expect(result.events[0].at).toEqual(new Date("2026-03-01T00:00:00Z"));
    expect(result.customer.id).toBe("cust-1");

    // Phone fallback: unlinked (customerId null) rows matching the customer's
    // phone identities are part of the query, so pre-linking history appears.
    expect(mocks.prisma.vapiCall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: "biz-1",
          OR: [
            { customerId: { in: ["cust-1"] } },
            { customerId: null, customerPhone: { in: ["+15550001111"] } }
          ]
        }
      })
    );
  });

  it("tenant guard: 404 for a customer of another business", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValueOnce(null);
    await expect(
      getCustomerTimeline({ businessId: "biz-1", customerId: "cust-foreign" })
    ).rejects.toBeInstanceOf(CustomerServiceError);
    await expect(
      getCustomerTimeline({ businessId: "biz-1", customerId: "cust-foreign" })
    ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND", httpStatus: 404 });
  });
});

describe("deleteCustomerData", () => {
  it("nulls links, tombstones phones (per-row for unique columns), strips call content, deletes the customer, and logs counts", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValueOnce({
      id: "cust-1",
      businessId: "biz-1",
      displayName: "Jane",
      primaryPhone: "+15550001111",
      primaryEmail: "jane@example.com",
      status: "ACTIVE",
      mergedIntoId: null,
      notes: null,
      firstSeenAt: new Date(),
      lastSeenAt: null,
      identities: [
        { id: "i1", kind: "PHONE", value: "+15550001111", confidence: "STRONG", source: null }
      ]
    });
    mocks.prisma.conversation.findMany.mockResolvedValueOnce([{ id: "c1" }]);
    mocks.prisma.lead.findMany.mockResolvedValueOnce([{ id: "l1" }]);
    mocks.prisma.appointment.updateMany.mockResolvedValueOnce({ count: 2 });
    mocks.prisma.vapiCall.updateMany.mockResolvedValueOnce({ count: 3 });
    mocks.prisma.handoffEvent.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.prisma.emailMessage.updateMany.mockResolvedValueOnce({ count: 4 });
    mocks.prisma.customerIdentity.deleteMany.mockResolvedValueOnce({ count: 1 });
    mocks.prisma.customer.deleteMany.mockResolvedValueOnce({ count: 1 });

    const counts = await deleteCustomerData({
      businessId: "biz-1",
      customerId: "cust-1",
      actorUserId: "user-1"
    });

    // Unique-indexed phone columns get per-row tombstones.
    expect(mocks.prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { customerId: null, customerPhone: "DELETED:c1" }
    });
    expect(mocks.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { customerId: null, phoneNumber: "DELETED:l1", name: null }
    });
    // Call content removed; operational skeleton retained.
    expect(mocks.prisma.vapiCall.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          customerId: null,
          customerPhone: "DELETED",
          transcript: null,
          summary: null,
          recordingUrl: null
        }
      })
    );
    expect(mocks.prisma.appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { customerId: null, customerPhone: "DELETED", customerName: null, customerEmail: null }
      })
    );
    expect(mocks.prisma.emailMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customerId: null } })
    );
    expect(mocks.prisma.customerIdentity.deleteMany).toHaveBeenCalledWith({
      where: { customerId: { in: ["cust-1"] } }
    });
    expect(mocks.prisma.customer.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["cust-1"] }, businessId: "biz-1" }
    });

    expect(counts).toMatchObject({
      conversationsRedacted: 1,
      leadsRedacted: 1,
      appointmentsRedacted: 2,
      callsRedacted: 3,
      handoffsUnlinked: 1,
      emailsUnlinked: 4,
      identitiesDeleted: 1,
      customersDeleted: 1
    });
    expect(mocks.logBusinessActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CUSTOMER_DELETED", targetId: "cust-1", detail: counts })
    );
  });

  it("tenant guard: 404 without touching any rows", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValueOnce(null);
    await expect(
      deleteCustomerData({ businessId: "biz-1", customerId: "cust-foreign" })
    ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND", httpStatus: 404 });
    expect(mocks.prisma.customer.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.vapiCall.updateMany).not.toHaveBeenCalled();
    expect(mocks.logBusinessActivity).not.toHaveBeenCalled();
  });
});
