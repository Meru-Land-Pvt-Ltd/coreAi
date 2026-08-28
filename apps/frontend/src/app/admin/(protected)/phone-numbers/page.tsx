"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assignPhoneNumber,
  configurePhoneNumberWebhooks,
  enableOutboundCalling,
  getAdminBusinesses,
  getAdminPhoneNumbers,
  getPhoneAssignOptions,
  purchasePhoneNumber,
  releasePhoneNumber,
  searchAvailablePhoneNumbers,
  syncTwilioPhoneNumbers,
  unassignPhoneNumber,
  type AdminBusiness,
  type AdminPhoneNumber,
  type AvailablePhoneNumber,
  type PhoneSyncResult
} from "@/components/admin/features/api";

const COUNTRIES = [
  { code: "US", label: "United States" },
  { code: "CA", label: "Canada" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "IN", label: "India" }
];

const STATUS_STYLES: Record<AdminPhoneNumber["status"], string> = {
  AVAILABLE: "bg-green-50 text-green-700 border-green-200",
  ASSIGNED: "bg-blue-50 text-blue-700 border-blue-200",
  DISABLED: "bg-slate-100 text-slate-600 border-slate-200",
  ARCHIVED: "bg-slate-100 text-slate-500 border-slate-200",
  RELEASED: "bg-red-50 text-red-500 border-red-100",
  ERROR: "bg-red-50 text-red-700 border-red-200"
};

const WEBHOOK_STYLES: Record<string, string> = {
  CONFIGURED: "text-green-700",
  MISSING: "text-red-600",
  FAILED: "text-red-600",
  UNKNOWN: "text-slate-400"
};

function maskSid(sid: string | null): string {
  if (!sid) return "—";
  return sid.length > 12 ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : sid;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function capabilityLabel(row: AdminPhoneNumber): string {
  const parts = [row.voiceEnabled ? "Voice" : null, row.smsEnabled ? "SMS" : null, row.mmsEnabled ? "MMS" : null];
  return parts.filter(Boolean).join(" · ") || "—";
}

type Toast = { id: number; type: "success" | "error"; message: string };

export default function AdminPhoneNumbersPage() {
  const [rows, setRows] = useState<AdminPhoneNumber[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  /** ARCHIVED numbers are hidden from the inventory unless explicitly shown. */
  const [showArchived, setShowArchived] = useState(false);
  /** Key of the action currently running — disables its buttons. */
  const [busy, setBusy] = useState<string | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, type, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);

  /* ------------------------------- inventory ------------------------------ */

  const load = useCallback(async () => {
    const result = await getAdminPhoneNumbers();
    if (result.success && result.data) {
      setRows(result.data.numbers);
      setState("ready");
    } else {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const total = rows.length;
    const available = rows.filter((r) => r.status === "AVAILABLE").length;
    const assigned = rows.filter((r) => r.status === "ASSIGNED").length;
    const inactive = rows.filter((r) => ["DISABLED", "ARCHIVED", "RELEASED", "ERROR"].includes(r.status)).length;
    const webhookIssues = rows.filter(
      (r) => ["MISSING", "FAILED"].includes(r.webhookStatus) && !["RELEASED", "ARCHIVED"].includes(r.status)
    ).length;
    const complianceUnknown = rows.filter(
      (r) => (r.complianceStatus === "UNKNOWN" || r.a2pStatus === "UNKNOWN") && !["RELEASED", "ARCHIVED"].includes(r.status)
    ).length;
    return { total, available, assigned, inactive, webhookIssues, complianceUnknown };
  }, [rows]);

  /* --------------------------- search + purchase -------------------------- */

  const [searchForm, setSearchForm] = useState({
    country: "US",
    areaCode: "",
    contains: "",
    voice: true,
    sms: true,
    mms: false,
    limit: 10
  });
  const [searchResults, setSearchResults] = useState<AvailablePhoneNumber[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [purchaseTarget, setPurchaseTarget] = useState<AvailablePhoneNumber | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  async function runSearch() {
    setSearching(true);
    setSearchResults(null);
    const result = await searchAvailablePhoneNumbers({
      country: searchForm.country,
      areaCode: searchForm.areaCode.trim() || undefined,
      contains: searchForm.contains.trim() || undefined,
      voiceEnabled: searchForm.voice,
      smsEnabled: searchForm.sms,
      mmsEnabled: searchForm.mms,
      limit: searchForm.limit
    });
    setSearching(false);
    if (result.success && result.data) {
      setSearchResults(result.data.numbers);
    } else {
      pushToast("error", result.error ?? "Could not search available numbers.");
    }
  }

  async function confirmPurchase() {
    if (!purchaseTarget || purchasing) return;
    setPurchasing(true);
    const result = await purchasePhoneNumber({
      phoneNumber: purchaseTarget.phoneNumber,
      country: purchaseTarget.country
    });
    setPurchasing(false);
    if (result.success) {
      pushToast("success", `${purchaseTarget.phoneNumber} purchased and webhooks configured.`);
      setSearchResults((current) => current?.filter((n) => n.phoneNumber !== purchaseTarget.phoneNumber) ?? null);
      setPurchaseTarget(null);
      await load();
    } else {
      pushToast("error", result.error ?? "Twilio could not complete the purchase.");
    }
  }

  /* -------------------------------- assign -------------------------------- */

  const [assignTarget, setAssignTarget] = useState<AdminPhoneNumber | null>(null);
  const [businesses, setBusinesses] = useState<AdminBusiness[]>([]);
  const [assignBusinessId, setAssignBusinessId] = useState("");
  const [agents, setAgents] = useState<{ id: string; name: string; status: string }[]>([]);
  const [assignAgentId, setAssignAgentId] = useState("");
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  /* THE HUNDRED-AND-FIRST BUSINESS COULD NOT BE GIVEN A NUMBER.
     This asked for one page of a hundred and dropped the rest with no sign
     that there were any — so past a hundred businesses, an admin opening this
     box simply could not find the one they wanted, and nothing on the screen
     said why. The list is searched on the server now, the way the rest of the
     admin screens search, and it says when there are more than it is
     showing. */
  const [businessSearch, setBusinessSearch] = useState("");
  const [businessTotal, setBusinessTotal] = useState(0);
  const [loadingBusinesses, setLoadingBusinesses] = useState(false);

  const loadBusinesses = useCallback(async (search: string) => {
    setLoadingBusinesses(true);
    const result = await getAdminBusinesses({ limit: 100, ...(search ? { search } : {}) });
    setLoadingBusinesses(false);
    if (result.success && result.data) {
      setBusinesses(result.data.items);
      setBusinessTotal(result.data.total);
      return;
    }
    pushToast("error", "Could not load businesses for assignment.");
  }, []);

  async function openAssign(row: AdminPhoneNumber) {
    setAssignTarget(row);
    setAssignBusinessId("");
    setAssignAgentId("");
    setAgents([]);
    setBusinessSearch("");
    await loadBusinesses("");
  }

  async function onAssignBusinessChange(businessId: string) {
    setAssignBusinessId(businessId);
    setAssignAgentId("");
    setAgents([]);
    if (!businessId) return;
    const result = await getPhoneAssignOptions(businessId);
    if (result.success && result.data) setAgents(result.data.agents);
  }

  const assignBuyer = useMemo(
    () => businesses.find((b) => b.id === assignBusinessId)?.owner ?? null,
    [businesses, assignBusinessId]
  );

  async function confirmAssign() {
    if (!assignTarget || !assignBusinessId || assignSubmitting) return;
    setAssignSubmitting(true);
    const result = await assignPhoneNumber(assignTarget.id, {
      businessId: assignBusinessId,
      installedAgentId: assignAgentId || undefined,
      buyerUserId: assignBuyer?.id ?? undefined
    });
    setAssignSubmitting(false);
    if (result.success) {
      pushToast("success", `${assignTarget.phoneNumber} assigned.`);
      setAssignTarget(null);
      await load();
    } else {
      pushToast("error", result.error ?? "Could not assign this number.");
    }
  }

  /* ------------------------ unassign / webhooks / release ------------------ */

  const [unassignTarget, setUnassignTarget] = useState<AdminPhoneNumber | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<AdminPhoneNumber | null>(null);

  async function runRowAction(
    key: string,
    action: () => Promise<{ success: boolean; error?: string }>,
    successMessage: string,
    failureMessage: string
  ) {
    if (busy) return;
    setBusy(key);
    const result = await action();
    setBusy(null);
    if (result.success) {
      pushToast("success", successMessage);
      await load();
      return true;
    }
    pushToast("error", result.error ?? failureMessage);
    return false;
  }

  /* ---------------------------------- sync -------------------------------- */

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncDryRun, setSyncDryRun] = useState<PhoneSyncResult | null>(null);
  const [syncRunning, setSyncRunning] = useState(false);

  async function openSync() {
    setSyncOpen(true);
    setSyncDryRun(null);
    setSyncRunning(true);
    const result = await syncTwilioPhoneNumbers(true);
    setSyncRunning(false);
    if (result.success && result.data) {
      setSyncDryRun(result.data);
    } else {
      pushToast("error", result.error ?? "Could not read numbers from Twilio.");
      setSyncOpen(false);
    }
  }

  async function confirmSync() {
    if (syncRunning) return;
    setSyncRunning(true);
    const result = await syncTwilioPhoneNumbers(false);
    setSyncRunning(false);
    if (result.success && result.data) {
      pushToast(
        "success",
        `Sync complete: ${result.data.created.length} imported, ${result.data.updated.length} refreshed.`
      );
      setSyncOpen(false);
      await load();
    } else {
      pushToast("error", result.error ?? "Sync failed.");
    }
  }

  /* --------------------------------- render ------------------------------- */

  const canRelease = (row: AdminPhoneNumber) =>
    row.status === "AVAILABLE" && !row.business && !row.installedAgent && Boolean(row.twilioSid);

  const visibleRows = useMemo(
    () => (showArchived ? rows : rows.filter((row) => row.status !== "ARCHIVED")),
    [rows, showArchived]
  );
  const archivedCount = rows.length - rows.filter((row) => row.status !== "ARCHIVED").length;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-normal text-slate-900">Phone Numbers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Search, purchase, assign, and manage platform Twilio numbers — no Twilio dashboard needed.
          </p>
        </div>
        <button
          type="button"
          data-testid="admin-phone-sync-open"
          onClick={() => void openSync()}
          disabled={syncOpen}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50"
        >
          Sync from Twilio
        </button>
      </header>

      {/* Overview cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" data-testid="admin-phone-stats">
        {[
          { label: "Total numbers", value: stats.total, testId: "total" },
          { label: "Available", value: stats.available, testId: "available" },
          { label: "Assigned", value: stats.assigned, testId: "assigned" },
          { label: "Disabled / archived", value: stats.inactive, testId: "inactive" },
          { label: "Webhook issues", value: stats.webhookIssues, testId: "webhook-issues" },
          { label: "Compliance unknown", value: stats.complianceUnknown, testId: "compliance-unknown" }
        ].map((card) => (
          <div key={card.testId} className="rounded-lg border border-gray-200 bg-white px-4 py-3" data-testid={`admin-phone-stat-${card.testId}`}>
            <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">{card.label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Inventory table */}
      {archivedCount > 0 ? (
        <label className="mb-3 flex w-fit items-center gap-2 text-sm font-semibold text-slate-600">
          <input
            type="checkbox"
            data-testid="admin-phone-show-archived"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 accent-amber-500"
          />
          Show archived ({archivedCount})
        </label>
      ) : null}
      {state === "loading" ? (
        <p data-testid="admin-phone-loading" className="text-sm font-semibold text-amber-700">Loading…</p>
      ) : state === "error" ? (
        <p data-testid="admin-phone-error" className="text-sm font-semibold text-red-600">Could not load phone numbers.</p>
      ) : visibleRows.length === 0 ? (
        <p data-testid="admin-phone-empty" className="text-sm font-semibold text-slate-500">
          {rows.length > 0
            ? "No active numbers — archived numbers are hidden. Use the checkbox above to show them."
            : "No platform numbers yet. Search below to purchase your first number, or sync existing numbers from Twilio."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table data-testid="admin-phone-table" className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-normal text-slate-400">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Capabilities</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Twilio SID</th>
                <th className="px-4 py-3">Webhooks</th>
                <th className="px-4 py-3">Compliance / A2P</th>
                <th className="px-4 py-3">Last synced</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 align-top" data-testid={`admin-phone-row-${row.phoneNumber}`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{row.phoneNumber}</p>
                    <p className="text-xs text-slate-400">{row.provider}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {[row.country, row.region, row.locality].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{capabilityLabel(row)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLES[row.status]}`}>
                      {row.status}
                    </span>
                    {row.lastError ? <p className="mt-1 max-w-[180px] text-xs text-red-500">{row.lastError}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.business?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{row.installedAgent?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{row.buyerUser?.email ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{maskSid(row.twilioSid)}</td>
                  <td className="px-4 py-3 text-xs">
                    <p className={WEBHOOK_STYLES[row.webhookStatus] ?? "text-slate-400"}>Voice: {row.webhookStatus}</p>
                    <p className={WEBHOOK_STYLES[row.webhookStatus] ?? "text-slate-400"}>SMS: {row.webhookStatus}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <p>{row.complianceStatus}</p>
                    <p>A2P: {row.a2pStatus}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(row.lastSyncedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1.5">
                      {row.status === "AVAILABLE" ? (
                        <button
                          type="button"
                          data-testid={`admin-phone-assign-${row.phoneNumber}`}
                          onClick={() => void openAssign(row)}
                          disabled={Boolean(busy)}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                        >
                          Assign
                        </button>
                      ) : null}
                      {row.status === "ASSIGNED" || row.business ? (
                        <button
                          type="button"
                          data-testid={`admin-phone-unassign-${row.phoneNumber}`}
                          onClick={() => setUnassignTarget(row)}
                          disabled={Boolean(busy)}
                          className="rounded-lg border border-gray-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                        >
                          Unassign
                        </button>
                      ) : null}
                      {row.twilioSid && row.status !== "RELEASED" && row.status !== "ARCHIVED" ? (
                        <button
                          type="button"
                          data-testid={`admin-phone-webhooks-${row.phoneNumber}`}
                          onClick={() =>
                            void runRowAction(
                              `webhooks-${row.id}`,
                              () => configurePhoneNumberWebhooks(row.id),
                              `Webhooks configured for ${row.phoneNumber}.`,
                              "Could not configure webhooks."
                            )
                          }
                          disabled={Boolean(busy)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {busy === `webhooks-${row.id}` ? "Configuring…" : "Configure webhooks"}
                        </button>
                      ) : null}
                      {row.vapiPhoneNumberId ? (
                        <span
                          data-testid={`admin-phone-outbound-ready-${row.phoneNumber}`}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"
                          title="This number is registered with the voice provider and can place calls."
                        >
                          Can place calls
                        </span>
                      ) : null}
                      {row.twilioSid && !row.business && row.status === "AVAILABLE" && !row.vapiPhoneNumberId ? (
                        <button
                          type="button"
                          data-testid={`admin-phone-outbound-${row.phoneNumber}`}
                          onClick={() =>
                            void runRowAction(
                              `outbound-${row.id}`,
                              () => enableOutboundCalling(row.id),
                              `${row.phoneNumber} can now place calls.`,
                              "Could not enable outbound calling."
                            )
                          }
                          disabled={Boolean(busy)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          title="Registers this number with the voice provider so agents can call out from it. Takes over its incoming calls, so only free numbers are offered."
                        >
                          {busy === `outbound-${row.id}` ? "Enabling…" : "Enable outbound calling"}
                        </button>
                      ) : null}
                      {canRelease(row) ? (
                        <button
                          type="button"
                          data-testid={`admin-phone-release-${row.phoneNumber}`}
                          onClick={() => setReleaseTarget(row)}
                          disabled={Boolean(busy)}
                          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
                        >
                          Release
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Search available numbers */}
      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-5" data-testid="admin-phone-search-section">
        <h2 className="text-lg font-bold text-slate-900">Search available numbers</h2>
        <p className="mt-1 text-sm text-slate-500">Find purchasable Twilio numbers. Purchasing charges the platform Twilio account.</p>

        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <label className="text-xs font-semibold text-slate-500">
            Country
            <select
              data-testid="admin-phone-search-country"
              value={searchForm.country}
              onChange={(e) => setSearchForm((f) => ({ ...f, country: e.target.value }))}
              className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Area code
            <input
              data-testid="admin-phone-search-areacode"
              value={searchForm.areaCode}
              onChange={(e) => setSearchForm((f) => ({ ...f, areaCode: e.target.value }))}
              placeholder="415"
              className="mt-1 block w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Contains
            <input
              data-testid="admin-phone-search-contains"
              value={searchForm.contains}
              onChange={(e) => setSearchForm((f) => ({ ...f, contains: e.target.value }))}
              placeholder="e.g. 777"
              className="mt-1 block w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
          </label>
          {(["voice", "sms", "mms"] as const).map((cap) => (
            <label key={cap} className="flex items-center gap-1.5 pb-2 text-sm font-semibold text-slate-600">
              <input
                type="checkbox"
                data-testid={`admin-phone-search-${cap}`}
                checked={searchForm[cap]}
                onChange={(e) => setSearchForm((f) => ({ ...f, [cap]: e.target.checked }))}
                className="h-4 w-4 accent-amber-500"
              />
              {cap.toUpperCase()}
            </label>
          ))}
          <label className="text-xs font-semibold text-slate-500">
            Limit
            <input
              data-testid="admin-phone-search-limit"
              type="number"
              min={1}
              max={30}
              value={searchForm.limit}
              onChange={(e) => setSearchForm((f) => ({ ...f, limit: Math.min(30, Math.max(1, Number(e.target.value) || 10)) }))}
              className="mt-1 block w-20 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
          </label>
          <button
            type="submit"
            data-testid="admin-phone-search-submit"
            disabled={searching}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {searchResults !== null ? (
          searchResults.length === 0 ? (
            <p data-testid="admin-phone-search-empty" className="mt-4 text-sm font-semibold text-slate-500">
              No numbers matched. Try a different area code or fewer filters.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
              <table data-testid="admin-phone-search-results" className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase tracking-normal text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">Number</th>
                    <th className="px-4 py-2.5">Country</th>
                    <th className="px-4 py-2.5">Region / locality</th>
                    <th className="px-4 py-2.5">Capabilities</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((item) => (
                    <tr key={item.phoneNumber} className="border-b border-gray-100">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{item.phoneNumber}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.country}</td>
                      <td className="px-4 py-2.5 text-slate-600">{[item.region, item.locality].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {[item.capabilities.voice ? "Voice" : null, item.capabilities.sms ? "SMS" : null, item.capabilities.mms ? "MMS" : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          data-testid={`admin-phone-buy-${item.phoneNumber}`}
                          onClick={() => setPurchaseTarget(item)}
                          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600"
                        >
                          Buy
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>

      {/* Purchase confirmation modal */}
      {purchaseTarget ? (
        <Modal onClose={() => (purchasing ? null : setPurchaseTarget(null))} testId="admin-phone-purchase-modal">
          <h3 className="text-lg font-bold text-slate-900">Purchase {purchaseTarget.phoneNumber}?</h3>
          <p className="mt-2 text-sm text-slate-600">
            Country: <span className="font-semibold">{purchaseTarget.country}</span>
            {" · "}Capabilities:{" "}
            <span className="font-semibold">
              {[purchaseTarget.capabilities.voice ? "Voice" : null, purchaseTarget.capabilities.sms ? "SMS" : null, purchaseTarget.capabilities.mms ? "MMS" : null]
                .filter(Boolean)
                .join(", ") || "—"}
            </span>
          </p>
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            Twilio may charge immediately when this number is purchased. Voice and SMS webhooks are configured automatically.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              data-testid="admin-phone-purchase-cancel"
              onClick={() => setPurchaseTarget(null)}
              disabled={purchasing}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="admin-phone-purchase-confirm"
              onClick={() => void confirmPurchase()}
              disabled={purchasing}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {purchasing ? "Purchasing…" : "Confirm purchase"}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* Assign modal */}
      {assignTarget ? (
        <Modal onClose={() => (assignSubmitting ? null : setAssignTarget(null))} testId="admin-phone-assign-modal">
          <h3 className="text-lg font-bold text-slate-900">Assign {assignTarget.phoneNumber}</h3>
          <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">
            This number will become active for inbound calls/SMS for the selected business/agent.
          </p>

          <label className="mt-4 block text-xs font-semibold text-slate-500">
            Business
            <input
              type="search"
              data-testid="admin-phone-assign-business-search"
              value={businessSearch}
              onChange={(event) => {
                setBusinessSearch(event.target.value);
                void loadBusinesses(event.target.value.trim());
              }}
              placeholder="Search by name or owner email…"
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
            <select
              data-testid="admin-phone-assign-business"
              value={assignBusinessId}
              onChange={(e) => void onAssignBusinessChange(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
            >
              <option value="">Select a business…</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.type}) — {b.owner?.email ?? "no owner"}
                </option>
              ))}
            </select>
            {businessTotal > businesses.length ? (
              <span
                data-testid="admin-phone-assign-business-more"
                className="mt-1 block text-[11px] font-medium text-slate-400"
              >
                Showing {businesses.length} of {businessTotal.toLocaleString("en-US")} — search to narrow it down.
              </span>
            ) : null}
            {loadingBusinesses ? (
              <span className="mt-1 block text-[11px] font-medium text-slate-400">Searching…</span>
            ) : null}
          </label>

          <label className="mt-3 block text-xs font-semibold text-slate-500">
            Installed agent (optional — latest active agent is used when empty)
            <select
              data-testid="admin-phone-assign-agent"
              value={assignAgentId}
              onChange={(e) => setAssignAgentId(e.target.value)}
              disabled={!assignBusinessId}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 disabled:opacity-50"
            >
              <option value="">No specific agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.status})
                </option>
              ))}
            </select>
          </label>

          {assignBuyer ? (
            <p className="mt-3 text-xs text-slate-500">
              Buyer user: <span className="font-semibold text-slate-700">{assignBuyer.email}</span> (business owner)
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              data-testid="admin-phone-assign-cancel"
              onClick={() => setAssignTarget(null)}
              disabled={assignSubmitting}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="admin-phone-assign-confirm"
              onClick={() => void confirmAssign()}
              disabled={!assignBusinessId || assignSubmitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {assignSubmitting ? "Assigning…" : "Assign number"}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* Unassign modal */}
      {unassignTarget ? (
        <Modal onClose={() => (busy ? null : setUnassignTarget(null))} testId="admin-phone-unassign-modal">
          <h3 className="text-lg font-bold text-slate-900">Unassign {unassignTarget.phoneNumber}?</h3>
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            Unassigning this number will stop inbound calls/SMS from routing to{" "}
            {unassignTarget.business?.name ?? "this business"} until another number is assigned.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              data-testid="admin-phone-unassign-cancel"
              onClick={() => setUnassignTarget(null)}
              disabled={Boolean(busy)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="admin-phone-unassign-confirm"
              onClick={() =>
                void runRowAction(
                  `unassign-${unassignTarget.id}`,
                  () => unassignPhoneNumber(unassignTarget.id),
                  `${unassignTarget.phoneNumber} unassigned.`,
                  "Could not unassign this number."
                ).then((ok) => (ok ? setUnassignTarget(null) : null))
              }
              disabled={Boolean(busy)}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {busy === `unassign-${unassignTarget.id}` ? "Unassigning…" : "Unassign"}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* Release modal */}
      {releaseTarget ? (
        <Modal onClose={() => (busy ? null : setReleaseTarget(null))} testId="admin-phone-release-modal">
          <h3 className="text-lg font-bold text-slate-900">Release {releaseTarget.phoneNumber}?</h3>
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            This will release the number from Twilio. It may not be recoverable. The inventory record is kept for history.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              data-testid="admin-phone-release-cancel"
              onClick={() => setReleaseTarget(null)}
              disabled={Boolean(busy)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="admin-phone-release-confirm"
              onClick={() =>
                void runRowAction(
                  `release-${releaseTarget.id}`,
                  () => releasePhoneNumber(releaseTarget.id),
                  `${releaseTarget.phoneNumber} released from Twilio.`,
                  "Could not release this number."
                ).then((ok) => (ok ? setReleaseTarget(null) : null))
              }
              disabled={Boolean(busy)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy === `release-${releaseTarget.id}` ? "Releasing…" : "Release number"}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* Sync modal */}
      {syncOpen ? (
        <Modal onClose={() => (syncRunning ? null : setSyncOpen(false))} testId="admin-phone-sync-modal">
          <h3 className="text-lg font-bold text-slate-900">Sync numbers from Twilio</h3>
          {syncRunning && !syncDryRun ? (
            <p className="mt-3 text-sm font-semibold text-amber-700">Reading numbers from Twilio…</p>
          ) : syncDryRun ? (
            <div className="mt-3 space-y-1.5 text-sm text-slate-700" data-testid="admin-phone-sync-summary">
              <p>Numbers on Twilio: <span className="font-bold">{syncDryRun.totalOnTwilio}</span></p>
              <p>New numbers to import: <span className="font-bold text-green-700">{syncDryRun.created.length}</span>{syncDryRun.created.length ? ` (${syncDryRun.created.join(", ")})` : ""}</p>
              <p>Existing numbers to refresh: <span className="font-bold">{syncDryRun.updated.length}</span></p>
              {(syncDryRun.repairedSids ?? []).length > 0 ? (
                <p>Stale Twilio SIDs to repair: <span className="font-bold text-amber-700">{syncDryRun.repairedSids.length}</span> ({syncDryRun.repairedSids.join(", ")})</p>
              ) : null}
              <p>In database but missing on Twilio: <span className="font-bold text-red-600">{syncDryRun.missingInTwilio.length}</span>{syncDryRun.missingInTwilio.length ? ` (${syncDryRun.missingInTwilio.join(", ")})` : ""}</p>
              {syncDryRun.created.length === 0 && syncDryRun.updated.length === 0 ? (
                <p className="font-semibold text-slate-500">No changes to apply.</p>
              ) : null}
              <p className="mt-2 text-xs text-slate-400">
                Sync never changes number status or business/agent assignments — metadata only.
              </p>
            </div>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              data-testid="admin-phone-sync-cancel"
              onClick={() => setSyncOpen(false)}
              disabled={syncRunning}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Close
            </button>
            <button
              type="button"
              data-testid="admin-phone-sync-confirm"
              onClick={() => void confirmSync()}
              disabled={syncRunning || !syncDryRun}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {syncRunning && syncDryRun ? "Syncing…" : "Confirm real sync"}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" data-testid="admin-phone-toasts">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-semibold shadow-lg ${
              toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function Modal({ children, onClose, testId }: { children: React.ReactNode; onClose: () => void; testId: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose} data-testid={testId}>
      <div
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
