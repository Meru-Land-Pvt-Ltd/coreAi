"use client";

import { RefreshCw, Search } from "lucide-react";

/**
 * Search + filter bar. Chrome copied from the admin businesses table so the
 * buyer CRM matches the rest of the product.
 *
 * Debouncing lives in the page (300ms) — this component stays controlled.
 */
export function CrmFilters({
  search,
  onSearchChange,
  stage,
  onStageChange,
  stageOptions,
  owner,
  onOwnerChange,
  ownerOptions,
  onRefresh,
  refreshing
}: {
  search: string;
  onSearchChange: (value: string) => void;
  stage: string;
  onStageChange: (value: string) => void;
  stageOptions: string[];
  owner: string;
  onOwnerChange: (value: string) => void;
  ownerOptions: string[];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search name, phone, or email"
          aria-label="Search customers"
          data-testid="business-crm-search"
          className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />
      </div>

      <select
        value={stage}
        onChange={(event) => onStageChange(event.target.value)}
        aria-label="Filter by stage"
        data-testid="business-crm-filter-stage"
        className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-700"
      >
        <option value="">All stages</option>
        {stageOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <select
        value={owner}
        onChange={(event) => onOwnerChange(event.target.value)}
        aria-label="Filter by owner"
        data-testid="business-crm-filter-owner"
        className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-700"
      >
        <option value="">All owners</option>
        {ownerOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={onRefresh}
        data-testid="business-crm-refresh"
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-gray-300"
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
        Refresh
      </button>
    </div>
  );
}
