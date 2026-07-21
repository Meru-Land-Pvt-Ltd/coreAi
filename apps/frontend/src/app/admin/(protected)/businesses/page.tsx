"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  X
} from "lucide-react";
import {
  getAdminBusinessAccounts,
  getAdminSummary,
  updateAdminUserSuspension,
  type AdminBusinessAccount
} from "@/components/admin/features/api";
import { AdminReferenceHeader } from "@/components/admin/ui/admin-reference-header";

const PAGE_SIZE = 10;

type AccountFilter = "all" | "Active" | "Inactive" | "Suspended";
type AccountSort = "name" | "email" | "type" | "status" | "agents" | "joined" | "revenue";
type SortDirection = "ascending" | "descending";

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

function formatCurrency(cents: number | null | undefined, currency: string | null | undefined) {
  if (typeof cents !== "number" || !Number.isFinite(cents) || !currency) return "N/A";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase()
    }).format(cents / 100);
  } catch {
    return "N/A";
  }
}

function formatStatus(value: string | null | undefined) {
  if (!value) return "N/A";
  if (value === "SUCCEEDED") return "Purchased";
  if (value === "TRIALING") return "Trial";

  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function accountStatus(account: AdminBusinessAccount) {
  return account.accountStatus || (account.isSuspended ? "Suspended" : "N/A");
}

function accountName(account: AdminBusinessAccount) {
  return account.fullName?.trim() || "N/A";
}

function initials(account: AdminBusinessAccount) {
  return accountName(account)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function statusStyle(status: string) {
  if (status === "Suspended") return "bg-red-50 text-red-700 ring-red-600/10";
  if (status === "Trial") return "bg-blue-50 text-blue-700 ring-blue-600/10";
  if (status === "Inactive") return "bg-gray-100 text-slate-600 ring-slate-600/10";
  if (status === "Active") return "bg-emerald-50 text-emerald-700 ring-emerald-600/10";
  return "bg-gray-100 text-slate-500 ring-slate-500/10";
}

function statusDot(status: string) {
  if (status === "Suspended") return "bg-red-500";
  if (status === "Trial") return "bg-blue-500";
  if (status === "Inactive") return "bg-slate-400";
  if (status === "Active") return "bg-emerald-500";
  return "bg-slate-300";
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

type PurchasedAgentsPopoverProps = {
  account: AdminBusinessAccount;
  anchor: HTMLButtonElement;
  onClose: () => void;
};

function PurchasedAgentsPopover({ account, anchor, onClose }: PurchasedAgentsPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    function place() {
      const rect = anchor.getBoundingClientRect();
      const edge = 16;
      const gap = 8;
      const width = Math.min(544, window.innerWidth - edge * 2);
      const left = Math.min(Math.max(edge, rect.left), Math.max(edge, window.innerWidth - width - edge));
      const roomBelow = window.innerHeight - rect.bottom - edge - gap;
      const roomAbove = rect.top - edge - gap;
      const openAbove = roomBelow < 220 && roomAbove > roomBelow;

      setPosition({
        left,
        ...(openAbove
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
        width,
        maxHeight: Math.max(144, Math.min(320, openAbove ? roomAbove : roomBelow))
      });
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    function dismiss(event: MouseEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !anchor.contains(target)) onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        anchor.focus();
      }
    }

    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchor, onClose]);

  if (!position) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="region"
      aria-label={`Purchased agents for ${account.email}`}
      className="fixed z-[110] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
      style={position}
    >
      <div className="hidden grid-cols-[minmax(0,1fr)_6rem_5.5rem_6rem] gap-3 border-b border-gray-100 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:grid">
        <span>Agent</span><span>Purchased</span><span>Amount</span><span>Status</span>
      </div>
      <div className="divide-y divide-gray-100 overflow-y-auto" style={{ maxHeight: position.maxHeight }}>
        {account.purchasedAgents.map((agent) => (
          <article key={agent.purchaseId} data-testid="admin-business-purchased-agent" className="grid grid-cols-3 items-start gap-3 px-3 py-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_6rem_5.5rem_6rem] sm:items-center">
            <div className="col-span-3 min-w-0 sm:col-span-1">
              <p className="truncate font-bold text-slate-900">{agent.listing.name || "N/A"}</p>
              <p className="mt-0.5 truncate text-slate-500">{agent.listing.shortDescription || "N/A"}</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-400">
                {agent.listing.category || "N/A"}
                {agent.listing.architect
                  ? ` · By ${agent.listing.architect.fullName || agent.listing.architect.email}`
                  : " · By N/A"}
              </p>
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 sm:hidden">Purchased</span>
              <p className="font-semibold text-slate-700">{formatDate(agent.purchasedAt)}</p>
              <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{formatStatus(agent.purchaseStatus)}</span>
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 sm:hidden">Amount</span>
              <p className="font-semibold text-slate-700">{formatCurrency(agent.amountCents, agent.currency)}</p>
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 sm:hidden">Status</span>
              <span className="mt-0.5 inline-flex w-fit rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700 sm:mt-0">{formatStatus(agent.installedAgentStatus)}</span>
            </div>
          </article>
        ))}
      </div>
    </div>,
    document.body
  );
}

type BusinessProfileModalProps = {
  account: AdminBusinessAccount;
  isUpdating: boolean;
  onClose: () => void;
  onToggleSuspension: () => Promise<boolean>;
};

function BusinessProfileModal({
  account,
  isUpdating,
  onClose,
  onToggleSuspension
}: BusinessProfileModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const status = accountStatus(account);
  const installedAgents = account.purchasedAgents.filter((agent) => agent.installedAgentId).length;
  const timeline = [
    ...account.purchasedAgents.map((agent) => ({
      id: agent.purchaseId,
      date: agent.purchasedAt,
      event: `${formatStatus(agent.purchaseStatus)} ${agent.listing.name}`
    })),
    { id: `registered-${account.id}`, date: account.createdAt, event: "Registered business account" }
  ]
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 5);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isUpdating) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isUpdating, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="business-profile-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isUpdating) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div>
            <h2 id="business-profile-title" className="text-lg font-extrabold tracking-tight text-slate-900">User Profile</h2>
            <p className="mt-0.5 text-sm text-slate-400">Registered business account</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            disabled={isUpdating}
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close business profile"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-slate-600 to-slate-900 text-lg font-extrabold text-white">
              {initials(account)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-extrabold tracking-tight text-slate-900">{accountName(account)}</h3>
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-600/10">Buyer</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${statusStyle(status)}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDot(status)}`} aria-hidden="true" />
                  {status}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-sm text-slate-500">{account.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Business", account.businessName || "N/A"],
              ["Phone", account.phone || "N/A"],
              ["Joined", formatDate(account.createdAt)],
              ["Last active", formatDate(account.lastActiveAt)]
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-slate-800" title={value}>{value}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-slate-900">Account overview</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Agents installed", installedAgents.toLocaleString()],
                ["Total spend", formatCurrency(account.totalSpendCents, account.currency)],
                ["Executions", typeof account.totalExecutions === "number" ? account.totalExecutions.toLocaleString() : "N/A"],
                ["Status", account.subscriptionStatus ? formatStatus(account.subscriptionStatus) : "N/A"]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-100 p-3">
                  <p className="text-lg font-extrabold text-slate-900 tabular-nums">{value}</p>
                  <p className="text-xs font-medium text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-slate-900">Recent activity</p>
            {timeline.length === 0 ? (
              <p className="rounded-xl bg-gray-50 p-4 text-sm font-semibold text-slate-400">N/A</p>
            ) : (
              <ol className="relative ml-1.5 space-y-3 border-l border-gray-200">
                {timeline.map((item) => (
                  <li key={item.id} className="ml-4">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-4 ring-amber-50" aria-hidden="true" />
                    <p className="text-sm font-medium text-slate-700">{item.event}</p>
                    <p className="text-xs text-slate-400 tabular-nums">{formatDate(item.date)}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 justify-end border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            disabled={isUpdating}
            onClick={async () => {
              const saved = await onToggleSuspension();
              if (saved) onClose();
            }}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-50 ${
              account.isSuspended
                ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                : "border-amber-200 text-amber-700 hover:bg-amber-50"
            }`}
          >
            {isUpdating ? "Updating…" : account.isSuspended ? "Unsuspend account" : "Suspend account"}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export default function AdminBusinessesPage() {
  const [rows, setRows] = useState<AdminBusinessAccount[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [sortKey, setSortKey] = useState<AccountSort | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<AdminBusinessAccount | null>(null);
  const [pendingAgentCount, setPendingAgentCount] = useState<number | null>(null);
  const [agentPopover, setAgentPopover] = useState<{
    account: AdminBusinessAccount;
    anchor: HTMLButtonElement;
  } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const loadSequence = useRef(0);

  async function load(searchValue: string) {
    const sequence = ++loadSequence.current;
    setState("loading");
    setMessage("");
    setAgentPopover(null);
    const result = await getAdminBusinessAccounts({ search: searchValue, limit: 100, all: true });

    if (sequence !== loadSequence.current) return false;

    if (result.success && result.data) {
      setRows(result.data.items);
      setTotal(result.data.total);
      setPage(1);
      setState("ready");
      return true;
    }

    setRows([]);
    setTotal(null);
    setState("error");
    return false;
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
    const filtered = rows.filter((account) => filter === "all" || accountStatus(account) === filter);
    if (!sortKey) return filtered;

    return [...filtered].sort((left, right) => {
      let difference = 0;
      if (sortKey === "name") difference = accountName(left).localeCompare(accountName(right));
      else if (sortKey === "email") difference = left.email.localeCompare(right.email);
      else if (sortKey === "type") difference = 0;
      else if (sortKey === "status") difference = accountStatus(left).localeCompare(accountStatus(right));
      else if (sortKey === "agents") difference = left.purchasedAgents.length - right.purchasedAgents.length;
      else if (sortKey === "joined") difference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      else difference = (left.totalSpendCents ?? -1) - (right.totalSpendCents ?? -1);
      return sortDirection === "ascending" ? difference : -difference;
    });
  }, [filter, rows, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const paginatedRows = filteredRows.slice(pageStart, pageStart + PAGE_SIZE);

  function changeSort(nextSort: AccountSort) {
    setPage(1);
    if (sortKey === nextSort) {
      setSortDirection((current) => (current === "ascending" ? "descending" : "ascending"));
      return;
    }
    setSortKey(nextSort);
    setSortDirection("ascending");
  }

  function exportAccounts() {
    const header = ["Name", "Email", "Type", "Status", "Agents", "Joined", "Revenue", "Business"];
    const data = filteredRows.map((account) => [
      accountName(account),
      account.email,
      "Buyer",
      accountStatus(account),
      account.purchasedAgents.length,
      formatDate(account.createdAt),
      formatCurrency(account.totalSpendCents, account.currency),
      account.businessName || "N/A"
    ]);
    const csv = [header, ...data].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "business-users.csv";
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${filteredRows.length} business account${filteredRows.length === 1 ? "" : "s"}.`);
  }

  async function changeSuspension(account: AdminBusinessAccount) {
    const nextSuspended = !account.isSuspended;
    setUpdatingId(account.id);
    setMessage(`${nextSuspended ? "Suspending" : "Restoring"} ${account.email}…`);
    const result = await updateAdminUserSuspension(account.id, nextSuspended);

    if (!result.success) {
      setMessage(result.error ?? "Could not update the business account.");
      setUpdatingId(null);
      return false;
    }

    await load(search.trim());
    setMessage(`${account.email} ${nextSuspended ? "suspended" : "restored"}.`);
    setUpdatingId(null);
    return true;
  }

  const buyerCount = total;

  return (
    <div className="w-full max-w-full">
      <AdminReferenceHeader
        active="users"
        title="User Management"
        pendingCount={pendingAgentCount}
      />

      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">User Management</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-slate-600 tabular-nums">
            {typeof total === "number" ? `${total.toLocaleString()} total` : "N/A total"}
          </span>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-600 tabular-nums">
            Buyers {typeof buyerCount === "number" ? buyerCount.toLocaleString() : "N/A"}
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div
            data-testid="admin-businesses-search-form"
            className="min-w-0"
          >
            <label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <span className="sr-only">Search business users</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                data-testid="admin-businesses-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, email, business…"
                className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              />
            </label>
          </div>
          <button
            type="button"
            data-testid="admin-businesses-export"
            onClick={exportAccounts}
            disabled={filteredRows.length === 0}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:border-gray-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
        </div>
      </header>

      <div className="mt-4 inline-flex max-w-full flex-wrap rounded-xl bg-gray-100 p-1" role="group" aria-label="Filter by status">
        {(["all", "Active", "Inactive", "Suspended"] as const).map((value) => {
          const selected = filter === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                selected ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {value === "all" ? "All" : value}
            </button>
          );
        })}
      </div>

      {message ? (
        <p data-testid="admin-businesses-action-message" role="status" className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">{message}</p>
      ) : null}

      {state === "loading" ? (
        <div data-testid="admin-businesses-loading" className="mt-4 h-80 animate-pulse rounded-2xl border border-gray-100 bg-white" />
      ) : state === "error" ? (
        <p data-testid="admin-businesses-error" className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-5 text-sm font-semibold text-red-700">Could not load registered business accounts.</p>
      ) : rows.length === 0 ? (
        <div data-testid="admin-businesses-empty" className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <p className="font-bold text-slate-900">No users found</p>
          <p className="mt-1 text-sm text-slate-400">Try a different search term.</p>
        </div>
      ) : (
        <section className="mt-4 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]" aria-label="Business user management">
          <div className="overflow-x-auto">
            <table data-testid="admin-businesses-table" className="w-full min-w-[1080px] text-left text-sm">
              <thead>
                <tr className="select-none border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {[
                    ["User", "name"],
                    ["Email", "email"],
                    ["Type", "type"],
                    ["Status", "status"],
                    ["Agents", "agents"],
                    ["Joined", "joined"],
                    ["Revenue", "revenue"]
                  ].map(([label, key]) => (
                    <th key={key} className="px-5 py-3.5" aria-sort={sortKey === key ? sortDirection : "none"}>
                      <button type="button" onClick={() => changeSort(key as AccountSort)} className="inline-flex items-center gap-1 hover:text-slate-700">
                        {label}<ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </th>
                  ))}
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginatedRows.length === 0 ? (
                  <tr><td colSpan={8} className="px-5 py-12 text-center font-semibold text-slate-400">No users match this filter.</td></tr>
                ) : paginatedRows.map((account) => {
                  const status = accountStatus(account);
                  const isUpdating = updatingId === account.id;

                  return (
                    <tr key={account.email.toLowerCase()} className="transition hover:bg-gray-50/70">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-[11px] font-bold text-white">{initials(account)}</span>
                          <span className="max-w-48 truncate font-semibold text-slate-900">{accountName(account)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5"><span className="font-mono text-xs text-slate-500" data-testid="admin-business-registered-email">{account.email}</span></td>
                      <td className="px-5 py-3.5"><span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-600/10">Buyer</span></td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${statusStyle(status)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDot(status)}`} aria-hidden="true" />{status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {account.purchasedAgents.length === 0 ? (
                          <span className="font-semibold text-slate-400">0</span>
                        ) : (
                          <button
                            type="button"
                            data-testid={`admin-business-agents-${account.id}`}
                            aria-expanded={agentPopover?.account.id === account.id}
                            onClick={(event) => {
                              const anchor = event.currentTarget;
                              setAgentPopover((current) =>
                                current?.account.id === account.id
                                  ? null
                                  : { account, anchor }
                              );
                            }}
                            className="inline-flex min-w-16 items-center gap-1 rounded-lg px-2 py-1 font-semibold text-slate-700 transition hover:bg-amber-50 hover:text-amber-700"
                          >
                            {account.purchasedAgents.length} {account.purchasedAgents.length === 1 ? "agent" : "agents"}
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition-transform ${agentPopover?.account.id === account.id ? "rotate-180" : ""}`}
                              aria-hidden="true"
                            />
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-slate-500 tabular-nums">{formatDate(account.createdAt)}</td>
                      <td className="px-5 py-3.5"><span className="font-semibold text-slate-700 tabular-nums">{formatCurrency(account.totalSpendCents, account.currency)}</span>{account.totalSpendCents ? <span className="ml-1 text-xs text-slate-400">spent</span> : null}</td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button type="button" onClick={() => setSelectedAccount(account)} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-gray-100">View</button>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void changeSuspension(account)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-50 ${account.isSuspended ? "text-emerald-700 hover:bg-emerald-50" : "text-red-600 hover:bg-red-50"}`}
                          >
                            {isUpdating ? "Updating…" : account.isSuspended ? "Unsuspend" : "Suspend"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

      {selectedAccount ? (
        <BusinessProfileModal
          account={selectedAccount}
          isUpdating={updatingId === selectedAccount.id}
          onClose={() => setSelectedAccount(null)}
          onToggleSuspension={() => changeSuspension(selectedAccount)}
        />
      ) : null}

      {agentPopover ? (
        <PurchasedAgentsPopover
          account={agentPopover.account}
          anchor={agentPopover.anchor}
          onClose={() => setAgentPopover(null)}
        />
      ) : null}
    </div>
  );
}
