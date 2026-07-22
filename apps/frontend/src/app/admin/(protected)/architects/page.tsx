"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search
} from "lucide-react";
import {
  getAdminArchitects,
  getAdminSummary,
  type AdminArchitect,
  type ArchitectApprovalStatus
} from "@/components/admin/features/api";
import { AdminReferenceHeader } from "@/components/admin/ui/admin-reference-header";

const PAGE_SIZE = 10;

type ArchitectSort = "name" | "email" | "listings" | "joined";
type SortDirection = "ascending" | "descending";



function display(value: string | null | undefined) {
  return value?.trim() || "N/A";
}

function architectName(architect: AdminArchitect) {
  return display(architect.fullName);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "N/A";
}

function formatRating(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "N/A";
}

function architectStatus(architect: AdminArchitect): ArchitectApprovalStatus | null {
  if (architect.isSuspended) return "SUSPENDED";
  return architect.architectProfile?.approvalStatus ?? null;
}

function formatStatus(status: ArchitectApprovalStatus | null) {
  if (!status) return "N/A";
  return status[0] + status.slice(1).toLowerCase();
}


function initials(architect: AdminArchitect) {
  const source = architect.fullName?.trim() || architect.email.trim();
  const value = source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return value || "NA";
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function paginationItems(pageCount: number, currentPage: number): Array<number | string> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const pages = [...new Set([
    1,
    2,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    pageCount - 1,
    pageCount
  ])]
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= pageCount)
    .sort((left, right) => left - right);

  return pages.flatMap((pageNumber, index) => {
    const previous = pages[index - 1];
    return previous && pageNumber - previous > 1
      ? [`ellipsis-${previous}-${pageNumber}`, pageNumber]
      : [pageNumber];
  });
}

export default function AdminArchitectsPage() {
  const [rows, setRows] = useState<AdminArchitect[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<ArchitectSort | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [pendingAgentCount, setPendingAgentCount] = useState<number | null>(null);
  const loadSequence = useRef(0);

  async function load(searchValue: string) {
    const sequence = ++loadSequence.current;
    setState("loading");
    setMessage("");

    const result = await getAdminArchitects({ search: searchValue, limit: 100 });
    if (sequence !== loadSequence.current) return false;

    if (!result.success || !result.data) {
      setRows([]);
      setTotal(null);
      setState("error");
      return false;
    }

    const responseLimit = Math.max(1, result.data.limit || 100);
    const pageCount = Math.ceil(result.data.total / responseLimit);
    const remainingPages = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        getAdminArchitects({
          search: searchValue,
          page: index + 2,
          limit: 100
        })
      )
    );

    if (sequence !== loadSequence.current) return false;
    if (remainingPages.some((pageResult) => !pageResult.success || !pageResult.data)) {
      setRows([]);
      setTotal(null);
      setState("error");
      return false;
    }

    setRows([
      ...result.data.items,
      ...remainingPages.flatMap((pageResult) => pageResult.data?.items ?? [])
    ]);
    setTotal(result.data.total);
    setPage(1);
    setState("ready");
    return true;
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(search.trim());
    }, search ? 300 : 0);

    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void getAdminSummary().then((result) => {
      if (result.success && result.data) setPendingAgentCount(result.data.pendingAgentListings);
    });
  }, []);

  const filteredRows = useMemo(() => {
    if (!sortKey) return rows;

    return [...rows].sort((left, right) => {
      let difference = 0;
      if (sortKey === "name") difference = architectName(left).localeCompare(architectName(right));
      else if (sortKey === "email") difference = left.email.localeCompare(right.email);
      else if (sortKey === "listings") difference = (left.listingCount ?? -1) - (right.listingCount ?? -1);
      else {
        const leftDate = new Date(left.createdAt).getTime();
        const rightDate = new Date(right.createdAt).getTime();
        difference = (Number.isFinite(leftDate) ? leftDate : -Infinity) - (Number.isFinite(rightDate) ? rightDate : -Infinity);
      }
      return sortDirection === "ascending" ? difference : -difference;
    });
  }, [rows, sortDirection, sortKey]);

  const approvedCount = rows.filter((architect) => architectStatus(architect) === "APPROVED").length;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const paginatedRows = filteredRows.slice(pageStart, pageStart + PAGE_SIZE);

  function changeSort(nextSort: ArchitectSort) {
    setPage(1);
    if (sortKey === nextSort) {
      setSortDirection((current) => (current === "ascending" ? "descending" : "ascending"));
      return;
    }
    setSortKey(nextSort);
    setSortDirection("ascending");
  }

  function exportArchitects() {
    const header = ["Name", "Email", "Type", "Status", "Listings", "Workflows", "Joined", "Title", "Rating", "Completed jobs"];
    const data = filteredRows.map((architect) => [
      architectName(architect),
      display(architect.email),
      "Architect",
      formatStatus(architectStatus(architect)),
      formatCount(architect.listingCount),
      formatCount(architect.workflowCount),
      formatDate(architect.createdAt),
      display(architect.architectProfile?.title),
      formatRating(architect.architectProfile?.rating),
      formatCount(architect.architectProfile?.completedJobs)
    ]);
    const csv = [header, ...data].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "architect-users.csv";
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${filteredRows.length} architect account${filteredRows.length === 1 ? "" : "s"}.`);
  }


  return (
    <div className="w-full max-w-full">
      <AdminReferenceHeader
        active="users"
        title="Architect Management"
        pendingCount={pendingAgentCount}
      />

      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Architect Management</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-slate-600 tabular-nums">
            {typeof total === "number" ? `${total.toLocaleString()} total` : "N/A total"}
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 tabular-nums">
            Approved {state === "ready" ? approvedCount.toLocaleString("en-US") : "N/A"}
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
            <span className="sr-only">Search architects</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              data-testid="admin-architects-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or email…"
              className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </label>
          <button
            type="button"
            data-testid="admin-architects-export"
            onClick={exportArchitects}
            disabled={filteredRows.length === 0}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:border-gray-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
        </div>
      </header>


      {message ? (
        <p data-testid="admin-architects-action-message" role="status" className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">{message}</p>
      ) : null}

      {state === "loading" ? (
        <div data-testid="admin-architects-loading" className="mt-4 h-80 animate-pulse rounded-2xl border border-gray-100 bg-white" />
      ) : state === "error" ? (
        <p data-testid="admin-architects-error" className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-5 text-sm font-semibold text-red-700">Could not load architects.</p>
      ) : rows.length === 0 ? (
        <div data-testid="admin-architects-empty" className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <p className="font-bold text-slate-900">No architects found</p>
          <p className="mt-1 text-sm text-slate-400">Try a different search term.</p>
        </div>
      ) : (
        <section className="mt-4 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]" aria-label="Architect management">
          <div className="overflow-x-auto">
            <table data-testid="admin-architects-table" className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="select-none border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {[
                    ["Architect", "name"],
                    ["Email", "email"]
                  ].map(([label, key]) => (
                    <th key={key} className="px-5 py-3.5" aria-sort={sortKey === key ? sortDirection : "none"}>
                      <button type="button" onClick={() => changeSort(key as ArchitectSort)} className="inline-flex items-center gap-1 hover:text-slate-700">
                        {label}<ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </th>
                  ))}
                  <th className="px-5 py-3.5">Type</th>
                  {[
                    ["Listings", "listings"],
                    ["Joined", "joined"]
                  ].map(([label, key]) => (
                    <th key={key} className="px-5 py-3.5" aria-sort={sortKey === key ? sortDirection : "none"}>
                      <button type="button" onClick={() => changeSort(key as ArchitectSort)} className="inline-flex items-center gap-1 hover:text-slate-700">
                        {label}<ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginatedRows.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-12 text-center font-semibold text-slate-400">No architects found.</td></tr>
                ) : paginatedRows.map((architect) => (
                    <tr key={architect.id} className="transition hover:bg-gray-50/70">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-700 text-[11px] font-bold text-white">{initials(architect)}</span>
                          <div className="min-w-0">
                            <p className="max-w-48 truncate font-semibold text-slate-900">{architectName(architect)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5"><span className="font-mono text-xs text-slate-500">{display(architect.email)}</span></td>
                      <td className="px-5 py-3.5"><span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-600/10">Architect</span></td>
                      <td className="px-5 py-3.5 font-semibold text-slate-700 tabular-nums">{formatCount(architect.listingCount)}</td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-slate-500 tabular-nums">{formatDate(architect.createdAt)}</td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 sm:flex-row">
            <p className="text-sm text-slate-500 tabular-nums">Showing {filteredRows.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredRows.length)} of {filteredRows.length.toLocaleString()}</p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Prev</button>
              <div className="hidden items-center gap-1 sm:flex">
                {paginationItems(pageCount, currentPage).map((item) =>
                  typeof item === "number" ? (
                    <button key={item} type="button" onClick={() => setPage(item)} className={`h-8 w-8 rounded-lg text-sm font-semibold ${currentPage === item ? "bg-amber-500 text-white shadow-sm" : "text-slate-600 hover:bg-gray-100"}`}>{item}</button>
                  ) : (
                    <span key={item} className="px-1 text-sm text-slate-300" aria-hidden="true">…</span>
                  )
                )}
              </div>
              <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">Next<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </div>
        </section>
      )}

    </div>
  );
}