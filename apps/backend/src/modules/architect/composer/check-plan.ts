/**
 * CHECKING WHAT THE COMPOSER PROPOSED.
 *
 * The composer writes a plan; this decides whether the plan is real. It is the
 * same arrangement that made the Node Frame work: a model may propose anything,
 * and a machine says whether it holds. Nothing reaches an architect's canvas
 * because it read well.
 *
 * Every problem here is written as an instruction back to the model, not as an
 * error message for a person. The loop feeds them straight back and asks again,
 * and in practice that converges in one or two rounds — the same way the fresh
 * model converged on a working connector once it was told exactly what was
 * wrong.
 */

import { checkWiring } from "@coreai/shared";
import type { MenuEntry } from "./node-menu";

export type PlannedNode = {
  id: string;
  type: string;
  title?: string;
  config?: Record<string, unknown>;
};

export type PlannedEdge = {
  from: string;
  to: string;
  /** For a branch: which side of the condition this wire leaves by. */
  when?: string;
};

export type ComposerPlan = {
  /** One plain line an architect reads before they look at the canvas. */
  summary: string;
  nodes: PlannedNode[];
  edges: PlannedEdge[];
  /** What the business will be asked for. Named, not invented at run time. */
  asksTheBusiness?: string[];
};

export function checkPlan(plan: ComposerPlan, menu: MenuEntry[]): string[] {
  const problems: string[] = [];
  const known = new Map(menu.map((entry) => [entry.type, entry]));
  const ids = new Set<string>();

  if (!plan.nodes?.length) {
    return ["The plan has no steps in it. Return at least a trigger and one action."];
  }

  /* ---- Every step must be a real one ----------------------------------- */
  for (const node of plan.nodes) {
    if (!node.id) {
      problems.push("Every step needs its own id, so the wires can point at it.");
      continue;
    }
    if (ids.has(node.id)) {
      problems.push(`Two steps share the id "${node.id}". Give each one its own.`);
    }
    ids.add(node.id);

    if (!known.has(node.type)) {
      // The single most important check. A made-up node type is the one
      // failure that produces a canvas which looks finished and does nothing.
      problems.push(
        `"${node.type}" is not a step that exists. Use only types from the list you were given, exactly as written.`
      );
    }
  }

  /* ---- Exactly one way in ---------------------------------------------- */
  const triggers = plan.nodes.filter((node) => known.get(node.type)?.kind === "trigger");
  if (triggers.length === 0) {
    problems.push(
      "Nothing starts this agent. Add exactly one trigger — the thing that happens in the world to set it off."
    );
  } else if (triggers.length > 1) {
    problems.push(
      `There are ${triggers.length} triggers. An agent has exactly one way in; pick the one the architect actually described and drop the rest.`
    );
  }

  /* ---- Every wire must point at something ------------------------------ */
  for (const edge of plan.edges ?? []) {
    if (!ids.has(edge.from)) problems.push(`A wire starts at "${edge.from}", which is not one of the steps.`);
    if (!ids.has(edge.to)) problems.push(`A wire ends at "${edge.to}", which is not one of the steps.`);
    if (edge.from === edge.to) problems.push(`The step "${edge.from}" is wired to itself.`);
  }

  /* ---- Nothing left stranded ------------------------------------------- */
  const reached = new Set(triggers.map((node) => node.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of plan.edges ?? []) {
      if (reached.has(edge.from) && !reached.has(edge.to)) {
        reached.add(edge.to);
        grew = true;
      }
    }
  }
  for (const node of plan.nodes) {
    if (!reached.has(node.id)) {
      // A step nothing leads to never runs. It reads as a feature on the
      // canvas and is a blank on the day somebody needs it.
      problems.push(
        `Nothing ever reaches "${node.id}". Wire it into the flow, or leave it out.`
      );
    }
  }

  /* ---- Does every step get the data it needs? ---------------------------- */
  //
  // The same check the builder runs, so an orchestration the composer produces
  // is held to exactly what a person's would be. Without this it could wire a
  // step to a value nothing supplies and hand over something that looks
  // finished and quietly does nothing.
  for (const problem of checkWiring({
    nodes: plan.nodes.map((node) => ({ id: node.id, data: { type: node.type, ...(node.config ?? {}) } })),
    edges: (plan.edges ?? []).map((edge) => ({ source: edge.from, target: edge.to }))
  }).problems) {
    if (problem.kind === "missing_value") {
      problems.push(
        `Step "${problem.nodeId}" uses "${problem.wanted}", which no step before it produces. Wire in a step that does, or write {{business.${problem.wanted.split(".").pop()}}} to have the business supply it.`
      );
    }
  }

  /* ---- It must not loop ------------------------------------------------ */
  if (hasCycle(plan)) {
    problems.push("The steps loop back on themselves, so the agent would never finish. Make it flow one way.");
  }

  /* ---- Every step must be told what it needs --------------------------- */
  for (const node of plan.nodes) {
    const entry = known.get(node.type);
    if (!entry) continue;
    for (const need of entry.needs) {
      const value = node.config?.[need];
      const supplied = value !== undefined && value !== null && String(value).trim() !== "";
      const fromBusiness = typeof value === "string" && /\{\{\s*business\./.test(value);
      if (!supplied && !fromBusiness) {
        problems.push(
          `Step "${node.id}" (${node.type}) needs "${need}" and was not given one. ` +
            `Either fill it in, or write {{business.${need}}} to have the business supply it.`
        );
      }
    }
  }

  return [...new Set(problems)];
}

function hasCycle(plan: ComposerPlan): boolean {
  const out = new Map<string, string[]>();
  for (const edge of plan.edges ?? []) {
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
  }

  const state = new Map<string, "visiting" | "done">();
  const walk = (id: string): boolean => {
    const seen = state.get(id);
    if (seen === "visiting") return true;
    if (seen === "done") return false;
    state.set(id, "visiting");
    for (const next of out.get(id) ?? []) {
      if (walk(next)) return true;
    }
    state.set(id, "done");
    return false;
  };

  return plan.nodes.some((node) => walk(node.id));
}
