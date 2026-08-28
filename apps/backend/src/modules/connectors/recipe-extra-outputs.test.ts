import { describe, expect, it } from "vitest";
import { heartFromRecipe } from "./recipe-heart";
import type { NodeFrameDeclaration } from "@coreai/shared";

/**
 * OUR NAME IS NOT THE PROVIDER'S PATH (2026-08-28).
 *
 * A described connector's first output comes from the recipe's `resultsAt`.
 * Every output after it was looked up by the name WE gave it — "totalFound",
 * "skipped" — as though the service answered in our words. It never does, so
 * a described card's second output was undefined on every single run, and
 * nothing anywhere said so.
 */

const declaration = (produces: NodeFrameDeclaration["produces"]): NodeFrameDeclaration =>
  ({
    id: "weather.today",
    version: "1.0.0",
    job: "custom",
    label: "Today's weather",
    description: "Reads a forecast.",
    provider: {
      name: "Open-Meteo",
      docsUrl: "https://open-meteo.com/en/docs",
      apiVersion: "v1",
      lastVerified: "2026-08-26"
    },
    needs: { platform: [], architect: [], business: [], accounts: [] },
    produces,
    cost: { style: "free", estimateCents: 0, unit: "per call", billedTo: "platform" },
    failure: { onError: "fail", retries: 0 },
    limits: { pageSize: 1, maxPages: 1 },
    rules: {},
    health: { everyHours: 24, expectKeys: [], severity: "informational" },
    execution: "immediate",
    rollout: "everyone",
    recipe: {
      method: "GET",
      url: "https://api.open-meteo.com/v1/forecast",
      resultsAt: "hourly.temperature_2m"
    }
  }) as never;

/* The engine hands every heart its own http function — nothing here touches
   the network, and nothing here can. */
const context = {
  config: {},
  secrets: {},
  page: 1,
  pageSize: 1,
  log: () => undefined,
  http: async () => ({
    ok: true,
    status: 200,
    body: {
      hourly: { temperature_2m: [12, 13, 14] },
      meta: { total: 3 }
    }
  })
} as never;

describe("a described connector's extra outputs", () => {
  it("reads the second output from the path the card declares", async () => {
    const heart = heartFromRecipe(
      declaration([
        { key: "temperatures", label: "Temperatures", kind: "list", required: true, sample: [] },
        {
          key: "totalFound",
          label: "How many",
          kind: "number",
          required: false,
          sample: 3,
          at: "meta.total"
        }
      ])
    );

    const result = await heart(context);

    expect(result.outputs.temperatures).toEqual([12, 13, 14]);
    expect(result.outputs.totalFound).toBe(3);
  });

  it("is honestly empty when no path was declared, never a stray lookup by our own name", async () => {
    const heart = heartFromRecipe(
      declaration([
        { key: "temperatures", label: "Temperatures", kind: "list", required: true, sample: [] },
        { key: "meta", label: "Anything else", kind: "object", required: false, sample: {} }
      ])
    );

    const result = await heart(context);

    /* "meta" happens to exist in this provider's body. Before the fix, our
       own output name was used as a path and this quietly picked it up —
       right by accident here, wrong on every real service. */
    expect(result.outputs.meta).toBeNull();
  });
});
