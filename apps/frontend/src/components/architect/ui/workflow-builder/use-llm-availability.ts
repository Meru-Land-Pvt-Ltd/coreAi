"use client";

import { useEffect, useState } from "react";
import { getArchitectAiProviders } from "../../features/api";

export type LlmAvailability = {
  /** providerId → can the backend actually run it right now. */
  usable: Record<string, boolean>;
  /** providerId → short reason, for a tooltip only (never shown as text). */
  reasons: Record<string, string>;
  /** False when nothing is usable — the builder then greys nothing out. */
  anyUsable: boolean;
};

let cached: Promise<LlmAvailability | null> | null = null;

function loadAvailability(): Promise<LlmAvailability | null> {
  if (!cached) {
    cached = getArchitectAiProviders()
      .then((response) => {
        const providers = response.data?.providers;
        if (!response.success || !providers) return null;

        const usable: Record<string, boolean> = {};
        const reasons: Record<string, string> = {};

        for (const provider of providers) {
          // `available` folds in runtime health (no credit, over quota, key
          // rejected); older backends only send `configured`.
          usable[provider.id] = provider.available ?? provider.configured;
          if (provider.unavailableReason) reasons[provider.id] = provider.unavailableReason;
        }

        return { usable, reasons, anyUsable: Object.values(usable).some(Boolean) };
      })
      .catch(() => null);
  }

  return cached;
}

/** Test seam — drops the page-level cache. */
export function resetLlmAvailabilityCache(): void {
  cached = null;
}

export function useLlmAvailability(): LlmAvailability | null {
  const [availability, setAvailability] = useState<LlmAvailability | null>(null);

  useEffect(() => {
    let active = true;
    void loadAvailability().then((result) => {
      if (active) setAvailability(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return availability;
}

/**
 * A provider is only greyed out when at least one other provider works — with
 * nothing usable, disabling everything would block workflow design entirely.
 */
export function isProviderDisabled(
  availability: LlmAvailability | null,
  providerId: string
): boolean {
  if (!availability || !availability.anyUsable) return false;
  return availability.usable[providerId] === false;
}

/** Tooltip text for a disabled provider. Never rendered as visible label text. */
export function providerDisabledTitle(
  availability: LlmAvailability | null,
  providerId: string
): string | undefined {
  if (!isProviderDisabled(availability, providerId)) return undefined;
  const reason = availability?.reasons[providerId];
  return reason ? `Unavailable — ${reason}` : "Unavailable on this backend";
}
