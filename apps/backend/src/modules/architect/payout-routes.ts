import { Hono } from "hono";
import { z } from "zod";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import {
  ARCHITECT_SHARE,
  loadArchitectEarnings,
  serializeArchitectSale,
  sumEarningsCents
} from "./payout-earnings";

export const architectPayoutRoutes = new Hono();

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const payoutMethodSchema = z
  .object({
    bankName: z.string().trim().min(2, "Bank name is required"),
    accountHolderName: z.string().trim().min(2, "Account holder name is required"),
    accountNumber: z
      .string()
      .trim()
      .min(8, "Account number must be at least 8 digits")
      .max(18, "Account number is too long")
      .regex(/^\d+$/, "Account number must contain digits only"),
    confirmAccountNumber: z.string().trim(),
    ifscCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(IFSC_REGEX, "Enter a valid IFSC code")
  })
  .refine((input) => input.accountNumber === input.confirmAccountNumber, {
    message: "Account numbers do not match",
    path: ["confirmAccountNumber"]
  });

const payoutRequestSchema = z.object({
  amountCents: z.number().int().positive().optional()
});

const earningsQuerySchema = z.object({
  listingIds: z.string().trim().optional()
});

function maskAccountNumber(accountNumber: string) {
  const digits = accountNumber.replace(/\D/g, "");
  return digits.slice(-4);
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function nextPayoutDate(from = new Date()) {
  const year = from.getFullYear();
  const month = from.getMonth();
  const candidates = [
    new Date(year, month, 1),
    new Date(year, month, 15),
    new Date(year, month + 1, 1)
  ].filter((candidate) => candidate.getTime() > from.getTime());

  return candidates[0] ?? new Date(year, month + 1, 1);
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

  const [sales, payouts, listings, payoutMethod] = await Promise.all([
    loadArchitectEarnings(architectUserId, { listingIds }),
    prisma.architectPayout.findMany({
      where: {
        architectUserId,
        status: "COMPLETED"
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
    })
  ]);

  const totalEarningsCents = sumEarningsCents(sales);
  const paidOutCents = payouts.reduce((sum, payout) => sum + payout.amountCents, 0);
  const availableBalanceCents = Math.max(0, totalEarningsCents - paidOutCents);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthSales = sales.filter((sale) => sale.createdAt >= monthStart);
  const thisMonthEarningsCents = sumEarningsCents(thisMonthSales);

  const grossAvailableCents = Math.round(availableBalanceCents / ARCHITECT_SHARE);
  const platformFeeCents = Math.max(0, grossAvailableCents - availableBalanceCents);
  const scheduledFor = nextPayoutDate(now);

  const chartPoints = Array.from({ length: 12 }).map((_, index) => {
    const offset = 11 - index;
    const pointDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const nextMonth = new Date(pointDate.getFullYear(), pointDate.getMonth() + 1, 1);
    const monthSales = sales.filter(
      (sale) => sale.createdAt >= pointDate && sale.createdAt < nextMonth
    );
    const confirmedCents = sumEarningsCents(monthSales);

    return {
      label: pointDate.toLocaleDateString("en-US", { month: "short" }),
      confirmedCents,
      pendingCents: 0
    };
  });

  const listingBreakdown = listings.map((listing) => {
    const listingSales = sales.filter((sale) => sale.listingId === listing.id);
    return {
      listingId: listing.id,
      listingName: listing.name,
      priceCents: listing.priceCents,
      installCount: listingSales.length,
      grossCents: listingSales.reduce((sum, sale) => sum + sale.grossCents, 0),
      earningsCents: sumEarningsCents(listingSales)
    };
  });

  return {
    totalEarningsCents,
    availableBalanceCents,
    pendingCents: 0,
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
    payoutMethod: payoutMethod
      ? {
          bankName: payoutMethod.bankName,
          accountHolderName: payoutMethod.accountHolderName,
          accountLast4: maskAccountNumber(payoutMethod.accountNumber),
          ifscCode: payoutMethod.ifscCode,
          createdAt: payoutMethod.createdAt.toISOString(),
          verified: true
        }
      : null
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
        earningsCents: sumEarningsCents(sales),
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

    if (!IFSC_REGEX.test(code)) {
      return errorResponse(c, "Invalid IFSC format", 422, "INVALID_IFSC_FORMAT");
    }

    const response = await fetch(`https://ifsc.razorpay.com/${code}`);

    if (!response.ok) {
      return errorResponse(c, "IFSC code not found", 404, "IFSC_NOT_FOUND");
    }

    const data = (await response.json()) as {
      BANK?: string;
      BRANCH?: string;
      CITY?: string;
      STATE?: string;
    };

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
  const payoutMethod = await prisma.architectPayoutMethod.findUnique({
    where: { architectUserId: authUser.id }
  });

  if (!payoutMethod) {
    return successResponse(c, { payoutMethod: null }, "No payout method on file");
  }

  return successResponse(c, {
    payoutMethod: {
      bankName: payoutMethod.bankName,
      accountHolderName: payoutMethod.accountHolderName,
      accountLast4: maskAccountNumber(payoutMethod.accountNumber),
      ifscCode: payoutMethod.ifscCode,
      createdAt: payoutMethod.createdAt.toISOString(),
      verified: true
    }
  });
});

architectPayoutRoutes.put("/method", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = payoutMethodSchema.parse(await c.req.json());

    const ifscResponse = await fetch(`https://ifsc.razorpay.com/${input.ifscCode}`);
    if (!ifscResponse.ok) {
      return errorResponse(c, "IFSC code not found", 422, "IFSC_NOT_FOUND");
    }

    const ifscData = (await ifscResponse.json()) as { BANK?: string };
    const bankName = input.bankName.trim() || ifscData.BANK?.trim() || "";

    if (!bankName) {
      return errorResponse(c, "Bank name is required", 422, "BANK_NAME_REQUIRED");
    }

    const payoutMethod = await prisma.architectPayoutMethod.upsert({
      where: { architectUserId: authUser.id },
      update: {
        bankName,
        accountHolderName: input.accountHolderName,
        accountNumber: input.accountNumber,
        ifscCode: input.ifscCode
      },
      create: {
        architectUserId: authUser.id,
        bankName,
        accountHolderName: input.accountHolderName,
        accountNumber: input.accountNumber,
        ifscCode: input.ifscCode
      }
    });

    return successResponse(
      c,
      {
        payoutMethod: {
          bankName: payoutMethod.bankName,
          accountHolderName: payoutMethod.accountHolderName,
          accountLast4: maskAccountNumber(payoutMethod.accountNumber),
          ifscCode: payoutMethod.ifscCode,
          createdAt: payoutMethod.createdAt.toISOString(),
          verified: true
        }
      },
      "Payout method saved"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid payout method",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not save payout method", 500, "PAYOUT_METHOD_SAVE_FAILED");
  }
});

architectPayoutRoutes.get("/transactions", async (c) => {
  try {
    const authUser = c.get("authUser");
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

    const accountMask = payoutMethod ? `•••• ${maskAccountNumber(payoutMethod.accountNumber)}` : "bank account";

    const saleTransactions = sales.map((sale) => ({
      id: sale.paymentId,
      paymentId: sale.paymentId,
      listingId: sale.listingId,
      installId: sale.installId,
      date: sale.createdAt.toISOString(),
      description: `${sale.listingName} — sold to ${sale.businessName}`,
      type: "Sale" as const,
      amountCents: sale.earningsCents,
      status: "Paid out" as const
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
      status: payout.status === "COMPLETED" ? ("Completed" as const) : ("Processing" as const)
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

    const amountCents = input.amountCents ?? summary.availableBalanceCents;

    if (amountCents <= 0) {
      return errorResponse(c, "No available balance to payout", 422, "NO_AVAILABLE_BALANCE");
    }

    if (amountCents > summary.availableBalanceCents) {
      return errorResponse(c, "Requested amount exceeds available balance", 422, "INSUFFICIENT_BALANCE");
    }

    const payout = await prisma.architectPayout.create({
      data: {
        architectUserId: authUser.id,
        amountCents,
        status: "COMPLETED"
      }
    });

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
      "Payout requested"
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
