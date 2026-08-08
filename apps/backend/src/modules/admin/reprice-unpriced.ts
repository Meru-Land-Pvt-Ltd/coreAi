import { prisma } from "../../lib/prisma";
import { priceExecutionUsage } from "../../lib/usage-pricing";
import {
  buildUsagePricingSnapshot,
  requiredServiceCodesForUsage,
  resolveApplicableUsageServiceCodes,
  UNKNOWN_USAGE_SERVICE_MAPPING,
  type UsagePricingSnapshot
} from "../../lib/usage-service-resolver";
import {
  parseStoredVoicePipeline,
  resolveDefaultLiveVoicePipeline,
  type ResolvedVoicePipeline
} from "../compliance/workspace-ai-guard";
import { loadActiveUsageServicePricing } from "./usage-pricing-service";
import { monthBounds, recordVapiExecutionUsage } from "../business/execution-billing";
import { completeVoicePipelineModels } from "../business/usage-billing";
import { fetchVapiCallById } from "../architect/vapi-connector";

export type RepriceUnpricedInput = {
  executionIds?: string[];
  billingMonth?: string;
  dryRun: boolean;
  limit: number;
  /** Admin user id for the audit log. */
  actorId?: string | null;
};

export type RepriceItemOutcome = {
  id: string;
  callId: string;
  outcome: "priced" | "skipped" | "failed";
  reason?: string;
  billedCostMicroUsd?: number;
  actualCostMicroUsd?: number;
};

export type RepriceUnpricedResult = {
  dryRun: boolean;
  scanned: number;
  priced: number;
  skipped: number;
  failed: number;
  stillUnpriced: number;
  items: RepriceItemOutcome[];
};

function pipelineFromSnapshot(snapshotJson: unknown): ResolvedVoicePipeline | null {
  if (!snapshotJson || typeof snapshotJson !== "object" || Array.isArray(snapshotJson)) return null;
  const snapshot = snapshotJson as Partial<UsagePricingSnapshot>;
  const pipeline = snapshot.pipeline;
  if (!pipeline || typeof pipeline !== "object") return null;
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : "");
  const llmProvider = str(pipeline.llmProvider);
  const transcriberProvider = str(pipeline.transcriberProvider);
  const voiceProvider = str(pipeline.voiceProvider);
  if (!llmProvider || !transcriberProvider || !voiceProvider) return null;
  return {
    orchestrator: "vapi",
    llmProvider,
    transcriberProvider,
    voiceProvider,
    ...(str(pipeline.llmModel) ? { llmModel: str(pipeline.llmModel) } : {}),
    ...(str(pipeline.transcriberModel) ? { transcriberModel: str(pipeline.transcriberModel) } : {}),
    ...(str(pipeline.voiceModel) ? { voiceModel: str(pipeline.voiceModel) } : {})
  };
}

function snapshotCalendarUsed(snapshotJson: unknown): boolean | null {
  if (!snapshotJson || typeof snapshotJson !== "object" || Array.isArray(snapshotJson)) return null;
  const calendarUsed = (snapshotJson as Record<string, unknown>).calendarUsed;
  return typeof calendarUsed === "boolean" ? calendarUsed : null;
}

export async function repriceUnpricedExecutions(
  input: RepriceUnpricedInput
): Promise<RepriceUnpricedResult> {
  const bounds = input.billingMonth ? monthBounds(input.billingMonth) : null;
  if (input.billingMonth && !bounds) {
    throw new Error(`Invalid billingMonth "${input.billingMonth}" — expected YYYY-MM`);
  }

  // Sweep BOTH UNPRICED and terminal-but-PENDING calls. A LIVE call that lost
  // its end-of-call webhook never left PENDING and would otherwise be
  // permanently unbillable; requiring endedAt excludes calls still in progress.
  const scopeWhere = {
    pricingState: { in: ["UNPRICED", "PENDING"] },
    executionMode: "LIVE",
    endedAt: bounds ? { gte: bounds.start, lt: bounds.end } : { not: null },
    ...(input.executionIds?.length
      ? { OR: [{ id: { in: input.executionIds } }, { callId: { in: input.executionIds } }] }
      : {})
  };

  const calls = await prisma.vapiCall.findMany({
    where: scopeWhere,
    orderBy: { endedAt: "asc" },
    take: input.limit,
    select: {
      id: true,
      callId: true,
      businessId: true,
      installedAgentId: true,
      conversationId: true,
      durationMinutes: true,
      smsCount: true,
      endedAt: true,
      createdAt: true,
      pricingSnapshotJson: true
    }
  });

  // VapiCall.installedAgentId is a bare scalar — batch-load the installs for
  // their deploy-time pipeline snapshots.
  const installedAgentIds = [
    ...new Set(calls.map((call) => call.installedAgentId).filter((id): id is string => Boolean(id)))
  ];
  const installedAgents = installedAgentIds.length
    ? await prisma.installedAgent.findMany({
        where: { id: { in: installedAgentIds } },
        select: { id: true, configJson: true }
      })
    : [];
  const installsById = new Map(installedAgents.map((agent) => [agent.id, agent]));

  const pricingServices = await loadActiveUsageServicePricing();
  const items: RepriceItemOutcome[] = [];
  let priced = 0;
  let skipped = 0;
  let failed = 0;

  for (const call of calls) {
    try {
      const durationMinutes = call.durationMinutes ?? 0;
      const smsCount = call.smsCount ?? 0;

      const storedCalendarUsed = snapshotCalendarUsed(call.pricingSnapshotJson);
      const calendarUsed =
        storedCalendarUsed ??
        (call.conversationId
          ? (await prisma.appointment.count({ where: { conversationId: call.conversationId } })) > 0
          : false);

      const install = call.installedAgentId ? installsById.get(call.installedAgentId) : undefined;
      let pipeline =
        pipelineFromSnapshot(call.pricingSnapshotJson) ??
        parseStoredVoicePipeline(install?.configJson) ??
        resolveDefaultLiveVoicePipeline();

      // Repricing must use the provider that handled this exact call. This
      // keeps ElevenLabs calls on the ElevenLabs rate and Cartesia calls on the
      // Cartesia rate even when an older installation snapshot is stale.
      const vapiCall = await fetchVapiCallById(call.callId).catch((error) => {
        console.error("[admin-reprice] Vapi call lookup failed (non-fatal)", {
          callId: call.callId,
          error
        });
        return null;
      });
      if (vapiCall?.voicePipeline) pipeline = vapiCall.voicePipeline;
      /* Vapi's re-fetched call reports the voice provider but usually not the
         model, and the stored snapshots of stuck calls carry model:null — both
         would fail resolution again forever. Complete the voice hop from our
         own deploy config, exactly as the live path now does. */
      pipeline = completeVoicePipelineModels(pipeline);

      const resolvePipeline = (voicePipeline: ResolvedVoicePipeline) =>
        resolveApplicableUsageServiceCodes({
          execution: { calendarUsed },
          installedAgent: install ? { id: install.id } : null,
          voicePipeline,
          providerMetadata: { telephonyProvider: "twilio" }
        });
      const priceResolution = (serviceCodes: string[]) =>
        priceExecutionUsage(
          pricingServices,
          { durationMinutes, smsCount, callCount: durationMinutes > 0 ? 1 : 0 },
          {
            applicableServiceCodes: new Set(serviceCodes),
            requiredServiceCodes: requiredServiceCodesForUsage(serviceCodes, {
              durationMinutes,
              smsCount,
              calendarUsed
            })
          }
        );

      const resolution = resolvePipeline(pipeline);
      const pricingResult =
        resolution.state === "RESOLVED" ? priceResolution(resolution.codes) : null;

      if (resolution.state === "UNKNOWN") {
        skipped += 1;
        items.push({
          id: call.id,
          callId: call.callId,
          outcome: "skipped",
          reason: UNKNOWN_USAGE_SERVICE_MAPPING
        });
        continue;
      }

      if (!pricingResult || pricingResult.state === "UNPRICED") {
        skipped += 1;
        items.push({
          id: call.id,
          callId: call.callId,
          outcome: "skipped",
          reason: pricingResult
            ? `${pricingResult.code}${
                pricingResult.missingServiceCodes?.length
                  ? `:${pricingResult.missingServiceCodes.join(",")}`
                  : ""
              }`
            : UNKNOWN_USAGE_SERVICE_MAPPING
        });
        continue;
      }

      if (input.dryRun) {
        priced += 1;
        items.push({
          id: call.id,
          callId: call.callId,
          outcome: "priced",
          billedCostMicroUsd: pricingResult.totals.billedCostMicroUsd,
          actualCostMicroUsd: pricingResult.totals.actualCostMicroUsd
        });
        continue;
      }

      const occurredAt = call.endedAt ?? call.createdAt;
      const billingMonth = occurredAt.toISOString().slice(0, 7);
      const snapshot = buildUsagePricingSnapshot({
        pipeline,
        telephonyProvider: "twilio",
        calendarUsed,
        resolution,
        unpricedReason: null
      });

      const updated = await prisma.vapiCall.updateMany({
        where: {
          id: call.id,
          pricingState: { in: ["UNPRICED", "PENDING"] },
          billingRecordedAt: null
        },
        data: {
          actualCostMicroUsd: pricingResult.totals.actualCostMicroUsd,
          billedCostMicroUsd: pricingResult.totals.billedCostMicroUsd,
          usageLineItemsJson: pricingResult.lineItems as never,
          pricingSnapshotJson: snapshot as never,
          pricingState: "PRICED",
          billingMonth,
          billingRecordedAt: new Date()
        }
      });

      if (updated.count === 0) {
        skipped += 1;
        items.push({
          id: call.id,
          callId: call.callId,
          outcome: "skipped",
          reason: "ALREADY_SETTLED_CONCURRENTLY"
        });
        continue;
      }

      if (call.installedAgentId) {
        await recordVapiExecutionUsage({
          installedAgentId: call.installedAgentId,
          callId: call.callId,
          occurredAt,
          actualCostMicroUsd: pricingResult.totals.actualCostMicroUsd,
          usageLineItems: pricingResult.lineItems
        })
          .then(async (execution) => {
            if (!execution?.usageInvoiceId) return;
            await prisma.vapiCall.updateMany({
              where: { id: call.id, usageInvoiceId: null },
              data: { usageInvoiceId: execution.usageInvoiceId }
            });
          })
          .catch((error) => {
            console.error("[admin-reprice] canonical execution write failed (non-fatal)", {
              callId: call.callId,
              error
            });
          });
      }

      priced += 1;
      items.push({
        id: call.id,
        callId: call.callId,
        outcome: "priced",
        billedCostMicroUsd: pricingResult.totals.billedCostMicroUsd,
        actualCostMicroUsd: pricingResult.totals.actualCostMicroUsd
      });
      console.log("[admin-reprice] repriced execution", {
        actorId: input.actorId ?? null,
        callId: call.callId,
        billingMonth,
        billedCostMicroUsd: pricingResult.totals.billedCostMicroUsd
      });
    } catch (error) {
      failed += 1;
      items.push({
        id: call.id,
        callId: call.callId,
        outcome: "failed",
        reason: error instanceof Error ? error.message : String(error)
      });
      console.error("[admin-reprice] reprice failed — row left UNPRICED", {
        actorId: input.actorId ?? null,
        callId: call.callId,
        error
      });
    }
  }

  const stillUnpriced = await prisma.vapiCall.count({ where: scopeWhere });

  console.log("[admin-reprice] run complete", {
    actorId: input.actorId ?? null,
    dryRun: input.dryRun,
    scanned: calls.length,
    priced,
    skipped,
    failed,
    stillUnpriced
  });

  return { dryRun: input.dryRun, scanned: calls.length, priced, skipped, failed, stillUnpriced, items };
}
