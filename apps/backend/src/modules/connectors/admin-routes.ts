/**
 * WHERE A BROKEN CONNECTOR SHOWS UP.
 *
 * A self-test nobody can see is a self-test nobody acts on. These three
 * endpoints answer the only three questions worth asking about a catalogue of
 * connectors:
 *
 *   what do we have          → GET /admin/connectors
 *   is anything broken now   → GET /admin/connectors/health
 *   check it right now       → POST /admin/connectors/health/run
 *
 * The listing deliberately never returns a heart, a probe or a credential —
 * only the declaration. An admin screen needs to know what a connector needs,
 * not how it works, and certainly not what key it runs on.
 */

import { Hono } from "hono";
import { errorResponse, successResponse } from "../../lib/api-response";
import { allConnectors, connectorProblems, connectorsNeedingReview, getConnector } from "./registry";
import { latestConnectorHealth, sweepConnectorHealth } from "./health-sweep";
import { checkConnectorHealth } from "./engine";

export const adminConnectorRoutes = new Hono();

/** The declaration, with the executable parts stripped out. */
function describe(contract: ReturnType<typeof allConnectors>[number]) {
  const { heart: _heart, probe: _probe, ...declaration } = contract;
  return {
    ...declaration,
    // Flattened for the screen, so a list can be scanned without opening rows.
    needsPlatformKeys: contract.needs.platform.map((need) => need.key),
    businessQuestions: contract.needs.business.length,
    hasSelfTest: typeof contract.probe === "function"
  };
}

adminConnectorRoutes.get("/", (c) => {
  return successResponse(c, {
    connectors: allConnectors().map(describe),
    /**
     * Connectors that failed validation at boot and were NOT registered.
     *
     * Surfaced rather than only logged: a connector missing from the list with
     * no explanation is the kind of thing that gets rediscovered a fortnight
     * later by whoever wrote it.
     */
    problems: connectorProblems(),
    needsReview: connectorsNeedingReview().map((contract) => ({
      connectorId: contract.id,
      provider: contract.provider.name,
      apiVersion: contract.provider.apiVersion,
      lastVerified: contract.provider.lastVerified,
      docsUrl: contract.provider.docsUrl
    }))
  });
});

adminConnectorRoutes.get("/health", async (c) => {
  return successResponse(c, { connectors: await latestConnectorHealth() });
});

/** Run the whole sweep now, rather than waiting for tomorrow. */
adminConnectorRoutes.post("/health/run", async (c) => {
  return successResponse(c, await sweepConnectorHealth());
});

/** Test one connector on demand — what you press after fixing a key. */
adminConnectorRoutes.post("/:id/health", async (c) => {
  const contract = getConnector(c.req.param("id"));
  if (!contract) return errorResponse(c, "No connector with that id.", 404, "NOT_FOUND");
  return successResponse(c, await checkConnectorHealth(contract));
});
