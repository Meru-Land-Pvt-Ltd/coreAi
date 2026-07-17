"use client";

import Link from "next/link";
import type { Route } from "next";
import { Bot, Building2, CircleDollarSign, Mail, Phone, UserRoundCog, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { StatCard } from "@/components/common/stat-card";
import { getAdminSummary, type AdminSummary } from "@/components/admin/features/api";

const QUICK_LINKS: Array<{ label: string; detail: string; href: Route; icon: LucideIcon }> = [
  { label: "Review agents", detail: "Moderate marketplace listings", href: "/admin/agents" as Route, icon: Bot },
  { label: "Review payouts", detail: "Approve architect earnings", href: "/admin/payout" as Route, icon: CircleDollarSign },
  { label: "Phone inventory", detail: "Assignments and webhook health", href: "/admin/phone-numbers" as Route, icon: Phone },
  { label: "Mail operations", detail: "Aliases and delivery health", href: "/admin/mail" as Route, icon: Mail }
];

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    async function load() {
      const result = await getAdminSummary();
      if (!active) return;
      if (result.success && result.data) {
        setSummary(result.data);
        setState("ready");
      } else {
        setState("error");
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  return (
    <div>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-normal text-amber-700">Administration</p>
          <h1 className="text-2xl font-bold text-slate-950">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Marketplace activity, account health, and operational work.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Trivern systems
        </div>
      </header>

      {state === "loading" ? (
        <div data-testid="admin-dashboard-loading" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-lg border border-gray-200 bg-white" />)}
        </div>
      ) : state === "error" ? (
        <div data-testid="admin-dashboard-error" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">Could not load summary.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Businesses" value={String(summary?.totalBusinesses ?? 0)} hint="Registered companies" />
          <StatCard label="Architects" value={String(summary?.totalArchitects ?? 0)} hint="Builder accounts" />
          <StatCard label="Agent listings" value={String(summary?.totalAgentListings ?? 0)} hint="All marketplace listings" />
          <StatCard label="Pending reviews" value={String(summary?.pendingAgentListings ?? 0)} hint="Need admin action" />
          <StatCard label="Approved" value={String(summary?.approvedAgentListings ?? 0)} hint="Live in marketplace" />
          <StatCard label="Active installs" value={String(summary?.activeInstalledAgents ?? 0)} hint="Running customer agents" />
          <StatCard label="Leads" value={String(summary?.totalLeads ?? 0)} hint="Captured by agents" />
          <StatCard label="Appointments" value={String(summary?.totalAppointments ?? 0)} hint="Booked by agents" />
        </div>
      )}

      <section className="mt-8" aria-labelledby="admin-quick-actions">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="admin-quick-actions" className="text-base font-semibold text-slate-900" data-testid="admin-dashboard-admin-actions-heading">Operations</h2>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> Accounts</span>
            <span className="inline-flex items-center gap-1"><UserRoundCog className="h-3.5 w-3.5" /> Marketplace</span>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {QUICK_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="group flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-amber-300 hover:shadow-md">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700"><Icon className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900">{item.label}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{item.detail}</span></span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
