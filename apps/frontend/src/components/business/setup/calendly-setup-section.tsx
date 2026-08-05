"use client";

import { useEffect, useState } from "react";
import {
  listBusinessCalendlyEventTypes,
  saveBusinessCalendlyConfig
} from "@/components/business/features/api";
import { InfoTooltip } from "@/components/business/setup/InfoTooltip";

type EventTypeOption = {
  value: string;
  label: string;
  uri: string;
  schedulingUrl?: string;
};

export function CalendlySetupSection({
  installedAgentId,
  listingId,
  connected,
  email,
  busy,
  eventTypeUri,
  eventTypeName,
  onConnect,
  onDisconnect,
  onSelectionChange
}: {
  installedAgentId: string | null;
  listingId?: string | null;
  connected: boolean;
  email: string | null;
  busy: boolean;
  eventTypeUri: string;
  eventTypeName: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSelectionChange: (next: {
    eventTypeUri: string;
    eventTypeName: string;
    schedulingUrl: string;
  }) => void;
}) {
  const [options, setOptions] = useState<EventTypeOption[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) {
      setOptions([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoadingTypes(true);
    setError(null);
    void listBusinessCalendlyEventTypes().then((result) => {
      if (cancelled) return;
      setLoadingTypes(false);
      if (!result.success) {
        setOptions([]);
        setError(result.error ?? "Could not load Calendly event types");
        return;
      }
      setOptions(result.data?.options ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  async function handleSelect(uri: string) {
    const selected = options.find((option) => option.value === uri);
    const next = {
      eventTypeUri: uri,
      eventTypeName: selected?.label ?? "",
      schedulingUrl: selected?.schedulingUrl ?? ""
    };
    onSelectionChange(next);
    if (!uri.trim()) return;
    if (!installedAgentId && !listingId) return;
    setSaving(true);
    setError(null);
    const result = await saveBusinessCalendlyConfig({
      installedAgentId: installedAgentId ?? undefined,
      listingId: listingId ?? undefined,
      eventTypeUri: next.eventTypeUri,
      eventTypeName: next.eventTypeName || undefined,
      schedulingUrl: next.schedulingUrl || undefined
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Could not save Calendly preferences");
    }
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-6" data-testid="business-setup-calendly">
      <h3 className="mb-3 text-sm font-bold text-slate-900">Calendly</h3>

      <div className="flex items-center justify-between gap-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
            <svg viewBox="0 0 24 24" className="h-10 w-10" aria-hidden="true">
              <rect x="2" y="2" width="20" height="20" rx="5" fill="#006BFF" />
              <path
                fill="#fff"
                d="M12.2 6.5c-3.2 0-5.8 2.6-5.8 5.8s2.6 5.8 5.8 5.8 5.8-2.6 5.8-5.8h-2.1c0 2-1.6 3.7-3.7 3.7s-3.7-1.6-3.7-3.7 1.6-3.7 3.7-3.7V6.5z"
              />
            </svg>
          </div>
          <div>
            <p className="inline-flex items-center text-sm font-semibold text-slate-800">
              {connected ? "Calendly connected" : "Calendly"}
              {!connected ? (
                <InfoTooltip content="Connect so meeting bookings can trigger this agent, then pick your default event type." />
              ) : null}
            </p>
            {connected ? (
              <p className="mt-0.5 text-xs text-slate-500" data-testid="business-setup-calendly-email">
                Connected as {email || "your account"}
              </p>
            ) : null}
          </div>
        </div>

        {connected ? (
          <button
            type="button"
            disabled={busy}
            onClick={onDisconnect}
            className="btn shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:border-gray-300"
            data-testid="business-setup-calendly-disconnect"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onConnect}
            className="btn shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600"
            data-testid="business-setup-calendly-connect"
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>

      {connected ? (
        <div className="mt-2 space-y-3">
          <div>
            <label
              className="mb-1.5 block text-sm font-semibold text-slate-700"
              htmlFor="business-setup-calendly-event-type"
            >
              Default event type
              <span className="font-bold text-amber-600"> *</span>
            </label>
            <p className="mb-2 text-xs text-slate-500">
              Used for booking, availability, and scheduling links in this agent.
            </p>
            <select
              id="business-setup-calendly-event-type"
              data-testid="business-setup-calendly-event-type"
              value={eventTypeUri}
              disabled={loadingTypes || saving}
              onChange={(event) => void handleSelect(event.target.value)}
              className="field w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none disabled:opacity-60"
            >
              <option value="">
                {loadingTypes
                  ? "Loading event types…"
                  : options.length === 0
                    ? "No event types found"
                    : "Select an event type"}
              </option>
              {eventTypeUri && !options.some((option) => option.value === eventTypeUri) ? (
                <option value={eventTypeUri}>{eventTypeName || eventTypeUri}</option>
              ) : null}
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {saving ? (
              <p className="mt-1.5 text-xs text-slate-500" data-testid="business-setup-calendly-saving">
                Saving…
              </p>
            ) : null}
          </div>
          {error ? (
            <p className="text-xs text-rose-600" data-testid="business-setup-calendly-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
