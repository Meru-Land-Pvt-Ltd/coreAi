/**
 * FIX IT FOR ME.
 *
 * A step on the canvas has gone red — it uses a value nothing produces, or
 * nothing leads to it. This repairs it.
 *
 * One decision shapes everything else here: THE REPAIR CANNOT DELETE ANYTHING.
 *
 * The obvious way to build this would be to hand the model the whole canvas and
 * take back a corrected one. That works right up until the day it quietly drops
 * a step somebody spent an afternoon on, and after that nobody presses the
 * button again. So the model does not return a canvas. It returns a short list
 * of changes in a vocabulary with three verbs — set a value, add a step, add a
 * wire — and no verb for removing anything. Losing an architect's work is not
 * something the repair is trusted not to do; it is something it cannot express.
 *
 * Everything else follows the pattern that has worked three times on this
 * platform now: the model proposes, a machine checks, and the exact problems go
 * straight back for another go.
 */

import { checkWiring, type WiringProblem } from "@coreai/shared";
import { resolveBrainSlot } from "../../admin/brain-slot-settings";
import { getSmartDesignerBrainConfig } from "../../admin/smart-designer-brain-settings";
import { getProviderEngine } from "../../ai-provider-engine/provider-engine";
import type { AIExecuteRequest, AIMessage } from "../../ai-provider-engine/types";
import { composerMenu, menuAsText } from "./node-menu";

export type CanvasNodeIn = {
  id: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
};

export type CanvasEdgeIn = { id?: string; source: string; target: string };

/** The only three things a repair may do. There is no verb for removing. */
type Change =
  | { set: { nodeId: string; values: Record<string, unknown> } }
  | { addStep: { id: string; type: string; title?: string; config?: Record<string, unknown>; after: string; before?: string } }
  | { addWire: { from: string; to: string } };

export type RepairResult =
  | {
      ok: true;
      summary: string;
      nodes: CanvasNodeIn[];
      edges: CanvasEdgeIn[];
      fixed: string[];
      remaining: WiringProblem[];
      attempts: number;
    }
  | { ok: false; message: string; remaining?: WiringProblem[] };

const MAX_ATTEMPTS = 3;

function describeCanvas(nodes: CanvasNodeIn[], edges: CanvasEdgeIn[]): string {
  const lines = nodes.map((node) => {
    const data = node.data ?? {};
    const settings = Object.entries(data)
      .filter(([key]) => !/^(type|nodeKind|icon|accent|kind|label|position|wiringProblems|wiringChecked)$/.test(key))
      .filter(([, value]) => typeof value === "string" || typeof value === "number")
      .map(([key, value]) => `      ${key}: ${String(value).slice(0, 200)}`)
      .join("\n");

    return [
      `  - id "${node.id}" · type ${String(data.type ?? "unknown")} · "${String(data.title ?? node.id)}"`,
      settings || "      (no settings)"
    ].join("\n");
  });

  const wires = edges.map((edge) => `  - ${edge.source} → ${edge.target}`);
  return [`STEPS:`, ...lines, ``, `WIRES:`, ...(wires.length ? wires : ["  (none)"])].join("\n");
}

function systemPrompt(menu: string): string {
  return [
    "You repair one thing at a time in an agent somebody else built.",
    "",
    "You are shown their canvas and exactly what is wrong with it. Fix only what is listed.",
    "",
    "THE MOST IMPORTANT RULE: this is somebody's work. Change as little as will fix the problem.",
    "Do not tidy, do not rename things you were not asked about, do not restructure. An architect",
    "who presses this and finds their agent rearranged will never press it again.",
    "",
    "THE STEPS YOU MAY ADD — there are no others, and you may not write code:",
    menu,
    "",
    "HOW TO FIX THE TWO KINDS OF PROBLEM",
    '- "uses X, and no step before it produces that" — either add a step before it that DOES produce X',
    "  (look at the `gives` line of each step above), or, when X is something only the business could",
    "  know — their phone number, their opening hours — change it to {{business.X}} so they are asked",
    "  for it on their setup screen. Prefer the second when it plainly belongs to the business.",
    '- "nothing leads to this step" — add a wire from wherever it belongs in the flow.',
    "",
    "OUTPUT",
    'Return ONLY JSON: { "summary": string, "changes": [ ... ] }',
    "Each change is exactly one of:",
    '  { "set": { "nodeId": "...", "values": { "settingName": "new value" } } }',
    '  { "addStep": { "id": "new1", "type": "...", "title": "...", "after": "existingNodeId" } }',
    '  { "addWire": { "from": "nodeId", "to": "nodeId" } }',
    'summary: one plain sentence saying what you changed, for a non-technical person.',
    "No markdown, no code fences, nothing before or after the JSON."
  ].join("\n");
}

function parseJson(text: string): unknown {
  const trimmed = (text ?? "").trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Apply the changes to a copy.
 *
 * Nothing is removed, because nothing can be: a change is a set, an add or a
 * wire. A `set` on a step that does not exist is ignored rather than creating
 * one, so a hallucinated id cannot conjure a step onto somebody's canvas.
 */
function applyChanges(
  nodes: CanvasNodeIn[],
  edges: CanvasEdgeIn[],
  changes: Change[]
): { nodes: CanvasNodeIn[]; edges: CanvasEdgeIn[] } {
  const nextNodes: Array<CanvasNodeIn & { data: Record<string, unknown> }> = nodes.map((node) => ({
    ...node,
    data: { ...(node.data ?? {}) }
  }));
  const nextEdges = [...edges];
  const byId = new Map(nextNodes.map((node) => [node.id, node]));

  for (const change of changes) {
    if ("set" in change) {
      const target = byId.get(change.set.nodeId);
      if (!target) continue;
      for (const [key, value] of Object.entries(change.set.values ?? {})) {
        // Identity and presentation are not settings a repair may touch.
        if (/^(id|type|nodeKind|position)$/.test(key)) continue;
        target.data[key] = value;
      }
      continue;
    }

    if ("addStep" in change) {
      const step = change.addStep;
      if (!step.id || byId.get(step.id)) continue;

      const anchor = byId.get(step.after);
      const created: CanvasNodeIn & { data: Record<string, unknown> } = {
        id: step.id,
        position: anchor?.position
          ? { x: anchor.position.x + 340, y: anchor.position.y }
          : { x: 120, y: 120 },
        data: {
          type: step.type,
          title: step.title ?? step.type,
          label: step.title ?? step.type,
          ...(step.config ?? {})
        }
      };
      nextNodes.push(created);
      byId.set(created.id, created);

      // Slot it in: the anchor now leads to the new step, and the new step
      // leads wherever the anchor used to.
      const onwards = nextEdges.filter((edge) => edge.source === step.after);
      for (const edge of onwards) edge.source = created.id;
      nextEdges.push({ id: `e-${step.after}-${created.id}`, source: step.after, target: created.id });
      continue;
    }

    if ("addWire" in change) {
      const { from, to } = change.addWire;
      if (!byId.get(from) || !byId.get(to) || from === to) continue;
      if (nextEdges.some((edge) => edge.source === from && edge.target === to)) continue;
      nextEdges.push({ id: `e-${from}-${to}`, source: from, target: to });
    }
  }

  return { nodes: nextNodes, edges: nextEdges };
}

export async function repairCanvas(input: {
  architectUserId: string;
  nodes: CanvasNodeIn[];
  edges: CanvasEdgeIn[];
  hiddenNodeTypes?: string[];
}): Promise<RepairResult> {
  const before = checkWiring({
    nodes: input.nodes.map((node) => ({ id: node.id, data: node.data })),
    edges: input.edges.map((edge) => ({ source: edge.source, target: edge.target }))
  });

  if (before.ok) {
    return { ok: false, message: "Nothing is wrong with this one — there is nothing to fix." };
  }

  const brain = resolveBrainSlot(await getSmartDesignerBrainConfig());
  if (!brain) {
    return {
      ok: false,
      message: "No AI service is switched on yet, so nothing can be repaired. An admin sets that up in Manage API.",
      remaining: before.problems
    };
  }

  const menu = menuAsText(await composerMenu(input.architectUserId, input.hiddenNodeTypes ?? []));

  let nodes = input.nodes;
  let edges = input.edges;
  let problems = before.problems;

  const messages: AIMessage[] = [
    {
      role: "user",
      content: [
        describeCanvas(nodes, edges),
        "",
        "WHAT IS WRONG:",
        ...problems.map((problem) => `- step "${problem.nodeId}": ${problem.message}`)
      ].join("\n")
    }
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const request: AIExecuteRequest = {
      capability: "llm",
      systemPrompt: systemPrompt(menu),
      conversationHistory: [],
      messages: [...messages],
      // Very low. This is a correction, not a rewrite, and warmth here shows up
      // as an architect's work being "improved" without being asked.
      temperature: 0.1,
      maxTokens: 3000,
      outputFormat: "json",
      task: "repair-orchestration",
      ...(brain.model ? { model: brain.model } : {})
    };

    let response;
    try {
      response = await getProviderEngine().executeWithProvider(brain.providerId, request);
    } catch (error) {
      console.error("[repair] LLM call failed", error);
      return {
        ok: false,
        message: "The AI service could not be reached, so nothing was changed on your canvas.",
        remaining: problems
      };
    }
    if (response.status === "error") {
      return {
        ok: false,
        message: "The AI service returned an error, so nothing was changed on your canvas.",
        remaining: problems
      };
    }

    const raw =
      response.structuredOutput && typeof response.structuredOutput === "object"
        ? response.structuredOutput
        : parseJson(response.text ?? "");
    const proposal = raw as { summary?: string; changes?: Change[] } | null;

    if (!proposal || !Array.isArray(proposal.changes) || proposal.changes.length === 0) {
      messages.push({ role: "assistant", content: (response.text ?? "").slice(0, 1500) });
      messages.push({
        role: "user",
        content: 'That was not usable. Return exactly { "summary": string, "changes": [ ... ] } with at least one change.'
      });
      continue;
    }

    const applied = applyChanges(nodes, edges, proposal.changes);

    // A repair that loses a step is not a repair. The vocabulary has no way to
    // remove one, so this can only trip on a bug — and if it ever does, the
    // architect's canvas is left exactly as it was.
    const lost = nodes.filter((node) => !applied.nodes.some((kept) => kept.id === node.id));
    if (lost.length > 0) {
      console.error("[repair] a change would have lost a step; refused", { lost: lost.map((node) => node.id) });
      return {
        ok: false,
        message: "That repair would have removed part of your agent, so nothing was changed.",
        remaining: problems
      };
    }

    const after = checkWiring({
      nodes: applied.nodes.map((node) => ({ id: node.id, data: node.data })),
      edges: applied.edges.map((edge) => ({ source: edge.source, target: edge.target }))
    });

    // Never hand back something worse than what they had.
    if (after.problems.length >= problems.length) {
      messages.push({ role: "assistant", content: JSON.stringify(proposal).slice(0, 2000) });
      messages.push({
        role: "user",
        content: [
          "That did not fix it. What is still wrong:",
          ...after.problems.map((problem) => `- step "${problem.nodeId}": ${problem.message}`)
        ].join("\n")
      });
      continue;
    }

    nodes = applied.nodes;
    edges = applied.edges;
    const fixed = problems
      .filter((was) => !after.problems.some((still) => still.nodeId === was.nodeId && still.wanted === was.wanted))
      .map((problem) => `${problem.nodeLabel}: ${problem.wanted || "not connected"}`);
    problems = after.problems;

    if (after.ok) {
      return {
        ok: true,
        summary: String(proposal.summary ?? "Fixed.").slice(0, 300),
        nodes,
        edges,
        fixed,
        remaining: [],
        attempts: attempt
      };
    }

    // Better, but not finished. Keep what was gained and go round again.
    messages.push({ role: "assistant", content: JSON.stringify(proposal).slice(0, 2000) });
    messages.push({
      role: "user",
      content: [
        "Better. What is still wrong:",
        ...after.problems.map((problem) => `- step "${problem.nodeId}": ${problem.message}`)
      ].join("\n")
    });
  }

  // Some of it was fixed, and saying which is more useful than starting over.
  if (problems.length < before.problems.length) {
    return {
      ok: true,
      summary: "Fixed some of it. What is left needs a decision only you can make.",
      nodes,
      edges,
      fixed: before.problems
        .filter((was) => !problems.some((still) => still.nodeId === was.nodeId && still.wanted === was.wanted))
        .map((problem) => `${problem.nodeLabel}: ${problem.wanted || "not connected"}`),
      remaining: problems,
      attempts: MAX_ATTEMPTS
    };
  }

  return {
    ok: false,
    message:
      "I could not fix this one automatically, so nothing was changed. The problems on each step say what is missing.",
    remaining: problems
  };
}
