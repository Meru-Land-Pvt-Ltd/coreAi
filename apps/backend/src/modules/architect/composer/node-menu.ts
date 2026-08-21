/**
 * THE MENU THE COMPOSER MAY CHOOSE FROM.
 *
 * An architect describes what they want in plain English and the platform
 * assembles the orchestration. The one rule that makes that safe is that it may
 * only use nodes that already exist — it cannot invent a step, and it cannot
 * write code.
 *
 * So the menu is READ FROM THE REGISTRY rather than written here. A node added
 * next year is composable the day it ships, and a node retired today stops
 * being offered the same day, without anyone remembering to edit a list. That
 * is the same principle as the Node Frame: describe the thing once, and let
 * everything else be a function of the description.
 *
 * What each entry carries is chosen for a model, not for a person: what the
 * step DOES, what it must be told, and what it hands to the step after it. That
 * last one is what lets the composer wire a graph rather than pile up steps —
 * "this node produces `leads`, that node needs `leads`" is the whole of it.
 */

import {
  ARCHITECT_NODE_CATALOG,
  getNodeDefinition,
  type NodeDefinition
} from "@coreai/shared";
import { allConnectors } from "../../connectors/registry";
import { readyFramesFor } from "../../connectors/architect-frames";
import { pausedNodeTypes } from "../../admin/node-controls";

export type MenuEntry = {
  type: string;
  label: string;
  does: string;
  /** "trigger" starts a run; the rest happen inside one. */
  kind: string;
  /** Settings this step cannot run without. */
  needs: string[];
  /** Values it hands to later steps. */
  gives: string[];
  /** True for a step that reaches a real person or spends real money. */
  reachesTheWorld: boolean;
};

/**
 * Steps that touch somebody outside the business.
 *
 * Marked so the composer can be told to use them sparingly and never to invent
 * a second one "just in case" — an extra send node is not an extra feature, it
 * is a second text message to a real patient.
 */
const REACHES_THE_WORLD = /send|call|email|sms|whatsapp|telegram|book|dial/i;

function entryFor(definition: NodeDefinition): MenuEntry {
  return {
    type: definition.type,
    label: definition.label,
    does: definition.description,
    kind: definition.runtime.nodeKind,
    needs: definition.requiredConfig ?? [],
    gives: definition.producedVariables ?? [],
    reachesTheWorld:
      REACHES_THE_WORLD.test(definition.type) || REACHES_THE_WORLD.test(definition.label)
  };
}

/**
 * Every node an architect may be given, including their own.
 *
 * Hidden nodes are left out: an admin who switched something off the palette
 * did so for a reason, and a composer that used it anyway would put a node on
 * the canvas the architect cannot find in their own sidebar.
 */
export async function composerMenu(architectUserId: string, hiddenTypes: string[] = []): Promise<MenuEntry[]> {
  const hidden = new Set(hiddenTypes);

  /*
   * A paused step is not offered either.
   *
   * Hidden and paused are different switches, but both mean "do not put this in
   * something new". Composing with a paused step would hand an architect an
   * agent with a step that cannot run, which is worse than not offering it —
   * they would publish it and find out from a customer.
   */
  for (const nodeType of (await pausedNodeTypes().catch(() => new Map<string, string>())).keys()) {
    hidden.add(nodeType);
  }

  const entries: MenuEntry[] = [];

  for (const item of ARCHITECT_NODE_CATALOG) {
    if (hidden.has(item.type)) continue;
    const definition = getNodeDefinition(item.type);
    if (!definition) continue;
    // Only genuinely unbuilt steps are held back.
    //
    // There used to be a `backendExecutable` filter here as well, on the
    // reasoning that a step the server cannot run is a drawing. It was wrong,
    // and wrong in the most damaging way available: that flag is false on the
    // AI receptionist, Send Text, Check Availability, Book Appointment and Send
    // Email — the five steps a receptionist is actually made of. The live
    // Dental AI Receptionist is built from exactly those five and books real
    // patients every week.
    //
    // The flag means "not run as an ordinary graph step" — the voice
    // conversation configures the assistant, and booking is called as a tool
    // during the call — which is a fact about HOW they run, not about whether
    // they work. Reading it as "cannot be used" left the composer choosing
    // WhatsApp for somebody who telephoned, because WhatsApp was the only thing
    // it was allowed to see. No amount of prompt wording fixes a menu with the
    // right answer missing from it.
    if (definition.comingSoon) continue;
    entries.push(entryFor(definition));
  }

  // Connectors, ours and the architect's own, offered the same way: by what
  // job they do, never by the company's name.
  const frames = [
    ...allConnectors().filter((frame) => frame.rollout !== "internal"),
    ...(await readyFramesFor(architectUserId).catch(() => []))
  ];

  for (const frame of frames) {
    entries.push({
      type: `connector.${frame.id}`,
      label: frame.label,
      does: frame.description,
      kind: frame.execution === "inbound" ? "trigger" : "connector",
      needs: frame.needs.business.map((need) => need.key),
      gives: frame.produces.map((output) => output.key),
      reachesTheWorld: frame.cost.style !== "free"
    });
  }

  return entries;
}

/** The menu as the model sees it: one line per node, nothing wasted. */
export function menuAsText(entries: MenuEntry[]): string {
  const lines = entries.map((entry) => {
    const parts = [`- ${entry.type} — ${entry.label}. ${entry.does}`];
    if (entry.needs.length) parts.push(`  needs: ${entry.needs.join(", ")}`);
    if (entry.gives.length) parts.push(`  gives: ${entry.gives.join(", ")}`);
    if (entry.reachesTheWorld) parts.push("  REACHES A REAL PERSON OR COSTS MONEY");
    return parts.join("\n");
  });
  return lines.join("\n");
}
