import { Hono, type Context } from "hono";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { requireBusinessPermission } from "../team/membership";
import {
  CustomerServiceError,
  deleteCustomerData,
  dismissMergeSuggestion,
  exportCustomerData,
  getCustomerTimeline,
  listMergeSuggestions,
  mergeCustomers,
  searchCustomers,
  splitCustomers
} from "./customer-service";

/**
 * Customer domain routes (plan Part 7). Mounted under /business/customers.
 * Every route authorizes server-side through requireBusinessPermission
 * (view_customers to read, manage_customers to merge/split/export/delete);
 * the businessId always comes from the resolved membership — never the client.
 */
export const customerRoutes = new Hono();

function handleServiceError(c: Context, error: unknown) {
  if (error instanceof CustomerServiceError) {
    return errorResponse(c, error.message, error.httpStatus as 400, error.code);
  }
  console.error("[customer-routes] unexpected error", error);
  return errorResponse(c, "Something went wrong", 500, "CUSTOMER_ERROR");
}

function parseLimit(c: Context): number | undefined {
  const raw = c.req.query("limit");
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

customerRoutes.get("/", requireBusinessPermission("view_customers"), async (c) => {
  const membership = c.get("businessMembership");
  try {
    const customers = await searchCustomers({
      businessId: membership.businessId,
      q: c.req.query("q") ?? null,
      limit: parseLimit(c)
    });
    return successResponse(c, { customers });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

// Registered before "/:customerId" so it is not swallowed by the param route.
customerRoutes.get("/suggestions", requireBusinessPermission("view_customers"), async (c) => {
  const membership = c.get("businessMembership");
  try {
    const suggestions = await listMergeSuggestions(membership.businessId);
    return successResponse(c, { suggestions });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

customerRoutes.post(
  "/suggestions/:suggestionId/dismiss",
  requireBusinessPermission("manage_customers"),
  async (c) => {
    const membership = c.get("businessMembership");
    const authUser = c.get("authUser");
    try {
      const suggestion = await dismissMergeSuggestion({
        businessId: membership.businessId,
        suggestionId: c.req.param("suggestionId") ?? "",
        actorUserId: authUser?.id ?? null
      });
      return successResponse(c, { suggestion });
    } catch (error) {
      return handleServiceError(c, error);
    }
  }
);

customerRoutes.post(
  "/merge-events/:eventId/split",
  requireBusinessPermission("manage_customers"),
  async (c) => {
    const membership = c.get("businessMembership");
    const authUser = c.get("authUser");
    try {
      const result = await splitCustomers({
        businessId: membership.businessId,
        mergeEventId: c.req.param("eventId") ?? "",
        actorUserId: authUser?.id ?? null
      });
      return successResponse(c, result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  }
);

customerRoutes.get("/:customerId", requireBusinessPermission("view_customers"), async (c) => {
  const membership = c.get("businessMembership");
  try {
    const result = await getCustomerTimeline({
      businessId: membership.businessId,
      customerId: c.req.param("customerId") ?? "",
      limit: parseLimit(c)
    });
    return successResponse(c, result);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

customerRoutes.post("/:customerId/merge", requireBusinessPermission("manage_customers"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const mergedCustomerId = typeof body.mergedCustomerId === "string" ? body.mergedCustomerId : "";
  if (!mergedCustomerId) {
    return errorResponse(c, "mergedCustomerId is required", 422, "MERGED_CUSTOMER_ID_REQUIRED");
  }
  try {
    const result = await mergeCustomers({
      businessId: membership.businessId,
      survivingId: c.req.param("customerId") ?? "",
      mergedId: mergedCustomerId,
      actorUserId: authUser?.id ?? null
    });
    return successResponse(c, result);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

customerRoutes.get("/:customerId/export", requireBusinessPermission("manage_customers"), async (c) => {
  const membership = c.get("businessMembership");
  try {
    const bundle = await exportCustomerData({
      businessId: membership.businessId,
      customerId: c.req.param("customerId") ?? ""
    });
    return successResponse(c, bundle);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

customerRoutes.delete("/:customerId", requireBusinessPermission("manage_customers"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  try {
    const counts = await deleteCustomerData({
      businessId: membership.businessId,
      customerId: c.req.param("customerId") ?? "",
      actorUserId: authUser?.id ?? null
    });
    return successResponse(c, { deleted: true, counts });
  } catch (error) {
    return handleServiceError(c, error);
  }
});
