import type { ArchitectRefundAction } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { loadArchitectEarnings } from "./payout-earnings";

export type LiveAgentRefundLine = {
  listingId: string;
  listingName: string;
  listingStatus: string;
  paidInstallCount: number;
  refundPerInstallCents: number;
  totalRefundCents: number;
};

export async function getArchitectLiveRefundObligations(architectUserId: string) {
  const [sales, liveListings] = await Promise.all([
    loadArchitectEarnings(architectUserId),
    prisma.agentListing.findMany({
      where: {
        architectUserId,
        status: { in: ["APPROVED", "PENDING_REVIEW"] }
      },
      select: {
        id: true,
        name: true,
        status: true,
        priceCents: true
      }
    })
  ]);

  const paidSales = sales.filter((sale) => sale.purchaseStatus === "SUCCEEDED");
  const listingMap = new Map(liveListings.map((listing) => [listing.id, listing]));
  const grouped = new Map<string, LiveAgentRefundLine>();

  for (const sale of paidSales) {
    const listing = listingMap.get(sale.listingId);
    if (!listing) continue;

    const existing = grouped.get(sale.listingId);
    const refundPerInstallCents = sale.grossCents;

    if (existing) {
      existing.paidInstallCount += 1;
      existing.totalRefundCents += refundPerInstallCents;
      continue;
    }

    grouped.set(sale.listingId, {
      listingId: listing.id,
      listingName: listing.name,
      listingStatus: listing.status,
      paidInstallCount: 1,
      refundPerInstallCents,
      totalRefundCents: refundPerInstallCents
    });
  }

  const agents = [...grouped.values()];
  const totalRefundCents = agents.reduce((sum, agent) => sum + agent.totalRefundCents, 0);

  return {
    agents,
    totalRefundCents,
    requiresPayment: totalRefundCents > 0
  };
}

export async function hasPaidRefundSettlement(
  architectUserId: string,
  action: ArchitectRefundAction
) {
  const settlement = await prisma.architectRefundSettlement.findFirst({
    where: {
      architectUserId,
      action,
      status: "PAID"
    },
    orderBy: { createdAt: "desc" }
  });

  if (!settlement) return false;

  const obligations = await getArchitectLiveRefundObligations(architectUserId);
  return obligations.totalRefundCents <= settlement.amountCents;
}
