import { prisma } from "../../lib/prisma";

type DatedAmount = { createdAt: Date; amountCents: number };
type DatedRecord = { createdAt: Date };

type CurrencyAmount = {
  amountCents: number;
  currency: string;
};

type MarketplaceUserSource = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  createdAt: Date;
  roleMemberships: Array<{ role: string; createdAt: Date }>;
};

export type AdminMarketplaceUserIdentity = {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: Date;
  roles: string[];
};

export type AdminPerformanceDay = {
  date: string;
  revenueCents: number;
  executions: number;
  newUsers: number;
};

export type AdminRecentActivity = {
  id: string;
  occurredAt: Date;
  type: "agent_submission" | "payment" | "user_registration" | "execution";
  event: string;
  user: string;
  details: string;
};

function utcDayStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfUtcWeek(value: Date) {
  const start = utcDayStart(value);
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export function buildAdminPerformance30d(
  now: Date,
  payments: DatedAmount[],
  executions: DatedRecord[],
  users: DatedRecord[]
): AdminPerformanceDay[] {
  const today = utcDayStart(now);
  const firstDay = new Date(today);
  firstDay.setUTCDate(firstDay.getUTCDate() - 29);

  const byDate = new Map<string, AdminPerformanceDay>();
  for (let offset = 0; offset < 30; offset += 1) {
    const day = new Date(firstDay);
    day.setUTCDate(day.getUTCDate() + offset);
    const date = dateKey(day);
    byDate.set(date, { date, revenueCents: 0, executions: 0, newUsers: 0 });
  }

  for (const payment of payments) {
    const row = byDate.get(dateKey(payment.createdAt));
    if (row) row.revenueCents += payment.amountCents;
  }
  for (const execution of executions) {
    const row = byDate.get(dateKey(execution.createdAt));
    if (row) row.executions += 1;
  }
  for (const user of users) {
    const row = byDate.get(dateKey(user.createdAt));
    if (row) row.newUsers += 1;
  }

  return [...byDate.values()];
}

export function calculateRevenueChangePercent(currentCents: number, previousCents: number) {
  if (previousCents <= 0) return null;
  return Math.round(((currentCents - previousCents) / previousCents) * 1000) / 10;
}

export function averageExecutionsPerDay30d(executionCount: number) {
  return Math.round((executionCount / 30) * 10) / 10;
}

export function sumAdminExecutionCounts(counts: number[]) {
  return counts.reduce((total, count) => total + count, 0);
}

export function summarizeAdminRevenue(amounts: CurrencyAmount[]) {
  const totals = new Map<string, number>();

  for (const amount of amounts) {
    const currency = amount.currency.trim().toLowerCase();
    if (!currency) continue;
    totals.set(currency, (totals.get(currency) ?? 0) + amount.amountCents);
  }

  if (totals.size === 0) {
    return { amountCents: 0, currency: null, mixedCurrencies: false };
  }
  if (totals.size > 1) {
    return { amountCents: null, currency: null, mixedCurrencies: true };
  }

  const [entry] = totals.entries();
  return {
    amountCents: entry?.[1] ?? 0,
    currency: entry?.[0] ?? null,
    mixedCurrencies: false
  };
}

export function dedupeMarketplaceUserRegistrations(
  sources: MarketplaceUserSource[]
): AdminMarketplaceUserIdentity[] {
  const identities = new Map<
    string,
    AdminMarketplaceUserIdentity & { roleSet: Set<string> }
  >();

  for (const source of sources) {
    const marketplaceRegistrations: Array<{ role: string; createdAt: Date }> = [];
    if (source.role === "BUSINESS" || source.role === "ARCHITECT") {
      marketplaceRegistrations.push({ role: source.role, createdAt: source.createdAt });
    }
    for (const membership of source.roleMemberships) {
      if (membership.role === "BUSINESS" || membership.role === "ARCHITECT") {
        marketplaceRegistrations.push(membership);
      }
    }
    if (marketplaceRegistrations.length === 0) continue;

    const emailKey = source.email.trim().toLowerCase();
    if (!emailKey) continue;
    const sourceRegistrationDate = marketplaceRegistrations.reduce(
      (earliest, registration) =>
        registration.createdAt < earliest ? registration.createdAt : earliest,
      marketplaceRegistrations[0]!.createdAt
    );
    const existing = identities.get(emailKey);

    if (!existing) {
      const roleSet = new Set(marketplaceRegistrations.map((registration) => registration.role));
      identities.set(emailKey, {
        id: source.id,
        email: source.email.trim(),
        fullName: source.fullName,
        createdAt: sourceRegistrationDate,
        roles: [],
        roleSet
      });
      continue;
    }

    for (const registration of marketplaceRegistrations) {
      existing.roleSet.add(registration.role);
    }
    if (sourceRegistrationDate < existing.createdAt) {
      existing.id = source.id;
      existing.email = source.email.trim();
      existing.createdAt = sourceRegistrationDate;
    }
    if (!existing.fullName && source.fullName) existing.fullName = source.fullName;
  }

  return [...identities.values()]
    .map(({ roleSet, ...identity }) => ({
      ...identity,
      roles: [...roleSet].sort()
    }))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

function displayUser(user: { fullName: string | null; email: string }) {
  return user.fullName?.trim() || user.email;
}

export async function getAdminLiveSummaryData(now = new Date()) {
  const today = utcDayStart(now);
  const performanceStart = new Date(today);
  performanceStart.setUTCDate(performanceStart.getUTCDate() - 29);
  const previousPeriodStart = new Date(today);
  previousPeriodStart.setUTCDate(previousPeriodStart.getUTCDate() - 59);
  const thisWeekStart = startOfUtcWeek(now);

  const [
    marketplaceUserRows,
    lifetimeRevenueByCurrency,
    recentRevenuePayments,
    totalExecutionCounts,
    performanceExecutionSources,
    submittedListings,
    recentPayments,
    recentExecutions
  ] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [
          { role: { in: ["BUSINESS", "ARCHITECT"] } },
          { roleMemberships: { some: { role: { in: ["BUSINESS", "ARCHITECT"] } } } }
        ]
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
        roleMemberships: {
          where: { role: { in: ["BUSINESS", "ARCHITECT"] } },
          select: { role: true, createdAt: true }
        }
      }
    }),
    prisma.payment.groupBy({
      by: ["currency"],
      where: { status: "SUCCEEDED" },
      _sum: { amountCents: true }
    }),
    prisma.payment.findMany({
      where: { status: "SUCCEEDED", createdAt: { gte: previousPeriodStart } },
      select: { createdAt: true, amountCents: true, currency: true }
    }),
    // Keep the platform execution definition aligned with the Business
    // dashboard: one live booking, missed-call capture, or AI call is one
    // execution. WorkflowRun alone does not contain every live agent event.
    Promise.all([
      prisma.appointment.count({ where: { executionMode: "LIVE" } }),
      prisma.lead.count({ where: { source: { contains: "MISSED_CALL" } } }),
      prisma.vapiCall.count({ where: { executionMode: "LIVE" } })
    ]),
    Promise.all([
      prisma.appointment.findMany({
        where: { executionMode: "LIVE", createdAt: { gte: performanceStart } },
        select: { createdAt: true }
      }),
      prisma.lead.findMany({
        where: { source: { contains: "MISSED_CALL" }, createdAt: { gte: performanceStart } },
        select: { createdAt: true }
      }),
      prisma.vapiCall.findMany({
        where: { executionMode: "LIVE", createdAt: { gte: performanceStart } },
        select: { createdAt: true }
      })
    ]),
    prisma.agentListing.findMany({
      where: { submittedAt: { not: null } },
      orderBy: { submittedAt: "desc" },
      take: 12,
      select: {
        id: true,
        name: true,
        category: true,
        submittedAt: true,
        architect: { select: { email: true, fullName: true } }
      }
    }),
    prisma.payment.findMany({
      where: { status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        createdAt: true,
        amountCents: true,
        currency: true,
        description: true,
        listing: { select: { name: true } },
        user: { select: { email: true, fullName: true } }
      }
    }),
    prisma.workflowRun.findMany({
      where: { mode: "LIVE" },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        createdAt: true,
        status: true,
        workflow: { select: { name: true } },
        triggeredBy: { select: { email: true, fullName: true } },
        business: { select: { name: true, owner: { select: { email: true, fullName: true } } } }
      }
    })
  ]);

  const totalExecutions = sumAdminExecutionCounts(totalExecutionCounts);
  const performanceExecutions = performanceExecutionSources.flat();

  const marketplaceUsers = dedupeMarketplaceUserRegistrations(marketplaceUserRows);
  const totalUsers = marketplaceUsers.length;
  const totalArchitects = marketplaceUsers.filter((user) => user.roles.includes("ARCHITECT")).length;
  const newUsersThisWeek = marketplaceUsers.filter((user) => user.createdAt >= thisWeekStart).length;
  const performanceUsers = marketplaceUsers.filter((user) => user.createdAt >= performanceStart);
  const recentUsers = marketplaceUsers.slice(0, 12);

  const lifetimeRevenue = summarizeAdminRevenue(
    lifetimeRevenueByCurrency.map((row) => ({
      currency: row.currency,
      amountCents: row._sum.amountCents ?? 0
    }))
  );
  const recentRevenue = summarizeAdminRevenue(recentRevenuePayments);

  const currentPeriodRevenueCents = recentRevenuePayments
    .filter((payment) => payment.createdAt >= performanceStart)
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const previousPeriodRevenueCents = recentRevenuePayments
    .filter((payment) => payment.createdAt >= previousPeriodStart && payment.createdAt < performanceStart)
    .reduce((sum, payment) => sum + payment.amountCents, 0);

  const performance = buildAdminPerformance30d(
    now,
    recentRevenuePayments,
    performanceExecutions,
    performanceUsers
  ).map((day) => ({
    ...day,
    revenueCents: recentRevenue.mixedCurrencies ? null : day.revenueCents
  }));

  const recentActivity: AdminRecentActivity[] = [
    ...submittedListings.flatMap((listing) =>
      listing.submittedAt
        ? [{
            id: `agent:${listing.id}`,
            occurredAt: listing.submittedAt,
            type: "agent_submission" as const,
            event: "New agent submitted",
            user: displayUser(listing.architect),
            details: [listing.name, listing.category].filter(Boolean).join(" · ")
          }]
        : []
    ),
    ...recentPayments.map((payment) => ({
      id: `payment:${payment.id}`,
      occurredAt: payment.createdAt,
      type: "payment" as const,
      event: "Payment received",
      user: displayUser(payment.user),
      details: [
        payment.listing?.name ?? payment.description?.trim(),
        `${(payment.amountCents / 100).toFixed(2)} ${payment.currency.toUpperCase()}`
      ]
        .filter(Boolean)
        .join(" · ")
    })),
    ...recentUsers.map((user) => ({
      id: `user:${user.id}`,
      occurredAt: user.createdAt,
      type: "user_registration" as const,
      event: "User registered",
      user: displayUser(user),
      details: `${user.roles.join(" + ")} · ${user.email}`
    })),
    ...recentExecutions.map((execution) => {
      const activityUser = execution.triggeredBy ?? execution.business?.owner ?? null;
      return {
        id: `execution:${execution.id}`,
        occurredAt: execution.createdAt,
        type: "execution" as const,
        event: "Workflow executed",
        user: activityUser ? displayUser(activityUser) : "N/A",
        details: [execution.workflow.name, execution.business?.name, execution.status]
          .filter(Boolean)
          .join(" · ")
      };
    })
  ]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 12);

  return {
    totalUsers,
    totalArchitects,
    newUsersThisWeek,
    platformRevenueCents: lifetimeRevenue.amountCents,
    platformRevenueCurrency: lifetimeRevenue.currency,
    performanceRevenueCurrency: recentRevenue.currency,
    revenueChangePercent: recentRevenue.mixedCurrencies
      ? null
      : calculateRevenueChangePercent(currentPeriodRevenueCents, previousPeriodRevenueCents),
    totalExecutions,
    avgExecutionsPerDay30d: averageExecutionsPerDay30d(performanceExecutions.length),
    performance,
    recentActivity,
    platformHealth: {
      apiUptimePercent: null,
      avgResponseTimeMs: null,
      errorRatePercent: null
    }
  };
}
