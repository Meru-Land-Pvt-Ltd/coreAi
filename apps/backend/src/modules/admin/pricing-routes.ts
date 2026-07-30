import { Hono } from "hono";
import { z } from "zod";
import type { UsageServiceUnit } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { microUsdToUsd, usdToMicroUsd } from "../../lib/usage-pricing";
import { listUsageServicePricing } from "./usage-pricing-service";
import { repriceUnpricedExecutions } from "./reprice-unpriced";

export const adminPricingRoutes = new Hono();

const unitSchema = z.enum(["PER_MINUTE", "PER_SMS", "PER_CALL", "PER_UNIT"]);

const costUsdSchema = z
  .number()
  .min(0)
  .max(1_000)
  .refine((value) => Number.isFinite(value), "Cost must be a finite number");

const PHONE_CALL_BREAKDOWN_UNIT_MESSAGE =
  "Phone call breakdown services must use PER_MINUTE";

export function isValidPhoneCallBreakdownSelection(
  showInPhoneCallBreakdown: boolean,
  unit: UsageServiceUnit
): boolean {
  return !showInPhoneCallBreakdown || unit === "PER_MINUTE";
}

const createServiceSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "Code must be lowercase letters, numbers, and underscores"),
  name: z.string().trim().min(2).max(120),
  role: z.string().trim().max(500).optional(),
  unit: unitSchema.default("PER_MINUTE"),
  actualCostUsd: costUsdSchema,
  updatedCostUsd: costUsdSchema,
  showInPhoneCallBreakdown: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).optional()
});

const updateServiceSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.string().trim().max(500).nullable().optional(),
    unit: unitSchema.optional(),
    actualCostUsd: costUsdSchema.optional(),
    updatedCostUsd: costUsdSchema.optional(),
    showInPhoneCallBreakdown: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export function serializeUsageService(service: {
  id: string;
  code: string;
  name: string;
  role: string | null;
  unit: UsageServiceUnit;
  actualCostMicroUsd: number;
  updatedCostMicroUsd: number;
  showInPhoneCallBreakdown: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: service.id,
    code: service.code,
    name: service.name,
    role: service.role,
    unit: service.unit,
    actualCostUsd: microUsdToUsd(service.actualCostMicroUsd),
    updatedCostUsd: microUsdToUsd(service.updatedCostMicroUsd),
    actualCostMicroUsd: service.actualCostMicroUsd,
    updatedCostMicroUsd: service.updatedCostMicroUsd,
    showInPhoneCallBreakdown: service.showInPhoneCallBreakdown,
    isActive: service.isActive,
    sortOrder: service.sortOrder,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString()
  };
}

adminPricingRoutes.get("/services", async (c) => {
  const includeInactive = c.req.query("includeInactive") === "true";

  const records = await listUsageServicePricing({ includeInactive });
  const serialized = records.map((record) =>
    serializeUsageService({
      id: record.pricingRecordId,
      code: record.serviceId,
      name: record.name,
      role: record.description,
      unit: record.unit,
      actualCostMicroUsd: record.actualCostMicroUsd,
      updatedCostMicroUsd: record.billingCostMicroUsd,
      showInPhoneCallBreakdown: record.showInPhoneCallBreakdown,
      isActive: record.active,
      sortOrder: record.sortOrder,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    })
  );
  const perMinuteActualUsd = serialized
    .filter((service) => service.unit === "PER_MINUTE" && service.isActive)
    .reduce((sum, service) => sum + service.actualCostUsd, 0);
  const perMinuteUpdatedUsd = serialized
    .filter((service) => service.unit === "PER_MINUTE" && service.isActive)
    .reduce((sum, service) => sum + service.updatedCostUsd, 0);

  return successResponse(c, {
    services: serialized,
    totals: {
      perMinuteActualUsd,
      perMinuteUpdatedUsd
    }
  });
});

adminPricingRoutes.post("/services", async (c) => {
  try {
    const input = createServiceSchema.parse(await c.req.json());

    if (!isValidPhoneCallBreakdownSelection(input.showInPhoneCallBreakdown, input.unit)) {
      return errorResponse(
        c,
        PHONE_CALL_BREAKDOWN_UNIT_MESSAGE,
        400,
        "PRICING_INVALID_INPUT"
      );
    }

    const existing = await prisma.platformUsageService.findUnique({
      where: { code: input.code }
    });
    if (existing) {
      return errorResponse(c, "Service code already exists", 409, "PRICING_SERVICE_CODE_EXISTS");
    }

    const service = await prisma.platformUsageService.create({
      data: {
        code: input.code,
        name: input.name,
        role: input.role,
        unit: input.unit,
        actualCostMicroUsd: usdToMicroUsd(input.actualCostUsd),
        updatedCostMicroUsd: usdToMicroUsd(input.updatedCostUsd),
        showInPhoneCallBreakdown: input.showInPhoneCallBreakdown,
        sortOrder: input.sortOrder ?? 0
      }
    });

    return successResponse(c, { service: serializeUsageService(service) }, "Service created", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid input", 400, "PRICING_INVALID_INPUT");
    }
    throw error;
  }
});

const repriceSchema = z.object({
  executionIds: z.array(z.string().trim().min(1)).max(500).optional(),
  billingMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "billingMonth must be YYYY-MM")
    .optional(),
  /** Report-only unless the caller EXPLICITLY passes dryRun: false. */
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional()
});

adminPricingRoutes.post("/reprice-unpriced", async (c) => {
  try {
    const raw = await c.req.json().catch(() => ({}));
    const input = repriceSchema.parse(raw ?? {});
    const actor = c.get("authUser") as { id?: string } | null | undefined;

    const result = await repriceUnpricedExecutions({
      executionIds: input.executionIds,
      billingMonth: input.billingMonth,
      dryRun: input.dryRun !== false,
      limit: input.limit ?? 100,
      actorId: actor?.id ?? null
    });

    return successResponse(
      c,
      result,
      result.dryRun
        ? "Dry run — no executions were modified"
        : `Repriced ${result.priced} execution(s)`
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid input", 400, "PRICING_INVALID_INPUT");
    }
    if (error instanceof Error && error.message.includes("Invalid billingMonth")) {
      return errorResponse(c, error.message, 400, "PRICING_INVALID_INPUT");
    }
    throw error;
  }
});

adminPricingRoutes.patch("/services/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const input = updateServiceSchema.parse(await c.req.json());

    const existing = await prisma.platformUsageService.findUnique({ where: { id } });
    if (!existing) {
      return errorResponse(c, "Service not found", 404, "PRICING_SERVICE_NOT_FOUND");
    }

    const nextUnit = input.unit ?? existing.unit;
    const nextShowInPhoneCallBreakdown =
      input.showInPhoneCallBreakdown ?? existing.showInPhoneCallBreakdown;
    if (!isValidPhoneCallBreakdownSelection(nextShowInPhoneCallBreakdown, nextUnit)) {
      return errorResponse(
        c,
        PHONE_CALL_BREAKDOWN_UNIT_MESSAGE,
        400,
        "PRICING_INVALID_INPUT"
      );
    }

    const service = await prisma.platformUsageService.update({
      where: { id },
      data: {
        name: input.name,
        role: input.role === null ? null : input.role,
        unit: input.unit,
        actualCostMicroUsd:
          input.actualCostUsd !== undefined ? usdToMicroUsd(input.actualCostUsd) : undefined,
        updatedCostMicroUsd:
          input.updatedCostUsd !== undefined ? usdToMicroUsd(input.updatedCostUsd) : undefined,
        showInPhoneCallBreakdown: input.showInPhoneCallBreakdown,
        isActive: input.isActive,
        sortOrder: input.sortOrder
      }
    });

    return successResponse(c, { service: serializeUsageService(service) }, "Service updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid input", 400, "PRICING_INVALID_INPUT");
    }
    throw error;
  }
});
