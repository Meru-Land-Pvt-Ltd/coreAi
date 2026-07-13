"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  archiveAdminEmailAlias,
  disableAdminEmailAlias,
  getAdminEmailAliases,
  getAdminEmailSuppressions,
  reactivateAdminEmailSuppression,
  resendTestAdminEmailAlias,
  type AdminEmailAlias,
  type AdminEmailSuppression
} from "@/components/admin/features/api";

const STATUS_STYLES: Record<AdminEmailAlias["status"], string> = {
  ACTIVE: "bg-green-50 text-green-700 border-green-200",
  DISABLED: "bg-slate-100 text-slate-600 border-slate-200",
  ARCHIVED: "bg-slate-100 text-slate-500 border-slate-200"
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function countOf(counts: Record<string, number>, key: string): number {
  return counts?.[key] ?? 0;
}

function isComplaint(suppression: AdminEmailSuppression): boolean {
  return /complain/i.test(suppression.reason);
}

type Toast = { id: number; type: "success" | "error"; message: string };

export default function AdminMailPage() {
  /* --------------------------------- toasts -------------------------------- */

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, type, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);

  /** Key of the action currently running — disables its buttons. */
  const [busy, setBusy] = useState<string | null>(null);

  /* -------------------------------- aliases -------------------------------- */

  const [aliases, setAliases] = useState<AdminEmailAlias[]>([]);
  const [aliasState, setAliasState] = useState<"loading" | "ready" | "error">("loading");
  const [search, setSearch] = useState("");

  const loadAliases = useCallback(async (searchValue: string) => {
    setAliasState("loading");
    const result = await getAdminEmailAliases({ search: searchValue, limit: 50 });
    if (result.success && result.data) {
      setAliases(result.data.items);
      setAliasState("ready");
    } else {
      setAliasState("error");
    }
  }, []);

  /* ------------------------------ suppressions ------------------------------ */

  const [suppressions, setSuppressions] = useState<AdminEmailSuppression[]>([]);
  const [suppressionState, setSuppressionState] = useState<"loading" | "ready" | "error">("loading");

  const loadSuppressions = useCallback(async () => {
    setSuppressionState("loading");
    const result = await getAdminEmailSuppressions({ limit: 50 });
    if (result.success && result.data) {
      setSuppressions(result.data.items);
      setSuppressionState("ready");
    } else {
      setSuppressionState("error");
    }
  }, []);

  useEffect(() => {
    void loadAliases("");
    void loadSuppressions();
  }, [loadAliases, loadSuppressions]);

  /* -------------------------------- actions -------------------------------- */

  async function disableAlias(alias: AdminEmailAlias) {
    if (busy) return;
    setBusy(`disable-${alias.id}`);
    const result = await disableAdminEmailAlias(alias.id);
    setBusy(null);
    if (result.success) {
      pushToast("success", `${alias.emailAddress} disabled.`);
      await loadAliases(search.trim());
    } else {
      pushToast("error", result.error ?? "Could not disable this alias.");
    }
  }

  async function archiveAlias(alias: AdminEmailAlias) {
    if (busy) return;
    if (!window.confirm(`Archive ${alias.emailAddress}? The alias will stop sending and receiving email.`)) return;
    setBusy(`archive-${alias.id}`);
    const result = await archiveAdminEmailAlias(alias.id);
    setBusy(null);
    if (result.success) {
      pushToast("success", `${alias.emailAddress} archived.`);
      await loadAliases(search.trim());
    } else {
      pushToast("error", result.error ?? "Could not archive this alias.");
    }
  }

  async function resendTest(alias: AdminEmailAlias) {
    if (busy) return;
    setBusy(`resend-test-${alias.id}`);
    const result = await resendTestAdminEmailAlias(alias.id);
    setBusy(null);
    if (result.success && result.data) {
      pushToast(
        "success",
        result.data.dryRun
          ? `Test email for ${alias.emailAddress} completed as a dry run.`
          : `Test email sent to ${alias.forwardToEmail ?? "the forward-to address"}.`
      );
      await loadAliases(search.trim());
    } else {
      pushToast("error", result.error ?? "Could not send the test email.");
    }
  }

  async function reactivateSuppression(suppression: AdminEmailSuppression) {
    if (busy) return;
    if (!window.confirm(`Reactivate ${suppression.emailAddress}? Emails will be delivered to this address again.`)) return;
    setBusy(`reactivate-${suppression.id}`);
    const result = await reactivateAdminEmailSuppression(suppression.id);
    setBusy(null);
    if (result.success) {
      pushToast("success", `${suppression.emailAddress} reactivated.`);
      await loadSuppressions();
    } else {
      pushToast("error", result.error ?? "Could not reactivate this recipient.");
    }
  }

  /* --------------------------------- render -------------------------------- */

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Mail</h1>
        <p className="mt-1 text-sm text-slate-500">
          Business email aliases, delivery health, and suppressed recipients.
        </p>
      </header>

      <form
        data-testid="admin-mail-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void loadAliases(search.trim());
        }}
        className="mb-4 flex gap-2"
      >
        <input
          data-testid="admin-mail-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by business name or alias"
          className="w-full max-w-md rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400"
        />
        <button type="submit" className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">Search</button>
      </form>

      {aliasState === "loading" ? (
        <p data-testid="admin-mail-aliases-loading" className="text-sm font-semibold text-orange-700">Loading…</p>
      ) : aliasState === "error" ? (
        <p data-testid="admin-mail-aliases-error" className="text-sm font-semibold text-red-600">Could not load email aliases.</p>
      ) : aliases.length === 0 ? (
        <p data-testid="admin-mail-aliases-empty" className="text-sm font-semibold text-slate-500">No email aliases found.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-orange-100 bg-white">
          <table data-testid="admin-mail-aliases-table" className="w-full text-left text-sm">
            <thead className="border-b border-orange-100 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Alias</th>
                <th className="px-4 py-3">Sender name</th>
                <th className="px-4 py-3">Forward-to</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Confirmations</th>
                <th className="px-4 py-3">Summaries</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Delivered</th>
                <th className="px-4 py-3">Bounced</th>
                <th className="px-4 py-3">Complaints</th>
                <th className="px-4 py-3">Suppressed</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3">Last error</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {aliases.map((alias) => (
                <tr key={alias.id} className="border-b border-orange-50 align-top" data-testid="admin-mail-alias-row">
                  <td className="px-4 py-3 font-semibold text-slate-900">{alias.business?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{alias.emailAddress}</td>
                  <td className="px-4 py-3 text-slate-600">{alias.displayName || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{alias.forwardToEmail ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLES[alias.status]}`}>
                      {alias.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{alias.customerConfirmationEnabled ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-slate-600">{alias.internalSummaryEnabled ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-slate-600">{countOf(alias.counts, "SENT")}</td>
                  <td className="px-4 py-3 text-slate-600">{countOf(alias.counts, "DELIVERED")}</td>
                  <td className="px-4 py-3 text-slate-600">{countOf(alias.counts, "BOUNCED")}</td>
                  <td className="px-4 py-3 text-slate-600">{countOf(alias.counts, "COMPLAINED")}</td>
                  <td className="px-4 py-3 text-slate-600">{countOf(alias.counts, "SUPPRESSED")}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {alias.lastMessage ? (
                      <>
                        <p>{formatDate(alias.lastMessage.createdAt)}</p>
                        <p className="text-slate-400">{alias.lastMessage.status}</p>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {alias.lastError ? <p className="max-w-[180px] text-red-500">{alias.lastError}</p> : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1.5">
                      {alias.status === "ACTIVE" ? (
                        <button
                          type="button"
                          data-testid="admin-mail-alias-disable"
                          onClick={() => void disableAlias(alias)}
                          disabled={Boolean(busy)}
                          className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                        >
                          {busy === `disable-${alias.id}` ? "Disabling…" : "Disable"}
                        </button>
                      ) : null}
                      {alias.status !== "ARCHIVED" ? (
                        <button
                          type="button"
                          data-testid="admin-mail-alias-archive"
                          onClick={() => void archiveAlias(alias)}
                          disabled={Boolean(busy)}
                          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
                        >
                          {busy === `archive-${alias.id}` ? "Archiving…" : "Archive"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        data-testid="admin-mail-alias-resend-test"
                        onClick={() => void resendTest(alias)}
                        disabled={Boolean(busy) || !alias.forwardToEmail}
                        title={alias.forwardToEmail ? undefined : "No forward-to email configured"}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {busy === `resend-test-${alias.id}` ? "Sending…" : "Resend test"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Suppressed recipients */}
      <section className="mt-8" data-testid="admin-mail-suppressions-section">
        <h2 className="text-lg font-bold text-slate-900">Suppressed recipients</h2>
        <p className="mt-1 text-sm text-slate-500">
          Addresses we no longer email because of bounces or complaints.
        </p>

        {suppressionState === "loading" ? (
          <p data-testid="admin-mail-suppressions-loading" className="mt-4 text-sm font-semibold text-orange-700">Loading…</p>
        ) : suppressionState === "error" ? (
          <p data-testid="admin-mail-suppressions-error" className="mt-4 text-sm font-semibold text-red-600">Could not load suppressed recipients.</p>
        ) : suppressions.length === 0 ? (
          <p data-testid="admin-mail-suppressions-empty" className="mt-4 text-sm font-semibold text-slate-500">No suppressed recipients.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-orange-100 bg-white">
            <table data-testid="admin-mail-suppressions-table" className="w-full text-left text-sm">
              <thead className="border-b border-orange-100 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Since</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppressions.map((suppression) => (
                  <tr key={suppression.id} className="border-b border-orange-50 align-top" data-testid="admin-mail-suppression-row">
                    <td className="px-4 py-3 font-semibold text-slate-900">{suppression.emailAddress}</td>
                    <td className="px-4 py-3 text-slate-600">{suppression.reason}</td>
                    <td className="px-4 py-3 text-slate-600">{suppression.source}</td>
                    <td className="px-4 py-3 text-slate-600">{suppression.active ? "Yes" : "No"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(suppression.createdAt)}</td>
                    <td className="px-4 py-3">
                      {isComplaint(suppression) ? (
                        <>
                          <button
                            type="button"
                            data-testid="admin-mail-suppression-reactivate"
                            disabled
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 disabled:opacity-50"
                          >
                            Reactivate
                          </button>
                          <p className="mt-1 text-xs text-slate-400">Complaints can&apos;t be reactivated</p>
                        </>
                      ) : suppression.active ? (
                        <button
                          type="button"
                          data-testid="admin-mail-suppression-reactivate"
                          onClick={() => void reactivateSuppression(suppression)}
                          disabled={Boolean(busy)}
                          className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-bold text-green-700 hover:bg-green-100 disabled:opacity-50"
                        >
                          {busy === `reactivate-${suppression.id}` ? "Reactivating…" : "Reactivate"}
                        </button>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" data-testid="admin-mail-toasts">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg ${
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
