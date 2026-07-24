import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { TRIAL_ACCESS_WINDOW_MS } from "../business/purchase-access";

export type RegisteredBusinessAccountCandidate = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  isSuspended: boolean;
  createdAt: Date;
  phone: string | null;
  lastActiveAt: Date | null;
};

export type RegisteredBusinessPurchasedAgent = {
  purchaseId: string;
  purchasedAt: Date;
  purchaseStatus: string;
  amountCents: number;
  currency: string;
  installedAgentId: string | null;
  installedAgentStatus: string | null;
  listing: {
    id: string;
    name: string;
    shortDescription: string;
    category: string | null;
    pricingModel: string;
    priceCents: number;
    architect: {
      email: string;
      fullName: string | null;
    } | null;
  };
};

export type RegisteredBusinessAccount = Omit<RegisteredBusinessAccountCandidate, "role"> & {
  purchasedAgents: RegisteredBusinessPurchasedAgent[];
  businessName: string | null;
  subscriptionStatus: string | null;
  accountStatus: "Active" | "Trial" | "Inactive" | "Suspended";
  totalSpendCents: number | null;
  currency: string | null;
  totalExecutions: number;
};

const BUSINESS_CAPABILITY_FILTER: Prisma.UserWhereInput = {
  OR: [
    { role: "BUSINESS" },
    { roleMemberships: { some: { role: "BUSINESS" } } }
  ]
};

/**
 * Legacy data can contain separate role rows for the same email. The admin
 * account list is identity-based, so normalize email and return it once.
 */
export function dedupeRegisteredBusinessAccounts(
  candidates: RegisteredBusinessAccountCandidate[]
): RegisteredBusinessAccount[] {
  const byEmail = new Map<string, RegisteredBusinessAccount>();

  for (const candidate of candidates) {
    const key = candidate.email.trim().toLowerCase();
    if (!key) continue;

    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, {
        id: candidate.id,
        email: candidate.email.trim(),
        fullName: candidate.fullName,
        isSuspended: candidate.isSuspended,
        createdAt: candidate.createdAt,
        phone: candidate.phone,
        lastActiveAt: candidate.lastActiveAt,
        businessName: null,
        subscriptionStatus: null,
        accountStatus: candidate.isSuspended ? "Suspended" : "Active",
        totalSpendCents: 0,
        currency: null,
        totalExecutions: 0,
        purchasedAgents: []
      });
      continue;
    }

    // Prefer the explicit BUSINESS user row as the representative id/name,
    // while preserving the earliest registration time and strictest status.
    if (candidate.role === "BUSINESS") {
      existing.id = candidate.id;
      existing.email = candidate.email.trim();
      existing.fullName = candidate.fullName ?? existing.fullName;
      existing.phone = candidate.phone ?? existing.phone;
    } else if (!existing.fullName && candidate.fullName) {
      existing.fullName = candidate.fullName;
    }

    existing.phone = existing.phone ?? candidate.phone;

    existing.isSuspended = existing.isSuspended || candidate.isSuspended;
    if (candidate.createdAt < existing.createdAt) existing.createdAt = candidate.createdAt;
    if (
      candidate.lastActiveAt &&
      (!existing.lastActiveAt || candidate.lastActiveAt > existing.lastActiveAt)
    ) {
      existing.lastActiveAt = candidate.lastActiveAt;
    }
  }

  return [...byEmail.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function listRegisteredBusinessAccounts(
  search = "",
  options: { includePurchasedAgents?: boolean; now?: Date } = {}
) {
  const normalizedSearch = search.trim().toLowerCase();
  const now = options.now ?? new Date();
  const userRows = await prisma.user.findMany({
    where: BUSINESS_CAPABILITY_FILTER,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isSuspended: true,
      createdAt: true,
      phone: true,
      activeSessions: {
        where: { revokedAt: null, expiresAt: { gt: now } },
        orderBy: { lastActiveAt: "desc" },
        take: 1,
        select: { lastActiveAt: true }
      },
      loginHistory: {
        where: { status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true }
      }
    }
  });

  const candidates: RegisteredBusinessAccountCandidate[] = userRows.map((user) => {
    const sessionActivity = user.activeSessions[0]?.lastActiveAt ?? null;
    const loginActivity = user.loginHistory[0]?.createdAt ?? null;
    const lastActiveAt =
      sessionActivity && loginActivity
        ? sessionActivity > loginActivity
          ? sessionActivity
          : loginActivity
        : sessionActivity ?? loginActivity;

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isSuspended: user.isSuspended,
      createdAt: user.createdAt,
      phone: user.phone,
      lastActiveAt
    };
  });

  let accounts = dedupeRegisteredBusinessAccounts(candidates);
  if (!options.includePurchasedAgents || accounts.length === 0) {
    if (!normalizedSearch) return accounts;
    return accounts.filter((account) =>
      `${account.email} ${account.fullName ?? ""}`.toLowerCase().includes(normalizedSearch)
    );
  }

  const normalizedEmailByUserId = new Map(
    candidates.map((candidate) => [candidate.id, candidate.email.trim().toLowerCase()])
  );
  const candidateUserIds = [...normalizedEmailByUserId.keys()];

  const [payments, businesses] = await Promise.all([
    prisma.payment.findMany({
      where: {
        userId: { in: candidateUserIds },
        status: { in: ["TRIALING", "SUCCEEDED"] }
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        amountCents: true,
        currency: true,
        status: true,
        createdAt: true,
        listing: {
          select: {
            id: true,
            name: true,
            shortDescription: true,
            category: true,
            pricingModel: true,
            priceCents: true,
            architect: { select: { email: true, fullName: true } }
          }
        }
      }
    }),
    prisma.business.findMany({
      where: { ownerId: { in: candidateUserIds } },
      orderBy: { updatedAt: "desc" },
      select: {
        ownerId: true,
        name: true,
        subscriptionStatus: true,
        updatedAt: true,
        profile: { select: { teamPhone: true } },
        phoneNumbers: {
          where: { isActive: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { phoneNumber: true }
        },
        _count: {
          // Canonical run definition: LIVE AI calls + missed-call captures.
          // (WorkflowRun alone was a third, disagreeing definition.)
          select: {
            vapiCalls: { where: { executionMode: "LIVE" } },
            leads: { where: { source: { contains: "MISSED_CALL" } } }
          }
        },
        installedAgents: {
          where: { listingId: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { id: true, listingId: true, status: true }
        }
      }
    })
  ]);

  const installationByEmailAndListing = new Map<
    string,
    { id: string; status: string }
  >();
  const businessDataByEmail = new Map<
    string,
    {
      name: string;
      subscriptionStatus: string | null;
      phone: string | null;
      updatedAt: Date;
      totalExecutions: number;
    }
  >();

  for (const business of businesses) {
    const emailKey = normalizedEmailByUserId.get(business.ownerId);
    if (!emailKey) continue;

    const existingBusinessData = businessDataByEmail.get(emailKey);
    if (!existingBusinessData) {
      businessDataByEmail.set(emailKey, {
        name: business.name,
        subscriptionStatus: business.subscriptionStatus,
        phone: business.profile?.teamPhone ?? business.phoneNumbers[0]?.phoneNumber ?? null,
        updatedAt: business.updatedAt,
        totalExecutions: business._count.vapiCalls + business._count.leads
      });
    } else {
      existingBusinessData.totalExecutions += business._count.vapiCalls + business._count.leads;
      if (business.updatedAt > existingBusinessData.updatedAt) {
        existingBusinessData.name = business.name;
        existingBusinessData.subscriptionStatus = business.subscriptionStatus;
        existingBusinessData.phone =
          business.profile?.teamPhone ?? business.phoneNumbers[0]?.phoneNumber ?? existingBusinessData.phone;
        existingBusinessData.updatedAt = business.updatedAt;
      }
    }

    for (const installedAgent of business.installedAgents) {
      if (!installedAgent.listingId) continue;
      const key = `${emailKey}:${installedAgent.listingId}`;
      if (!installationByEmailAndListing.has(key)) {
        installationByEmailAndListing.set(key, installedAgent);
      }
    }
  }

  const paymentsByEmailAndListing = new Map<string, typeof payments>();
  const paymentsByEmail = new Map<string, typeof payments>();
  for (const payment of payments) {
    const emailKey = normalizedEmailByUserId.get(payment.userId);
    if (!emailKey) continue;

    const emailPayments = paymentsByEmail.get(emailKey) ?? [];
    emailPayments.push(payment);
    paymentsByEmail.set(emailKey, emailPayments);

    if (!payment.listing) continue;

    const key = `${emailKey}:${payment.listing.id}`;
    const existing = paymentsByEmailAndListing.get(key) ?? [];
    existing.push(payment);
    paymentsByEmailAndListing.set(key, existing);
  }

  for (const account of accounts) {
    const emailKey = account.email.trim().toLowerCase();
    const accountPayments = paymentsByEmail.get(emailKey) ?? [];
    const successfulPayments = accountPayments.filter((payment) => payment.status === "SUCCEEDED");
    const trialPayments = accountPayments.filter((payment) => payment.status === "TRIALING");
    const trialCutoff = now.getTime() - TRIAL_ACCESS_WINDOW_MS;
    const hasFreshTrial = trialPayments.some(
      (payment) => payment.createdAt.getTime() > trialCutoff
    );
    const currencies = new Set(successfulPayments.map((payment) => payment.currency.toLowerCase()));
    const paymentCurrencies = new Set(accountPayments.map((payment) => payment.currency.toLowerCase()));
    const businessData = businessDataByEmail.get(emailKey) ?? null;

    account.businessName = businessData?.name ?? null;
    account.subscriptionStatus = businessData?.subscriptionStatus ?? null;
    account.phone = account.phone ?? businessData?.phone ?? null;
    account.totalExecutions = businessData?.totalExecutions ?? 0;
    account.totalSpendCents = currencies.size > 1
      ? null
      : successfulPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
    account.currency =
      currencies.size === 1
        ? [...currencies][0] ?? null
        : successfulPayments.length === 0 && paymentCurrencies.size === 1
          ? [...paymentCurrencies][0] ?? null
          : null;

    const subscriptionStatus = account.subscriptionStatus?.trim().toLowerCase() ?? "";
    const hasActiveSubscription = subscriptionStatus === "active";
    const hasInactiveSubscription = [
      "inactive",
      "canceled",
      "cancelled",
      "expired",
      "past_due",
      "paused",
      "unpaid"
    ].includes(subscriptionStatus);
    if (account.isSuspended) {
      account.accountStatus = "Suspended";
    } else if (hasActiveSubscription || successfulPayments.length > 0) {
      account.accountStatus = "Active";
    } else if (subscriptionStatus.includes("trial")) {
      account.accountStatus = hasFreshTrial ? "Trial" : "Inactive";
    } else if (hasInactiveSubscription) {
      account.accountStatus = "Inactive";
    } else if (hasFreshTrial) {
      account.accountStatus = "Trial";
    } else if (trialPayments.length > 0) {
      account.accountStatus = "Inactive";
    } else {
      account.accountStatus = "Active";
    }

    account.purchasedAgents = [...paymentsByEmailAndListing.entries()]
      .filter(([key]) => key.startsWith(`${emailKey}:`))
      .map(([key, listingPayments]) => {
        // Payments are newest first. Prefer a completed purchase over a trial
        // when historical records for both exist for the same agent.
        const purchase = listingPayments.find((payment) => payment.status === "SUCCEEDED") ?? listingPayments[0];
        const installedAgent = installationByEmailAndListing.get(key) ?? null;

        return {
          purchaseId: purchase.id,
          purchasedAt: purchase.createdAt,
          purchaseStatus: purchase.status,
          amountCents: purchase.amountCents,
          currency: purchase.currency,
          installedAgentId: installedAgent?.id ?? null,
          installedAgentStatus: installedAgent?.status ?? null,
          listing: purchase.listing!
        };
      })
      .sort((a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime());
  }

  if (normalizedSearch) {
    accounts = accounts.filter((account) =>
      `${account.email} ${account.fullName ?? ""} ${account.businessName ?? ""}`
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }

  return accounts;
}
