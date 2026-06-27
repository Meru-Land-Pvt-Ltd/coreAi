"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken, getAuthUser } from "@/lib/auth";
import { BUSINESS_LOGIN_PATH } from "@/lib/routes";

type GuardStatus = "checking" | "authed";

export function BusinessAuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<GuardStatus>("checking");

  useEffect(() => {
    const token = getAuthToken();
    const user = getAuthUser();

    if (!token || user?.role !== "BUSINESS") {
      router.replace(BUSINESS_LOGIN_PATH);
      return;
    }

    setStatus("authed");
  }, [router]);

  if (status !== "authed") {
    return <div className="min-h-screen bg-gray-50" />;
  }

  return <>{children}</>;
}
