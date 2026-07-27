"use client";

import { useEffect, useState } from "react";
import { getArchitectAiProviders } from "../../features/api";

export type LlmAvailability = {
  configured: Record<string, boolean>;
  envKeys: Record<string, string>;
  anyConfigured: boolean;
};

let cached: Promise<LlmAvailability | null> | null = null;

function loadAvailability(): Promise<LlmAvailability | null> {
  if (!cached) {
    cached = getArchitectAiProviders()
      .then((response) => {
        const providers = response.data?.providers;
        if (!response.success || !providers) return null;

        const configured: Record<string, boolean> = {};
        const envKeys: Record<string, string> = {};

        for (const provider of providers) {
          configured[provider.id] = provider.configured;
          if (provider.envKey) envKeys[provider.id] = provider.envKey;
        }

        return {
          configured,
          envKeys,
          anyConfigured: Object.values(configured).some(Boolean)
        };
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
 * A provider is only greyed out when the backend has at least one working
 * provider — with no keys at all, disabling everything would block workflow
 * design entirely, so the builder just shows the hint instead.
 */
export function isProviderDisabled(
  availability: LlmAvailability | null,
  providerId: string
): boolean {
  if (!availability || !availability.anyConfigured) return false;
  return availability.configured[providerId] === false;
}

export function providerKeyHint(
  availability: LlmAvailability | null,
  providerId: string
): string | null {
  if (!availability || availability.configured[providerId] !== false) return null;
  const envKey = availability.envKeys[providerId];
  return envKey ? `No ${envKey}` : "No API key";
}
