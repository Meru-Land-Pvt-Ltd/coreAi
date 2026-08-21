/**
 * THE PLATFORM WORKS OUT WHAT WENT WRONG, ONCE.
 *
 * The last layer of the nervous system. The first three find faults; this one
 * explains them and says what to do.
 *
 * Everything about how it is built is about cost, and the cheapest design also
 * turns out to be the most useful one.
 *
 *   It never watches. Nothing is called while runs are succeeding. A failure is
 *   what wakes it.
 *
 *   It answers a CAUSE, not an occurrence. A broken step fails four hundred
 *   times; this is asked once and the other three hundred and ninety-nine are
 *   free lookups.
 *
 *   It remembers across architects. A fault understood for one person is
 *   already understood the next time anyone meets it, which is why the bill
 *   falls as the platform grows instead of rising with it.
 *
 * And the part that is about safety rather than money: a fix is scoped before
 * it is allowed to travel, and anything that would change what a customer
 * receives is never applied without a person.
 */

import { failureSignature, fixScopeFor, isSafeToApplyAutomatically, type FailureFacts } from "@coreai/shared";
import { getNodeDefinition } from "@coreai/shared";
import { prisma } from "../../../lib/prisma";
import { resolveBrainSlot } from "../../admin/brain-slot-settings";
import { getSmartDesignerBrainConfig } from "../../admin/smart-designer-brain-settings";
import { getProviderEngine } from "../../ai-provider-engine/provider-engine";
import type { AIExecuteRequest } from "../../ai-provider-engine/types";

export type KnownFailure = {
  signature: string;
  nodeType: string;
  seenCount: number;
  cause: string | null;
  remedy: string | null;
  scope: string | null;
  autoFixable: boolean;
  diagnosed: boolean;
};

/**
 * Write down that this happened.
 *
 * Called on every failure, and deliberately cheap: one upsert, no AI, no
 * thinking. When the cause is already understood the answer comes straight
 * back from memory and nothing is spent at all.
 */
export async function noteFailure(facts: FailureFacts): Promise<KnownFailure | null> {
  const signature = failureSignature(facts);

  try {
    const existing = await prisma.failureDiagnosis.findUnique({ where: { signature } });

    if (existing) {
      const updated = await prisma.failureDiagnosis.update({
        where: { signature },
        data: {
          seenCount: { increment: 1 },
          lastSeenAt: new Date(),
          // Counted separately so the saving is visible: this is one failure
          // that cost nothing because the platform had met it before.
          ...(existing.diagnosedAt ? { servedFromMemory: { increment: 1 } } : {})
        }
      });

      return {
        signature,
        nodeType: updated.nodeType,
        seenCount: updated.seenCount,
        cause: updated.cause,
        remedy: updated.remedy,
        scope: updated.scope,
        autoFixable: updated.autoFixable,
        diagnosed: Boolean(updated.diagnosedAt)
      };
    }

    const created = await prisma.failureDiagnosis.create({
      data: { signature, nodeType: facts.nodeType || "unknown" }
    });

    return {
      signature,
      nodeType: created.nodeType,
      seenCount: 1,
      cause: null,
      remedy: null,
      scope: null,
      autoFixable: false,
      diagnosed: false
    };
  } catch (error) {
    // Never let the bookkeeping break the run it is describing.
    console.warn("[self-healing] could not note a failure", (error as Error).message);
    return null;
  }
}

/* -------------------------------------------------------------------------- */

function promptFor(row: { signature: string; nodeType: string; seenCount: number }): string {
  const definition = getNodeDefinition(row.nodeType);

  return [
    "A step inside an automated agent is failing. Say what is wrong and what to do about it.",
    "",
    `THE STEP: ${definition?.label ?? row.nodeType} (${row.nodeType})`,
    definition?.description ? `WHAT IT IS FOR: ${definition.description}` : "",
    definition?.producedVariables?.length
      ? `WHAT IT IS SUPPOSED TO HAND ON: ${definition.producedVariables.join(", ")}`
      : "",
    "",
    `THE FAULT: ${row.signature}`,
    `It has happened ${row.seenCount} time${row.seenCount === 1 ? "" : "s"}.`,
    "",
    "A fault written as `unproven` means the step reported success and did not hand on the things",
    "listed above. That usually means one of three things: it was given something it could not use,",
    "the service it calls answered with a different shape than expected, or the step was placed",
    "somewhere in the flow where what it needs has not happened yet.",
    "",
    "ANSWER FOR THE PERSON WHO BUILT THE AGENT. They are not a programmer. No jargon, no stack",
    "traces, no talk of nodes or JSON. Two short sentences at most for each field.",
    "",
    'Return ONLY JSON: { "cause": string, "remedy": string }',
    '  cause  — what is actually going wrong, in plain words.',
    '  remedy — what to do about it. Be specific and say who does it.'
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Ask, once, about one cause.
 *
 * Returns false when nothing was learned, so the caller can leave the row
 * undiagnosed and try again another day rather than storing a shrug.
 */
export async function diagnoseOne(signature: string): Promise<boolean> {
  const row = await prisma.failureDiagnosis.findUnique({ where: { signature } });
  if (!row || row.diagnosedAt) return false;

  const brain = resolveBrainSlot(await getSmartDesignerBrainConfig());
  if (!brain) return false;

  const request: AIExecuteRequest = {
    capability: "llm",
    systemPrompt: promptFor(row),
    conversationHistory: [],
    messages: [{ role: "user", content: "What is wrong, and what should be done?" }],
    // Nearly none. This is a diagnosis, and a diagnosis that varies run to run
    // is not a diagnosis.
    temperature: 0.1,
    maxTokens: 500,
    outputFormat: "json",
    task: "diagnose-failure",
    ...(brain.model ? { model: brain.model } : {})
  };

  let answer: { cause?: string; remedy?: string } | null = null;
  try {
    const response = await getProviderEngine().executeWithProvider(brain.providerId, request);
    if (response.status === "error") return false;

    const raw =
      response.structuredOutput && typeof response.structuredOutput === "object"
        ? response.structuredOutput
        : JSON.parse((response.text ?? "{}").replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim());
    answer = raw as { cause?: string; remedy?: string };
  } catch (error) {
    console.warn("[self-healing] could not diagnose", signature, (error as Error).message);
    return false;
  }

  const cause = String(answer?.cause ?? "").trim();
  const remedy = String(answer?.remedy ?? "").trim();
  if (!cause || !remedy) return false;

  // Two judgements the model does not get to make, because getting them wrong
  // is how one business's mistake becomes everybody's.
  const scope = fixScopeFor(`${cause} ${remedy}`);
  const autoFixable = scope === "generic" && isSafeToApplyAutomatically(remedy);

  await prisma.failureDiagnosis.update({
    where: { signature },
    data: {
      cause: cause.slice(0, 1000),
      remedy: remedy.slice(0, 1000),
      scope,
      autoFixable,
      diagnosedAt: new Date(),
      diagnosedBy: brain.model ?? brain.providerId
    }
  });

  console.log("[self-healing] learned a fault", { signature, scope, autoFixable });
  return true;
}

/**
 * Diagnose what is not yet understood.
 *
 * Worst first, because a fault that has happened four hundred times is costing
 * a real customer something four hundred times, and one that has happened once
 * may never happen again.
 *
 * Capped per sweep. An unbounded loop here is the one way this design could
 * become expensive: a bad deploy could produce fifty new causes in an hour, and
 * the platform should learn them over a day rather than in one bill.
 */
export async function diagnoseUnknownFailures(limit = 5): Promise<{ diagnosed: number; waiting: number }> {
  const pending = await prisma.failureDiagnosis.findMany({
    where: { diagnosedAt: null },
    orderBy: { seenCount: "desc" },
    take: limit
  });

  let diagnosed = 0;
  for (const row of pending) {
    if (await diagnoseOne(row.signature)) diagnosed += 1;
  }

  const waiting = await prisma.failureDiagnosis.count({ where: { diagnosedAt: null } });
  return { diagnosed, waiting };
}

/* -------------------------------------------------------------------------- */

/** Everything the platform has learned, worst first. */
export async function knownFailures(limit = 100) {
  const rows = await prisma.failureDiagnosis.findMany({
    orderBy: [{ seenCount: "desc" }],
    take: limit
  });

  const totals = rows.reduce(
    (sum, row) => ({
      causes: sum.causes + 1,
      occurrences: sum.occurrences + row.seenCount,
      // What was NOT spent: every occurrence after the first of a cause we had
      // already met.
      answeredFree: sum.answeredFree + row.servedFromMemory
    }),
    { causes: 0, occurrences: 0, answeredFree: 0 }
  );

  return {
    totals: {
      ...totals,
      diagnosed: rows.filter((row) => row.diagnosedAt).length,
      aiCallsMade: rows.filter((row) => row.diagnosedAt).length
    },
    failures: rows.map((row) => ({
      signature: row.signature,
      nodeType: row.nodeType,
      seenCount: row.seenCount,
      cause: row.cause,
      remedy: row.remedy,
      scope: row.scope,
      autoFixable: row.autoFixable,
      diagnosed: Boolean(row.diagnosedAt),
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString()
    }))
  };
}
