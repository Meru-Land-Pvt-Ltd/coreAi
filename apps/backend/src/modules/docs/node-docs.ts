/**
 * THE DOCUMENTATION — written by the nodes themselves.
 *
 * The founder's ruling (2026-08-27): "Every big platform has documentation —
 * AWS, Google Cloud, Instantly. Most architects will want to drag and drop
 * and wire it themselves, and there is no section like this on our whole
 * platform." He was right, and a $100B-grade product cannot ship without it.
 *
 * But documentation written by hand rots the day a node changes, and then it
 * lies — which is the one thing this platform never does. So it is GENERATED
 * from the same row every panel, every setup form and every admin dial reads:
 * the node's own declaration. A node added next year documents itself the
 * day its row ships, and a page can never disagree with the software.
 *
 * WHAT A PAGE MUST ANSWER, in the order a person actually asks:
 *   what it is · when to use it and when not · what it needs coming in ·
 *   what it gives out · every setting, and WHO fills it · what the business
 *   must supply at setup · how it fails · what it costs · what it pairs with
 *
 * The prose that cannot be generated — when to use it, the traps — is the
 * Soul's wisdom page for that node, written by hand and already required by
 * law for every covered node. The docs simply show it where a person is
 * looking for it.
 */

import {
  PARKED_NODE_TYPES,
  isParkedNodeType,
  nodeCatalogue,
  type NodeCatalogueRow,
  type NodeSetting
} from "@coreai/shared";
import { DELETED_NODE_TYPES } from "@coreai/shared";
import { soulPageFor } from "../architect/builder-soul";

export type DocSetting = {
  name: string;
  whatItsFor: string;
  type: string;
  /** "you" for the architect, "the business", "Triven" for admin ceilings. */
  filledBy: string;
  default: string;
  limits: string | null;
};

export type NodeDoc = {
  type: string;
  title: string;
  /** Trigger | Brain | Face | Hand | Connection — the Four Elements. */
  element: string;
  oneLine: string;
  /** The Soul's own wisdom for this node: when to use it, where it stops. */
  wisdom: string | null;
  needs: string[];
  gives: string[];
  yourSettings: DocSetting[];
  businessAnswers: DocSetting[];
  platformLimits: DocSetting[];
  hasDoors: boolean;
  parked: string | null;
};

function human(setting: NodeSetting): DocSetting {
  const limits: string[] = [];
  if (setting.limits?.min !== undefined) limits.push(`no less than ${setting.limits.min}`);
  if (setting.limits?.max !== undefined) limits.push(`no more than ${setting.limits.max}`);
  if (setting.limits?.maxLength) limits.push(`up to ${setting.limits.maxLength} characters`);
  if (setting.limits?.required) limits.push("must be filled in");
  if (setting.limits?.choices?.length) {
    limits.push(`one of: ${setting.limits.choices.map((choice) => choice.label).join(", ")}`);
  }

  return {
    name: setting.name,
    whatItsFor: setting.whatItsFor,
    type: setting.type,
    filledBy: setting.whoFills === "architect" ? "you" : setting.whoFills === "business" ? "the business" : "Triven",
    default:
      setting.default === "" || setting.default === undefined
        ? "empty"
        : String(setting.default),
    limits: limits.length > 0 ? limits.join(", ") : null
  };
}

function docFor(row: NodeCatalogueRow): NodeDoc {
  const wisdom = soulPageFor(row.type);
  return {
    type: row.type,
    title: row.label,
    element: row.element,
    oneLine: row.description,
    wisdom: wisdom ? wisdom.body : null,
    needs: row.needs,
    gives: row.gives,
    yourSettings: row.settings.architect.map(human),
    businessAnswers: row.settings.business.map(human),
    platformLimits: row.settings.admin.map(human),
    hasDoors: row.hasDoors,
    parked: row.parked
  };
}

/**
 * Every node's page, in the palette's own order.
 *
 * Deleted types never appear: an architect cannot place one, so documenting
 * it would be documenting a thing that does not exist. Parked ones DO
 * appear, carrying the reason they sleep — an architect who sees a grey card
 * deserves to know why.
 */
export function allNodeDocs(): NodeDoc[] {
  return nodeCatalogue()
    .filter((row) => !(row.type in DELETED_NODE_TYPES))
    .map(docFor)
    .sort((a, b) => {
      const order = ["Trigger", "Face", "Brain", "Hand", "Connection"];
      const byElement = order.indexOf(a.element) - order.indexOf(b.element);
      if (byElement !== 0) return byElement;
      /* Parked cards sink to the bottom of their own element. */
      if (Boolean(a.parked) !== Boolean(b.parked)) return a.parked ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
}

export function nodeDocFor(type: string): NodeDoc | null {
  if (type in DELETED_NODE_TYPES) return null;
  const row = nodeCatalogue().find((entry) => entry.type === type);
  return row ? docFor(row) : null;
}

/** How many nodes are documented, and how many sleep — for the docs index. */
export function docsSummary(): { total: number; working: number; parked: number } {
  const docs = allNodeDocs();
  return {
    total: docs.length,
    parked: docs.filter((doc) => doc.parked).length,
    working: docs.filter((doc) => !doc.parked).length
  };
}

/** The reason a parked node sleeps, in the platform's own words. */
export function parkedReason(type: string): string | null {
  return isParkedNodeType(type) ? PARKED_NODE_TYPES[type] ?? null : null;
}
