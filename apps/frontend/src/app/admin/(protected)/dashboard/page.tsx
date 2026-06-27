"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/common/stat-card";
import { getAdminSummary, type AdminSummary } from "@/components/admin/features/api";

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
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Manage users, approvals, AI Architects, Businesses, and marketplace quality.</p>
      </header>

      {state === "loading" ? (
        <p data-testid="admin-dashboard-loading" className="text-sm font-semibold text-orange-700">Loading summary…</p>
      ) : state === "error" ? (
        <p data-testid="admin-dashboard-error" className="text-sm font-semibold text-red-600">Could not load summary.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Businesses" value={String(summary?.totalBusinesses ?? 0)} hint="Registered companies" />
          <StatCard label="AI Architects" value={String(summary?.totalArchitects ?? 0)} hint="Builder profiles" />
          <StatCard label="Agent listings" value={String(summary?.totalAgentListings ?? 0)} hint="All listings" />
          <StatCard label="Pending Reviews" value={String(summary?.pendingAgentListings ?? 0)} hint="Need admin action" />
          <StatCard label="Approved" value={String(summary?.approvedAgentListings ?? 0)} hint="Live in marketplace" />
          <StatCard label="Active installs" value={String(summary?.activeInstalledAgents ?? 0)} hint="InstalledAgent ACTIVE" />
          <StatCard label="Leads" value={String(summary?.totalLeads ?? 0)} hint="Captured leads" />
          <StatCard label="Appointments" value={String(summary?.totalAppointments ?? 0)} hint="Booked" />
        </div>
      )}

      <section className="mt-6 rounded-3xl soft-card p-6">
        <h2 className="text-xl font-bold" data-testid="admin-dashboard-admin-actions-heading">Admin Actions</h2>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {["Approve AI Architects", "Review Agent Listings", "Monitor Workflow Runs"].map((item) => (
            <div key={item} className="rounded-2xl bg-orange-50 p-4 text-sm font-semibold">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
