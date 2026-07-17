"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getAuthToken, getAuthUser } from "@/lib/auth";
import { businessLoginPathWithNext } from "@/lib/routes";

type GuardStatus = "checking" | "authed";

export function BusinessAuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<GuardStatus>("checking");

  useEffect(() => {
    const token = getAuthToken();
    const user = getAuthUser();

    if (!token || user?.role !== "BUSINESS") {
      const query = searchParams.toString();
      const returnTo = `${pathname}${query ? `?${query}` : ""}`;
      router.replace(businessLoginPathWithNext(returnTo));
      return;
    }

    setStatus("authed");
  }, [pathname, router, searchParams]);

  if (status !== "authed") {
    return <div className="min-h-screen bg-gray-50" />;
  }

  return <>{children}</>;
}
