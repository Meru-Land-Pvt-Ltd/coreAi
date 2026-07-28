import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { paymentRoutes } from "./routes";

let databaseAvailable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("public execution pricing", () => {
  it("does not require an authenticated business session", async () => {
    if (!databaseAvailable) {
      throw new Error("Integration test requires a reachable database.");
    }

    const app = new Hono();
    app.route("/payments", paymentRoutes);

    const [response, calendarPricing] = await Promise.all([
      app.request("/payments/execution-pricing"),
      prisma.platformUsageService.findFirst({
        where: { code: "google_calendar", isActive: true },
        select: {
          updatedCostMicroUsd: true,
          actualCostMicroUsd: true
        }
      })
    ]);
    expect(response.status).toBe(200);
    expect(calendarPricing).not.toBeNull();

    const body = (await response.json()) as {
      success: boolean;
      data?: {
        executionPricing?: {
          voice?: {
            serviceBreakdown?: Array<Record<string, unknown>>;
          };
          sms?: {
            billingRatePerSmsUsd?: number | null;
          } | null;
          calendar?: {
            serviceId?: string;
            billingRateUsd?: number | null;
          } | null;
        };
      };
    };

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data?.executionPricing?.voice?.serviceBreakdown)).toBe(true);
    expect(
      typeof body.data?.executionPricing?.sms?.billingRatePerSmsUsd
    ).toBe("number");
    expect(body.data?.executionPricing?.calendar).toMatchObject({
      serviceId: "google_calendar",
      billingRateUsd:
        (calendarPricing?.updatedCostMicroUsd ?? 0) / 1_000_000
    });
    if (
      calendarPricing &&
      calendarPricing.actualCostMicroUsd !==
        calendarPricing.updatedCostMicroUsd
    ) {
      expect(body.data?.executionPricing?.calendar?.billingRateUsd).not.toBe(
        calendarPricing.actualCostMicroUsd / 1_000_000
      );
    }
    expect(JSON.stringify(body)).not.toContain("actualCost");
  });
});
