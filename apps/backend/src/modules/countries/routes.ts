import { Hono } from "hono";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";

export const countryRoutes = new Hono();

countryRoutes.get("/", async (c) => {
  try {
    const countries = await prisma.country.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        countryCode: true,
        flag: true
      }
    });

    return successResponse(c, { countries }, "Countries loaded");
  } catch {
    return errorResponse(c, "Could not load countries", 500, "COUNTRIES_LIST_FAILED");
  }
});
