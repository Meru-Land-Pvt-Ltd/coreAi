import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    business: { findFirst: vi.fn(), count: vi.fn() },
    payment: { findMany: vi.fn() },
    businessUsageInvoice: { findMany: vi.fn() },
    agentUsageExecution: { groupBy: vi.fn() },
    vapiCall: { count: vi.fn(), findMany: vi.fn() },
    lead: { count: vi.fn(), findMany: vi.fn() },
    appointment: { count: vi.fn(), findMany: vi.fn() },
    smsExecution: { findMany: vi.fn() }
  },
  buildInstalledAgentRunStats: vi.fn(),
  buildInvoicePdfBuffer: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("./installed-agent-run-stats", () => ({
  buildInstalledAgentRunStats: mocks.buildInstalledAgentRunStats
}));
vi.mock("../../lib/mailer", () => ({
  buildInvoicePdfBuffer: mocks.buildInvoicePdfBuffer
}));

import { buildBusinessDataExportZip } from "./data-export";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("business data export ZIP", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const profilePhotoUrl = `data:image/png;base64,${ONE_PIXEL_PNG}`;

    mocks.prisma.user.findUnique.mockResolvedValue({
      email: "owner@example.com",
      fullName: "Asha Owner",
      phone: "+15550001111",
      location: "Austin",
      timezone: "America/Chicago",
      profilePhotoUrl,
      createdAt: new Date("2025-01-05T10:00:00.000Z")
    });
    mocks.prisma.business.findFirst.mockResolvedValue({
      id: "business-1",
      name: "Asha Clinic",
      type: "Healthcare",
      subscriptionStatus: "ACTIVE",
      billingName: "Asha Clinic LLC",
      billingEmail: "billing@example.com",
      billingAddress: "42 Example Street",
      billingPostalCode: "78701",
      createdAt: new Date("2025-01-06T10:00:00.000Z"),
      profile: {
        businessSize: "1-10",
        teamPhone: "+15550002222",
        bookingUrl: "https://example.com/book",
        timeZone: "America/Chicago"
      },
      installedAgents: [
        {
          id: "agent-1",
          listingId: "listing-1",
          name: "Reception Agent",
          status: "ACTIVE",
          pausedAt: null,
          executionFeeCents: 5,
          trialExecutionLimit: 100,
          trialExecutionsUsed: 10,
          createdAt: new Date("2025-02-01T10:00:00.000Z"),
          updatedAt: now,
          listing: {
            id: "listing-1",
            name: "Reception Agent",
            shortDescription: "Answers calls and books appointments.",
            description: "A helpful voice receptionist.",
            priceCents: 4900,
            pricingModel: "ONE_TIME",
            executionFeeCents: 5,
            category: "Operations",
            tags: ["Voice"],
            industryTags: ["Healthcare"],
            iconUrl: profilePhotoUrl,
            freeTrialEnabled: true,
            trialDays: 7
          }
        }
      ]
    });
    mocks.prisma.business.count.mockResolvedValue(2);
    mocks.prisma.payment.findMany.mockResolvedValue([
      {
        id: "payment-12345678",
        businessId: "business-1",
        listingId: "listing-1",
        amountCents: 4900,
        currency: "usd",
        status: "SUCCEEDED",
        description: "Reception Agent purchase",
        createdAt: new Date("2025-02-01T10:00:00.000Z"),
        updatedAt: new Date("2025-02-01T10:05:00.000Z"),
        invoiceKind: "PURCHASE",
        paidAt: new Date("2025-02-01T10:05:00.000Z"),
        billingName: "Asha Clinic LLC",
        billingEmail: "billing@example.com",
        billingAddress: "42 Example Street",
        lineItemsJson: [{ label: "Reception Agent", amountCents: 4900 }],
        listing: {
          id: "listing-1",
          name: "Reception Agent",
          priceCents: 4900,
          pricingModel: "ONE_TIME",
          trialDays: 7
        }
      },
      {
        id: "payment-setup-87654321",
        businessId: "business-1",
        listingId: "listing-2",
        amountCents: 2900,
        currency: "usd",
        status: "SUCCEEDED",
        description: "Follow-up Agent purchase",
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
        updatedAt: new Date("2026-07-20T10:05:00.000Z"),
        invoiceKind: "PURCHASE",
        paidAt: new Date("2026-07-20T10:05:00.000Z"),
        billingName: "Asha Clinic LLC",
        billingEmail: "billing@example.com",
        billingAddress: "42 Example Street",
        lineItemsJson: [{ label: "Follow-up Agent", amountCents: 2900 }],
        listing: {
          id: "listing-2",
          name: "Follow-up Agent",
          shortDescription: "Follows up with new leads.",
          description: "A lead follow-up assistant awaiting setup.",
          priceCents: 2900,
          pricingModel: "ONE_TIME",
          category: "Sales",
          tags: ["Follow-up"],
          industryTags: ["Healthcare"],
          iconUrl: null,
          freeTrialEnabled: false,
          trialDays: 0,
          executionFeeCents: 4
        }
      }
    ]);
    mocks.prisma.businessUsageInvoice.findMany.mockResolvedValue([
      {
        invoiceNumber: "USE-2026-0001",
        billingMonth: month,
        issuedAt: now,
        totalMicroUsd: 250_000,
        currency: "usd",
        status: "PAID",
        stripePaymentIntentId: "pi_usage_1",
        installedAgent: { id: "agent-1", name: "Reception Agent" },
        lineItems: [
          {
            serviceName: "Voice service",
            quantity: 10,
            unitPriceMicroUsd: 12_500,
            amountMicroUsd: 125_000
          },
          {
            serviceName: "Text messaging",
            quantity: 5,
            unitPriceMicroUsd: 25_000,
            amountMicroUsd: 125_000
          }
        ]
      }
    ]);
    mocks.prisma.agentUsageExecution.groupBy.mockResolvedValue([
      {
        billingMonth: month,
        installedAgentId: "agent-1",
        _count: { _all: 12 },
        _sum: { amountMicroUsd: 250_000, legacyBilledCostMicroUsd: 0 }
      }
    ]);
    mocks.prisma.vapiCall.count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(5);
    mocks.prisma.lead.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    mocks.prisma.appointment.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    mocks.prisma.appointment.findMany
      .mockResolvedValueOnce([
        {
          id: "appointment-1",
          customerName: "Mina",
          customerPhone: "+15550003333",
          service: "Consultation",
          startAt: now,
          endAt: new Date(now.getTime() + 30 * 60 * 1000),
          timeZone: "America/Chicago",
          status: "CONFIRMED",
          calendarEventLink: "https://calendar.example.com/event/1",
          createdAt: now
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "appointment-1",
          customerName: "Mina",
          customerPhone: "+15550003333",
          service: "Consultation",
          startAt: now,
          createdAt: now
        }
      ])
      .mockResolvedValueOnce([{ conversationId: "conversation-1" }]);
    mocks.prisma.lead.findMany.mockResolvedValue([
      {
        id: "lead-1",
        phoneNumber: "+15550004444",
        name: "Ravi",
        createdAt: now
      }
    ]);
    mocks.prisma.vapiCall.findMany
      .mockResolvedValueOnce([
        {
          id: "call-1",
          installedAgentId: "agent-1",
          customerPhone: "+15550005555",
          status: "COMPLETED",
          billedCostMicroUsd: 100_000,
          recordingUrl: "https://recordings.example.com/1",
          createdAt: now
        }
      ])
      .mockResolvedValueOnce([
        { installedAgentId: "agent-1", conversationId: "conversation-1" }
      ]);
    mocks.prisma.smsExecution.findMany.mockResolvedValue([
      {
        dedupeKey: "appointment-confirmation:appointment-1",
        status: "SENT",
        errorCode: null
      }
    ]);
    mocks.buildInstalledAgentRunStats
      .mockResolvedValueOnce(new Map([["agent-1", { runs: 10, costMicroUsd: 250_000 }]]))
      .mockResolvedValueOnce(new Map([["agent-1", { runs: 75, costMicroUsd: 1_500_000 }]]));
    mocks.buildInvoicePdfBuffer.mockImplementation(async (invoice: { invoiceNumber: string }) =>
      Buffer.from(`%PDF-1.7\n${invoice.invoiceNumber}\n%%EOF`)
    );
  });

  it("contains only the requested readable sections, normal images, and every invoice PDF", async () => {
    const result = await buildBusinessDataExportZip("owner-1", "business-1");
    const archive = await JSZip.loadAsync(result.zip);
    const paths = Object.keys(archive.files);

    expect(result.filename).toMatch(/^triven-asha-clinic-data-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(paths).toContain("start-here.html");
    expect(paths).toContain("README.txt");
    expect(paths).toContain("01-profile/profile.html");
    expect(paths).toContain("01-profile/profile-photo.png");
    expect(paths).toContain("02-dashboard/dashboard.html");
    expect(paths).toContain("03-my-agents/my-agents.html");
    expect(paths).toContain("03-my-agents/images/agent-01-icon.png");
    expect(paths).toContain("04-billing-and-usage/billing-and-usage.html");

    const pdfPaths = paths.filter((path) => path.endsWith(".pdf"));
    expect(pdfPaths).toHaveLength(3);
    expect(pdfPaths.some((path) => path.includes("/agent-invoices/"))).toBe(true);
    expect(pdfPaths.some((path) => path.includes("/usage-invoices/"))).toBe(true);
    await Promise.all(
      pdfPaths.map(async (path) => {
        const pdf = await archive.file(path)!.async("nodebuffer");
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      })
    );

    const profileImage = await archive
      .file("01-profile/profile-photo.png")!
      .async("nodebuffer");
    expect(profileImage.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    const readablePaths = paths.filter(
      (path) => path.endsWith(".html") || path.endsWith(".txt")
    );
    const readableContent = (
      await Promise.all(readablePaths.map((path) => archive.file(path)!.async("string")))
    ).join("\n");
    expect(readableContent).not.toContain(";base64,");
    expect(readableContent).not.toContain(ONE_PIXEL_PNG);
    expect(readableContent).not.toContain("<script");
    expect(paths.some((path) => path.endsWith(".json"))).toBe(false);
    const myAgentsHtml = await archive.file("03-my-agents/my-agents.html")!.async("string");
    expect(myAgentsHtml).toContain("Follow-up Agent");
    expect(myAgentsHtml).toContain("Setup required");
    const dashboardHtml = await archive.file("02-dashboard/dashboard.html")!.async("string");
    expect(dashboardHtml).toContain("Purchased Follow-up Agent");

    const topLevelEntries = new Set(paths.map((path) => path.split("/")[0]));
    expect(topLevelEntries).toEqual(
      new Set([
        "start-here.html",
        "README.txt",
        "01-profile",
        "02-dashboard",
        "03-my-agents",
        "04-billing-and-usage"
      ])
    );
    expect(mocks.prisma.business.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "owner-1", id: "business-1" }
      })
    );
    expect(mocks.prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "owner-1", businessId: "business-1" }
      })
    );
    expect(mocks.buildInvoicePdfBuffer).toHaveBeenCalledTimes(3);
    const usagePdfInput = mocks.buildInvoicePdfBuffer.mock.calls
      .map(([invoice]) => invoice)
      .find((invoice) => invoice.invoiceNumber === "USE-2026-0001");
    expect(
      usagePdfInput.lineItems.reduce(
        (total: number, item: { amountCents: number }) => total + item.amountCents,
        0
      )
    ).toBe(usagePdfInput.amountCents);
    expect(usagePdfInput.lineItems).toEqual([
      expect.objectContaining({
        label: "Voice service",
        quantity: 10,
        unitPriceDisplay: "$0.0125"
      }),
      expect.objectContaining({
        label: "Text messaging",
        quantity: 5,
        unitPriceDisplay: "$0.025"
      })
    ]);
  });

  it("includes unassigned legacy payments only when the owner has a single business", async () => {
    mocks.prisma.business.count.mockResolvedValue(1);

    await buildBusinessDataExportZip("owner-1", "business-1");

    expect(mocks.prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "owner-1",
          OR: [{ businessId: "business-1" }, { businessId: null }]
        }
      })
    );
  });
});
