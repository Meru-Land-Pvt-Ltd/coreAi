"use client";

import { useEffect, useMemo, useState } from "react";
import { getAdminTemplateRequests, type AdminTemplateRequest } from "@/components/admin/features/api";

const PREVIEW_LENGTH = 320;

function DescriptionBlock({ text, requestId }: { text: string; requestId: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > PREVIEW_LENGTH;
  const visible = expanded || !isLong ? text : `${text.slice(0, PREVIEW_LENGTH).trimEnd()}…`;

  return (
    <div className="mt-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</div>
      <p
        data-testid={`admin-template-requests-description-${requestId}`}
        className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600 [overflow-wrap:anywhere]"
      >
        {visible}
      </p>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          data-testid={`admin-template-requests-toggle-${requestId}`}
          className="mt-2 text-xs font-semibold text-orange-600 transition hover:text-orange-700"
        >
          {expanded ? "Show less" : "Show full description"}
        </button>
      ) : null}
    </div>
  );
}

function RequestCard({ row }: { row: AdminTemplateRequest }) {
  return (
    <article
      data-testid={`admin-template-requests-item-${row.id}`}
      className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
          {row.industry}
        </span>
        <time
          className="text-xs font-medium text-slate-400"
          data-testid={`admin-template-requests-submitted-${row.id}`}
          dateTime={row.createdAt}
        >
          {new Date(row.createdAt).toLocaleString()}
        </time>
      </div>

      <DescriptionBlock text={row.description} requestId={row.id} />

      <div className="mt-4 border-t border-orange-50 pt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Architect</div>
        <div className="mt-1 text-sm font-medium text-slate-800">{row.architect?.fullName ?? "—"}</div>
        <div className="break-all text-xs text-slate-500">{row.architect?.email ?? "—"}</div>
      </div>
    </article>
  );
}

export default function AdminTemplateRequestsPage() {
  const [rows, setRows] = useState<AdminTemplateRequest[]>([]);
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  async function load(searchValue: string, industryValue: string) {
    setState("loading");
    const result = await getAdminTemplateRequests({
      search: searchValue,
      industry: industryValue,
      limit: 100
    });

    if (result.success && result.data) {
      setRows(result.data.items);
      setState("ready");
      setMessage("");
    } else {
      setState("error");
      setMessage(result.error ?? "Could not load template requests.");
    }
  }

  useEffect(() => {
    void load("", "");
  }, []);

  const industries = useMemo(
    () => Array.from(new Set(rows.map((row) => row.industry))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  return (
    <div className="min-w-0">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Template requests</h1>
          <p className="mt-1 text-sm text-slate-500">Review template requests submitted by architects.</p>
        </div>
        {state === "ready" ? (
          <p className="text-sm font-medium text-slate-400" data-testid="admin-template-requests-count">
            {rows.length} {rows.length === 1 ? "request" : "requests"}
          </p>
        ) : null}
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(search.trim(), industry.trim());
        }}
        className="mb-6 flex flex-wrap gap-2"
      >
        <input
          data-testid="admin-template-requests-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by industry, description, or architect"
          className="min-w-[220px] flex-1 rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400 sm:max-w-md"
        />
        <select
          data-testid="admin-template-requests-industry"
          value={industry}
          onChange={(event) => setIndustry(event.target.value)}
          className="rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400"
        >
          <option value="">All industries</option>
          {industries.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">
          Search
        </button>
      </form>

      {message ? (
        <p data-testid="admin-template-requests-message" className="mb-3 text-sm font-semibold text-orange-700">
          {message}
        </p>
      ) : null}

      {state === "loading" ? (
        <div className="space-y-4" data-testid="admin-template-requests-loading">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-2xl border border-orange-100 bg-white" />
          ))}
        </div>
      ) : state === "error" ? (
        <p data-testid="admin-template-requests-error" className="text-sm font-semibold text-red-600">
          Could not load template requests.
        </p>
      ) : rows.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-orange-200 bg-white px-6 py-16 text-center"
          data-testid="admin-template-requests-empty"
        >
          <p className="text-sm font-semibold text-slate-700">No template requests found</p>
          <p className="mt-1 text-sm text-slate-500">Try a different search or industry filter.</p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="admin-template-requests-list">
          {rows.map((row) => (
            <RequestCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
