"use client";

import type { ReactNode } from "react";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuthSession, getAuthUser } from "@/lib/auth";
import { AdminShell } from "@/components/admin/ui/admin-shell";

const ADMIN_LOGIN_PATH = "/admin/login" as Route;

export default function AdminProtectedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const authUser = getAuthUser();

    if (!authUser) {
      router.replace(ADMIN_LOGIN_PATH);
      return;
    }
    if (authUser.role !== "ADMIN") {
      // Wrong role in this browser session — clear it and send to admin login
      // (not the home page).
      clearAuthSession();
      router.replace(ADMIN_LOGIN_PATH);
      return;
    }
    setAllowed(true);
  }, [router]);

  // Backend still enforces ADMIN on every /admin API — this guard is UX only.
  if (!allowed) {
    return <div data-testid="admin-protected-checking" className="min-h-screen bg-[#fffaf3]" />;
  }

  return <AdminShell>{children}</AdminShell>;
}
