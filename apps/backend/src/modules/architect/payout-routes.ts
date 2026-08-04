import { Hono } from "hono";
import Stripe from "stripe";
import { z } from "zod";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { getStripeClient, isStripeConfigured } from "../payments/stripe";
import { getArchitectBalances } from "../payouts/balance-service";
import { syncConnectedAccount } from "../payouts/connect-account";
import { payoutConfig, stripeLivemode } from "../payouts/config";
import { checkRateLimit } from "../payouts/rate-limit";
import { releaseEligibleEarnings } from "../payouts/settlements";
import { isLegalPayoutTransition, PAYOUT_TERMINAL, payoutStatusFromStripe } from "../payouts/state-machine";
import { logStripeError, normalizeStripeError } from "../payouts/stripe-errors";
import { findInstantPayoutDestination, requestArchitectPayout } from "../payouts/payout-service";
import {
  ARCHITECT_SHARE,
  loadArchitectEarnings,
  saleTransactionStatus,
  serializeArchitectSale,
  sumApprovedEarningsCents,
  sumPendingEarningsCents,
  effectiveEarningStatus
} from "./payout-earnings";
import { computeNextPayoutDate, normalizePayoutSchedule } from "./payout-schedule";

// Public Connect webhook (registered before auth in ./routes.ts) — the
// implementation lives with the other payout services.
export { handleStripeConnectWebhook } from "../payouts/connect-webhook";

export const architectPayoutRoutes = new Hono();

const payoutRequestSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  deliveryMethod: z.enum(["standard", "instant"]).default("standard"),
  /** Client-generated UUID; makes retries and double-clicks idempotent. */
  clientRequestId: z.string().trim().min(8).max(64)
});

const connectOnboardingSchema = z.object({
  country: z.enum(["US", "IN"]),
  accountHolderName: z.string().trim().min(2, "Account holder name is required")
});

const stripeScheduleSchema = z.object({
  interval: z.enum(["daily", "weekly", "monthly", "manual"]),
  weeklyAnchor: z
    .enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
    .optional(),
  monthlyAnchor: z.number().int().min(1).max(31).optional()
});

const earningsQuerySchema = z.object({
  listingIds: z.string().trim().optional()
});

function connectUrls() {
  const payoutsUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/architect/payouts`;
  return {
    returnUrl: env.STRIPE_CONNECT_RETURN_URL ?? `${payoutsUrl}?stripe_onboarding=complete`,
    refreshUrl: env.STRIPE_CONNECT_REFRESH_URL ?? `${payoutsUrl}?stripe_onboarding=refresh`
  };
}

function serializePayoutMethod(method: {
  bankName: string | null;
  accountHolderName: string | null;
  country: string;
  currency: string;
  accountLast4: string | null;
  routingLast4: string | null;
  stripeAccountId: string | null;
  verificationStatus: string;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason?: string | null;
  requirementsJson?: unknown;
  lastSyncedAt?: Date | null;
  createdAt: Date;
}) {
  const isIndia = method.country === "IN";
  const verified = method.verificationStatus === "VERIFIED" && method.payoutsEnabled;
  const requirements =
    method.requirementsJson && typeof method.requirementsJson === "object"
      ? (method.requirementsJson as { currentlyDue?: string[] })
      : null;

  return {
    bankName: method.bankName ?? "Stripe bank account",
    accountHolderName: method.accountHolderName ?? "",
    accountLast4: method.accountLast4 ?? "",
    country: method.country,
    currency: method.currency,
    routingLabel: isIndia ? "IFSC" : "ABA routing number",
    routingLast4: method.routingLast4,
    verificationStatus: method.verificationStatus,
    payoutsEnabled: method.payoutsEnabled,
    detailsSubmitted: method.detailsSubmitted,
    requiresAction: !verified,
    stripeConnected: Boolean(method.stripeAccountId),
    disabledReason: method.disabledReason ?? null,
    requirementsCurrentlyDue: requirements?.currentlyDue?.length ?? 0,
    lastSyncedAt: method.lastSyncedAt?.toISOString() ?? null,
    createdAt: method.createdAt.toISOString(),
    verified
  };
}

/**
 * Read-only refresh of non-terminal payouts that already have a Stripe payout
 * id. Never creates Stripe objects — money movement only happens in the payout
 * service and webhooks.
 */
async function refreshPendingPayoutStatuses(architectUserId: string) {
  const stripe = getStripeClient();
  if (!stripe) return;

  const method = await prisma.architectPayoutMethod.findUnique({ where: { architectUserId } });
  if (!method?.stripeAccountId) return;

  const pending = await prisma.architectPayout.findMany({
    where: {
      architectUserId,
      status: { notIn: PAYOUT_TERMINAL },
      stripePayoutId: { not: null }
    },
    take: 20
  });

  for (const record of pending) {
    try {
      const stripePayout = await stripe.payouts.retrieve(record.stripePayoutId as string, {}, {
        stripeAccount: record.stripeConnectedAccountId ?? method.stripeAccountId
      });
      const nextStatus = payoutStatusFromStripe(stripePayout.status);
      if (!isLegalPayoutTransition(record.status, nextStatus)) continue;

      await prisma.architectPayout.update({
        where: { id: record.id },
        data: {
          status: nextStatus,
          arrivalDate: stripePayout.arrival_date
            ? new Date(stripePayout.arrival_date * 1000)
            : record.arrivalDate,
          paidAt: nextStatus === "PAID" && !record.paidAt ? new Date() : record.paidAt,
          failedAt: nextStatus === "FAILED" && !record.failedAt ? new Date() : record.failedAt,
          failureCode: stripePayout.failure_code ?? record.failureCode
        }
      });
    } catch (error) {
      const normalized = normalizeStripeError(error, "payout.refresh");
      logStripeError(normalized, { architectUserId, payoutId: record.id });
    }
  }
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function parseListingIds(raw?: string) {
  if (!raw?.trim()) return undefined;
  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return ids.length ? ids : undefined;
}

async function computeArchitectPayoutSummary(
  architectUserId: string,
  options?: { listingIds?: string[] }
) {
  const listingIds = options?.listingIds;

  await syncConnectedAccount(architectUserId);
  await releaseEligibleEarnings(architectUserId);
  await refreshPendingPayoutStatuses(architectUserId);

  const [sales, payouts, listings, payoutMethod, profile] = await Promise.all([
    loadArchitectEarnings(architectUserId, { listingIds }),
    prisma.architectPayout.findMany({
      where: {
        architectUserId,
        status: { notIn: ["FAILED", "CANCELED"] }
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.agentListing.findMany({
      where: {
        architectUserId,
        status: "APPROVED",
        ...(listingIds?.length ? { id: { in: listingIds } } : {})
      },
      select: { id: true, name: true, priceCents: true }
    }),
    prisma.architectPayoutMethod.findUnique({
      where: { architectUserId }
    }),
    prisma.architectProfile.findUnique({
      where: { userId: architectUserId },
      select: { payoutSchedule: true }
    })
  ]);

  const balances = await getArchitectBalances(architectUserId, payoutMethod?.stripeAccountId ?? null);
  const payoutCurrency = (payoutMethod?.currency ?? payoutConfig.defaultPayoutCurrency).toLowerCase();
  const stripeBucket = balances.stripe[payoutCurrency] ?? {
    availableCents: 0,
    pendingCents: 0,
    instantAvailableCents: 0
  };

  const approvedSales = sales.filter((sale) => effectiveEarningStatus(sale) === "APPROVED");
  const totalEarningsCents = sumApprovedEarningsCents(approvedSales);
  const grossSalesCents = approvedSales.reduce((sum, sale) => sum + sale.grossCents, 0);
  const platformFeeCents = Math.max(0, grossSalesCents - totalEarningsCents);
  const pendingCents = sumPendingEarningsCents(sales);

  // Withdrawable = released-but-untransferred ledger earnings plus the fresh
  // Stripe available balance, minus reservations that have not reached Stripe
  // yet. Payouts already created at Stripe have deducted their funds there.
  const reservedNotAtStripe = payouts
    .filter((payout) => !payout.stripePayoutId && ["PENDING", "RESERVED", "PROCESSING"].includes(payout.status))
    .reduce((sum, payout) => sum + payout.amountCents, 0);
  const availableBalanceCents = Math.max(
    0,
    balances.internal.availableEarningsCents + stripeBucket.availableCents - reservedNotAtStripe
  );

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthSales = sales.filter(
    (sale) => sale.createdAt >= monthStart && effectiveEarningStatus(sale) === "APPROVED"
  );
  const thisMonthEarningsCents = sumApprovedEarningsCents(thisMonthSales);

  const payoutSchedule = normalizePayoutSchedule(profile?.payoutSchedule);
  const scheduledFor = computeNextPayoutDate(payoutSchedule, now);

  const chartPoints = Array.from({ length: 12 }).map((_, index) => {
    const offset = 11 - index;
    const pointDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const nextMonth = new Date(pointDate.getFullYear(), pointDate.getMonth() + 1, 1);
    const monthSales = sales.filter(
      (sale) => sale.createdAt >= pointDate && sale.createdAt < nextMonth
    );
    return {
      label: pointDate.toLocaleDateString("en-US", { month: "short" }),
      confirmedCents: sumApprovedEarningsCents(monthSales),
      pendingCents: sumPendingEarningsCents(monthSales)
    };
  });

  const listingBreakdown = listings.map((listing) => {
    const listingSales = sales.filter((sale) => sale.listingId === listing.id);
    const approvedSales = listingSales.filter((sale) => effectiveEarningStatus(sale) === "APPROVED");
    return {
      listingId: listing.id,
      listingName: listing.name,
      priceCents: listing.priceCents,
      installCount: approvedSales.length,
      grossCents: approvedSales.reduce((sum, sale) => sum + sale.grossCents, 0),
      earningsCents: sumApprovedEarningsCents(approvedSales)
    };
  });

  const instantDestination = payoutMethod?.stripeAccountId
    ? await findInstantPayoutDestination(payoutMethod.stripeAccountId, payoutCurrency)
    : null;

  return {
    totalEarningsCents,
    availableBalanceCents,
    pendingCents,
    thisMonthEarningsCents,
    thisMonthLabel: formatMonthLabel(now),
    thisMonthSalesCount: thisMonthSales.length,
    totalSalesCount: sales.length,
    agentCount: listings.length,
    architectSharePercent: Math.round(ARCHITECT_SHARE * 100),
    sales: sales.map(serializeArchitectSale),
    listingBreakdown,
    payoutSchedule,
    // Ledger + Stripe accounting so the UI can explain the difference between
    // internal earnings and the actually withdrawable Stripe balance.
    balances: {
      unreleasedEarningsCents: balances.internal.unreleasedEarningsCents,
      availableEarningsCents: balances.internal.availableEarningsCents,
      transferredEarningsCents: balances.internal.transferredEarningsCents,
      payoutsInTransitCents: balances.internal.payoutsInTransitCents,
      paidOutCents: balances.internal.paidOutCents,
      stripeAvailableCents: stripeBucket.availableCents,
      stripePendingCents: stripeBucket.pendingCents,
      stripeInstantAvailableCents: stripeBucket.instantAvailableCents,
      currency: payoutCurrency
    },
    chart: {
      period: "12M",
      points: chartPoints
    },
    nextPayout: {
      amountCents: availableBalanceCents,
      scheduledFor: scheduledFor.toISOString(),
      grossSalesCents,
      platformFeeCents,
      earningsCents: totalEarningsCents
    },
    instantPayout: {
      eligible: Boolean(instantDestination),
      destinationType: instantDestination?.object ?? null,
      destinationLast4: instantDestination?.last4 ?? null
    },
    payoutMethod: payoutMethod ? serializePayoutMethod(payoutMethod) : null
  };
}

architectPayoutRoutes.get("/earnings", async (c) => {
  try {
    const authUser = c.get("authUser");
    const query = earningsQuerySchema.parse({
      listingIds: c.req.query("listingIds")
    });
    const listingIds = parseListingIds(query.listingIds);
    const sales = await loadArchitectEarnings(authUser.id, { listingIds });

    return successResponse(c, {
      sales: sales.map(serializeArchitectSale),
      totals: {
        salesCount: sales.length,
        grossCents: sales.reduce((sum, sale) => sum + sale.grossCents, 0),
        earningsCents: sumApprovedEarningsCents(sales),
        architectSharePercent: Math.round(ARCHITECT_SHARE * 100)
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid earnings query",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not load architect earnings", 500, "PAYOUT_EARNINGS_FAILED");
  }
});

architectPayoutRoutes.get("/summary", async (c) => {
  try {
    const authUser = c.get("authUser");
    const listingIds = parseListingIds(c.req.query("listingIds"));
    const summary = await computeArchitectPayoutSummary(authUser.id, { listingIds });
    return successResponse(c, summary, "Payout summary loaded");
  } catch (error) {
    console.error("[payouts] summary failed", error);
    return errorResponse(c, "Could not load payout summary", 500, "PAYOUT_SUMMARY_FAILED");
  }
});

architectPayoutRoutes.get("/balance", async (c) => {
  try {
    const authUser = c.get("authUser");
    const method = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });
    const balances = await getArchitectBalances(authUser.id, method?.stripeAccountId ?? null);
    return successResponse(c, balances);
  } catch (error) {
    console.error("[payouts] balance failed", error);
    return errorResponse(c, "Could not load payout balance", 500, "PAYOUT_BALANCE_FAILED");
  }
});

// Legacy IFSC directory check — still used by the settings UI for display
// validation. Read-only; carries no account numbers.
architectPayoutRoutes.get("/verify-ifsc/:code", async (c) => {
  try {
    const code = c.req.param("code").trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
      return errorResponse(c, "Invalid IFSC format", 422, "INVALID_IFSC_FORMAT");
    }

    const response = await fetch(`https://ifsc.razorpay.com/${code}`);
    if (!response.ok) return errorResponse(c, "IFSC code not found", 404, "IFSC_NOT_FOUND");
    const data = (await response.json()) as { BANK?: string; BRANCH?: string; CITY?: string; STATE?: string };
    return successResponse(c, {
      valid: true,
      ifscCode: code,
      bankName: data.BANK ?? "",
      branch: data.BRANCH ?? "",
      city: data.CITY ?? "",
      state: data.STATE ?? ""
    });
  } catch {
    return errorResponse(c, "Could not verify IFSC code", 500, "IFSC_VERIFY_FAILED");
  }
});

architectPayoutRoutes.get("/method", async (c) => {
  try {
    const authUser = c.get("authUser");
    const payoutMethod = await syncConnectedAccount(authUser.id);

    if (!payoutMethod) {
      return successResponse(c, { payoutMethod: null }, "No payout method on file");
    }

    return successResponse(c, {
      payoutMethod: serializePayoutMethod(payoutMethod)
    });
  } catch (error) {
    console.error("[payouts] method load failed", error);
    return errorResponse(c, "Could not load your payout method", 500, "PAYOUT_METHOD_LOAD_FAILED");
  }
});

architectPayoutRoutes.get("/connect/status", async (c) => {
  try {
    const authUser = c.get("authUser");
    const method = await syncConnectedAccount(authUser.id);

    return successResponse(c, {
      connected: Boolean(method?.stripeAccountId),
      livemode: stripeLivemode(),
      modeMismatch: Boolean(method?.stripeAccountId && method.livemode !== stripeLivemode()),
      payoutMethod: method ? serializePayoutMethod(method) : null
    });
  } catch (error) {
    console.error("[payouts] connect status failed", error);
    return errorResponse(c, "Could not load Stripe Connect status", 500, "CONNECT_STATUS_FAILED");
  }
});

architectPayoutRoutes.post("/connect/onboarding", async (c) => {
  try {
    const authUser = c.get("authUser");
    if (!checkRateLimit(`connect-link:${authUser.id}`, 5, 60_000)) {
      return errorResponse(c, "Too many onboarding attempts. Try again in a minute.", 429, "RATE_LIMITED");
    }

    const input = connectOnboardingSchema.parse(await c.req.json());
    const stripe = getStripeClient();

    if (!stripe || !isStripeConfigured()) {
      return errorResponse(c, "Stripe Connect is not configured", 503, "STRIPE_NOT_CONFIGURED");
    }

    const existing = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });

    // Wrong-mode accounts require an explicit repair path — never silently
    // create a second account for the same architect.
    if (existing?.stripeAccountId && existing.livemode !== stripeLivemode()) {
      console.error("[payouts] onboarding blocked by mode mismatch", {
        architectUserId: authUser.id,
        storedLivemode: existing.livemode
      });
      return errorResponse(
        c,
        "Your payout account belongs to a different Stripe mode. Contact support to reconnect it.",
        409,
        "STRIPE_MODE_MISMATCH"
      );
    }

    let stripeAccountId =
      existing?.stripeAccountId && existing.country === input.country
        ? existing.stripeAccountId
        : null;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create(
        {
          type: "express",
          country: input.country,
          email: authUser.email,
          business_type: "individual",
          capabilities: { transfers: { requested: true } },
          // Manual payout schedule: the architect withdraws through Triven
          // (standard or instant); automatic sweeps would race manual payouts.
          settings: { payouts: { schedule: { interval: "manual" } } },
          metadata: { architectUserId: authUser.id, product: "core_architect_payouts" }
        },
        { idempotencyKey: `connect-account:${authUser.id}:${input.country}:${stripeLivemode() ? "live" : "test"}` }
      );
      stripeAccountId = account.id;
    }

    await prisma.architectPayoutMethod.upsert({
      where: { architectUserId: authUser.id },
      update: {
        accountHolderName: input.accountHolderName,
        country: input.country,
        currency: input.country === "IN" ? "inr" : "usd",
        stripeAccountId,
        verificationStatus: "REQUIRES_ACTION",
        payoutsEnabled: false,
        detailsSubmitted: false,
        livemode: stripeLivemode(),
        accountNumber: null,
        ifscCode: null
      },
      create: {
        architectUserId: authUser.id,
        accountHolderName: input.accountHolderName,
        country: input.country,
        currency: input.country === "IN" ? "inr" : "usd",
        stripeAccountId,
        livemode: stripeLivemode(),
        verificationStatus: "REQUIRES_ACTION"
      }
    });

    const { returnUrl, refreshUrl } = connectUrls();
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
      collection_options: { fields: "eventually_due" }
    });

    return successResponse(c, {
      url: accountLink.url,
      expiresAt: new Date(accountLink.expires_at * 1000).toISOString(),
      stripeAccountId
    }, "Stripe onboarding link created");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid payout country",
        422,
        "VALIDATION_ERROR"
      );
    }

    const normalized = normalizeStripeError(error, "connect.onboarding");
    logStripeError(normalized, { route: "connect/onboarding" });
    return errorResponse(c, normalized.userMessage, normalized.httpStatus, normalized.code);
  }
});

architectPayoutRoutes.post("/connect/refresh", async (c) => {
  try {
    const authUser = c.get("authUser");
    if (!checkRateLimit(`connect-link:${authUser.id}`, 5, 60_000)) {
      return errorResponse(c, "Too many onboarding attempts. Try again in a minute.", 429, "RATE_LIMITED");
    }

    const method = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });

    if (!method?.stripeAccountId) {
      return errorResponse(c, "Start Stripe onboarding first", 404, "CONNECT_ACCOUNT_NOT_FOUND");
    }

    const stripe = getStripeClient();
    if (!stripe) {
      return errorResponse(c, "Stripe Connect is not configured", 503, "STRIPE_NOT_CONFIGURED");
    }

    const { returnUrl, refreshUrl } = connectUrls();
    const accountLink = await stripe.accountLinks.create({
      account: method.stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
      collection_options: { fields: "eventually_due" }
    });

    return successResponse(c, { url: accountLink.url }, "Stripe onboarding link refreshed");
  } catch (error) {
    const normalized = normalizeStripeError(error, "connect.refresh");
    logStripeError(normalized, { route: "connect/refresh" });
    return errorResponse(c, normalized.userMessage, normalized.httpStatus, normalized.code);
  }
});

// Stripe Express dashboard link — the safe way to manage bank accounts and
// debit cards. Stripe collects the details; Triven never sees them.
architectPayoutRoutes.post("/connect/dashboard-link", async (c) => {
  try {
    const authUser = c.get("authUser");
    if (!checkRateLimit(`connect-link:${authUser.id}`, 5, 60_000)) {
      return errorResponse(c, "Too many attempts. Try again in a minute.", 429, "RATE_LIMITED");
    }

    const method = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });
    if (!method?.stripeAccountId) {
      return errorResponse(c, "Connect your payout account with Stripe first", 404, "CONNECT_ACCOUNT_NOT_FOUND");
    }

    const stripe = getStripeClient();
    if (!stripe) {
      return errorResponse(c, "Stripe Connect is not configured", 503, "STRIPE_NOT_CONFIGURED");
    }

    const loginLink = await stripe.accounts.createLoginLink(method.stripeAccountId);
    return successResponse(c, { url: loginLink.url }, "Stripe dashboard link created");
  } catch (error) {
    const normalized = normalizeStripeError(error, "connect.dashboard-link");
    logStripeError(normalized, { route: "connect/dashboard-link" });
    return errorResponse(c, normalized.userMessage, normalized.httpStatus, normalized.code);
  }
});

architectPayoutRoutes.post("/method/sync", async (c) => {
  try {
    const authUser = c.get("authUser");
    const payoutMethod = await syncConnectedAccount(authUser.id);

    return successResponse(c, {
      payoutMethod: payoutMethod ? serializePayoutMethod(payoutMethod) : null
    }, "Payout method synced");
  } catch (error) {
    console.error("[payouts] method sync failed", error);
    return errorResponse(c, "Could not sync your payout method", 500, "PAYOUT_METHOD_SYNC_FAILED");
  }
});

// Raw bank-detail entry is retired: Stripe collects account numbers through
// hosted onboarding / the Express dashboard. Triven's backend never accepts
// full bank account or routing numbers anymore.
architectPayoutRoutes.put("/method", async (c) => {
  return errorResponse(
    c,
    "Bank details are now added securely through Stripe. Use “Connect with Stripe” instead.",
    410,
    "PAYOUT_METHOD_DIRECT_ENTRY_DISABLED"
  );
});

architectPayoutRoutes.put("/method/backup", async (c) => {
  return errorResponse(
    c,
    "Backup bank accounts are managed in your Stripe payout dashboard now.",
    410,
    "PAYOUT_METHOD_DIRECT_ENTRY_DISABLED"
  );
});

architectPayoutRoutes.post("/method/backup/primary", async (c) => {
  try {
    const authUser = c.get("authUser");
    const [primary, backup] = await Promise.all([
      prisma.architectPayoutMethod.findUnique({ where: { architectUserId: authUser.id } }),
      prisma.architectBackupPayoutMethod.findUnique({ where: { architectUserId: authUser.id } })
    ]);
    if (!primary || !backup) {
      return errorResponse(c, "Primary and backup payout methods are required", 422, "PAYOUT_METHODS_REQUIRED");
    }

    const stripe = getStripeClient();
    if (!stripe || !isStripeConfigured() || !primary.stripeAccountId || !backup.stripeExternalAccountId) {
      return errorResponse(c, "Stripe payout method is not ready", 422, "STRIPE_PAYOUT_METHOD_NOT_READY");
    }

    // Both rows reference the same connected account — this only switches the
    // default external account; no bank details transit Triven.
    await stripe.accounts.updateExternalAccount(
      primary.stripeAccountId,
      backup.stripeExternalAccountId,
      { default_for_currency: true }
    );

    const [nextPrimary, nextBackup] = await prisma.$transaction([
      prisma.architectPayoutMethod.update({
        where: { architectUserId: authUser.id },
        data: {
          bankName: backup.bankName,
          accountHolderName: backup.accountHolderName,
          country: backup.country,
          currency: backup.currency,
          accountLast4: backup.accountLast4,
          routingLast4: backup.routingLast4,
          stripeExternalAccountId: backup.stripeExternalAccountId,
          verificationStatus: backup.verificationStatus
        }
      }),
      prisma.architectBackupPayoutMethod.update({
        where: { architectUserId: authUser.id },
        data: {
          bankName: primary.bankName,
          accountHolderName: primary.accountHolderName,
          country: primary.country,
          currency: primary.currency,
          accountLast4: primary.accountLast4,
          routingLast4: primary.routingLast4,
          stripeAccountId: primary.stripeAccountId,
          stripeExternalAccountId: primary.stripeExternalAccountId,
          verificationStatus: primary.verificationStatus
        }
      })
    ]);

    return successResponse(c, {
      payoutMethod: serializePayoutMethod(nextPrimary),
      backupPayoutMethod: nextBackup
    }, "Primary payout method updated");
  } catch (error) {
    const normalized = normalizeStripeError(error, "method.backup-primary");
    logStripeError(normalized, { route: "method/backup/primary" });
    return errorResponse(c, normalized.userMessage, normalized.httpStatus, normalized.code);
  }
});

architectPayoutRoutes.get("/schedule", async (c) => {
  try {
    const authUser = c.get("authUser");
    const method = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });
    if (!method?.stripeAccountId) {
      return errorResponse(c, "Connect your payout account with Stripe first", 404, "CONNECT_ACCOUNT_NOT_FOUND");
    }
    const stripe = getStripeClient();
    if (!stripe) {
      return errorResponse(c, "Stripe Connect is not configured", 503, "STRIPE_NOT_CONFIGURED");
    }

    const account = await stripe.accounts.retrieve(method.stripeAccountId);
    const schedule = account.settings?.payouts?.schedule;
    return successResponse(c, {
      interval: schedule?.interval ?? "manual",
      weeklyAnchor: schedule?.weekly_anchor ?? null,
      monthlyAnchor: schedule?.monthly_anchor ?? null,
      delayDays: schedule?.delay_days ?? null
    });
  } catch (error) {
    const normalized = normalizeStripeError(error, "schedule.get");
    logStripeError(normalized, { route: "schedule" });
    return errorResponse(c, normalized.userMessage, normalized.httpStatus, normalized.code);
  }
});

architectPayoutRoutes.patch("/schedule", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = stripeScheduleSchema.parse(await c.req.json());

    const method = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });
    if (!method?.stripeAccountId) {
      return errorResponse(c, "Connect your payout account with Stripe first", 404, "CONNECT_ACCOUNT_NOT_FOUND");
    }
    if (method.livemode !== stripeLivemode()) {
      return errorResponse(c, "Your payout account belongs to a different Stripe mode.", 409, "STRIPE_MODE_MISMATCH");
    }
    if (!method.payoutsEnabled) {
      return errorResponse(c, "Complete Stripe verification before changing the payout schedule.", 422, "CONNECT_PAYOUTS_DISABLED");
    }

    const stripe = getStripeClient();
    if (!stripe) {
      return errorResponse(c, "Stripe Connect is not configured", 503, "STRIPE_NOT_CONFIGURED");
    }

    const account = await stripe.accounts.update(method.stripeAccountId, {
      settings: {
        payouts: {
          schedule: {
            interval: input.interval,
            ...(input.interval === "weekly" && input.weeklyAnchor ? { weekly_anchor: input.weeklyAnchor } : {}),
            ...(input.interval === "monthly" && input.monthlyAnchor ? { monthly_anchor: input.monthlyAnchor } : {})
          }
        }
      }
    });

    const schedule = account.settings?.payouts?.schedule;
    return successResponse(c, {
      interval: schedule?.interval ?? input.interval,
      weeklyAnchor: schedule?.weekly_anchor ?? null,
      monthlyAnchor: schedule?.monthly_anchor ?? null,
      delayDays: schedule?.delay_days ?? null
    }, "Payout schedule updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid schedule", 422, "VALIDATION_ERROR");
    }
    const normalized = normalizeStripeError(error, "schedule.patch");
    logStripeError(normalized, { route: "schedule" });
    return errorResponse(c, normalized.userMessage, normalized.httpStatus, normalized.code);
  }
});

architectPayoutRoutes.get("/transactions", async (c) => {
  try {
    const authUser = c.get("authUser");
    await refreshPendingPayoutStatuses(authUser.id);
    const type = c.req.query("type") ?? "all";
    const range = c.req.query("range") ?? "all";
    const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
    const perPage = Math.min(50, Math.max(1, Number(c.req.query("perPage") ?? "10") || 10));
    const listingIds = parseListingIds(c.req.query("listingIds"));

    const [sales, payouts, payoutMethod] = await Promise.all([
      loadArchitectEarnings(authUser.id, { listingIds }),
      prisma.architectPayout.findMany({
        where: { architectUserId: authUser.id },
        orderBy: { createdAt: "desc" }
      }),
      prisma.architectPayoutMethod.findUnique({
        where: { architectUserId: authUser.id }
      })
    ]);

    const accountMask = payoutMethod?.accountLast4
      ? `•••• ${payoutMethod.accountLast4}`
      : "bank account";

    const saleTransactions = sales.map((sale) => ({
      id: sale.paymentId,
      paymentId: sale.paymentId,
      listingId: sale.listingId,
      installId: sale.installId,
      date: sale.createdAt.toISOString(),
      description: `${sale.listingName} — sold to ${sale.businessName}`,
      type: "Sale" as const,
      amountCents: sale.earningsCents,
      status: saleTransactionStatus(sale)
    }));

    const payoutTransactions = payouts.map((payout) => ({
      id: payout.id,
      paymentId: null,
      listingId: null,
      installId: null,
      date: payout.createdAt.toISOString(),
      description: `Payout → ${payout.destinationLast4 ? `•••• ${payout.destinationLast4}` : accountMask}`,
      type: "Payout" as const,
      amountCents: -payout.amountCents,
      status:
        payout.status === "COMPLETED" || payout.status === "PAID"
          ? ("Completed" as const)
          : payout.status === "FAILED" || payout.status === "CANCELED" || payout.status === "REVERSED"
            ? ("Failed" as const)
            : ("Processing" as const)
    }));

    let transactions = [...saleTransactions, ...payoutTransactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    if (type !== "all") {
      transactions = transactions.filter((transaction) => transaction.type === type);
    }

    if (range !== "all") {
      const days = range === "30" ? 30 : 90;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      transactions = transactions.filter((transaction) => new Date(transaction.date).getTime() >= cutoff);
    }

    const total = transactions.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * perPage;
    const items = transactions.slice(start, start + perPage);

    return successResponse(c, {
      transactions: items,
      pagination: {
        page: safePage,
        perPage,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error("[payouts] transactions failed", error);
    return errorResponse(c, "Could not load payout transactions", 500, "PAYOUT_TRANSACTIONS_FAILED");
  }
});

architectPayoutRoutes.post("/request", async (c) => {
  try {
    const authUser = c.get("authUser");
    if (!checkRateLimit(`payout-request:${authUser.id}`, 5, 60_000)) {
      return errorResponse(c, "Too many payout requests. Try again in a minute.", 429, "RATE_LIMITED");
    }

    const input = payoutRequestSchema.parse(await c.req.json());

    const result = await requestArchitectPayout({
      architectUserId: authUser.id,
      amountCents: input.amountCents,
      deliveryMethod: input.deliveryMethod,
      clientRequestId: input.clientRequestId
    });

    if (!result.ok) {
      return errorResponse(c, result.userMessage, result.httpStatus as never, result.code);
    }

    const payout = await prisma.architectPayout.findUnique({ where: { id: result.payoutId } });
    const summary = await computeArchitectPayoutSummary(authUser.id);

    return successResponse(
      c,
      {
        payout: payout
          ? {
              id: payout.id,
              amountCents: payout.amountCents,
              deliveryMethod: payout.deliveryMethod,
              status: payout.status,
              expectedArrival: payout.arrivalDate?.toISOString() ?? null,
              duplicate: result.duplicate,
              createdAt: payout.createdAt.toISOString()
            }
          : null,
        summary
      },
      result.duplicate ? "Payout request already received" : "Stripe payout requested"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid payout request",
        422,
        "VALIDATION_ERROR"
      );
    }

    console.error("[payouts] request failed", error);
    return errorResponse(c, "Could not request payout", 500, "PAYOUT_REQUEST_FAILED");
  }
});
