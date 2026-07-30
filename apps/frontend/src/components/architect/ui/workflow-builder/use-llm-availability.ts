"use client";

import { useCallback, useEffect, useState } from "react";
import { getArchitectAiProviders } from "../../features/api";

export type LlmUnavailableKind = "blocked" | "no_key";

export type LlmAvailability = {
  usable: Record<string, boolean>;
  kinds: Record<string, LlmUnavailableKind>;
  reasons: Record<string, string>;
  anyUsable: boolean;
};

const CACHE_TTL_MS = 15_000;

let cached: Promise<LlmAvailability | null> | null = null;
let cachedAt = 0;

function fetchAvailability(): Promise<LlmAvailability | null> {
  return getArchitectAiProviders()
    .then((response) => {
      const providers = response.data?.providers;
      if (!response.success || !providers) return null;

      const usable: Record<string, boolean> = {};
      const kinds: Record<string, LlmUnavailableKind> = {};
      const reasons: Record<string, string> = {};

      for (const provider of providers) {
        // As long as a provider is configured with an API key, allow selecting it in the workflow builder
        usable[provider.id] = typeof provider.available === "boolean" ? provider.available : provider.configured;
        if (provider.unavailableKind) kinds[provider.id] = provider.unavailableKind;
        if (provider.unavailableReason) reasons[provider.id] = provider.unavailableReason;
      }

      return { usable, kinds, reasons, anyUsable: Object.values(usable).some(Boolean) };
    })
    .catch(() => null);
}

function loadAvailability(force = false, now = Date.now()): Promise<LlmAvailability | null> {
  if (force || !cached || now - cachedAt > CACHE_TTL_MS) {
    cached = fetchAvailability();
    cachedAt = now;
  }
  return cached;
}

/** Test seam — drops the page-level cache. */
export function resetLlmAvailabilityCache(): void {
  cached = null;
  cachedAt = 0;
}

export function useLlmAvailability(): {
  availability: LlmAvailability | null;
  refresh: () => void;
} {
  const [availability, setAvailability] = useState<LlmAvailability | null>(null);

  const apply = useCallback((force: boolean) => {
    let active = true;
    void loadAvailability(force).then((result) => {
      if (active) setAvailability(result);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => apply(false), [apply]);

  const refresh = useCallback(() => {
    apply(true);
  }, [apply]);

  return { availability, refresh };
}

export function isProviderDisabled(
  availability: LlmAvailability | null,
  providerId: string
): boolean {
  if (!availability) return false;
  // If the provider has a key configured on the backend, it is usable
  if (availability.usable[providerId] === true) return false;

  if (availability.kinds[providerId] === "blocked") return true;
  return availability.anyUsable;
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
