"use client";

import type { CrmProviderEntry } from "./api";

/**
 * Empty state when no CRM is connected.
 *
 * Deliberately renders the whole provider catalog, not a lone HubSpot button —
 * Triven is the AI layer on top of whichever CRM the business already uses, and
 * the buyer should be able to see that Salesforce/Zoho are on the way.
 */
export function CrmEmptyConnect({
  providers,
  busyProviderId,
  onConnect,
  onComingSoon
}: {
  providers: CrmProviderEntry[];
  busyProviderId: string | null;
  onConnect: (providerId: string) => void;
  onComingSoon: (provider: CrmProviderEntry) => void;
}) {
  return (
    <div
      className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center"
      data-testid="business-crm-empty"
    >
      <p className="font-bold text-slate-900">Connect a CRM</p>
      <p className="mt-1 text-sm text-slate-400">
        Triven uses your CRM for customer context on calls. Email and company are optional.
      </p>

      <div className="mx-auto mt-8 max-w-2xl space-y-3 text-left">
        {providers.map((provider) => {
          const live = provider.status === "live";
          const busy = busyProviderId === provider.id;

          return (
            <div
              key={provider.id}
              className="flex flex-col gap-4 rounded-xl border border-gray-100 p-4 sm:flex-row sm:items-center"
              data-testid={`business-crm-provider-${provider.id.toLowerCase()}`}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50">
                  <CrmProviderIcon providerId={provider.id} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{provider.name}</p>
                  <p className="mt-0.5 text-sm text-slate-500">{provider.description}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-500">
                    <span
                      className={`h-2 w-2 rounded-full ${provider.connected ? "bg-green-500" : "bg-slate-300"}`}
                    />
                    <span>{live ? (provider.connected ? "Connected" : "Not connected") : "Coming soon"}</span>
                  </div>
                </div>
              </div>

              <div className="sm:ml-auto sm:flex-none">
                <button
                  type="button"
                  disabled={busy}
                  data-testid={
                    provider.id === "HUBSPOT"
                      ? "business-crm-connect-hubspot"
                      : `business-crm-connect-${provider.id.toLowerCase()}`
                  }
                  onClick={() => (live ? onConnect(provider.id) : onComingSoon(provider))}
                  className={
                    live
                      ? "w-full rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60 sm:w-auto"
                      : "w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 hover:border-gray-300 sm:w-auto"
                  }
                >
                  {live ? (busy ? "Connecting…" : `Connect ${provider.name}`) : "Coming soon"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CrmProviderIcon({ providerId }: { providerId: string }) {
  if (providerId === "HUBSPOT") {
    return (
      <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
        <circle cx="33" cy="16" r="5.5" fill="none" stroke="#FF7A59" strokeWidth="3" />
        <circle cx="14" cy="30" r="6.5" fill="#FF7A59" />
        <path d="M14 30 L28.5 18.5" stroke="#FF7A59" strokeWidth="3" strokeLinecap="round" />
        <rect x="31" y="4" width="3" height="7" rx="1.5" fill="#FF7A59" />
      </svg>
    );
  }

  if (providerId === "SALESFORCE") {
    return (
      <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
        <path
          fill="#00A1E0"
          d="M20 14a7 7 0 0 1 11.7-2.3A8 8 0 0 1 44 19a7.5 7.5 0 0 1-9.3 7.3A6.5 6.5 0 0 1 23 29.5 7 7 0 0 1 11 27a7.5 7.5 0 0 1 1.4-14.8A7 7 0 0 1 20 14z"
        />
      </svg>
    );
  }

  if (providerId === "ZOHO") {
    return (
      <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
        <rect x="6" y="14" width="16" height="20" rx="3" fill="#E42527" />
        <rect x="26" y="14" width="16" height="20" rx="3" fill="#226DB4" />
      </svg>
    );
  }

  if (providerId === "PIPEDRIVE") {
    return (
      <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
        <rect x="6" y="6" width="36" height="36" rx="9" fill="#017737" />
        <path
          fill="#fff"
          d="M26 13c-3 0-5 1.4-6 3v-2.5h-6v29h6.3V32c1 1.3 2.8 2.4 5.5 2.4 5 0 8.7-4 8.7-10.8S31 13 26 13zm-1.4 16.2c-2.6 0-4.5-2-4.5-5.4s1.9-5.5 4.5-5.5 4.5 2 4.5 5.5-1.8 5.4-4.5 5.4z"
        />
      </svg>
    );
  }

  return <span className="text-sm font-bold text-slate-500">?</span>;
}
