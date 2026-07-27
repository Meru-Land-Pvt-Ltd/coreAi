"use client";

import { apiGet } from "@/lib/api";

export type BusinessOnboardingStatus = { completed: boolean; skipped: boolean };

const CACHE_KEY = "triven.business.onboarding-status";

let inFlight: Promise<BusinessOnboardingStatus | null> | null = null;

function readCache(): BusinessOnboardingStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BusinessOnboardingStatus;
    return typeof parsed?.completed === "boolean" && typeof parsed?.skipped === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(value: BusinessOnboardingStatus): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // Private mode / quota — the check simply runs again next load.
  }
}

/** Called when onboarding is completed or skipped so the gate re-reads it. */
export function clearBusinessOnboardingStatusCache(): void {
  inFlight = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function primeBusinessOnboardingStatus(): Promise<BusinessOnboardingStatus | null> {
  if (inFlight) return inFlight;

  const cached = readCache();
  if (cached) {
    inFlight = Promise.resolve(cached);
    return inFlight;
  }

  inFlight = apiGet<BusinessOnboardingStatus>("/business/onboarding")
    .then((response) => {
      if (!response.success || !response.data) return null;
      if (response.data.completed || response.data.skipped) writeCache(response.data);
      return response.data;
    })
    .catch(() => null);

  return inFlight;
}
