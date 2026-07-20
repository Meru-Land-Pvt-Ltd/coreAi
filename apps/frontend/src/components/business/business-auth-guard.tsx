"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getAuthToken, getAuthUser, hasAuthRole, setActiveWorkspace } from "@/lib/auth";
import { ensureBusinessWorkspaceAccess } from "@/lib/business-workspace";
import { businessLoginPathWithNext } from "@/lib/routes";

type GuardStatus = "checking" | "authed";

export function BusinessAuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<GuardStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    const redirectToLogin = () => {
      const query = searchParams.toString();
      const returnTo = `${pathname}${query ? `?${query}` : ""}`;
      router.replace(businessLoginPathWithNext(returnTo));
    };

    const token = getAuthToken();
    const user = getAuthUser();

    if (!token || !user) {
      redirectToLogin();
      return;
    }

    if (hasAuthRole(user, "BUSINESS")) {
      setActiveWorkspace("BUSINESS");
      setStatus("authed");
      return;
    }

    // Authenticated account without the BUSINESS capability (e.g. an
    // ARCHITECT entering the buyer side intentionally) — activate the
    // Business workspace server-side; the token and other roles are kept.
    void ensureBusinessWorkspaceAccess().then((access) => {
      if (cancelled) return;
      if (access === "authed") {
        setStatus("authed");
      } else {
        redirectToLogin();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pathname, router, searchParams]);

  if (status !== "authed") {
    return <div className="min-h-screen bg-gray-50" />;
  }

  return <>{children}</>;
}
