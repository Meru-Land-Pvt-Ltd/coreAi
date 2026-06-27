"use client";

import Link from "next/link";
import type { Route } from "next";
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
      <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] text-orange-950">
        <p className="text-sm text-orange-800" data-testid="common-dashboard-shell-checking-session-text">Checking session...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff8ef] text-orange-950">
      <header className="border-b border-orange-200 bg-white/75 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link data-testid="dashboard-shell-home-link" href={"/" as Route} className="flex items-center gap-3">
            <div className="brand-ring" />
            <span className="font-bold" data-testid="common-dashboard-shell-core-ai-marketplace-text">CoreAI Marketplace</span>
          </Link>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-orange-800 md:inline" data-testid="common-dashboard-shell-user-full-user-email-text">
              {user.fullName ?? user.email}
            </span>
            <button data-testid="dashboard-shell-logout-button"
              onClick={logout}
              className="rounded-full border border-orange-300 px-4 py-2 text-sm font-semibold text-orange-900"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-600" data-testid="common-dashboard-shell-role-text">
            {role}
          </p>
          <h1 className="mt-2 text-3xl font-bold" data-testid="common-dashboard-shell-title-heading">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-orange-800/75" data-testid="common-dashboard-shell-subtitle-text">{subtitle}</p>
        </div>

        {children}
      </section>
    </main>
  );
}