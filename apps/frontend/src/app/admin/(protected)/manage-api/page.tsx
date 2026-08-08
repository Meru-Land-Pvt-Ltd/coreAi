"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAdminApiSettings,
  updateAdminApiSettings,
  type AdminApiSettingField,
  type AdminApiSettingGroup
} from "@/components/admin/features/api";

/**
 * Admin → Manage API.
 *
 * Platform credentials live in the database so a key can be rotated without a
 * redeploy. A key left blank here keeps using the matching .env value, so this
 * page can be adopted one field at a time and never takes a provider offline.
 *
 * Stored secrets are only ever returned masked — the plaintext never leaves the
 * server, which is why a saved field shows "••••" rather than the real key.
 */

const SOURCE_BADGE: Record<AdminApiSettingField["source"], { label: string; className: string }> = {
  admin: { label: "Saved here", className: "border-green-200 bg-green-50 text-green-700" },
  env: { label: "From .env", className: "border-amber-200 bg-amber-50 text-amber-700" },
  unset: { label: "Not set", className: "border-slate-200 bg-slate-50 text-slate-500" }
};

export default function ManageApiPage() {
  const [groups, setGroups] = useState<AdminApiSettingGroup[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await getAdminApiSettings();
    if (!response.success || !response.data) {
      setError(response.error ?? "Could not load API settings.");
      setLoading(false);
      return;
    }
    setGroups(response.data.groups);
    setDrafts({});
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only edited fields are sent — an untouched masked value must never be saved
  // back, or the mask itself would overwrite the real key.
  const edited = Object.entries(drafts).filter(([, value]) => value !== undefined);

  async function save() {
    if (edited.length === 0) return;
    setSaving(true);
    setMessage("");
    setError("");

    const response = await updateAdminApiSettings(edited.map(([key, value]) => ({ key, value })));
    if (!response.success || !response.data) {
      setError(response.error ?? "Could not save API settings.");
      setSaving(false);
      return;
    }

    setGroups(response.data.groups);
    setDrafts({});
    const { saved, cleared } = response.data;
    setMessage(
      cleared > 0
        ? `Saved ${saved} key${saved === 1 ? "" : "s"}, cleared ${cleared} back to .env.`
        : `Saved ${saved} key${saved === 1 ? "" : "s"}. Changes are live immediately — no restart needed.`
    );
    setSaving(false);
  }

  return (
    <main data-testid="admin-manage-api-page" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900" data-testid="admin-manage-api-heading">
          Manage API
        </h1>
        <p className="mt-1 text-sm text-slate-600" data-testid="admin-manage-api-subtitle">
          Platform API keys and provider settings. A value saved here overrides the server
          environment and takes effect immediately. Leave a field blank to keep using the
          existing <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env</code> value.
        </p>
      </header>

      {error ? (
        <div
          data-testid="admin-manage-api-error"
          className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {message ? (
        <div
          data-testid="admin-manage-api-message"
          className="mb-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          {message}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4" data-testid="admin-manage-api-loading">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-white" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section
              key={group.id}
              data-testid={`admin-manage-api-group-${group.id}`}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
            >
              <h2 className="text-base font-semibold text-slate-900">{group.title}</h2>
              <p className="mt-1 text-xs text-slate-500">{group.description}</p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {group.fields.map((field) => {
                  const badge = SOURCE_BADGE[field.source];
                  const draft = drafts[field.key];
                  return (
                    <div key={field.key}>
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor={`setting-${field.key}`}
                          className="text-xs font-semibold text-slate-700"
                        >
                          {field.label}
                        </label>
                        <span
                          data-testid={`admin-manage-api-source-${field.key}`}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>

                      <input
                        id={`setting-${field.key}`}
                        data-testid={`admin-manage-api-input-${field.key}`}
                        type={field.secret ? "password" : "text"}
                        autoComplete="off"
                        value={draft ?? ""}
                        placeholder={field.value || "Not configured"}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [field.key]: event.target.value }))
                        }
                        className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-amber-300 focus:outline-none focus:ring-4 focus:ring-amber-100"
                      />

                      <p className="mt-1 text-[11px] text-slate-400">
                        <span className="font-mono">{field.key}</span>
                        {draft !== undefined && draft.trim() === "" && field.source === "admin"
                          ? " — saving blank restores the .env value"
                          : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="sticky bottom-4 mt-6 flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <p className="text-xs text-slate-500" data-testid="admin-manage-api-pending">
          {edited.length === 0
            ? "No changes."
            : `${edited.length} field${edited.length === 1 ? "" : "s"} changed.`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrafts({})}
            disabled={saving || edited.length === 0}
            data-testid="admin-manage-api-discard"
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || edited.length === 0}
            data-testid="admin-manage-api-save"
            className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </main>
  );
}
