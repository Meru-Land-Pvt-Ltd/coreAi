import { Hono, type Context } from "hono";
import Stripe from "stripe";
import { z } from "zod";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { getStripeClient, isStripeConfigured } from "../payments/stripe";
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

export const architectPayoutRoutes = new Hono();

export async function handleStripeConnectWebhook(c: Context) {
  const stripe = getStripeClient();
  const signature = c.req.header("stripe-signature");

  if (!stripe || !env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    return errorResponse(c, "Stripe Connect webhook is not configured", 503, "STRIPE_WEBHOOK_NOT_CONFIGURED");
  }

  if (!signature) {
    return errorResponse(c, "Missing Stripe signature", 400, "STRIPE_SIGNATURE_MISSING");
  }

  try {
    const rawBody = await c.req.text();
    const event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_CONNECT_WEBHOOK_SECRET
    );

    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const method = await prisma.architectPayoutMethod.findUnique({
        where: { stripeAccountId: account.id }
      });
      if (method) await syncStripePayoutMethod(method.architectUserId);
    }

    if (event.type === "account.external_account.updated" && event.account) {
      const method = await prisma.architectPayoutMethod.findUnique({
        where: { stripeAccountId: event.account }
      });
      if (method) await syncStripePayoutMethod(method.architectUserId);
    }

    if (["payout.created", "payout.updated", "payout.paid", "payout.failed"].includes(event.type)) {
      const stripePayout = event.data.object as Stripe.Payout;
      const appPayoutId = stripePayout.metadata?.appPayoutId;
      const record = appPayoutId
        ? await prisma.architectPayout.findUnique({ where: { id: appPayoutId } })
        : await prisma.architectPayout.findUnique({ where: { stripePayoutId: stripePayout.id } });

      if (record) {
        await prisma.architectPayout.update({
          where: { id: record.id },
          data: {
            stripePayoutId: stripePayout.id,
            status: stripePayoutStatus(stripePayout.status),
            arrivalDate: stripePayout.arrival_date
              ? new Date(stripePayout.arrival_date * 1000)
              : null,
            failureCode: stripePayout.failure_code ?? null,
            failureMessage: stripePayout.failure_message ?? null
          }
        });
      }
    }

    return successResponse(c, { received: true });
  } catch (error) {
    return errorResponse(c, stripeErrorMessage(error), 400, "STRIPE_WEBHOOK_INVALID");
  }
}

const connectOnboardingSchema = z.object({
  country: z.enum(["US", "IN"]),
  accountHolderName: z.string().trim().min(2, "Account holder name is required")
});

const directPayoutMethodSchema = z
  .object({
    country: z.enum(["US", "IN"]),
    bankName: z.string().trim().min(2, "Bank name is required"),
    accountHolderName: z.string().trim().min(2, "Account holder name is required"),
    accountNumber: z.string().trim().min(4).max(34).regex(/^\d+$/, "Account number must contain digits only"),
    confirmAccountNumber: z.string().trim(),
    routingNumber: z.string().trim().toUpperCase()
  })
  .refine((input) => input.accountNumber === input.confirmAccountNumber, {
    message: "Account numbers do not match",
    path: ["confirmAccountNumber"]
  })
  .refine(
    (input) => input.country === "IN"
      ? /^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.routingNumber)
      : /^\d{9}$/.test(input.routingNumber),
    { message: "Invalid bank routing number", path: ["routingNumber"] }
  );

const payoutRequestSchema = z.object({
  amountCents: z.number().int().positive().optional()
});

const earningsQuerySchema = z.object({
  listingIds: z.string().trim().optional()
});

function legacyAccountLast4(accountNumber?: string | null) {
  return accountNumber?.replace(/\D/g, "").slice(-4) ?? "";
}

function stripeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Stripe could not complete the request";
}

function stripePayoutStatus(status: Stripe.Payout["status"]) {
  if (status === "paid") return "COMPLETED" as const;
  if (status === "failed" || status === "canceled") return "FAILED" as const;
  return "PROCESSING" as const;
}

function serializePayoutMethod(method: {
  bankName: string | null;
  accountHolderName: string | null;
  accountNumber: string | null;
  ifscCode: string | null;
  country: string;
  currency: string;
  accountLast4: string | null;
  routingLast4: string | null;
  stripeAccountId: string | null;
  verificationStatus: string;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  createdAt: Date;
}) {
  const isIndia = method.country === "IN";
  const accountLast4 = method.accountLast4 ?? legacyAccountLast4(method.accountNumber);
  const routingLast4 = method.routingLast4 ?? (method.ifscCode ? method.ifscCode.slice(-4) : null);
  const verified = method.verificationStatus === "VERIFIED" && method.payoutsEnabled;

  return {
    bankName: method.bankName ?? "Stripe bank account",
    accountHolderName: method.accountHolderName ?? "",
    accountLast4,
    country: method.country,
    currency: method.currency,
    routingLabel: isIndia ? "IFSC" : "ABA routing number",
    routingLast4,
    verificationStatus: method.verificationStatus,
    payoutsEnabled: method.payoutsEnabled,
    detailsSubmitted: method.detailsSubmitted,
    requiresAction: !verified,
    stripeConnected: Boolean(method.stripeAccountId),
    createdAt: method.createdAt.toISOString(),
    verified
  };
}

async function syncStripePayoutMethod(architectUserId: string) {
  const method = await prisma.architectPayoutMethod.findUnique({ where: { architectUserId } });
  if (!method?.stripeAccountId) return method;

  const stripe = getStripeClient();
  if (!stripe) return method;

  try {
    const account = await stripe.accounts.retrieve(method.stripeAccountId);
    const externalAccounts = await stripe.accounts.listExternalAccounts(method.stripeAccountId, {
      object: "bank_account",
      limit: 1
    });
    const bank = externalAccounts.data.find(
      (item): item is Stripe.BankAccount => item.object === "bank_account"
    );
    const bankFailed = bank?.status === "errored" || bank?.status === "verification_failed";
    const requirementsDue = (account.requirements?.currently_due?.length ?? 0) > 0;
    const transfersActive = account.capabilities?.transfers === "active";
    const verified = Boolean(
      account.payouts_enabled && transfersActive && bank && !bankFailed && !requirementsDue
    );
    const verificationStatus = bankFailed
      ? "FAILED"
      : verified
        ? "VERIFIED"
        : account.details_submitted
          ? "PENDING"
          : "REQUIRES_ACTION";

    return await prisma.architectPayoutMethod.update({
      where: { architectUserId },
      data: {
        bankName: bank?.bank_name ?? method.bankName,
        accountLast4: bank?.last4 ?? method.accountLast4,
        routingLast4: bank?.routing_number?.slice(-4) ?? method.routingLast4,
        stripeExternalAccountId: bank?.id ?? method.stripeExternalAccountId,
        country: account.country ?? method.country,
        currency: bank?.currency ?? account.default_currency ?? method.currency,
        verificationStatus,
        payoutsEnabled: Boolean(account.payouts_enabled),
        detailsSubmitted: Boolean(account.details_submitted),
        // Remove legacy credentials as soon as Stripe Connect owns this method.
        accountNumber: null,
        ifscCode: null
      }
    });
  } catch (error) {
    console.error("[stripe-connect] Could not sync connected account", {
      architectUserId,
      error: stripeErrorMessage(error)
    });
    return method;
  }
}

async function syncStripePayoutRecords(architectUserId: string) {
  const stripe = getStripeClient();
  if (!stripe) return;

  const method = await prisma.architectPayoutMethod.findUnique({ where: { architectUserId } });
  if (!method?.stripeAccountId) return;

  const payouts = await prisma.architectPayout.findMany({
    where: { architectUserId, status: { in: ["PENDING", "PROCESSING"] } }
  });

  for (const record of payouts) {
    try {
      let stripePayout: Stripe.Payout;

      if (record.stripePayoutId) {
        stripePayout = await stripe.payouts.retrieve(record.stripePayoutId, {}, {
          stripeAccount: method.stripeAccountId
        });
      } else if (record.stripeTransferId) {
        stripePayout = await stripe.payouts.create(
          {
            amount: record.amountCents,
            currency: record.currency,
            description: `CORE architect payout ${record.id}`,
            metadata: { architectUserId, appPayoutId: record.id }
          },
          {
            stripeAccount: method.stripeAccountId,
            idempotencyKey: `architect-payout-${record.id}`
          }
        );
      } else {
        continue;
      }

      await prisma.architectPayout.update({
        where: { id: record.id },
        data: {
          stripePayoutId: stripePayout.id,
          status: stripePayoutStatus(stripePayout.status),
          arrivalDate: stripePayout.arrival_date
            ? new Date(stripePayout.arrival_date * 1000)
            : null,
          failureCode: stripePayout.failure_code ?? null,
          failureMessage: stripePayout.failure_message ?? null
        }
      });
    } catch (error) {
      // A transfer can be pending before it becomes available for the connected
      // account payout. Keep it processing; the next summary/transaction load retries.
      await prisma.architectPayout.update({
        where: { id: record.id },
        data: { status: "PROCESSING", failureMessage: stripeErrorMessage(error) }
      });
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

  await syncStripePayoutMethod(architectUserId);
  await syncStripePayoutRecords(architectUserId);

  const [sales, payouts, listings, payoutMethod, profile] = await Promise.all([
    loadArchitectEarnings(architectUserId, { listingIds }),
    prisma.architectPayout.findMany({
      where: {
        architectUserId,
        status: { not: "FAILED" }
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

  const totalEarningsCents = sumApprovedEarningsCents(sales);
  const pendingCents = sumPendingEarningsCents(sales);
  // Reserve processing Stripe payouts as well as paid payouts, preventing a
  // double request while Stripe is moving the same earnings to the bank.
  const committedPayoutCents = payouts.reduce((sum, payout) => sum + payout.amountCents, 0);
  const availableBalanceCents = Math.max(0, totalEarningsCents - committedPayoutCents);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthSales = sales.filter(
    (sale) => sale.createdAt >= monthStart && effectiveEarningStatus(sale) === "APPROVED"
  );
  const thisMonthEarningsCents = sumApprovedEarningsCents(thisMonthSales);

  const grossAvailableCents = Math.round(availableBalanceCents / ARCHITECT_SHARE);
  const platformFeeCents = Math.max(0, grossAvailableCents - availableBalanceCents);
  // Next payout date reflects the architect-selected schedule (Settings →
  // Payouts). Falls back to the default 1st-of-month schedule when unset.
  const payoutSchedule = normalizePayoutSchedule(profile?.payoutSchedule);
  const scheduledFor = computeNextPayoutDate(payoutSchedule, now);

  const chartPoints = Array.from({ length: 12 }).map((_, index) => {
    const offset = 11 - index;
    const pointDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const nextMonth = new Date(pointDate.getFullYear(), pointDate.getMonth() + 1, 1);
    const monthSales = sales.filter(
      (sale) => sale.createdAt >= pointDate && sale.createdAt < nextMonth
    );
    const confirmedCents = sumApprovedEarningsCents(monthSales);
    const pendingMonthCents = sumPendingEarningsCents(monthSales);

    return {
      label: pointDate.toLocaleDateString("en-US", { month: "short" }),
      confirmedCents,
      pendingCents: pendingMonthCents
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
    chart: {
      period: "12M",
      points: chartPoints
    },
    nextPayout: {
      amountCents: availableBalanceCents,
      scheduledFor: scheduledFor.toISOString(),
      grossSalesCents: grossAvailableCents,
      platformFeeCents,
      earningsCents: availableBalanceCents
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
  } catch {
    return errorResponse(c, "Could not load payout summary", 500, "PAYOUT_SUMMARY_FAILED");
  }
});

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
  const authUser = c.get("authUser");
  const payoutMethod = await syncStripePayoutMethod(authUser.id);

  if (!payoutMethod) {
    return successResponse(c, { payoutMethod: null }, "No payout method on file");
  }

  return successResponse(c, {
    payoutMethod: serializePayoutMethod(payoutMethod)
  });
});

architectPayoutRoutes.post("/connect/onboarding", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = connectOnboardingSchema.parse(await c.req.json());
    const stripe = getStripeClient();

    if (!stripe || !isStripeConfigured()) {
      return errorResponse(c, "Stripe Connect is not configured", 503, "STRIPE_NOT_CONFIGURED");
    }

    const existing = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });

    let stripeAccountId =
      existing?.stripeAccountId && existing.country === input.country
        ? existing.stripeAccountId
        : null;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: input.country,
        email: authUser.email,
        business_type: "individual",
        capabilities: { transfers: { requested: true } },
        metadata: { architectUserId: authUser.id, product: "core_architect_payouts" }
      });
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
        accountNumber: null,
        ifscCode: null
      },
      create: {
        architectUserId: authUser.id,
        accountHolderName: input.accountHolderName,
        country: input.country,
        currency: input.country === "IN" ? "inr" : "usd",
        stripeAccountId,
        verificationStatus: "REQUIRES_ACTION"
      }
    });

    const payoutsUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/architect/payouts`;
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${payoutsUrl}?stripe_onboarding=refresh`,
      return_url: `${payoutsUrl}?stripe_onboarding=complete`,
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

    console.error("[stripe-connect] Could not start onboarding", stripeErrorMessage(error));
    return errorResponse(
      c,
      stripeErrorMessage(error),
      503,
      "STRIPE_CONNECT_ONBOARDING_FAILED"
    );
  }
});

architectPayoutRoutes.post("/connect/refresh", async (c) => {
  try {
    const authUser = c.get("authUser");
    const method = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });

    if (!method?.stripeAccountId) {
      return errorResponse(c, "Start Stripe onboarding first", 404, "STRIPE_ACCOUNT_NOT_FOUND");
    }

    const stripe = getStripeClient();
    if (!stripe) {
      return errorResponse(c, "Stripe Connect is not configured", 503, "STRIPE_NOT_CONFIGURED");
    }

    const payoutsUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/architect/payouts`;
    const accountLink = await stripe.accountLinks.create({
      account: method.stripeAccountId,
      refresh_url: `${payoutsUrl}?stripe_onboarding=refresh`,
      return_url: `${payoutsUrl}?stripe_onboarding=complete`,
      type: "account_onboarding",
      collection_options: { fields: "eventually_due" }
    });

    return successResponse(c, { url: accountLink.url }, "Stripe onboarding link refreshed");
  } catch (error) {
    return errorResponse(
      c,
      stripeErrorMessage(error),
      503,
      "STRIPE_CONNECT_ONBOARDING_FAILED"
    );
  }
});

architectPayoutRoutes.post("/method/sync", async (c) => {
  const authUser = c.get("authUser");
  const payoutMethod = await syncStripePayoutMethod(authUser.id);

  return successResponse(c, {
    payoutMethod: payoutMethod ? serializePayoutMethod(payoutMethod) : null
  }, "Payout method synced");
});

architectPayoutRoutes.put("/method", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = directPayoutMethodSchema.parse(await c.req.json());
    const stripe = getStripeClient();
    if (!stripe || !isStripeConfigured()) {
      return errorResponse(c, "Stripe Connect is not configured", 503, "STRIPE_NOT_CONFIGURED");
    }

    if (input.country === "IN") {
      const response = await fetch(`https://ifsc.razorpay.com/${input.routingNumber}`);
      if (!response.ok) return errorResponse(c, "IFSC code not found", 422, "IFSC_NOT_FOUND");
    }

    const existing = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });
    const token = await stripe.tokens.create({
      bank_account: {
        country: input.country,
        currency: input.country === "IN" ? "inr" : "usd",
        account_holder_name: input.accountHolderName,
        account_holder_type: "individual",
        routing_number: input.routingNumber,
        account_number: input.accountNumber
      }
    });

    let stripeAccountId = existing?.country === input.country ? existing.stripeAccountId : null;
    let stripeExternalAccountId = token.bank_account?.id ?? null;

    if (stripeAccountId) {
      const external = await stripe.accounts.createExternalAccount(stripeAccountId, {
        external_account: token.id,
        default_for_currency: true
      });
      stripeExternalAccountId = external.id;
    } else {
      const account = await stripe.accounts.create({
        type: "express",
        country: input.country,
        email: authUser.email,
        business_type: "individual",
        external_account: token.id,
        capabilities: { transfers: { requested: true } },
        metadata: { architectUserId: authUser.id, product: "core_architect_payouts" }
      });
      stripeAccountId = account.id;
    }

    await prisma.architectPayoutMethod.upsert({
      where: { architectUserId: authUser.id },
      update: {
        bankName: input.bankName,
        accountHolderName: input.accountHolderName,
        country: input.country,
        currency: input.country === "IN" ? "inr" : "usd",
        accountLast4: input.accountNumber.slice(-4),
        routingLast4: input.routingNumber.slice(-4),
        stripeAccountId,
        stripeExternalAccountId,
        verificationStatus: "REQUIRES_ACTION",
        payoutsEnabled: false,
        detailsSubmitted: false,
        accountNumber: null,
        ifscCode: null
      },
      create: {
        architectUserId: authUser.id,
        bankName: input.bankName,
        accountHolderName: input.accountHolderName,
        country: input.country,
        currency: input.country === "IN" ? "inr" : "usd",
        accountLast4: input.accountNumber.slice(-4),
        routingLast4: input.routingNumber.slice(-4),
        stripeAccountId,
        stripeExternalAccountId,
        verificationStatus: "REQUIRES_ACTION"
      }
    });

    const payoutMethod = await syncStripePayoutMethod(authUser.id);
    return successResponse(c, {
      payoutMethod: payoutMethod ? serializePayoutMethod(payoutMethod) : null
    }, "Payout method saved with Stripe");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid payout method", 422, "VALIDATION_ERROR");
    }
    console.error("[stripe-connect] Could not save payout method", stripeErrorMessage(error));
    return errorResponse(c, stripeErrorMessage(error), 422, "PAYOUT_METHOD_SAVE_FAILED");
  }
});

architectPayoutRoutes.get("/transactions", async (c) => {
  try {
    const authUser = c.get("authUser");
    await syncStripePayoutRecords(authUser.id);
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

    const accountMask = payoutMethod
      ? `•••• ${payoutMethod.accountLast4 ?? legacyAccountLast4(payoutMethod.accountNumber)}`
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
      description: `Payout → ${accountMask}`,
      type: "Payout" as const,
      amountCents: -payout.amountCents,
      status:
        payout.status === "COMPLETED"
          ? ("Completed" as const)
          : payout.status === "FAILED"
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
  } catch {
    return errorResponse(c, "Could not load payout transactions", 500, "PAYOUT_TRANSACTIONS_FAILED");
  }
});

architectPayoutRoutes.post("/request", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = payoutRequestSchema.parse(await c.req.json());
    const summary = await computeArchitectPayoutSummary(authUser.id);

    if (!summary.payoutMethod) {
      return errorResponse(c, "Add a payout method before requesting a payout", 422, "PAYOUT_METHOD_REQUIRED");
    }

    if (!summary.payoutMethod.verified || !summary.payoutMethod.payoutsEnabled) {
      return errorResponse(
        c,
        "Complete Stripe verification before requesting a payout",
        422,
        "PAYOUT_METHOD_NOT_VERIFIED"
      );
    }

    const amountCents = input.amountCents ?? summary.availableBalanceCents;

    if (amountCents <= 0) {
      return errorResponse(c, "No available balance to payout", 422, "NO_AVAILABLE_BALANCE");
    }

    if (amountCents > summary.availableBalanceCents) {
      return errorResponse(c, "Requested amount exceeds available balance", 422, "INSUFFICIENT_BALANCE");
    }

    const method = await prisma.architectPayoutMethod.findUnique({
      where: { architectUserId: authUser.id }
    });
    const stripe = getStripeClient();

    if (!stripe || !method?.stripeAccountId) {
      return errorResponse(c, "Stripe Connect is not configured", 503, "STRIPE_NOT_CONFIGURED");
    }

    let payout = await prisma.architectPayout.create({
      data: {
        architectUserId: authUser.id,
        amountCents,
        currency: "usd",
        status: "PENDING"
      }
    });

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: amountCents,
          currency: "usd",
          destination: method.stripeAccountId,
          description: `CORE architect earnings ${payout.id}`,
          transfer_group: `architect_payout_${payout.id}`,
          metadata: { architectUserId: authUser.id, appPayoutId: payout.id }
        },
        { idempotencyKey: `architect-transfer-${payout.id}` }
      );

      payout = await prisma.architectPayout.update({
        where: { id: payout.id },
        data: { stripeTransferId: transfer.id, status: "PROCESSING" }
      });

      // The connected balance can briefly remain pending. The sync path retries
      // this idempotently when it becomes available.
      try {
        const stripePayout = await stripe.payouts.create(
          {
            amount: amountCents,
            currency: "usd",
            description: `CORE architect payout ${payout.id}`,
            metadata: { architectUserId: authUser.id, appPayoutId: payout.id }
          },
          {
            stripeAccount: method.stripeAccountId,
            idempotencyKey: `architect-payout-${payout.id}`
          }
        );

        payout = await prisma.architectPayout.update({
          where: { id: payout.id },
          data: {
            stripePayoutId: stripePayout.id,
            status: stripePayoutStatus(stripePayout.status),
            arrivalDate: stripePayout.arrival_date
              ? new Date(stripePayout.arrival_date * 1000)
              : null,
            failureCode: stripePayout.failure_code ?? null,
            failureMessage: stripePayout.failure_message ?? null
          }
        });
      } catch (error) {
        payout = await prisma.architectPayout.update({
          where: { id: payout.id },
          data: { status: "PROCESSING", failureMessage: stripeErrorMessage(error) }
        });
      }
    } catch (error) {
      payout = await prisma.architectPayout.update({
        where: { id: payout.id },
        data: { status: "FAILED", failureMessage: stripeErrorMessage(error) }
      });
      return errorResponse(c, stripeErrorMessage(error), 422, "STRIPE_PAYOUT_FAILED");
    }

    const updatedSummary = await computeArchitectPayoutSummary(authUser.id);

    return successResponse(
      c,
      {
        payout: {
          id: payout.id,
          amountCents: payout.amountCents,
          status: payout.status,
          createdAt: payout.createdAt.toISOString()
        },
        summary: updatedSummary
      },
      "Stripe payout requested"
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

    return errorResponse(c, "Could not request payout", 500, "PAYOUT_REQUEST_FAILED");
  }
});
