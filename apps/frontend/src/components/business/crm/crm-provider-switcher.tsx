"use client";

import type { CrmProviderEntry } from "./api";

/**
 * Active-CRM picker in the page header.
 *
 * A business can have more than one CRM connected over time, but exactly one
 * feeds AI greeting, lookup and after-call sync. Coming-soon providers are
 * listed (so the roadmap is visible) but disabled.
 *
 * Native <select> on purpose — this repo has no dropdown library and the spec
 * forbids adding one.
 */
export function CrmProviderSwitcher({
  providers,
  activeProvider,
  busy,
  onChange
}: {
  providers: CrmProviderEntry[];
  activeProvider: string | null;
  busy: boolean;
  onChange: (providerId: string) => void;
}) {
  if (providers.length === 0) return null;

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">CRM</span>
      <select
        value={activeProvider ?? ""}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        data-testid="business-crm-provider-select"
        aria-label="Active CRM"
        className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
      >
        {!activeProvider ? <option value="">Select a CRM</option> : null}
        {providers.map((provider) => (
          <option
            key={provider.id}
            value={provider.id}
            // Not-yet-shipped adapters cannot be selected at all.
            disabled={provider.status !== "live"}
          >
            {provider.name}
            {provider.status !== "live"
              ? " (coming soon)"
              : provider.connected
                ? " (connected)"
                : " (not connected)"}
          </option>
        ))}
      </select>
    </label>
  );
}
