"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";

type AdminReferenceHeaderProps = {
  active: "overview" | "moderation" | "users" | "architects";
  title: string;
  pendingCount?: number | null;
};

/* ONE PLACE, ONE NAME. These tabs used to call /admin/businesses "User
   Management" while the sidebar beside them called it "Businesses" — the same
   screen under two names, on screen at the same time. And the Architects page
   lit up the "User Management" tab, a tab that does not lead there. The names
   now match the sidebar, and every page a tab can highlight has its own tab. */
const TABS: Array<{
  id: AdminReferenceHeaderProps["active"];
  label: string;
  href: Route;
}> = [
  { id: "overview", label: "Dashboard", href: "/admin/dashboard" },
  { id: "moderation", label: "Agent listings", href: "/admin/agents" },
  { id: "users", label: "Businesses", href: "/admin/businesses" },
  { id: "architects", label: "Architects", href: "/admin/architects" }
];

export function AdminReferenceHeader({ active, title, pendingCount }: AdminReferenceHeaderProps) {
  const [dateLabel, setDateLabel] = useState<string | null>(null);

  useEffect(() => {
    setDateLabel(
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric"
      }).format(new Date())
    );
  }, []);

  return (
    <header className="sticky top-16 z-20 -mx-4 -mt-6 mb-6 border-b border-gray-100 bg-white/90 backdrop-blur-md sm:-mx-6 lg:top-0 lg:-mx-8 lg:-mt-8">
      <div className="flex min-h-16 items-center px-4 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <h1 className="truncate text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">{title}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {dateLabel ? `${dateLabel} · Live data` : "Live data"}
          </p>
        </div>
      </div>

      <nav className="overflow-x-auto px-2 sm:px-4 lg:px-6" aria-label="Admin sections">
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const selected = tab.id === active;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={selected ? "page" : undefined}
                className={`border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
                  selected
                    ? "border-amber-500 text-amber-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {tab.label}
                {tab.id === "moderation" ? (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 tabular-nums">
                    {typeof pendingCount === "number" ? pendingCount.toLocaleString("en-US") : "N/A"}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
