import { BLOCK_NODE_TYPES } from "@coreai/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { buildAllCallingAgentDraftDefinitions } from "../architect/calling-agent-drafts";
import { deriveFaceBlueprint } from "./blueprint";

/**
 * End-to-end smoke: deriveFaceBlueprint against the REAL production node
 * shape, not a hand-written fixture.
 *
 * Two layers:
 *
 * 1. Deterministic (always runs): scripts/seed-calling-agents.ts writes
 *    `definition.workflowJson` verbatim into WorkflowDefinition rows, so
 *    buildAllCallingAgentDraftDefinitions() IS the byte-for-byte shape of
 *    seeded production rows — nodes[] of { id, type: "coreNode",
 *    position: {x,y}, data: { type, nodeKind, label, title, subtitle,
 *    ...flattened config } }.
 *
 * 2. Live row (read-only, skipped when the database is unreachable): pick
 *    any WorkflowDefinition row, deep-copy its workflowJson, append two
 *    block nodes to the COPY, and assert ordered derivation. The row itself
 *    is never written.
 */

/** Production-shaped block node, mirroring what the builder serializes. */
function productionBlockNode(
  id: string,
  type: string,
  position: { x: number; y: number },
  config: Record<string, unknown> = {}
) {
  return {
    id,
    type: "coreNode",
    position,
    data: {
      type,
      nodeKind: "block",
      label: "Product Section",
      title: "Product Section",
      ...config
    }
  };
}

/** The two appended blocks sit far below any real canvas content (y ≈ 1e6),
 * with array order REVERSED from canvas order so the y-then-x sort is what
 * puts them right. */
function appendTwoBlocks(workflowJson: { nodes: unknown[] }) {
  workflowJson.nodes.push(
    productionBlockNode("smoke-styles", BLOCK_NODE_TYPES.presetGallery, { x: 80, y: 1_000_200 }, {
      presets: [
        { id: "vivid", title: "Vivid", emoji: "🎨", promptFragment: "vivid colors, high contrast" }
      ]
    }),
    productionBlockNode("smoke-prompt", BLOCK_NODE_TYPES.promptComposer, { x: 80, y: 1_000_100 }, {
      placeholder: "Describe your dream photo…"
    })
  );
}

let dbAvailable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn(
      "[blueprint-production-shape.test] database unreachable — live-row case skipped (deterministic production-shape case still runs)"
    );
  }
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("deriveFaceBlueprint against the production workflowJson shape", () => {
  it("seeded production definition: null without blocks, ordered blocks after appending two", () => {
    const definitions = buildAllCallingAgentDraftDefinitions();
    expect(definitions.length).toBeGreaterThan(0);

    // Any seeded row — same objects the seed script stores verbatim.
    const definition = definitions[0];
    const copy = JSON.parse(JSON.stringify(definition.workflowJson)) as { nodes: unknown[] };
    expect(Array.isArray(copy.nodes)).toBe(true);
    expect(copy.nodes.length).toBeGreaterThan(0);

    // Backward compatibility: a real graph with zero block nodes keeps the
    // default Face.
    expect(deriveFaceBlueprint(copy)).toBeNull();

    appendTwoBlocks(copy);
    const blueprint = deriveFaceBlueprint(copy);

    expect(blueprint).not.toBeNull();
    // Only the two appended blocks derive — none of the real trigger/ai/
    // connector nodes leak into the Face.
    expect(blueprint!.blocks).toHaveLength(2);
    // Canvas order (y then x), not array order: prompt (y 1_000_100) comes
    // before styles (y 1_000_200) even though it was appended second.
    expect(blueprint!.blocks[0]).toEqual({
      nodeId: "smoke-prompt",
      type: BLOCK_NODE_TYPES.promptComposer,
      config: { placeholder: "Describe your dream photo…" }
    });
    expect(blueprint!.blocks[1]).toEqual({
      nodeId: "smoke-styles",
      type: BLOCK_NODE_TYPES.presetGallery,
      config: {
        presets: [
          { id: "vivid", title: "Vivid", emoji: "🎨", promptFragment: "vivid colors, high contrast" }
        ]
      }
    });
  });

  it("live WorkflowDefinition row (read-only): appending two blocks to a copy derives ordered blocks", async () => {
    if (!dbAvailable) return;

    const row = await prisma.workflowDefinition.findFirst({
      select: { id: true, workflowJson: true },
      orderBy: { createdAt: "asc" }
    });
    if (!row) {
      console.warn("[blueprint-production-shape.test] no WorkflowDefinition rows — live-row case skipped");
      return;
    }

    const copy = JSON.parse(JSON.stringify(row.workflowJson)) as { nodes?: unknown[] };
    if (!Array.isArray(copy.nodes)) {
      // Legacy/empty graphs derive no Face — still a valid production shape.
      expect(deriveFaceBlueprint(copy)).toBeNull();
      return;
    }

    appendTwoBlocks(copy as { nodes: unknown[] });
    const blueprint = deriveFaceBlueprint(copy);

    expect(blueprint).not.toBeNull();
    const appended = blueprint!.blocks.filter((block) =>
      [BLOCK_NODE_TYPES.promptComposer, BLOCK_NODE_TYPES.presetGallery].includes(
        block.type as typeof BLOCK_NODE_TYPES.promptComposer | typeof BLOCK_NODE_TYPES.presetGallery
      )
    );
    // Both appended blocks derive, in canvas order (prompt above styles).
    const promptIndex = blueprint!.blocks.findIndex(
      (block) => block.type === BLOCK_NODE_TYPES.promptComposer
    );
    const stylesIndex = blueprint!.blocks.findIndex(
      (block) => block.type === BLOCK_NODE_TYPES.presetGallery
    );
    expect(appended.length).toBeGreaterThanOrEqual(2);
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    expect(stylesIndex).toBeGreaterThanOrEqual(0);
    expect(promptIndex).toBeLessThan(stylesIndex);
  });
});
