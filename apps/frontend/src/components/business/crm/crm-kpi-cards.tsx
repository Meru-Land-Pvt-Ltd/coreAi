"use client";

import type { ReactNode } from "react";
import type { CrmDashboard } from "./api";

/**
 * KPI row. Card chrome copied from the buyer dashboard MetricCard
 * (rounded-2xl / border-gray-100) so CRM does not look like a different app.
 */
export function CrmKpiCards({
  dashboard,
  loading
}: {
  dashboard: CrmDashboard | null;
  loading: boolean;
}) {
  if (loading || !dashboard) {
    return (
      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-[120px] animate-pulse rounded-2xl border border-gray-100 bg-white"
            data-testid="business-crm-kpi-loading"
          />
        ))}
      </section>
    );
  }

  const cards: { label: string; value: string; subtitle: string; icon: ReactNode; testId: string }[] =
    [
      {
        label: "Total Customers",
        value: dashboard.totalCustomers.toLocaleString(),
        subtitle: "in your CRM",
        icon: <UsersIcon />,
        testId: "business-crm-kpi-total-customers"
      },
      {
        label: "Active Customers",
        value: dashboard.activeCustomers.toLocaleString(),
        subtitle: "active in last 90 days",
        icon: <ActivityIcon />,
        testId: "business-crm-kpi-active-customers"
      },
      {
        label: "Appointments",
        value: dashboard.appointments.toLocaleString(),
        subtitle: "booked this month",
        icon: <CalendarIcon />,
        testId: "business-crm-kpi-appointments"
      },
      {
        label: "Open Deals",
        value: dashboard.openDeals.toLocaleString(),
        subtitle: "tracked in CRM",
        icon: <DollarIcon />,
        testId: "business-crm-kpi-open-deals"
      },
      {
        label: "AI Interactions",
        value: dashboard.aiInteractions.toLocaleString(),
        subtitle: "calls & texts this month",
        icon: <BotIcon />,
        testId: "business-crm-kpi-ai-interactions"
      }
    ];

  return (
    <section
      aria-label="CRM metrics"
      className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-5"
    >
      {cards.map((card) => (
        <article
          key={card.label}
          data-testid={card.testId}
          className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow duration-300 hover:shadow-md sm:p-6"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            {card.icon}
          </span>
          <p className="mt-5 text-sm font-medium text-slate-500">{card.label}</p>
          <p className="mt-1 text-3xl font-black tracking-tight text-slate-900 tabular-nums">
            {card.value}
          </p>
          <p className="mt-1 text-sm text-slate-400">{card.subtitle}</p>
        </article>
      ))}
    </section>
  );
}

const iconProps = {
  className: "h-5 w-5",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.75",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true
};

function UsersIcon() {
  return (
    <svg {...iconProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg {...iconProps}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...iconProps}>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg {...iconProps}>
      <line x1="12" x2="12" y1="2" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function BotIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2.5" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}
