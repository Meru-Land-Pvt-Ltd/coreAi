import type { Hono } from "hono";
import { errorResponse, successResponse } from "../../lib/api-response";
import { resolveProductForPublic } from "./product-spec-service";

/**
 * Public product read for a published agent page.
 *
 *   GET /agent-pages/:slug/product
 *
 * The whole customer-facing product in one call: the multi-page ProductSpec
 * plus the listing and architect the site chrome needs. The frontend renders
 * /a/<slug> and /a/<slug>/<page> from this payload on the server, so it must
 * carry everything a page needs for its markup AND its metadata.
 *
 * Public, unauthenticated, and 404s under exactly the same rule as
 * GET /agent-pages/:slug — the page must be LIVE and its listing APPROVED, so
 * an unpublished or suspended agent is indistinguishable from a missing one.
 * `resolveProductForPublic` owns that rule; this route only shapes the reply.
 *
 * `product` is never null for a resolvable page. `source` says where it came
 * from: "spec" is the architect's stored design, "blueprint" is synthesized
 * from the older Face Blueprint. The frontend keeps its pre-Product-Spec
 * rendering path for "blueprint" so every agent that renders today keeps
 * rendering exactly as it does now.
 *
 * NOTE FOR THE INTEGRATOR: this file is registered from manage-routes.ts (one
 * import, one call) purely because routes.ts belongs to another fleet right
 * now. It is a PUBLIC route and belongs next to the other public ones — move
 * the call into routes.ts, above `registerAgentPageManageRoutes`, whenever
 * that file is free. Nothing else changes; the path is unaffected.
 */

const PRODUCT_NOT_FOUND_MESSAGE = "This agent page is not available.";

export function registerAgentPageProductRoutes(routes: Hono) {
  /** The resolved ProductSpec + listing + architect for a live public slug. */
  routes.get("/:slug/product", async (c) => {
    const slug = c.req.param("slug");

    const resolved = await resolveProductForPublic(slug);
    if (!resolved) {
      return errorResponse(c, PRODUCT_NOT_FOUND_MESSAGE, 404, "AGENT_PAGE_NOT_FOUND");
    }

    return successResponse(c, {
      slug: resolved.slug,
      source: resolved.source,
      product: resolved.product,
      page: resolved.page,
      listing: resolved.listing,
      architect: resolved.architect,
      // Design Brain dials ride along, same as GET /agent-pages/:slug — the
      // live product surface reads them for composer placement and density.
      design: resolved.design
    });
  });
}
