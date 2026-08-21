/**
 * DOES EVERY STEP GET THE DATA IT NEEDS?
 *
 * The spine. It runs before an orchestration goes live, and again every time an
 * architect adds, removes or rewires a node.
 *
 * The obvious way to build this would be to make every node declare what it
 * requires and check that list. That was tried and it is the weaker design, for
 * a plain reason: most steps need CONFIG, not data from an earlier step. An AI
 * Brain needs a prompt, not somebody's output. Declaring requirements for all
 * of them would mean inventing needs that are not real, and a check built on
 * invented needs produces false red — which is how a real warning stops being
 * read.
 *
 * So this checks what the architect ACTUALLY WROTE. Every {{token}} in a step's
 * settings is a promise that something will be there when the step runs. This
 * finds the promises nothing keeps.
 *
 * It needs no new declarations, it works on node types nobody has invented yet,
 * and it catches the exact failure the founder described: a step wired to a
 * value that never arrives, where nothing looks broken and the business quietly
 * gets nothing.
 */

import { getNodeDefinition } from "./node-registry.js";
import { canonicalPromptVariableKey, KNOWN_PROMPT_VARIABLES } from "./prompt-variables.js";

export type WiringNode = {
  id: string;
  data?: Record<string, unknown>;
};

export type WiringEdge = {
  source: string;
  target: string;
};

export type WiringProblem = {
  nodeId: string;
  /** The step's own name, for a message a person can act on. */
  nodeLabel: string;
  kind: "missing_value" | "unreachable" | "needs_upstream";
  /** What it asked for and did not get. */
  wanted: string;
  message: string;
};

export type WiringResult = {
  ok: boolean;
  problems: WiringProblem[];
  /** Steps with nothing wrong. Used to paint the canvas green. */
  healthyNodeIds: string[];
};

/**
 * Names the platform supplies on every run, whatever the orchestration is.
 *
 * Read from KNOWN_PROMPT_VARIABLES rather than written out here. That list is
 * already the platform's answer to "what can a prompt refer to", and keeping a
 * second copy would mean this check slowly disagreeing with the thing it is
 * checking.
 *
 * It matters more than it looks. Run against the 57 real workflows in
 * production, a hand-written list flagged 37 of them — almost all for
 * assistantName, business_hours and currentDateTime, which the platform fills
 * in itself. That is a wall of false red, and a wall of false red is a check
 * nobody reads by the second week.
 */
const ALWAYS_AVAILABLE = new Set<string>([
  ...KNOWN_PROMPT_VARIABLES,
  ...KNOWN_PROMPT_VARIABLES.map((name) => canonicalPromptVariableKey(name)),
  // Shapes the run carries that a prompt would not name directly. Kept short
  // on purpose: every name added here is one this check stops looking at.
  "business",
  "services",
  "memory",
  "latestMessage",
  "attachments",
  "now",
  "today",
  "date",
  "time"
]);

/** Settings that are presentation or wiring, never a promise about data. */
const NOT_A_PROMISE =
  /^(type|nodeKind|label|title|subtitle|icon|accent|kind|footer|connector|connectorAction|doors|position|frameDeclaration|connectorId)$/;

/** Every {{token}} an architect wrote into this step's settings. */
export function tokensUsedBy(node: WiringNode): string[] {
  const found = new Set<string>();

  const walk = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) found.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (NOT_A_PROMISE.test(key)) continue;
        walk(inner);
      }
    }
  };

  walk(node.data ?? {});
  return [...found];
}

/** Everything a step hands on, by the names it declares. */
function producedBy(node: WiringNode): string[] {
  const type = String(node.data?.type ?? "");
  const definition = getNodeDefinition(type);
  return [...(definition?.producedVariables ?? [])];
}

/** Every step that runs before this one, following the wires backwards. */
function upstreamOf(nodeId: string, edges: WiringEdge[]): Set<string> {
  const into = new Map<string, string[]>();
  for (const edge of edges) into.set(edge.target, [...(into.get(edge.target) ?? []), edge.source]);

  const seen = new Set<string>();
  const queue = [...(into.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(into.get(id) ?? []));
  }
  return seen;
}

/**
 * Is this name satisfied by something?
 *
 * Generous about shape for the same reason the honesty check is: a step
 * producing "caller.phone" satisfies a reference to "caller", and a step
 * producing "callerNumber" satisfies "callerNumber.formatted". Being strict
 * here would flag working orchestrations, and one false alarm costs more than
 * one missed warning — because after the first false alarm nobody reads the
 * second one.
 */
function isSatisfied(wanted: string, available: Set<string>): boolean {
  if (available.has(wanted)) return true;

  // The same value is written three ways across the platform — assistantName,
  // assistant_name, assistant.name — and all three mean the same thing.
  const canonical = canonicalPromptVariableKey(wanted.replace(/\./g, "_"));
  if (available.has(canonical)) return true;
  for (const name of available) {
    if (canonicalPromptVariableKey(name.replace(/\./g, "_")) === canonical) return true;
  }

  const head = wanted.split(".")[0];
  if (available.has(head)) return true;

  for (const name of available) {
    if (name.startsWith(`${wanted}.`)) return true;
    if (wanted.startsWith(`${name}.`)) return true;
  }
  return false;
}

export function checkWiring(input: { nodes: WiringNode[]; edges: WiringEdge[] }): WiringResult {
  const nodes = input.nodes ?? [];
  const edges = input.edges ?? [];
  const problems: WiringProblem[] = [];
  const unhealthy = new Set<string>();

  const labelOf = (node: WiringNode) =>
    String(node.data?.title ?? node.data?.label ?? node.data?.type ?? node.id);

  const byId = new Map(nodes.map((node) => [node.id, node]));

  const triggers = nodes.filter((node) => {
    const type = String(node.data?.type ?? "");
    return (
      String(node.data?.nodeKind ?? "") === "trigger" ||
      getNodeDefinition(type)?.runtime.nodeKind === "trigger"
    );
  });

  /* ---- A step nothing leads to never runs ------------------------------- */
  const reachable = new Set(triggers.map((node) => node.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of edges) {
      if (reachable.has(edge.source) && !reachable.has(edge.target)) {
        reachable.add(edge.target);
        grew = true;
      }
    }
  }

  for (const node of nodes) {
    if (triggers.length > 0 && !reachable.has(node.id)) {
      unhealthy.add(node.id);
      problems.push({
        nodeId: node.id,
        nodeLabel: labelOf(node),
        kind: "unreachable",
        wanted: "",
        message: "Nothing leads to this step, so it will never run. Connect it, or remove it."
      });
    }
  }

  /* ---- Every promise must be kept --------------------------------------- */
  for (const node of nodes) {
    const wanted = tokensUsedBy(node);
    if (wanted.length === 0) continue;

    const available = new Set<string>(ALWAYS_AVAILABLE);
    for (const id of upstreamOf(node.id, edges)) {
      const upstream = byId.get(id);
      if (upstream) for (const name of producedBy(upstream)) available.add(name);
    }

    for (const name of wanted) {
      // The architect saying "the business fills this in" is an answer, not a
      // gap — it becomes a question on their setup form.
      if (name.startsWith("business.")) continue;
      if (isSatisfied(name, available)) continue;

      unhealthy.add(node.id);
      problems.push({
        nodeId: node.id,
        nodeLabel: labelOf(node),
        kind: "missing_value",
        wanted: name,
        message: `This step uses "${name}", and no step before it produces that. It will be empty every time.`
      });
    }
  }

  /* ---- And what a step formally declares it needs ------------------------ */
  for (const node of nodes) {
    const definition = getNodeDefinition(String(node.data?.type ?? ""));
    const requires = definition?.requiredVariables ?? [];
    if (requires.length === 0) continue;

    const available = new Set<string>(ALWAYS_AVAILABLE);
    for (const id of upstreamOf(node.id, edges)) {
      const upstream = byId.get(id);
      if (upstream) for (const name of producedBy(upstream)) available.add(name);
    }

    for (const name of requires) {
      if (isSatisfied(name, available)) continue;
      // Config the architect filled in by hand counts: a step told the value
      // directly does not need an earlier step to hand it over.
      if (node.data && name in node.data && String(node.data[name] ?? "").trim()) continue;

      unhealthy.add(node.id);
      problems.push({
        nodeId: node.id,
        nodeLabel: labelOf(node),
        kind: "needs_upstream",
        wanted: name,
        message: `This step needs "${name}" and nothing before it provides one.`
      });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    healthyNodeIds: nodes.filter((node) => !unhealthy.has(node.id)).map((node) => node.id)
  };
}
