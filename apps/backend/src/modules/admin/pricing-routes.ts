import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { microUsdToUsd, usdToMicroUsd } from "../../lib/usage-pricing";

export const adminPricingRoutes = new Hono();

const unitSchema = z.enum(["PER_MINUTE", "PER_SMS", "PER_CALL", "PER_UNIT"]);

const costUsdSchema = z
  .number()
  .min(0)
  .max(1_000)
  .refine((value) => Number.isFinite(value), "Cost must be a finite number");

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
  sortOrder: z.number().int().min(0).max(9999).optional()
});

const updateServiceSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.string().trim().max(500).nullable().optional(),
    unit: unitSchema.optional(),
    actualCostUsd: costUsdSchema.optional(),
    updatedCostUsd: costUsdSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export function serializeUsageService(service: {
  id: string;
  code: string;
  name: string;
  role: string | null;
  unit: "PER_MINUTE" | "PER_SMS" | "PER_CALL" | "PER_UNIT";
  actualCostMicroUsd: number;
  updatedCostMicroUsd: number;
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
    isActive: service.isActive,
    sortOrder: service.sortOrder,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString()
  };
}

adminPricingRoutes.get("/services", async (c) => {
  const includeInactive = c.req.query("includeInactive") === "true";

  const services = await prisma.platformUsageService.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });

  const serialized = services.map(serializeUsageService);
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

adminPricingRoutes.patch("/services/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const input = updateServiceSchema.parse(await c.req.json());

    const existing = await prisma.platformUsageService.findUnique({ where: { id } });
    if (!existing) {
      return errorResponse(c, "Service not found", 404, "PRICING_SERVICE_NOT_FOUND");
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
