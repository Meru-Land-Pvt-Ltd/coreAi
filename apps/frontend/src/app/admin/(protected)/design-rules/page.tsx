"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_DESIGN_RULES_MAX_LENGTH,
  getAdminDesignRules,
  updateAdminDesignRules
} from "@/components/admin/features/design-rules";

/**
 * Admin → Design Brain rules.
 *
 * One plain-text rulebook the Design Brain follows on every styling request.
 * While nothing is saved the platform default applies, so the Brain is never
 * rule-less. "Restore default" saves blank, which brings the default back.
 */

export default function DesignRulesPage() {
  const [value, setValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [defaultValue, setDefaultValue] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await getAdminDesignRules();
    if (!response.success || !response.data) {
      setError(response.error ?? "Could not load the rules.");
      setLoading(false);
      return;
    }
    const { rules } = response.data;
    setValue(rules.value);
    setSavedValue(rules.value);
    setDefaultValue(rules.defaultValue);
    setIsDefault(rules.isDefault);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = value !== savedValue;

  async function submit(nextValue: string, restoring: boolean) {
    setSaving(true);
    setMessage("");
    setError("");

    const response = await updateAdminDesignRules(nextValue);
    if (!response.success || !response.data) {
      setError(response.error ?? "Could not save the rules.");
      setSaving(false);
      return;
    }

    const { rules, restoredDefault } = response.data;
    setValue(rules.value);
    setSavedValue(rules.value);
    setDefaultValue(rules.defaultValue);
    setIsDefault(rules.isDefault);
    setMessage(
      restoring || restoredDefault
        ? "Default rules restored. The Design Brain follows them right away."
        : "Rules saved. The Design Brain follows them right away."
    );
    setSaving(false);
  }

  return (
    <main data-testid="admin-design-rules-page" className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900" data-testid="admin-design-rules-heading">
            Design Brain rules
          </h1>
          <span
            data-testid="admin-design-rules-status"
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              isDefault
                ? "border-slate-200 bg-slate-50 text-slate-500"
                : "border-green-200 bg-green-50 text-green-700"
            }`}
          >
            {isDefault ? "Platform default" : "Customized"}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600" data-testid="admin-design-rules-subtitle">
          These rules discipline the Design Brain on every styling request.
        </p>
      </header>

      {error ? (
        <div
          data-testid="admin-design-rules-error"
          className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {message ? (
        <div
          data-testid="admin-design-rules-message"
          className="mb-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          {message}
        </div>
      ) : null}

      {loading ? (
        <div
          data-testid="admin-design-rules-loading"
          className="h-96 animate-pulse rounded-2xl border border-gray-100 bg-white"
        />
      ) : (
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <label htmlFor="design-rules-text" className="text-xs font-semibold text-slate-700">
            The rulebook
          </label>
          <textarea
            id="design-rules-text"
            data-testid="admin-design-rules-textarea"
            value={value}
            maxLength={ADMIN_DESIGN_RULES_MAX_LENGTH}
            rows={18}
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1.5 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 placeholder:text-slate-400 focus:border-amber-300 focus:outline-none focus:ring-4 focus:ring-amber-100"
            placeholder="Write one rule per line."
          />
          <p className="mt-1 text-right text-[11px] text-slate-400" data-testid="admin-design-rules-count">
            {value.length} / {ADMIN_DESIGN_RULES_MAX_LENGTH}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              data-testid="admin-design-rules-restore"
              onClick={() => void submit("", true)}
              disabled={saving || (isDefault && !dirty)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50"
            >
              Restore default
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="admin-design-rules-discard"
                onClick={() => setValue(savedValue)}
                disabled={saving || !dirty}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                data-testid="admin-design-rules-save"
                onClick={() => void submit(value, false)}
                disabled={saving || !dirty}
                className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save rules"}
              </button>
            </div>
          </div>

          {value.trim() === "" ? (
            <p className="mt-3 text-[11px] text-slate-400" data-testid="admin-design-rules-blank-hint">
              Saving an empty rulebook brings back the platform default — the Design Brain is never
              left without rules.
            </p>
          ) : null}
          {!isDefault && value !== defaultValue ? (
            <p className="mt-3 text-[11px] text-slate-400">
              &ldquo;Restore default&rdquo; replaces your custom rules with the platform&apos;s
              standard rulebook.
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}
