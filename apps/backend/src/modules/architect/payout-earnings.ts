import type { Payment, PaymentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const ARCHITECT_SHARE = 0.7;

const OWNED_PAYMENT_STATUSES: PaymentStatus[] = ["TRIALING", "SUCCEEDED", "PENDING"];

export type ArchitectSaleRecord = {
  id: string;
  paymentId: string;
  listingId: string;
  installId: string | null;
  buyerUserId: string;
  createdAt: Date;
  listingName: string;
  businessName: string;
  grossCents: number;
  earningsCents: number;
  purchaseStatus: PaymentStatus;
};

function resolveActivePayment<T extends { status: PaymentStatus }>(payments: T[]) {
  const owned = payments.filter((payment) => OWNED_PAYMENT_STATUSES.includes(payment.status));

  return (
    owned.find((payment) => payment.status === "SUCCEEDED") ??
    owned.find((payment) => payment.status === "TRIALING") ??
    owned.find((payment) => payment.status === "PENDING") ??
    null
  );
}

function buyerDisplayName(payment: Payment & {
  user: {
    email: string;
    fullName: string | null;
    businesses: Array<{ name: string }>;
  };
}) {
  return payment.user.businesses[0]?.name ?? payment.user.fullName ?? payment.user.email;
}

export async function loadArchitectEarnings(
  architectUserId: string,
  options?: { listingIds?: string[] }
): Promise<ArchitectSaleRecord[]> {
  const listingIds = options?.listingIds?.filter(Boolean);

  const payments = await prisma.payment.findMany({
    where: {
      listingId: { not: null },
      status: { in: OWNED_PAYMENT_STATUSES },
      listing: {
        architectUserId,
        ...(listingIds?.length ? { id: { in: listingIds } } : {})
      }
    },
    include: {
      listing: {
        select: {
          id: true,
          name: true,
          priceCents: true
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

  const listingIdSet = [...new Set([...grouped.keys()].map((key) => key.split(":")[0]!))];
  const installs = listingIdSet.length
    ? await prisma.installedAgent.findMany({
        where: {
          listingId: { in: listingIdSet },
          listing: { architectUserId }
        },
        select: {
          id: true,
          listingId: true,
          business: {
            select: {
              ownerId: true
            }
          }
        }
      })
    : [];

  const installByListingBuyer = new Map<string, string>();
  for (const install of installs) {
    if (!install.listingId || !install.business.ownerId) continue;
    installByListingBuyer.set(`${install.listingId}:${install.business.ownerId}`, install.id);
  }

  const sales: ArchitectSaleRecord[] = [];

  for (const bucket of grouped.values()) {
    const active = resolveActivePayment(bucket);
    if (!active?.listing || !active.listingId) continue;

    const grossCents = active.amountCents > 0 ? active.amountCents : active.listing.priceCents;
    const installKey = `${active.listingId}:${active.userId}`;

    sales.push({
      id: active.id,
      paymentId: active.id,
      listingId: active.listingId,
      installId: installByListingBuyer.get(installKey) ?? null,
      buyerUserId: active.userId,
      createdAt: active.createdAt,
      listingName: active.listing.name,
      businessName: buyerDisplayName(active),
      grossCents,
      earningsCents: Math.round(grossCents * ARCHITECT_SHARE),
      purchaseStatus: active.status
    });
  }

  return sales.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function sumEarningsCents(sales: ArchitectSaleRecord[]) {
  return sales.reduce((sum, sale) => sum + sale.earningsCents, 0);
}

export async function countSalesByListingIds(listingIds: string[]): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(listingIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const payments = await prisma.payment.findMany({
    where: {
      listingId: { in: uniqueIds },
      status: { in: OWNED_PAYMENT_STATUSES }
    },
    select: {
      listingId: true,
      userId: true,
      status: true
    }
  });

  const grouped = new Map<string, Array<{ status: PaymentStatus }>>();

  for (const payment of payments) {
    if (!payment.listingId) continue;
    const key = `${payment.listingId}:${payment.userId}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(payment);
    grouped.set(key, bucket);
  }

  const counts = new Map<string, number>();

  for (const key of grouped.keys()) {
    const listingId = key.split(":")[0]!;
    const bucket = grouped.get(key)!;
    if (resolveActivePayment(bucket)) {
      counts.set(listingId, (counts.get(listingId) ?? 0) + 1);
    }
  }

  return counts;
}

export function serializeArchitectSale(sale: ArchitectSaleRecord) {
  return {
    id: sale.id,
    paymentId: sale.paymentId,
    listingId: sale.listingId,
    installId: sale.installId,
    buyerUserId: sale.buyerUserId,
    date: sale.createdAt.toISOString(),
    listingName: sale.listingName,
    businessName: sale.businessName,
    grossCents: sale.grossCents,
    earningsCents: sale.earningsCents,
    purchaseStatus: sale.purchaseStatus
  };
}
