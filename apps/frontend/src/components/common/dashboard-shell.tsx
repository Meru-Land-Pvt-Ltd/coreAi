"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAuthUser, logout, type AuthRole, type AuthUser } from "@/lib/auth";

type Props = {
  role: AuthRole;
  title: string;
  subtitle: string;
  children: React.ReactNode;
};

export function DashboardShell({ role, title, subtitle, children }: Props) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const authUser = getAuthUser();
    setUser(authUser);

    if (!authUser || authUser.role !== role) {
      window.location.href =
        role === "ADMIN"
          ? "/admin/login"
          : role === "BUSINESS"
            ? "/business/login"
            : "/architect/login";
    }
  }, [role]);

  if (!user) {
    return (
      <main data-testid="components-common-dashboard-shell-main-1" className="flex min-h-screen items-center justify-center bg-[#fff8ef] text-orange-950">
        <p data-testid="components-common-dashboard-shell-p-1" className="text-sm text-orange-800">Checking session...</p>
      </main>
    );
  }

  return (
    <main data-testid="components-common-dashboard-shell-main-2" className="min-h-screen bg-[#fff8ef] text-orange-950">
      <header data-testid="components-common-dashboard-shell-header-1" className="border-b border-orange-200 bg-white/75 backdrop-blur">
        <div data-testid="components-common-dashboard-shell-div-1" className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link data-testid="components-common-dashboard-shell-link-1" href="/" className="flex items-center gap-3">
            <div data-testid="components-common-dashboard-shell-div-2" className="brand-ring" />
            <span data-testid="components-common-dashboard-shell-span-1" className="font-bold">CoreAI Marketplace</span>
          </Link>

          <div data-testid="components-common-dashboard-shell-div-3" className="flex items-center gap-4">
            <span data-testid="components-common-dashboard-shell-span-2" className="hidden text-sm text-orange-800 md:inline">
              {user.fullName ?? user.email}
            </span>
            <button data-testid="components-common-dashboard-shell-button-1"
              onClick={logout}
              className="rounded-full border border-orange-300 px-4 py-2 text-sm font-semibold text-orange-900"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <section data-testid="components-common-dashboard-shell-section-1" className="mx-auto max-w-7xl px-6 py-8">
        <div data-testid="components-common-dashboard-shell-div-4" className="mb-8">
          <p data-testid="components-common-dashboard-shell-p-2" className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-600">
            {role}
          </p>
          <h1 data-testid="components-common-dashboard-shell-h1-1" className="mt-2 text-3xl font-bold">{title}</h1>
          <p data-testid="components-common-dashboard-shell-p-3" className="mt-2 max-w-2xl text-sm leading-6 text-orange-800/75">{subtitle}</p>
        </div>

        {children}
      </section>
    </main>
  );
}