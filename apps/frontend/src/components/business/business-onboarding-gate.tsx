"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { primeBusinessOnboardingStatus } from "@/lib/business-onboarding-status";
import { BUSINESS_ONBOARDING_PATH } from "@/lib/routes";

type GateStatus = "checking" | "ready";

export function BusinessOnboardingGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<GateStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    async function checkOnboarding() {
      try {
        const status = await primeBusinessOnboardingStatus();

        if (cancelled) return;

        if (status && !status.completed && !status.skipped) {
          router.replace(BUSINESS_ONBOARDING_PATH);
          return;
        }
      } catch {
        // Allow access if onboarding status cannot be loaded.
      }

      if (!cancelled) {
        setStatus("ready");
      }
    }

    void checkOnboarding();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (status !== "ready") {
    return <div className="min-h-screen bg-gray-50" />;
  }

  return <>{children}</>;
}
