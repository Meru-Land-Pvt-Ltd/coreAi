import type { Context } from "hono";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { recordCallOutcome } from "../architect/call-list";
import { resolvePrimaryBusinessId } from "./primary-business";
import { errorResponse, successResponse } from "../../lib/api-response";
import {
  microUsdToUsd,
  priceExecutionUsage,
  type UsageLineItem
} from "../../lib/usage-pricing";
import {
  buildUsagePricingSnapshot,
  requiredServiceCodesForUsage,
  resolveApplicableUsageServiceCodes,
  UNKNOWN_USAGE_SERVICE_MAPPING
} from "../../lib/usage-service-resolver";
import {
  parseStoredVoicePipeline,
  resolveDefaultLiveVoicePipeline,
  type ResolvedVoicePipeline
} from "../compliance/workspace-ai-guard";
import { fetchVapiCallById } from "../architect/vapi-connector";
import { env } from "../../config/env";
import { loadActiveUsageServicePricing } from "../admin/usage-pricing-service";
import { getStripeClient, isStripeConfigured } from "../payments/stripe";
import { restoreBusinessAfterBillingPayment } from "./billing-cycle";
import {
  billingMonthFor,
  monthBounds,
  monthLabel,
  normalizeUsageInvoiceStatus,
  reconcileBusinessExecutionUsage,
  recordVapiExecutionUsage,
  rollupExecutions
} from "./execution-billing";
import {
  customerFacingUsageLineItems,
  type UsageInvoiceLabelMap
} from "./usage-invoice-line-items";

async function loadServiceRoles(): Promise<UsageInvoiceLabelMap> {
  const services = await prisma.platformUsageService.findMany({
    select: { code: true, role: true }
  });
  return new Map(services.map((service) => [service.code, service.role]));
}

function billingMonthFromDate(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function parseDurationMinutes(payload: Record<string, unknown>): number {
  const minutes = Number(payload.durationMinutes);
  if (Number.isFinite(minutes) && minutes > 0) return minutes;

  const seconds = Number(payload.durationSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds / 60;

  const ms = Number(payload.durationMs);
  if (Number.isFinite(ms) && ms > 0) return ms / 60_000;

  return 0;
}

/** The single TTS model this platform deploys for a given voice provider. */
function platformVoiceModelFor(voiceProvider: string): string | undefined {
  switch (voiceProvider) {
    case "cartesia":
      return env.CARTESIA_TTS_MODEL || "sonic-2";
    case "elevenlabs":
      return env.VAPI_ELEVENLABS_MODEL || "eleven_flash_v2_5";
    default:
      return undefined;
  }
}

/**
 * Complete a pipeline whose voice hop lacks a model. Vapi's payloads report
 * voice.provider but routinely omit voice.model (production log:
 * `{ hop: 'voice', provider: 'cartesia', model: null }`), and a model-less hop
 * can never match a rate. We only ever deploy each provider with one
 * platform-configured model, so this is a restoration of our own deploy
 * config — providers we do not deploy stay incomplete and correctly UNPRICED.
 */
export function completeVoicePipelineModels(pipeline: ResolvedVoicePipeline): ResolvedVoicePipeline {
  if (pipeline.voiceModel) return pipeline;
  const voiceModel = platformVoiceModelFor(pipeline.voiceProvider);
  return voiceModel ? { ...pipeline, voiceModel } : pipeline;
}

export function mergeVapiCallPipeline(
  vapiPipeline: ResolvedVoicePipeline | null,
  fallback: ResolvedVoicePipeline
): ResolvedVoicePipeline {
  if (!vapiPipeline) return fallback;

  const sameProviderModel = (
    actualProvider: string,
    actualModel: string | undefined,
    fallbackProvider: string,
    fallbackModel: string | undefined
  ) => actualModel ?? (actualProvider === fallbackProvider ? fallbackModel : undefined);

  const llmModel = sameProviderModel(
    vapiPipeline.llmProvider,
    vapiPipeline.llmModel,
    fallback.llmProvider,
    fallback.llmModel
  );
  const transcriberModel = sameProviderModel(
    vapiPipeline.transcriberProvider,
    vapiPipeline.transcriberModel,
    fallback.transcriberProvider,
    fallback.transcriberModel
  );
  const voiceModel =
    sameProviderModel(
      vapiPipeline.voiceProvider,
      vapiPipeline.voiceModel,
      fallback.voiceProvider,
      fallback.voiceModel
    ) ??
    /* Vapi's end-of-call payload reports voice.provider but frequently omits
       voice.model. When the fallback pipeline is for a DIFFERENT provider
       (agent deployed under ElevenLabs, call answered under Cartesia after the
       platform default switch), the merge produced a model-less voice hop and
       the whole call went UNPRICED. We only ever deploy these providers with
       one platform-configured model, so completing it from our own deploy
       config is a restoration, not a guess. */
    platformVoiceModelFor(vapiPipeline.voiceProvider);

  return {
    ...vapiPipeline,
    ...(llmModel ? { llmModel } : {}),
    ...(transcriberModel ? { transcriberModel } : {}),
    ...(voiceModel ? { voiceModel } : {})
  };
}

/**
 * SMS billable-status policy: FAILED / SUPPRESSED / SIMULATED are never
 * billable. Among the remaining statuses, a row is billable only when the
 * PROVIDER accepted it — it carries a messageSid (Twilio returns one on create
 * even while still "queued") or a provider-reported delivery status.
 * UNDELIVERED stays billable because Twilio accepted and charged the message.
 * A bare QUEUED row with no sid is a local write that never reached the
 * provider (e.g. a crash between the local queue insert and the Twilio call)
 * and must NOT be billed.
 */
const BILLABLE_SMS_STATUSES = ["QUEUED", "ACCEPTED", "SENDING", "SENT", "DELIVERED", "UNDELIVERED"] as const;
const PROVIDER_REPORTED_SMS_STATUSES = ["ACCEPTED", "SENDING", "SENT", "DELIVERED", "UNDELIVERED"] as const;

export function providerAcceptedSmsWhere(): Prisma.SmsExecutionWhereInput {
  return {
    status: { in: [...BILLABLE_SMS_STATUSES] },
    OR: [
      { messageSid: { not: null } },
      { status: { in: [...PROVIDER_REPORTED_SMS_STATUSES] } }
    ]
  };
}

/**
 * Customer SMS attributable to ONE voice execution. Primary association is the
 * direct SmsExecution.vapiCallId link; the legacy dedupeKey convention
 * (`send_notification:{callId}:customer`) and the appointment-confirmation
 * relation remain as fallbacks for historical rows. A row provably linked to a
 * DIFFERENT call is never counted here — attribution is direct or absent,
 * never guessed.
 */
export async function countBillableCustomerSms(
  callId: string,
  conversationId: string | null
): Promise<number> {
  const directRows = await prisma.smsExecution.findMany({
    where: {
      AND: [
        providerAcceptedSmsWhere(),
        {
          OR: [
            { vapiCallId: callId },
            { dedupeKey: { startsWith: `send_notification:${callId}:` } }
          ]
        }
      ]
    },
    select: { id: true, dedupeKey: true, messageType: true }
  });
  const countedIds = new Set(
    directRows
      .filter((row) => row.messageType !== "TEAM_NOTIFICATION" && !row.dedupeKey?.endsWith(":team"))
      .map((row) => row.id)
  );

  let confirmations = 0;
  if (conversationId) {
    const appointments = await prisma.appointment.findMany({
      where: { conversationId },
      select: { id: true }
    });
    if (appointments.length > 0) {
      confirmations = await prisma.smsExecution.count({
        where: {
          AND: [
            providerAcceptedSmsWhere(),
            {
              appointmentId: { in: appointments.map((appointment) => appointment.id) },
              messageType: "APPOINTMENT_CONFIRMATION",
              id: { notIn: [...countedIds] },
              // A confirmation directly attributed to another call belongs to
              // that call's execution, not this one.
              OR: [{ vapiCallId: null }, { vapiCallId: callId }]
            }
          ]
        }
      });
    }
  }

  return countedIds.size + confirmations;
}

/**
 * Valid billable customer SMS for a business period with NO provable link to a
 * voice execution (no vapiCallId, no appointment, not a call-scoped
 * send_notification key). These are business-period SMS usage — they must not
 * be attached to any call execution, and equally must not be discarded.
 */
export async function countStandaloneBillableSms(
  businessId: string,
  range: { start: Date; end: Date }
): Promise<number> {
  return prisma.smsExecution.count({
    where: {
      AND: [
        providerAcceptedSmsWhere(),
        {
          businessId,
          createdAt: { gte: range.start, lt: range.end },
          vapiCallId: null,
          appointmentId: null,
          messageType: { not: "TEAM_NOTIFICATION" },
          NOT: { dedupeKey: { startsWith: "send_notification:" } }
        }
      ]
    }
  });
}

export function extractRecordingUrl(message: Record<string, unknown>): string | null {
  const artifact =
    typeof message.artifact === "object" && message.artifact !== null
      ? (message.artifact as Record<string, unknown>)
      : {};

  const candidates = [
    artifact.recordingUrl,
    artifact.stereoRecordingUrl,
    message.recordingUrl,
    message.stereoRecordingUrl
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^https:\/\//i.test(candidate.trim())) {
      return candidate.trim();
    }
  }

  return null;
}

const RECORDING_REFETCH_DELAY_MS = 60_000;
const scheduledRecordingRefetches = new Set<string>();

function scheduleRecordingRefetch(callId: string) {
  if (!callId || scheduledRecordingRefetches.has(callId)) return;
  scheduledRecordingRefetches.add(callId);

  const timer = setTimeout(() => {
    void (async () => {
      try {
        const existing = await prisma.vapiCall.findUnique({
          where: { callId },
          select: { id: true, recordingUrl: true }
        });
        if (!existing || existing.recordingUrl) return;

        const call = await fetchVapiCallById(callId).catch(() => null);
        if (call?.recordingUrl) {
          await prisma.vapiCall.update({
            where: { callId },
            data: { recordingUrl: call.recordingUrl }
          });
          console.log("[usage-billing] recording backfilled after delay", { callId });
        }
      } catch (error) {
        console.error("[usage-billing] delayed recording re-fetch failed (non-fatal)", error);
      } finally {
        scheduledRecordingRefetches.delete(callId);
      }
    })();
  }, RECORDING_REFETCH_DELAY_MS);
  // Never keep the process (or a test runner) alive just for this retry.
  timer.unref?.();
}

export async function recordVapiCallUsage({
  businessId,
  installedAgentId,
  callId,
  customerPhone,
  webhookBody
}: {
  businessId: string;
  installedAgentId?: string | null;
  callId: string;
  customerPhone?: string;
  webhookBody: Record<string, unknown>;
}) {

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerId: true }
  });
  if (!business) return;


  const callRow = await prisma.vapiCall.findUnique({
    where: { callId },
    select: {
      installedAgentId: true,
      executionMode: true,
      billingRecordedAt: true,
      usageInvoiceId: true,
      recordingUrl: true,
      pricingState: true,
      conversationId: true,
      endedAt: true,
      actualCostMicroUsd: true,
      billedCostMicroUsd: true,
      usageLineItemsJson: true
    }
  });
  if (callRow && callRow.executionMode !== "LIVE") {
    console.log("[usage-billing] skipped: non-live call", { businessId, callId, executionMode: callRow.executionMode });
    return;
  }

  if (callRow?.billingRecordedAt || callRow?.usageInvoiceId || callRow?.pricingState === "PRICED" || callRow?.pricingState === "INVOICED") {
    // The priced Vapi row is written before the canonical execution so a
    // transient failure used to make every webhook redelivery return here and
    // preserve a permanent invoice orphan. Re-run the idempotent canonical
    // write whenever the call is priced but still lacks an invoice link.
    if (!callRow.usageInvoiceId && callRow.pricingState === "PRICED") {
      const repairAgentIds = [callRow.installedAgentId, installedAgentId]
        .filter((id): id is string => Boolean(id));
      if (repairAgentIds.length > 0) {
        try {
          const ownedAgents = await prisma.installedAgent.findMany({
            where: { id: { in: [...new Set(repairAgentIds)] }, businessId },
            select: { id: true }
          });
          const ownedById = new Map(ownedAgents.map((agent) => [agent.id, agent]));
          const ownedAgentId = repairAgentIds.find((id) => ownedById.has(id));
          const ownedAgent = ownedAgentId ? ownedById.get(ownedAgentId) : undefined;
          if (ownedAgent) {
            const storedLineItems = Array.isArray(callRow.usageLineItemsJson)
              ? (callRow.usageLineItemsJson as unknown as UsageLineItem[])
              : callRow.billedCostMicroUsd && callRow.billedCostMicroUsd > 0
                ? [
                    {
                      serviceCode: "agent_execution",
                      serviceName: "Usage service",
                      invoiceLabel: "Usage service",
                      unit: "PER_UNIT" as const,
                      quantity: 1,
                      unitPriceMicroUsd: callRow.billedCostMicroUsd,
                      actualCostMicroUsd: callRow.actualCostMicroUsd ?? 0,
                      billedCostMicroUsd: callRow.billedCostMicroUsd,
                      billingRateMicroUsd: callRow.billedCostMicroUsd
                    }
                  ]
                : undefined;
            const execution = await recordVapiExecutionUsage({
              installedAgentId: ownedAgent.id,
              callId,
              occurredAt: callRow.endedAt ?? callRow.billingRecordedAt ?? new Date(),
              actualCostMicroUsd: callRow.actualCostMicroUsd,
              usageLineItems: storedLineItems
            });
            if (execution?.usageInvoiceId) {
              await prisma.vapiCall.updateMany({
                where: { callId, businessId, usageInvoiceId: null },
                data: {
                  installedAgentId: ownedAgent.id,
                  usageInvoiceId: execution.usageInvoiceId
                }
              });
            }
          }
        } catch (error) {
          console.error("[usage-billing] priced execution repair failed (non-fatal)", {
            businessId,
            callId,
            error
          });
        }
      }
    }
    if (!callRow.recordingUrl) {
      const message =
        typeof webhookBody.message === "object" && webhookBody.message !== null
          ? (webhookBody.message as Record<string, unknown>)
          : webhookBody;
      const lateRecordingUrl = extractRecordingUrl(message);
      if (lateRecordingUrl) {
        await prisma.vapiCall
          .update({ where: { callId }, data: { recordingUrl: lateRecordingUrl } })
          .catch(() => null);
      }
    }
    console.log("[usage-billing] skipped: usage already recorded (idempotent re-delivery)", {
      businessId,
      callId,
      invoiced: Boolean(callRow.usageInvoiceId)
    });
    return;
  }

  const installedAgent = installedAgentId
    ? await prisma.installedAgent.findFirst({
      where: { id: installedAgentId, businessId },
      select: { id: true, listingId: true, configJson: true, createdAt: true }
    })
    : null;


  const agentConfig =
    installedAgent?.configJson && typeof installedAgent.configJson === "object" && !Array.isArray(installedAgent.configJson)
      ? (installedAgent.configJson as Record<string, unknown>)
      : {};
  if (agentConfig.testMode === true || agentConfig.executionMode === "ARCHITECT_DRY_RUN" || agentConfig.executionMode === "BUSINESS_TEST") {
    console.log("[usage-billing] skipped: test-mode installed agent", { businessId, installedAgentId });
    return;
  }
  const webhookMetadata =
    typeof webhookBody.message === "object" && webhookBody.message !== null
      ? ((webhookBody.message as Record<string, unknown>).call as Record<string, unknown> | undefined)?.metadata
      : undefined;
  const topLevelMetadata = webhookBody.metadata;
  const metadata =
    typeof webhookMetadata === "object" && webhookMetadata !== null
      ? (webhookMetadata as Record<string, unknown>)
      : typeof topLevelMetadata === "object" && topLevelMetadata !== null
        ? (topLevelMetadata as Record<string, unknown>)
        : {};
  const assignedPhoneNumber =
    typeof metadata.assignedPhoneNumber === "string" ? metadata.assignedPhoneNumber : "";

  if (assignedPhoneNumber) {
    // Active mapping only — a stale released/suspended row must neither
    // validate a foreign call nor block a legitimate one for the number's
    // real current holder.
    const assignedMapping = await prisma.businessPhoneNumber.findFirst({
      where: {
        businessId,
        phoneNumber: assignedPhoneNumber,
        isActive: true,
        ...(installedAgent?.id ? { installedAgentId: installedAgent.id } : {})
      },
      select: { id: true }
    });
    if (!assignedMapping) {
      console.warn("[usage-billing] skipped: assigned Twilio number does not match business/agent", {
        businessId,
        installedAgentId,
        assignedPhoneNumber
      });
      return;
    }
  }
  const purchase = await prisma.payment.findFirst({
    where: {
      userId: business.ownerId,
      status: "SUCCEEDED",
      OR: [{ businessId }, { businessId: null }],
      ...(installedAgent?.listingId ? { listingId: installedAgent.listingId } : {})
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true }
  });

  let acquiredAt = purchase?.createdAt ?? installedAgent?.createdAt ?? null;
  if (!acquiredAt) {
    const anyAgent = await prisma.installedAgent.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, configJson: true }
    });
    const realAgent = anyAgent.find((agent) => {
      const config =
        agent.configJson && typeof agent.configJson === "object" && !Array.isArray(agent.configJson)
          ? (agent.configJson as Record<string, unknown>)
          : {};
      return config.purpose !== "ARCHITECT_TEST";
    });
    acquiredAt = realAgent?.createdAt ?? null;
  }
  if (!acquiredAt) {
    console.log("[usage-billing] skipped: no completed agent purchase or install", { businessId, installedAgentId });
    return;
  }

  const message =
    typeof webhookBody.message === "object" && webhookBody.message !== null
      ? (webhookBody.message as Record<string, unknown>)
      : webhookBody;

  const vapiCall = await fetchVapiCallById(callId).catch((error) => {
    console.error("[usage-billing] fetchVapiCallById failed (non-fatal)", error);
    return null;
  });

  const durationMinutes = parseDurationMinutes({
    durationMinutes: message.durationMinutes ?? vapiCall?.durationMinutes,
    durationSeconds: message.durationSeconds ?? vapiCall?.durationSeconds,
    durationMs: message.durationMs ?? vapiCall?.durationMs
  });

  const smsCount = await countBillableCustomerSms(callId, callRow?.conversationId ?? null);

  const calendarUsed = callRow?.conversationId
    ? (await prisma.appointment.count({ where: { conversationId: callRow.conversationId } })) > 0
    : false;

  // Prefer the assistant configuration returned by Vapi for this exact call.
  // Stored deployment configuration fills only fields Vapi omitted, while
  // legacy assistants fall back to the current platform default.
  const fallbackVoicePipeline =
    parseStoredVoicePipeline(agentConfig) ?? resolveDefaultLiveVoicePipeline();
  const voicePipeline = mergeVapiCallPipeline(
    vapiCall?.voicePipeline ?? null,
    fallbackVoicePipeline
  );
  const resolution = resolveApplicableUsageServiceCodes({
    execution: { calendarUsed },
    installedAgent: installedAgent ? { id: installedAgent.id } : null,
    voicePipeline,
    providerMetadata: { telephonyProvider: "twilio" }
  });

  // The ONE pricing decision (pure, canonical rates): PRICED with immutable
  // snapshot lines, or UNPRICED when the pipeline maps to an unknown service
  // or a genuinely-used component has no active rate. Never guess, never
  // invoice zero.
  const pricingServices = await loadActiveUsageServicePricing();
  const pricingResult =
    resolution.state === "UNKNOWN"
      ? ({ state: "UNPRICED", code: UNKNOWN_USAGE_SERVICE_MAPPING } as const)
      : priceExecutionUsage(
          pricingServices,
          { durationMinutes, smsCount, callCount: durationMinutes > 0 ? 1 : 0 },
          {
            applicableServiceCodes: new Set(resolution.codes),
            requiredServiceCodes: requiredServiceCodesForUsage(resolution.codes, {
              durationMinutes,
              smsCount,
              calendarUsed
            })
          }
        );
  const lineItems = pricingResult.state === "PRICED" ? pricingResult.lineItems : [];
  const totals =
    pricingResult.state === "PRICED"
      ? pricingResult.totals
      : { actualCostMicroUsd: 0, billedCostMicroUsd: 0 };

  const pricingSnapshot = buildUsagePricingSnapshot({
    pipeline: voicePipeline,
    telephonyProvider: "twilio",
    calendarUsed,
    resolution,
    unpricedReason: pricingResult.state === "UNPRICED" ? pricingResult.code : null,
    missingServiceCodes:
      pricingResult.state === "UNPRICED" && "missingServiceCodes" in pricingResult
        ? pricingResult.missingServiceCodes
        : undefined
  });

  const vapiCostUsd = vapiCall?.costUsd ?? Number(message.cost);
  const vapiCostMicroUsd =
    Number.isFinite(vapiCostUsd) && vapiCostUsd >= 0 ? Math.round(vapiCostUsd * 1_000_000) : null;
  const vapiCostDetails =
    vapiCall?.costs ??
    vapiCall?.costBreakdown ??
    (Array.isArray(message.costs) ? message.costs : message.costBreakdown ?? null);

  const endedAt = new Date();
  if (endedAt < acquiredAt) return;
  const billingMonth = billingMonthFromDate(endedAt);

  const recordingUrl = extractRecordingUrl(message) ?? vapiCall?.recordingUrl ?? null;
  if (!recordingUrl) scheduleRecordingRefetch(callId);

  if (pricingResult.state === "UNPRICED") {
    console.error(`[usage-billing] ${pricingResult.code}: execution preserved UNPRICED for administrator reconciliation`, {
      businessId,
      callId,
      durationMinutes,
      reason: pricingResult.code,
      unknownHops: resolution.state === "UNKNOWN" ? resolution.unknownHops : undefined,
      missingServiceCodes:
        "missingServiceCodes" in pricingResult ? pricingResult.missingServiceCodes : undefined
    });
    await prisma.vapiCall.upsert({
      where: { callId },
      update: {
        installedAgentId: installedAgentId ?? undefined,
        recordingUrl: recordingUrl ?? undefined,
        durationSeconds: durationMinutes > 0 ? Math.round(durationMinutes * 60) : undefined,
        durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
        smsCount,
        vapiCostMicroUsd: vapiCostMicroUsd ?? undefined,
        vapiCostBreakdownJson: vapiCostDetails as never,
        pricingSnapshotJson: pricingSnapshot as never,
        pricingState: "UNPRICED",
        /* billingMonth was omitted here, which made an unpriceable call
           invisible: every Billing & Usage query is month-addressed, so the
           business saw neither the execution nor any charge — while the Vapi
           dashboard showed cost. The month is known from endedAt regardless of
           whether the pipeline priced; reprice recomputes the same value. */
        billingMonth,
        endedAt
      },
      create: {
        businessId,
        installedAgentId: installedAgentId ?? undefined,
        callId,
        customerPhone: customerPhone || "unknown",
        executionMode: "LIVE",
        status: "end-of-call-report",
        recordingUrl,
        durationSeconds: durationMinutes > 0 ? Math.round(durationMinutes * 60) : undefined,
        durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
        smsCount,
        vapiCostMicroUsd: vapiCostMicroUsd ?? undefined,
        vapiCostBreakdownJson: vapiCostDetails as never,
        pricingSnapshotJson: pricingSnapshot as never,
        pricingState: "UNPRICED",
        billingMonth,
        endedAt,
        metadataJson: webhookBody as never
      }
    });

    /* The execution itself is real and its buyer-facing charge — the flat
       per-execution fee — does not depend on per-hop pipeline rates. Skipping
       this on UNPRICED meant no AgentUsageExecution, therefore no execution on
       the page, no invoice attachment, and no dashboard count: the platform
       looked like it lost the call. recordAgentExecutionUsage dedupes on the
       canonical callId key under an advisory lock, so the later admin reprice
       (which also calls it, with line items) can never double-charge. */
    /* installedAgent (the business-scoped lookup), never the raw param — a
       metadata id from another tenant resolves to null there, and the fee must
       not land on a foreign agent. */
    if (installedAgent?.id) {
      try {
        await recordVapiExecutionUsage({
          installedAgentId: installedAgent.id,
          callId,
          occurredAt: endedAt,
          actualCostMicroUsd: vapiCostMicroUsd
        });
      } catch (error) {
        console.error("[usage-billing] flat-fee execution write failed for UNPRICED call (non-fatal)", {
          callId,
          error
        });
      }
    }
    return;
  }

  await prisma.vapiCall.upsert({
    where: { callId },
    update: {
      installedAgentId: installedAgentId ?? undefined,
      recordingUrl: recordingUrl ?? undefined,
      durationSeconds:
        Number.isFinite(Number(message.durationSeconds)) && Number(message.durationSeconds) > 0
          ? Math.round(Number(message.durationSeconds))
          : durationMinutes > 0
            ? Math.round(durationMinutes * 60)
            : undefined,
      durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
      smsCount,
      vapiCostMicroUsd: vapiCostMicroUsd ?? undefined,
      actualCostMicroUsd: totals.actualCostMicroUsd,
      billedCostMicroUsd: totals.billedCostMicroUsd,
      usageLineItemsJson: lineItems as never,
      vapiCostBreakdownJson: vapiCostDetails as never,
      pricingSnapshotJson: pricingSnapshot as never,
      pricingState: "PRICED",
      billingMonth,
      billingRecordedAt: endedAt,
      endedAt
    },
    create: {
      businessId,
      installedAgentId: installedAgentId ?? undefined,
      callId,
      customerPhone: customerPhone || "unknown",
      executionMode: "LIVE",
      status: "end-of-call-report",
      recordingUrl,
      durationSeconds:
        durationMinutes > 0 ? Math.round(durationMinutes * 60) : undefined,
      durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
      smsCount,
      vapiCostMicroUsd: vapiCostMicroUsd ?? undefined,
      actualCostMicroUsd: totals.actualCostMicroUsd,
      billedCostMicroUsd: totals.billedCostMicroUsd,
      usageLineItemsJson: lineItems as never,
      vapiCostBreakdownJson: vapiCostDetails as never,
      pricingSnapshotJson: pricingSnapshot as never,
      pricingState: "PRICED",
      billingMonth,
      billingRecordedAt: endedAt,
      endedAt,
      metadataJson: webhookBody as never
    }
  });

  if (installedAgent?.id) {
    await recordVapiExecutionUsage({
      installedAgentId: installedAgent.id,
      callId,
      occurredAt: endedAt,
      actualCostMicroUsd: totals.actualCostMicroUsd,
      usageLineItems: lineItems
    })
      .then(async (execution) => {
        if (!execution?.usageInvoiceId) return;
        await prisma.vapiCall.updateMany({
          where: { callId, usageInvoiceId: null },
          data: { usageInvoiceId: execution.usageInvoiceId }
        });
      })
      .catch((error) => {
        console.error("[usage-billing] canonical execution write failed (non-fatal)", {
          callId,
          installedAgentId: installedAgent.id,
          error
        });
      });
  }

  // WHAT HAPPENED ON THE CALL. Until now nothing read Vapi's endedReason —
  // the code that did was commented out — so all 159 calls on this platform
  // had an empty outcome. An empty outcome column does not look broken; it
  // looks like every call went fine. This runs for EVERY call, not just calls
  // that came from a list, so ordinary calls get their outcome too.
  await recordCallOutcome({
    callId,
    endedReason: typeof message.endedReason === "string" ? message.endedReason : null,
    transcript: extractCallTranscript(message),
    costCents: vapiCostMicroUsd ? Math.round(vapiCostMicroUsd / 10_000) : null
  }).catch((error) => {
    console.error("[usage-billing] outcome write failed (non-fatal)", { callId, error });
  });

  console.log("[usage-billing] recorded call usage", {
    businessId,
    callId,
    durationMinutes,
    billedUsd: microUsdToUsd(totals.billedCostMicroUsd),
    vapiCostUsd: vapiCostMicroUsd ? microUsdToUsd(vapiCostMicroUsd) : null
  });
}

/** The transcript, wherever Vapi put it on this payload shape. */
function extractCallTranscript(message: Record<string, unknown>): string | null {
  const artifact = message.artifact;
  if (artifact && typeof artifact === "object") {
    const value = (artifact as Record<string, unknown>).transcript;
    if (typeof value === "string" && value.trim()) return value;
  }
  return typeof message.transcript === "string" && message.transcript.trim() ? message.transcript : null;
}

/* A SECOND WAY TO CHARGE A CARD, WITH NO ROUTE AND NO SAFETY.
   Everything below this point was an older copy of the usage-billing screens:
   the bill, the invoice list, and a payment function that created a confirmed
   off-session charge with no idempotency key, no lock and no attempt claim —
   so two clicks a second apart would have charged the buyer twice. Nothing
   ever imported any of it; the live routes are in execution-usage-routes.ts.
   A second, unsafer path to a customer's card, sitting one import away from
   being wired up by mistake. Removed 2026-08-27. */
