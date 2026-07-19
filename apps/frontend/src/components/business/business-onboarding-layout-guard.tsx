"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken, getAuthUser, hasAuthRole, setActiveWorkspace } from "@/lib/auth";
import { ensureBusinessWorkspaceAccess } from "@/lib/business-workspace";
import { BUSINESS_LOGIN_PATH } from "@/lib/routes";

type GuardStatus = "checking" | "authed";

export function BusinessOnboardingLayoutGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<GuardStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    const token = getAuthToken();
    const user = getAuthUser();

    if (!token || !user) {
      router.replace(BUSINESS_LOGIN_PATH);
      return;
    }

    if (hasAuthRole(user, "BUSINESS")) {
      setActiveWorkspace("BUSINESS");
      setStatus("authed");
      return;
    }

    // Dual-role entry (e.g. ARCHITECT starting buyer onboarding) — grant the
    // BUSINESS capability server-side without touching the session token.
    void ensureBusinessWorkspaceAccess().then((access) => {
      if (cancelled) return;
      if (access === "authed") {
        setStatus("authed");
      } else {
        router.replace(BUSINESS_LOGIN_PATH);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (status !== "authed") {
    return <div className="min-h-screen bg-white" />;
  }

  return <>{children}</>;
}
