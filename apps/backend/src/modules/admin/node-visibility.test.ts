import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { defaultHiddenArchitectNodeTypes, isArchitectNodeType } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import {
  invalidateArchitectNodeVisibilityCache,
  listArchitectNodeVisibility,
  listHiddenArchitectNodeTypes,
  saveArchitectNodeVisibility
} from "./node-visibility";

const RUN = `nodevis-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[node-visibility.test] database unreachable — suite skipped");
  }
});

afterEach(async () => {
  if (!dbAvailable) return;
  await prisma.architectNodeVisibility.deleteMany({ where: { nodeType: { startsWith: "ai." } } });
  await prisma.architectNodeVisibility.deleteMany({ where: { nodeType: { startsWith: "action.human" } } });
  invalidateArchitectNodeVisibilityCache();
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.architectNodeVisibility.deleteMany({ where: { nodeType: { contains: RUN } } });
});

describe("architect node visibility", () => {
  it("rejects unknown node types", () => {
    expect(isArchitectNodeType("not.a.node")).toBe(false);
    expect(isArchitectNodeType("ai.llm_call")).toBe(true);
  });

  it("hides catalog defaults until an admin override exists", async () => {
    if (!dbAvailable) return;
    invalidateArchitectNodeVisibilityCache();
    const hidden = await listHiddenArchitectNodeTypes();
    expect(hidden).toEqual(defaultHiddenArchitectNodeTypes());
  });

  it("lets admin show a previously hidden node", async () => {
    if (!dbAvailable) return;
    await saveArchitectNodeVisibility([{ type: "action.human_handoff", visible: true }]);
    const nodes = await listArchitectNodeVisibility();
    const handoff = nodes.find((node) => node.type === "action.human_handoff");
    expect(handoff?.visible).toBe(true);
    expect(handoff?.defaultVisible).toBe(false);
    const hidden = await listHiddenArchitectNodeTypes();
    expect(hidden).not.toContain("action.human_handoff");
  });

  it("lets admin hide a currently visible node", async () => {
    if (!dbAvailable) return;
    await saveArchitectNodeVisibility([{ type: "ai.llm_call", visible: false }]);
    const hidden = await listHiddenArchitectNodeTypes();
    expect(hidden).toContain("ai.llm_call");
  });

  it("lets admin rename a node and move its group", async () => {
    if (!dbAvailable) return;
    await saveArchitectNodeVisibility([
      { type: "ai.llm_call", label: "Custom Brain", group: "Custom AI" }
    ]);
    const nodes = await listArchitectNodeVisibility();
    const brain = nodes.find((node) => node.type === "ai.llm_call");
    expect(brain?.label).toBe("Custom Brain");
    expect(brain?.group).toBe("Custom AI");
    expect(brain?.defaultLabel).toBe("AI Brain");
    expect(brain?.defaultGroup).toBe("AI");
    expect(brain?.visible).toBe(true);
  });

  it("keeps stored name when only visibility is updated", async () => {
    if (!dbAvailable) return;
    await saveArchitectNodeVisibility([{ type: "ai.llm_call", label: "Keep Me" }]);
    await saveArchitectNodeVisibility([{ type: "ai.llm_call", visible: false }]);
    const nodes = await listArchitectNodeVisibility();
    const brain = nodes.find((node) => node.type === "ai.llm_call");
    expect(brain?.label).toBe("Keep Me");
    expect(brain?.visible).toBe(false);
  });
});
