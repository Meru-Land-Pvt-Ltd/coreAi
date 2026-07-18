import { Hono } from "hono";
import { z } from "zod";
import { paymentAgentGrossCents } from "../../lib/billing-invoices";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import {
  ARCHITECT_SHARE,
  effectiveEarningStatus,
  loadArchitectEarnings,
  serializeArchitectSale,
  sumApprovedEarningsCents,
  sumPendingEarningsCents
} from "../architect/payout-earnings";
import { releaseEligibleEarnings, transitionEarning } from "../payouts/settlements";

export const adminPayoutRoutes = new Hono();

const saleStatusSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"])
});

function parsePagination(c: { req: { query: (k: string) => string | undefined } }) {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limitRaw = Number(c.req.query("limit")) || 20;
  const limit = Math.min(100, Math.max(1, limitRaw));
  return { page, limit, skip: (page - 1) * limit };
}

async function loadAdminPayoutSales(options?: {
  status?: "PENDING" | "APPROVED" | "REJECTED";
  search?: string;
}) {
  const payments = await prisma.payment.findMany({
    where: {
      listingId: { not: null },
      status: { in: ["TRIALING", "SUCCEEDED", "PENDING"] }
    },
    include: {
      listing: {
        select: {
          id: true,
          name: true,
          priceCents: true,
          architect: {
            select: {
              id: true,
              email: true,
              fullName: true,
              payoutMethod: {
                select: {
                  bankName: true,
                  accountHolderName: true,
                  accountLast4: true,
                  country: true,
                  routingLast4: true,
                  verificationStatus: true
                }
              }
            }
          }
        }
      },
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          businesses: {
            select: { id: true, name: true },
            take: 1,
            orderBy: { createdAt: "asc" }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const grouped = new Map<string, typeof payments>();

  for (const payment of payments) {
    if (!payment.listingId) continue;
    const key = `${payment.listingId}:${payment.userId}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(payment);
    grouped.set(key, bucket);
  }

  const listingIds = [...new Set([...grouped.keys()].map((key) => key.split(":")[0]!))];
  const installs = listingIds.length
    ? await prisma.installedAgent.findMany({
        where: { listingId: { in: listingIds } },
        select: {
          id: true,
          listingId: true,
          business: { select: { ownerId: true } }
        }
      })
    : [];

  const installByListingBuyer = new Map<string, string>();
  for (const install of installs) {
    if (!install.listingId || !install.business.ownerId) continue;
    installByListingBuyer.set(`${install.listingId}:${install.business.ownerId}`, install.id);
  }

  const sales = [];

  for (const bucket of grouped.values()) {
    const active =
      bucket.find((payment) => payment.status === "SUCCEEDED") ??
      bucket.find((payment) => payment.status === "TRIALING") ??
      bucket.find((payment) => payment.status === "PENDING");

    if (!active?.listing || !active.listingId) continue;

    // Agent price only — the payment total may include the platform's
    // phone-number fee, which never feeds architect earnings.
    const agentGrossCents = paymentAgentGrossCents(active);
    const grossCents = agentGrossCents > 0 ? agentGrossCents : active.listing.priceCents;
    const earningsCents = Math.round(grossCents * ARCHITECT_SHARE);
    const businessName =
      active.user.businesses[0]?.name ?? active.user.fullName ?? active.user.email;
    const architect = active.listing.architect;
    const payoutMethod = architect.payoutMethod;

    sales.push({
      paymentId: active.id,
      listingId: active.listingId,
      installId: installByListingBuyer.get(`${active.listingId}:${active.userId}`) ?? null,
      date: active.createdAt.toISOString(),
      listingName: active.listing.name,
      businessName,
      buyerEmail: active.user.email,
      grossCents,
      earningsCents,
      architectSharePercent: Math.round(ARCHITECT_SHARE * 100),
      purchaseStatus: active.status,
      architectEarningStatus: effectiveEarningStatus({
        architectEarningStatus: active.architectEarningStatus,
        reviewedAt: active.architectEarningReviewedAt
      }),
      reviewedAt: active.architectEarningReviewedAt?.toISOString() ?? null,
      architect: {
        id: architect.id,
        email: architect.email,
        fullName: architect.fullName,
        payoutMethod: payoutMethod
          ? {
              bankName: payoutMethod.bankName ?? "Stripe bank account",
              accountHolderName: payoutMethod.accountHolderName ?? "",
              accountLast4: payoutMethod.accountLast4 ?? "",
              country: payoutMethod.country,
              routingLabel: payoutMethod.country === "IN" ? "IFSC" : "ABA routing number",
              routingLast4: payoutMethod.routingLast4,
              verificationStatus: payoutMethod.verificationStatus
            }
          : null
      }
    });
  }

  const search = options?.search?.trim().toLowerCase();
  let filtered = search
    ? sales.filter((sale) => {
        const haystack = [
          sale.listingName,
          sale.businessName,
          sale.buyerEmail,
          sale.architect.email,
          sale.architect.fullName ?? ""
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      })
    : sales;

  if (options?.status) {
    filtered = filtered.filter((sale) => sale.architectEarningStatus === options.status);
  }

  return filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

adminPayoutRoutes.get("/summary", async (c) => {
  const sales = await loadAdminPayoutSales();

  const pendingSales = sales.filter((sale) => sale.architectEarningStatus === "PENDING");
  const approvedSales = sales.filter((sale) => sale.architectEarningStatus === "APPROVED");
  const rejectedSales = sales.filter((sale) => sale.architectEarningStatus === "REJECTED");

  return successResponse(c, {
    pendingSalesCount: pendingSales.length,
    pendingEarningsCents: pendingSales.reduce((sum, sale) => sum + sale.earningsCents, 0),
    approvedSalesCount: approvedSales.length,
    approvedEarningsCents: approvedSales.reduce((sum, sale) => sum + sale.earningsCents, 0),
    rejectedSalesCount: rejectedSales.length,
    rejectedEarningsCents: rejectedSales.reduce((sum, sale) => sum + sale.earningsCents, 0),
    architectSharePercent: Math.round(ARCHITECT_SHARE * 100)
  });
});

adminPayoutRoutes.get("/sales", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const status = (c.req.query("status") ?? "").trim();
  const search = (c.req.query("search") ?? "").trim();

  const normalizedStatus = ["PENDING", "APPROVED", "REJECTED"].includes(status)
    ? (status as "PENDING" | "APPROVED" | "REJECTED")
    : undefined;

  const sales = await loadAdminPayoutSales({
    status: normalizedStatus,
    search
  });

  const total = sales.length;
  const items = sales.slice(skip, skip + limit);

  return successResponse(c, { items, total, page, limit });
});

adminPayoutRoutes.patch("/sales/:paymentId/status", async (c) => {
  try {
    const authUser = c.get("authUser");
    const paymentId = c.req.param("paymentId");
    const input = saleStatusSchema.parse(await c.req.json());

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        listing: {
          select: {
            id: true,
            name: true,
            architectUserId: true
          }
        }
      }
    });

    if (!payment?.listingId || !payment.listing) {
      return errorResponse(c, "Sale not found", 404, "PAYOUT_SALE_NOT_FOUND");
    }

    if (payment.architectEarningStatus === "REJECTED") {
      return errorResponse(
        c,
        "This sale is already rejected.",
        409,
        "PAYOUT_SALE_ALREADY_REVIEWED"
      );
    }

    if (payment.architectEarningStatus === "APPROVED" && payment.architectEarningReviewedAt) {
      return errorResponse(
        c,
        "This sale is already approved.",
        409,
        "PAYOUT_SALE_ALREADY_REVIEWED"
      );
    }

    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        architectEarningStatus: input.status,
        architectEarningReviewedAt: new Date(),
        architectEarningReviewedByUserId: authUser.id
      }
    });

    // Keep the settlement ledger in step with the review decision: approval
    // releases the earning once its hold expires; rejection retires it.
    try {
      if (input.status === "APPROVED") {
        await releaseEligibleEarnings(payment.listing.architectUserId);
      } else {
        const earning = await prisma.architectEarning.findUnique({ where: { paymentId } });
        if (earning) {
          await transitionEarning({
            earningId: earning.id,
            to: "FAILED",
            source: "admin",
            sourceId: authUser.id,
            reason: "Earning rejected by admin review"
          });
        }
      }
    } catch (error) {
      console.error("[admin-payouts] settlement sync after review failed", { paymentId, error });
    }

    const architectSales = await loadArchitectEarnings(payment.listing.architectUserId);
    const sale = architectSales.find((item) => item.paymentId === paymentId);

    return successResponse(
      c,
      {
        payment: {
          id: updated.id,
          architectEarningStatus: updated.architectEarningStatus,
          reviewedAt: updated.architectEarningReviewedAt?.toISOString() ?? null
        },
        sale: sale ? serializeArchitectSale(sale) : null,
        architectTotals: {
          approvedEarningsCents: sumApprovedEarningsCents(architectSales),
          pendingEarningsCents: sumPendingEarningsCents(architectSales)
        }
      },
      input.status === "APPROVED" ? "Architect earnings approved" : "Architect earnings rejected"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid status", 422, "VALIDATION_ERROR");
    }

    return errorResponse(c, "Could not update payout sale status", 500, "PAYOUT_SALE_STATUS_FAILED");
  }
});
