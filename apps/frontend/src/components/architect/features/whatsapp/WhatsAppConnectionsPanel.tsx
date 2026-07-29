"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteWhatsAppConnection,
  disconnectWhatsAppConnection,
  listWhatsAppConnectionsOwnerView,
  refreshWhatsAppConnection,
  renameWhatsAppConnection,
  testWhatsAppConnection,
  type WhatsAppConnectionOwnerView
} from "@/components/architect/features/api";
import { WhatsAppConnectModal } from "./WhatsAppConnectModal";
import { WhatsAppIcon } from "./WhatsAppIcon";

function statusBadgeClass(status: WhatsAppConnectionOwnerView["status"]) {
  if (status === "CONNECTED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "ERROR") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "DISCONNECTED") return "border-gray-200 bg-gray-50 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function WhatsAppConnectionsPanel() {
  const [connections, setConnections] = useState<WhatsAppConnectionOwnerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listWhatsAppConnectionsOwnerView();
      if (!res.success) {
        setError(res.error ?? "Could not load WhatsApp connections");
        setConnections([]);
        return;
      }
      setConnections(res.data?.connections ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load WhatsApp connections");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function runAction(id: string, action: "test" | "refresh" | "disconnect" | "delete") {
    setBusyId(id);
    setError("");
    try {
      if (action === "test") {
        const res = await testWhatsAppConnection(id);
        if (!res.success) {
          setError(res.error ?? "Test failed");
          return;
        }
        setToast("Connection test passed");
      } else if (action === "refresh") {
        const res = await refreshWhatsAppConnection(id);
        if (!res.success) {
          setError(res.error ?? "Refresh failed");
          return;
        }
        setToast("Connection refreshed");
      } else if (action === "disconnect") {
        const res = await disconnectWhatsAppConnection(id);
        if (!res.success) {
          setError(res.error ?? "Disconnect failed");
          return;
        }
        setToast("Disconnected");
      } else {
        const res = await deleteWhatsAppConnection(id);
        if (!res.success) {
          setError(res.error ?? "Delete failed");
          return;
        }
        setConfirmDeleteId(null);
        setToast("Connection removed");
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function onRename(id: string) {
    if (!renameValue.trim()) return;
    setBusyId(id);
    try {
      const res = await renameWhatsAppConnection(id, renameValue.trim());
      if (!res.success) {
        setError(res.error ?? "Rename failed");
        return;
      }
      setRenameId(null);
      setToast("Renamed");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6" data-testid="architect-whatsapp-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-slate-900"
            data-testid="architect-whatsapp-title"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <WhatsAppIcon className="h-5 w-5" />
            </span>
            WhatsApp Business
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Connect a Meta Cloud API WhatsApp number for inbound triggers and Send WhatsApp nodes. Point Meta&apos;s
            webhook to the callback URL shown on each connection card.
          </p>
        </div>
        <button
          type="button"
          data-testid="architect-whatsapp-connect-button"
          onClick={() => setShowConnect(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
        >
          <WhatsAppIcon className="h-4 w-4" />
          Connect WhatsApp
        </button>
      </div>

      {toast ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800" data-testid="architect-whatsapp-toast">
          {toast}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800" data-testid="architect-whatsapp-error">
          {error}
        </div>
      ) : null}

      <div className="mt-8 space-y-4">
        {loading ? (
          <div className="space-y-3" data-testid="architect-whatsapp-skeleton">
            {[1, 2].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />
            ))}
          </div>
        ) : connections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center" data-testid="architect-whatsapp-empty">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <WhatsAppIcon className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm font-semibold text-slate-800">No WhatsApp connections yet</p>
            <p className="mt-2 text-sm text-slate-500">Connect a Meta Cloud API number to use WhatsApp triggers and actions.</p>
          </div>
        ) : (
          connections.map((connection) => (
            <div
              key={connection.id}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
              data-testid={`architect-whatsapp-card-${connection.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <WhatsAppIcon className="h-4 w-4" />
                    </span>
                    <h2 className="text-lg font-bold text-slate-900">
                      {connection.displayName || connection.businessName || "WhatsApp"}
                    </h2>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusBadgeClass(connection.status)}`}>
                      {connection.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{connection.businessName || "—"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === connection.id}
                    data-testid={`architect-whatsapp-test-${connection.id}`}
                    onClick={() => void runAction(connection.id, "test")}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Test Connection
                  </button>
                  <button
                    type="button"
                    disabled={busyId === connection.id}
                    data-testid={`architect-whatsapp-refresh-${connection.id}`}
                    onClick={() => void runAction(connection.id, "refresh")}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    disabled={busyId === connection.id}
                    data-testid={`architect-whatsapp-disconnect-${connection.id}`}
                    onClick={() => void runAction(connection.id, "disconnect")}
                    className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    data-testid={`architect-whatsapp-delete-${connection.id}`}
                    onClick={() => setConfirmDeleteId(connection.id)}
                    className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Phone</dt>
                  <dd className="mt-1 font-medium text-slate-800">{connection.phoneNumber}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Quality rating</dt>
                  <dd className="mt-1 font-medium text-slate-800">{connection.qualityRating || "Unavailable"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last connected</dt>
                  <dd className="mt-1 font-medium text-slate-800">{formatDate(connection.lastConnectedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Phone number ID</dt>
                  <dd className="mt-1 truncate font-mono text-xs text-slate-700">{connection.phoneNumberId}</dd>
                </div>
              </dl>

              <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Webhook callback URL</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-700" data-testid={`architect-whatsapp-webhook-url-${connection.id}`}>
                  {connection.webhookCallbackUrl}
                </p>
              </div>

              {connection.lastError ? (
                <p className="mt-3 text-xs font-medium text-rose-600">{connection.lastError}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {renameId === connection.id ? (
                  <>
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      data-testid={`architect-whatsapp-rename-input-${connection.id}`}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void onRename(connection.id)}
                      className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950"
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setRenameId(null)} className="text-xs font-semibold text-slate-500">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid={`architect-whatsapp-rename-${connection.id}`}
                    onClick={() => {
                      setRenameId(connection.id);
                      setRenameValue(connection.displayName || "");
                    }}
                    className="text-xs font-semibold text-amber-700 hover:underline"
                  >
                    Rename connection
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <WhatsAppConnectModal
        open={showConnect}
        onClose={() => setShowConnect(false)}
        onConnected={() => {
          setToast("WhatsApp connected");
          void load();
        }}
      />

      {confirmDeleteId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" data-testid="architect-whatsapp-delete-confirm">
          <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">Remove this connection?</h2>
            <p className="mt-2 text-sm text-slate-600">This deletes the connection and stored WhatsApp conversations for it.</p>
            <div className="mt-6 flex justify-center gap-2">
              <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600">
                Cancel
              </button>
              <button
                type="button"
                data-testid="architect-whatsapp-delete-confirm-button"
                onClick={() => void runAction(confirmDeleteId, "delete")}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
