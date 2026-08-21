/**
 * THE TWO SWITCHES ON EVERY NODE.
 *
 * They answer different questions and are deliberately independent, because the
 * two situations they exist for are different.
 *
 *   VISIBILITY — "may somebody build something new with this?"
 *   Off takes it out of the palette and out of the AI composer's menu. It says
 *   nothing about the agents already running. This is the ordinary case: a step
 *   is being retired, or is not ready for everyone yet, and the businesses
 *   already using it must not notice a thing.
 *
 *   EXECUTION — "may this run at all, anywhere?"
 *   Off stops it everywhere at once, including inside agents a business has
 *   already bought and is depending on this minute. This is the emergency: a
 *   provider is charging for calls it is not making, a step turns out to be
 *   sending something it should not, a bug is doing damage while we watch.
 *
 * Pausing execution is the more serious act by a long way, so it is the one
 * that demands a written reason — and that reason is shown to the businesses
 * whose agents are affected, in their words, rather than leaving them with a
 * step that silently does nothing.
 */

import { isArchitectNodeType } from "@coreai/shared";
import { prisma } from "../../lib/prisma";

/** Node types paused right now, cached briefly — the runner asks per step. */
let pausedCache: { at: number; byType: Map<string, string> } | null = null;
const CACHE_MS = 15_000;

/**
 * Deliberately short. This is the switch somebody reaches for when something is
 * actively going wrong, and waiting a minute for it to take effect while a
 * customer is being harmed is not acceptable. Fifteen seconds is the most delay
 * worth trading for not querying on every step of every run.
 */
export async function pausedNodeTypes(force = false): Promise<Map<string, string>> {
  if (!force && pausedCache && Date.now() - pausedCache.at < CACHE_MS) return pausedCache.byType;

  try {
    const rows = await prisma.architectNodeVisibility.findMany({
      where: { executionEnabled: false },
      select: { nodeType: true, pausedReason: true }
    });
    const byType = new Map(rows.map((row) => [row.nodeType, row.pausedReason ?? ""]));
    pausedCache = { at: Date.now(), byType };
    return byType;
  } catch (error) {
    // A database blip must not pause every node on the platform. Failing open
    // here is right: the previous answer is far more likely to be correct than
    // "everything is off".
    console.warn("[node-controls] could not read paused nodes", (error as Error).message);
    return pausedCache?.byType ?? new Map();
  }
}

export function invalidatePausedCache(): void {
  pausedCache = null;
}

/** What a business is told when their agent reaches a paused step. */
export function pausedMessageFor(nodeLabel: string, reason: string): string {
  const why = reason.trim();
  return why
    ? `"${nodeLabel}" is paused by Triven: ${why} The rest of your agent carried on.`
    : `"${nodeLabel}" is paused by Triven while we look into something. The rest of your agent carried on, and we will switch it back on as soon as it is safe.`;
}

export type NodeControl = {
  nodeType: string;
  visible: boolean;
  executionEnabled: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
};

export async function nodeControls(): Promise<Map<string, NodeControl>> {
  const rows = await prisma.architectNodeVisibility.findMany();
  return new Map(
    rows.map((row) => [
      row.nodeType,
      {
        nodeType: row.nodeType,
        visible: row.visible,
        executionEnabled: row.executionEnabled,
        pausedReason: row.pausedReason,
        pausedAt: row.pausedAt?.toISOString() ?? null
      }
    ])
  );
}

export async function setNodeVisibility(nodeType: string, visible: boolean): Promise<void> {
  if (!isArchitectNodeType(nodeType)) throw new Error(`"${nodeType}" is not a node on this platform.`);

  await prisma.architectNodeVisibility.upsert({
    where: { nodeType },
    create: { nodeType, visible },
    update: { visible }
  });
}

/**
 * Pause or resume a node everywhere.
 *
 * A reason is required to pause and is not optional politeness: it is what a
 * business reads when their agent tells them a step is not running. "Paused"
 * with no explanation is worse for them than a plain failure, because there is
 * nothing they can do and nothing they can ask about.
 */
export async function setNodeExecution(input: {
  nodeType: string;
  enabled: boolean;
  reason?: string;
  adminUserId: string;
}): Promise<void> {
  if (!isArchitectNodeType(input.nodeType)) {
    throw new Error(`"${input.nodeType}" is not a node on this platform.`);
  }
  if (!input.enabled && !input.reason?.trim()) {
    throw new Error("Say why it is being paused. Every business using it will read this.");
  }

  const paused = {
    executionEnabled: input.enabled,
    pausedReason: input.enabled ? null : input.reason!.trim().slice(0, 500),
    pausedAt: input.enabled ? null : new Date(),
    pausedByUserId: input.enabled ? null : input.adminUserId
  };

  await prisma.architectNodeVisibility.upsert({
    where: { nodeType: input.nodeType },
    create: { nodeType: input.nodeType, visible: true, ...paused },
    update: paused
  });

  // Immediately, not in fifteen seconds. Whoever pressed this is watching
  // something go wrong.
  invalidatePausedCache();
}

/**
 * Which businesses are affected by pausing this node, so nobody presses it
 * blind.
 *
 * Shown before the pause takes effect. "This will stop a step inside 14 live
 * agents belonging to 9 businesses" is a different decision from "this affects
 * nobody", and an admin should never have to guess which one they are making.
 */
export async function whoIsAffectedBy(nodeType: string): Promise<{
  installedAgents: number;
  businesses: number;
  agentNames: string[];
}> {
  const installs = await prisma.installedAgent.findMany({
    where: { status: { in: ["ACTIVE", "PROVISIONING"] } },
    select: { id: true, name: true, businessId: true, workflow: { select: { workflowJson: true } } }
  });

  const affected = installs.filter((install) => {
    const graph = install.workflow?.workflowJson as { nodes?: Array<{ data?: { type?: string } }> } | null;
    return (graph?.nodes ?? []).some((node) => node?.data?.type === nodeType);
  });

  return {
    installedAgents: affected.length,
    businesses: new Set(affected.map((install) => install.businessId)).size,
    agentNames: [...new Set(affected.map((install) => install.name))].slice(0, 10)
  };
}
