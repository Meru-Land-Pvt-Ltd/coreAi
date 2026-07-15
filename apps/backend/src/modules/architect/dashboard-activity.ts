import { prisma } from "../../lib/prisma";
import { effectiveEarningStatus, loadArchitectEarnings } from "./payout-earnings";

export type ArchitectDashboardActivity = {
  id: string;
  type: "SALE" | "PAYOUT" | "LISTING";
  title: string;
  description: string;
  occurredAt: string;
  status: string;
  amountCents?: number;
  listingId?: string;
};

function listingStatusLabel(status: string) {
  switch (status) {
    case "APPROVED":
      return "Live";
    case "PENDING_REVIEW":
      return "In review";
    case "REJECTED":
      return "Rejected";
    case "SUSPENDED":
      return "Suspended";
    case "PAUSED":
      return "Paused";
    default:
      return "Draft";
  }
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export async function loadArchitectDashboardActivity(
  architectUserId: string,
  limit = 10
): Promise<ArchitectDashboardActivity[]> {
  const safeLimit = Math.min(25, Math.max(1, limit));
  const [sales, payouts, listings] = await Promise.all([
    loadArchitectEarnings(architectUserId),
    prisma.architectPayout.findMany({
      where: { architectUserId },
      orderBy: { updatedAt: "desc" },
      take: safeLimit,
      select: {
        id: true,
        amountCents: true,
        status: true,
        updatedAt: true
      }
    }),
    prisma.agentListing.findMany({
      where: { architectUserId },
      orderBy: { updatedAt: "desc" },
      take: safeLimit,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        submittedAt: true,
        approvedAt: true,
        publishedAt: true
      }
    })
  ]);

  const activities: ArchitectDashboardActivity[] = sales.map((sale) => {
    const earningStatus = effectiveEarningStatus(sale);
    return {
      id: `sale:${sale.id}`,
      type: "SALE",
      title: earningStatus === "APPROVED" ? "Earning approved" : "New agent sale",
      description: `${sale.businessName} purchased ${sale.listingName}`,
      occurredAt: (earningStatus === "APPROVED" ? sale.reviewedAt ?? sale.createdAt : sale.createdAt).toISOString(),
      status:
        earningStatus === "APPROVED"
          ? "Approved"
          : earningStatus === "REJECTED"
            ? "Rejected"
            : "Pending",
      amountCents: sale.earningsCents,
      listingId: sale.listingId
    };
  });

  for (const payout of payouts) {
    activities.push({
      id: `payout:${payout.id}`,
      type: "PAYOUT",
      title: payout.status === "COMPLETED" ? "Payout completed" : "Payout updated",
      description: `Payout is ${payout.status.toLowerCase().replace(/_/g, " ")}`,
      occurredAt: payout.updatedAt.toISOString(),
      status: titleCase(payout.status),
      amountCents: payout.amountCents
    });
  }

  for (const listing of listings) {
    activities.push({
      id: `listing-created:${listing.id}`,
      type: "LISTING",
      title: "Agent draft created",
      description: listing.name,
      occurredAt: listing.createdAt.toISOString(),
      status: "Draft",
      listingId: listing.id
    });

    if (listing.submittedAt) {
      activities.push({
        id: `listing-submitted:${listing.id}`,
        type: "LISTING",
        title: "Agent submitted for review",
        description: listing.name,
        occurredAt: listing.submittedAt.toISOString(),
        status: "In review",
        listingId: listing.id
      });
    }

    const liveAt = listing.publishedAt ?? listing.approvedAt;
    if (liveAt) {
      activities.push({
        id: `listing-live:${listing.id}`,
        type: "LISTING",
        title: "Agent went live",
        description: listing.name,
        occurredAt: liveAt.toISOString(),
        status: "Live",
        listingId: listing.id
      });
    } else if (["REJECTED", "SUSPENDED", "PAUSED"].includes(listing.status)) {
      const status = listingStatusLabel(listing.status);
      activities.push({
        id: `listing-status:${listing.id}:${listing.status}`,
        type: "LISTING",
        title: `Agent ${status.toLowerCase()}`,
        description: listing.name,
        occurredAt: listing.updatedAt.toISOString(),
        status,
        listingId: listing.id
      });
    }
  }

  return activities
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, safeLimit);
}
