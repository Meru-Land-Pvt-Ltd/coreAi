import type { Context } from "hono";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
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
      executionMode: true,
      billingRecordedAt: true,
      usageInvoiceId: true,
      recordingUrl: true,
      pricingState: true,
      conversationId: true
    }
  });
  if (callRow && callRow.executionMode !== "LIVE") {
    console.log("[usage-billing] skipped: non-live call", { businessId, callId, executionMode: callRow.executionMode });
    return;
  }

  if (callRow?.billingRecordedAt || callRow?.usageInvoiceId || callRow?.pricingState === "PRICED" || callRow?.pricingState === "INVOICED") {
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
    const assignedMapping = await prisma.businessPhoneNumber.findFirst({
      where: {
        businessId,
        phoneNumber: assignedPhoneNumber,
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

  console.log("[usage-billing] recorded call usage", {
    businessId,
    callId,
    durationMinutes,
    billedUsd: microUsdToUsd(totals.billedCostMicroUsd),
    vapiCostUsd: vapiCostMicroUsd ? microUsdToUsd(vapiCostMicroUsd) : null
  });
}

function rollupLineItems(
  calls: Array<{ usageLineItemsJson: unknown }>,
  serviceRoles: UsageInvoiceLabelMap
) {
  const rollup = new Map<
    string,
    {
      serviceCode: string;
      serviceName: string;
      unit: string;
      quantity: number;
      actualCostMicroUsd: number;
      billedCostMicroUsd: number;
    }
  >();

  for (const call of calls) {
    const items = Array.isArray(call.usageLineItemsJson)
      ? customerFacingUsageLineItems(
          call.usageLineItemsJson as UsageLineItem[],
          serviceRoles
        )
      : [];

    for (const item of items) {
      const existing = rollup.get(item.serviceCode);
      if (!existing) {
        rollup.set(item.serviceCode, {
          serviceCode: item.serviceCode,
          serviceName: item.serviceName,
          unit: item.unit,
          quantity: item.quantity,
          actualCostMicroUsd: item.actualCostMicroUsd,
          billedCostMicroUsd: item.billedCostMicroUsd
        });
        continue;
      }

      existing.quantity += item.quantity;
      existing.actualCostMicroUsd += item.actualCostMicroUsd;
      existing.billedCostMicroUsd += item.billedCostMicroUsd;
    }
  }

  return [...rollup.values()].map((item) => ({
    ...item,
    actualCostUsd: microUsdToUsd(item.actualCostMicroUsd),
    billedCostUsd: microUsdToUsd(item.billedCostMicroUsd)
  }));
}

function rollupAgentUsage(
  calls: Array<{
    installedAgentId: string | null;
    durationMinutes: number | null;
    billedCostMicroUsd: number | null;
    usageLineItemsJson?: unknown;
  }>,
  agentNames: Map<string, string>,
  serviceRoles: UsageInvoiceLabelMap
) {
  const rollup = new Map<string, {
    agentId: string | null;
    agentName: string;
    callCount: number;
    durationMinutes: number;
    billedCostMicroUsd: number;
    services: Map<string, {
      serviceCode: string;
      serviceName: string;
      unit: string;
      quantity: number;
      billedCostMicroUsd: number;
    }>;
  }>();

  for (const call of calls) {
    const key = call.installedAgentId ?? "unassigned";
    const existing = rollup.get(key) ?? {
      agentId: call.installedAgentId,
      agentName: call.installedAgentId
        ? agentNames.get(call.installedAgentId) ?? "Agent"
        : "Unassigned agent",
      callCount: 0,
      durationMinutes: 0,
      billedCostMicroUsd: 0,
      services: new Map()
    };
    existing.callCount += 1;
    existing.durationMinutes += call.durationMinutes ?? 0;
    existing.billedCostMicroUsd += call.billedCostMicroUsd ?? 0;
    const lineItems = Array.isArray(call.usageLineItemsJson)
      ? customerFacingUsageLineItems(
          call.usageLineItemsJson as UsageLineItem[],
          serviceRoles
        )
      : [];
    for (const lineItem of lineItems) {
      if (lineItem.quantity <= 0 || lineItem.billedCostMicroUsd <= 0) continue;
      const service = existing.services.get(lineItem.serviceCode) ?? {
        serviceCode: lineItem.serviceCode,
        serviceName: lineItem.serviceName,
        unit: lineItem.unit,
        quantity: 0,
        billedCostMicroUsd: 0
      };
      service.quantity += lineItem.quantity;
      service.billedCostMicroUsd += lineItem.billedCostMicroUsd;
      existing.services.set(lineItem.serviceCode, service);
    }
    rollup.set(key, existing);
  }

  return [...rollup.values()].map(({ services, ...item }) => ({
    ...item,
    billedCostUsd: microUsdToUsd(item.billedCostMicroUsd),
    amountCents: Math.round(item.billedCostMicroUsd / 10_000),
    serviceCosts: [...services.values()].map((service) => ({
      ...service,
      billedCostUsd: microUsdToUsd(service.billedCostMicroUsd),
      amountCents: Math.round(service.billedCostMicroUsd / 10_000)
    }))
  }));
}

export async function getBusinessUsageBill(c: Context) {
  const authUser = c.get("authUser");
  const month = (c.req.query("month") ?? "").trim() || billingMonthFromDate(new Date());

  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
    select: { id: true, name: true }
  });

  if (!business) {
    return successResponse(c, {
      month,
      businessId: null,
      totalCalls: 0,
      totalDurationMinutes: 0,
      totalActualUsd: 0,
      totalBilledUsd: 0,
      totalVapiReportedUsd: 0,
      updatedAt: null,
      agentRollup: [],
      serviceRollup: [],
      calls: []
    });
  }

  const [calls, agents, serviceRoles] = await Promise.all([
    prisma.vapiCall.findMany({
      where: {
        businessId: business.id,
        billingMonth: month,
        /* UNPRICED calls (billingRecordedAt null until admin reprice) are shown
           with their flat execution fee rather than hidden — a call the buyer
           made and was charged for must never be absent from their bill. */
        OR: [
          { billingRecordedAt: { not: null } },
          { pricingState: { in: ["PENDING", "UNPRICED"] } }
        ]
      },
      orderBy: [{ billingRecordedAt: "desc" }, { createdAt: "desc" }],
      select: {
        callId: true,
        customerPhone: true,
        durationMinutes: true,
        durationSeconds: true,
        smsCount: true,
        actualCostMicroUsd: true,
        billedCostMicroUsd: true,
        vapiCostMicroUsd: true,
        usageLineItemsJson: true,
        billingRecordedAt: true,
        installedAgentId: true,
        recordingUrl: true
      }
    }),
    prisma.installedAgent.findMany({
      where: { businessId: business.id },
      select: { id: true, name: true }
    }),
    loadServiceRoles()
  ]);
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));

  const totalDurationMinutes = calls.reduce((sum, call) => sum + (call.durationMinutes ?? 0), 0);
  const totalActualMicroUsd = calls.reduce((sum, call) => sum + (call.actualCostMicroUsd ?? 0), 0);
  const totalBilledMicroUsd = calls.reduce((sum, call) => sum + (call.billedCostMicroUsd ?? 0), 0);
  const totalVapiMicroUsd = calls.reduce((sum, call) => sum + (call.vapiCostMicroUsd ?? 0), 0);

  return successResponse(c, {
    month,
    businessId: business.id,
    businessName: business.name,
    totalCalls: calls.length,
    totalDurationMinutes,
    totalActualUsd: microUsdToUsd(totalActualMicroUsd),
    totalBilledUsd: microUsdToUsd(totalBilledMicroUsd),
    totalVapiReportedUsd: microUsdToUsd(totalVapiMicroUsd),
    updatedAt: calls[0]?.billingRecordedAt?.toISOString() ?? null,
    agentRollup: rollupAgentUsage(calls, agentNames, serviceRoles),
    serviceRollup: rollupLineItems(calls, serviceRoles),
    calls: calls.map((call) => ({
      callId: call.callId,
      customerPhone: call.customerPhone,
      installedAgentId: call.installedAgentId,
      durationMinutes: call.durationMinutes,
      durationSeconds: call.durationSeconds,
      smsCount: call.smsCount,
      actualCostUsd: call.actualCostMicroUsd ? microUsdToUsd(call.actualCostMicroUsd) : 0,
      billedCostUsd: call.billedCostMicroUsd ? microUsdToUsd(call.billedCostMicroUsd) : 0,
      vapiReportedCostUsd: call.vapiCostMicroUsd ? microUsdToUsd(call.vapiCostMicroUsd) : null,
      lineItems: Array.isArray(call.usageLineItemsJson)
        ? customerFacingUsageLineItems(
            call.usageLineItemsJson as UsageLineItem[],
            serviceRoles
          )
        : [],
      recordedAt: call.billingRecordedAt?.toISOString() ?? null,
      recordingUrl: call.recordingUrl ?? null
    }))
  });
}

function serializeUsageInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  billingMonth: string;
  status: string;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  dueAt: Date;
  totalMicroUsd: number;
  paidAt: Date | null;
  reminderCount: number;
  suspendedAt: Date | null;
  lineItems: Array<{
    serviceCode: string;
    serviceName: string;
    unit: string;
    quantity: number;
    unitPriceMicroUsd: number;
    amountMicroUsd: number;
  }>;
  calls: Array<{
    installedAgentId: string | null;
    durationMinutes: number | null;
    billedCostMicroUsd: number | null;
    usageLineItemsJson: unknown;
  }>;
}, agentNames: Map<string, string>, serviceRoles: UsageInvoiceLabelMap) {
  const agentBreakdown = rollupAgentUsage(invoice.calls, agentNames, serviceRoles);
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    billingMonth: invoice.billingMonth,
    status: invoice.status,
    currency: invoice.currency,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    issuedAt: invoice.issuedAt.toISOString(),
    dueAt: invoice.dueAt.toISOString(),
    totalMicroUsd: invoice.totalMicroUsd,
    totalUsd: microUsdToUsd(invoice.totalMicroUsd),
    amountCents: Math.round(invoice.totalMicroUsd / 10_000),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    reminderCount: invoice.reminderCount,
    suspendedAt: invoice.suspendedAt?.toISOString() ?? null,
    callCount: invoice.calls.length,
    agentBreakdown,
    lineItems: customerFacingUsageLineItems(
      invoice.lineItems.map((item) => ({
        serviceCode: item.serviceCode,
        serviceName: item.serviceName,
        unit: item.unit as UsageLineItem["unit"],
        quantity: item.quantity,
        actualCostMicroUsd: 0,
        billedCostMicroUsd: item.amountMicroUsd
      })),
      serviceRoles
    ).map((item) => ({
      serviceCode: item.serviceCode,
      serviceName: item.serviceName,
      unit: item.unit,
      quantity: item.quantity,
      amountMicroUsd: item.billedCostMicroUsd,
      amountUsd: microUsdToUsd(item.billedCostMicroUsd)
    }))
  };
}

export async function getBusinessUsageInvoices(c: Context) {
  const authUser = c.get("authUser");
  const business = await prisma.business.findFirst({
    where: { id: (await resolvePrimaryBusinessId(authUser.id)) ?? "" },
    select: { id: true }
  });
  if (!business) return successResponse(c, { invoices: [] });

  const [invoices, agents, serviceRoles] = await Promise.all([
    prisma.businessUsageInvoice.findMany({
      where: { businessId: business.id },
      orderBy: [{ billingMonth: "desc" }, { issuedAt: "desc" }],
      include: {
        lineItems: { orderBy: { amountMicroUsd: "desc" } },
        calls: {
          select: {
            installedAgentId: true,
            durationMinutes: true,
            billedCostMicroUsd: true,
            usageLineItemsJson: true
          }
        }
      }
    }),
    prisma.installedAgent.findMany({
      where: { businessId: business.id },
      select: { id: true, name: true }
    }),
    loadServiceRoles()
  ]);
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  return successResponse(c, {
    invoices: invoices.map((invoice) => serializeUsageInvoice(invoice, agentNames, serviceRoles))
  });
}

export async function payBusinessUsageInvoice(c: Context) {
  const authUser = c.get("authUser");
  const invoiceId = c.req.param("id");
  const invoice = await prisma.businessUsageInvoice.findFirst({
    where: { id: invoiceId, business: { ownerId: authUser.id } },
    include: { business: { select: { id: true } } }
  });
  if (!invoice) return errorResponse(c, "Invoice not found", 404, "USAGE_INVOICE_NOT_FOUND");
  if (invoice.status === "PAID") return successResponse(c, { invoiceId, alreadyPaid: true });
  if (invoice.status === "VOID") return errorResponse(c, "Invoice is void", 409, "USAGE_INVOICE_VOID");

  const stripe = getStripeClient();
  if (!stripe || !isStripeConfigured()) {
    return errorResponse(c, "Stripe is not configured", 503, "STRIPE_NOT_CONFIGURED");
  }

  const savedPayment = await prisma.payment.findFirst({
    where: {
      userId: authUser.id,
      stripeCustomerId: { not: null },
      stripePaymentId: { not: null },
      status: "SUCCEEDED"
    },
    orderBy: { createdAt: "desc" },
    select: { stripeCustomerId: true, stripePaymentId: true }
  });
  if (!savedPayment?.stripeCustomerId || !savedPayment.stripePaymentId) {
    return errorResponse(c, "No saved payment method is available", 409, "PAYMENT_METHOD_REQUIRED");
  }

  const amountCents = Math.round(invoice.totalMicroUsd / 10_000);
  if (amountCents < 50) {
    return errorResponse(c, "Invoice is below Stripe's $0.50 minimum charge", 409, "INVOICE_BELOW_MINIMUM");
  }

  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: invoice.currency,
    customer: savedPayment.stripeCustomerId,
    payment_method: savedPayment.stripePaymentId,
    confirm: true,
    off_session: true,
    description: `Triven usage invoice ${invoice.invoiceNumber}`,
    metadata: {
      usageInvoiceId: invoice.id,
      businessId: invoice.business.id,
      billingMonth: invoice.billingMonth
    }
  });

  if (intent.status !== "succeeded") {
    return errorResponse(c, "Payment requires attention", 409, "USAGE_INVOICE_PAYMENT_INCOMPLETE");
  }

  await prisma.businessUsageInvoice.update({
    where: { id: invoice.id },
    data: { status: "PAID", paidAt: new Date(), stripePaymentIntentId: intent.id }
  });
  const servicesRestored = await restoreBusinessAfterBillingPayment(invoice.business.id);
  return successResponse(c, { invoiceId, status: "PAID", servicesRestored }, "Invoice paid");
}
