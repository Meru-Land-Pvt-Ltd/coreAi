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

    const response = await app.request("/payments/execution-pricing");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      data?: {
        executionPricing?: {
          voice?: {
            serviceBreakdown?: Array<Record<string, unknown>>;
          };
        };
      };
    };

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data?.executionPricing?.voice?.serviceBreakdown)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("actualCost");
  });
});
