/**
 * THE PLATFORM'S DIALS, READ FROM THE NODES THEMSELVES.
 *
 * The founder's ruling (2026-08-26): one node, one row, three columns. The
 * admin's ceilings used to be hand-written in a module per node — a second
 * filing system describing the same thing the registry already described, and
 * two filing systems drift. Now every dial is declared on its node with
 * `whoFills: "admin"` and the row it is stored under, and this module is the
 * one place that reads them.
 *
 * The per-node modules (memory-limits, node-limits, knowledge-limits) still
 * serve the engine's hot paths with their caches. What changes is the source
 * of the DEFAULTS and the BOUNDS: they come from the declaration now, so a
 * dial added to a node appears on the admin screen by itself.
 */

import { allPlatformDials, type NodeSetting } from "@coreai/shared";
import { prisma } from "../../lib/prisma";

export type PlatformDialView = {
  /** The setting row it lives in, e.g. "memoryKeepForDays". */
  key: string;
  nodeType: string;
  nodeLabel: string;
  name: string;
  whatItsFor: string;
  type: NodeSetting["type"];
  min?: number;
  max?: number;
  choices?: Array<{ value: string; label: string }>;
  /** What the platform shipped with. */
  default: string | number | boolean;
  /** What it is right now — the stored value, or the default when untouched. */
  value: string | number | boolean;
};

/** Every dial on the platform, with its live value. One query, no per-node code. */
export async function listPlatformDials(): Promise<PlatformDialView[]> {
  const declared = allPlatformDials();
  const keys = declared.map((dial) => dial.storedAs!).filter(Boolean);

  let stored = new Map<string, string>();
  try {
    const rows = await prisma.platformApiSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, valueEncrypted: true }
    });
    stored = new Map(rows.map((row) => [row.key, row.valueEncrypted]));
  } catch (error) {
    /* A dial screen that cannot reach the database shows the shipped values
       rather than nothing — the same rule every getter here follows. */
    console.warn("[platform-dials] falling back to declared defaults", (error as Error).message);
  }

  return declared.map((dial) => {
    const raw = stored.get(dial.storedAs!);
    let value: string | number | boolean = dial.default;
    if (raw !== undefined) {
      if (dial.type === "on/off") value = raw !== "off";
      else if (dial.type === "number") value = Number.isFinite(Number(raw)) ? Number(raw) : dial.default;
      else value = raw;
    }
    return {
      key: dial.storedAs!,
      nodeType: dial.nodeType,
      nodeLabel: dial.nodeLabel,
      name: dial.name,
      whatItsFor: dial.whatItsFor,
      type: dial.type,
      ...(dial.limits?.min !== undefined ? { min: dial.limits.min } : {}),
      ...(dial.limits?.max !== undefined ? { max: dial.limits.max } : {}),
      ...(dial.limits?.choices ? { choices: [...dial.limits.choices] } : {}),
      default: dial.default,
      value
    };
  });
}

/** Save one dial, clamped by the bounds its own node declared. */
export async function savePlatformDial(
  storedAs: string,
  value: string | number | boolean,
  updatedByUserId: string
): Promise<PlatformDialView | { refused: string }> {
  const dial = allPlatformDials().find((entry) => entry.storedAs === storedAs);
  if (!dial) return { refused: "No such setting." };

  let toStore: string;
  if (dial.type === "on/off") {
    toStore = value === true || value === "on" ? "on" : "off";
  } else if (dial.type === "number") {
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber)) return { refused: "That is not a number." };
    const min = dial.limits?.min ?? Number.NEGATIVE_INFINITY;
    const max = dial.limits?.max ?? Number.POSITIVE_INFINITY;
    toStore = String(Math.min(max, Math.max(min, Math.round(asNumber))));
  } else {
    toStore = String(value);
  }

  await prisma.platformApiSetting.upsert({
    where: { key: storedAs },
    update: { valueEncrypted: toStore, secret: false, updatedByUserId },
    create: { key: storedAs, valueEncrypted: toStore, secret: false, updatedByUserId }
  });

  const all = await listPlatformDials();
  return all.find((entry) => entry.key === storedAs)!;
}
