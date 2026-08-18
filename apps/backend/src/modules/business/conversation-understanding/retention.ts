/**
 * Recording/transcript retention sweep.
 *
 * Businesses can set Business.recordingRetentionDays (null = keep forever).
 * For LIVE VapiCall rows older than that window the sweep:
 *   1. attempts provider-side deletion (DELETE {VAPI_BASE_URL}/call/{id}),
 *   2. nulls transcript/summary/recordingUrl on the Triven side,
 *   3. stamps recordingDeletedAt + providerDeletionState.
 *
 * providerDeletionState is HONEST:
 *   - "DELETED"       — Vapi confirmed the delete (2xx).
 *   - "DELETE_FAILED" — Vapi rejected/404'd or the request failed. We never
 *                       pretend a deletion succeeded; a 404 means we could
 *                       not CONFIRM deletion, so it is recorded as failed.
 *   - "UNSUPPORTED"   — no VAPI_API_KEY configured, or the API answered
 *                       405/501 (endpoint not supported).
 *
 * Rows are selected by recordingDeletedAt: null, so each row is swept exactly
 * once (Triven-side data is gone either way); retrying DELETE_FAILED rows at
 * the provider is a deliberate follow-up, visible via providerDeletionState.
 *
 * Batch limit: RETENTION_SWEEP_BATCH_LIMIT (50) rows per sweep across all
 * businesses, so a backlog cannot stall the worker tick.
 */

import { prisma } from "../../../lib/prisma";
import { env } from "../../../config/env";

export const RETENTION_SWEEP_BATCH_LIMIT = 50;

export type ProviderDeletionState = "DELETED" | "DELETE_FAILED" | "UNSUPPORTED";

export interface ProviderDeletionResult {
  state: ProviderDeletionState;
  detail?: string;
}

/**
 * Best-effort provider-side deletion of a Vapi call (recording + transcript
 * artifacts live under the call resource). Never throws; never lies about
 * success.
 */
export async function deleteVapiCallArtifacts(callId: string): Promise<ProviderDeletionResult> {
  if (!env.VAPI_API_KEY) {
    return {
      state: "UNSUPPORTED",
      detail: "VAPI_API_KEY is not configured — provider-side deletion cannot be attempted."
    };
  }

  const url = `${env.VAPI_BASE_URL.replace(/\/$/, "")}/call/${encodeURIComponent(callId)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.VAPI_API_KEY}`
      }
    });
  } catch (error) {
    return {
      state: "DELETE_FAILED",
      detail: `network error: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (response.ok) return { state: "DELETED" };
  if (response.status === 405 || response.status === 501) {
    return {
      state: "UNSUPPORTED",
      detail: `Vapi does not support DELETE /call (HTTP ${response.status}).`
    };
  }
  if (response.status === 404) {
    return {
      state: "DELETE_FAILED",
      detail: "Vapi returned 404 — deletion could not be confirmed."
    };
  }
  return { state: "DELETE_FAILED", detail: `Vapi returned HTTP ${response.status}.` };
}

export interface RetentionSweepResult {
  /** Rows picked up this sweep (bounded by the batch limit). */
  scanned: number;
  /** Rows whose Triven-side artifacts were nulled. */
  cleaned: number;
  providerDeleted: number;
  providerFailed: number;
  providerUnsupported: number;
}

export async function sweepExpiredRecordings(
  options: { batchLimit?: number; now?: Date } = {}
): Promise<RetentionSweepResult> {
  const batchLimit = options.batchLimit ?? RETENTION_SWEEP_BATCH_LIMIT;
  const now = options.now ?? new Date();

  const result: RetentionSweepResult = {
    scanned: 0,
    cleaned: 0,
    providerDeleted: 0,
    providerFailed: 0,
    providerUnsupported: 0
  };

  // Only businesses that opted into retention. null = keep indefinitely;
  // 0/negative is treated as "not configured" rather than "delete everything".
  const businesses = await prisma.business.findMany({
    where: { recordingRetentionDays: { gt: 0 } },
    select: { id: true, recordingRetentionDays: true }
  });

  let remaining = batchLimit;
  for (const business of businesses) {
    if (remaining <= 0) break;
    const retentionDays = business.recordingRetentionDays;
    if (!retentionDays || retentionDays <= 0) continue;

    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const expiredCalls = await prisma.vapiCall.findMany({
      where: {
        businessId: business.id,
        recordingDeletedAt: null,
        createdAt: { lt: cutoff }
      },
      select: { id: true, callId: true },
      take: remaining
    });

    for (const call of expiredCalls) {
      result.scanned += 1;
      remaining -= 1;
      try {
        const provider = await deleteVapiCallArtifacts(call.callId);
        if (provider.state === "DELETED") result.providerDeleted += 1;
        else if (provider.state === "UNSUPPORTED") result.providerUnsupported += 1;
        else result.providerFailed += 1;

        await prisma.vapiCall.update({
          where: { id: call.id },
          data: {
            transcript: null,
            summary: null,
            recordingUrl: null,
            recordingDeletedAt: now,
            providerDeletionState: provider.state
          }
        });
        result.cleaned += 1;
      } catch (error) {
        // One bad row must not stall the sweep; the row stays eligible for
        // the next tick because recordingDeletedAt was never set.
        console.error("[retention-sweep] failed to clean call (will retry next sweep)", {
          vapiCallRowId: call.id,
          callId: call.callId,
          error: error instanceof Error ? error.message : error
        });
      }
    }
  }

  return result;
}

const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let retentionTimer: ReturnType<typeof setInterval> | null = null;

/** Interval worker — mirror of startBillingScheduler; wire in src/index.ts. */
export function startRetentionSweepWorker(): void {
  if (retentionTimer) return;
  const execute = () => {
    void sweepExpiredRecordings()
      .then((result) => {
        if (result.scanned > 0) console.log("[retention-sweep] sweep complete", result);
      })
      .catch((error) => {
        console.error("[retention-sweep] sweep failed", error);
      });
  };
  execute();
  retentionTimer = setInterval(execute, RETENTION_SWEEP_INTERVAL_MS);
  retentionTimer.unref();
}

export function stopRetentionSweepWorker(): void {
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = null;
}
