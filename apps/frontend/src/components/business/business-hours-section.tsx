"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getBusinessHours,
  putBusinessHours,
  syncBusinessHoursToLiveAgent,
  type BusinessHoursData,
  type BusinessHoursDayInput,
  type BusinessHoursSyncStatus,
  type BusinessHoursWeekday,
  type BusinessSpecialHoursInput
} from "@/components/business/features/api";

/**
 * Self-contained structured Business Hours editor. Every surface (Business
 * Settings, Agent Setup, onboarding) mounts this same component, and it talks
 * to GET/PUT /business/hours directly — so saving works even for live agents
 * and always reports the honest live-sync status.
 */

const WEEK_DAYS: BusinessHoursWeekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
];

const WEEKDAYS_MON_FRI: BusinessHoursWeekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

const DAY_LABELS: Record<BusinessHoursWeekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday"
};

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney"
];

const DEFAULT_DAY = (day: BusinessHoursWeekday): BusinessHoursDayInput => ({
  day,
  closed: day === "sunday",
  periods: day === "sunday" ? [] : [{ open: "09:00", close: "17:00" }]
});

function to12h(hhmm: string): string {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return hhmm;
  const hour = Number(match[1]);
  const meridiem = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return match[2] === "00" ? `${hour12} ${meridiem}` : `${hour12}:${match[2]} ${meridiem}`;
}

function minutesOf(hhmm: string): number | null {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function validateDay(day: BusinessHoursDayInput): string | null {
  if (day.closed) return null;
  if (day.periods.length === 0) return "Add at least one working period";

  const spans: Array<{ start: number; end: number }> = [];
  for (const period of day.periods) {
    const start = minutesOf(period.open);
    const end = minutesOf(period.close);
    if (start === null || end === null) return "Times must be valid";
    if (end <= start) return "Closing time must be after opening time";
    spans.push({ start, end });
  }
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return "Working periods must not overlap";
  }
  return null;
}

function normalizeWeek(hours: BusinessHoursDayInput[] | null): BusinessHoursDayInput[] {
  const byDay = new Map((hours ?? []).map((day) => [day.day, day]));
  return WEEK_DAYS.map((day) => {
    const existing = byDay.get(day);
    if (!existing) return DEFAULT_DAY(day);
    return {
      day,
      closed: existing.closed,
      periods: (existing.periods ?? []).map((period) => ({ ...period })),
      ...(existing.note ? { note: existing.note } : {})
    };
  });
}

function summarizeWeek(week: BusinessHoursDayInput[]): string[] {
  return week.map((day) => {
    if (day.closed || day.periods.length === 0) return `${DAY_LABELS[day.day]}: Closed`;
    const label = day.periods.map((period) => `${to12h(period.open)}–${to12h(period.close)}`).join(", ");
    return `${DAY_LABELS[day.day]}: ${label}${day.note ? ` (${day.note})` : ""}`;
  });
}

/* --------------------------------- editor --------------------------------- */

/** Imperative handle for embedded (parent-orchestrated) saving. */
export type EmbeddedSectionApi = {
  save: () => Promise<{ ok: boolean; error?: string }>;
  isDirty: () => boolean;
};

export function BusinessHoursSection({
  title = "Business Hours",
  compact = false,
  embedded = false,
  onSaved,
  onLoaded,
  onDirtyChange,
  registerApi
}: {
  title?: string;
  compact?: boolean;
  /**
   * Embedded mode (Agent Setup): the internal Save button is hidden and the
   * parent saves through registerApi — one page-level save experience.
   * Standalone mode (Business Settings, onboarding) keeps its own button.
   */
  embedded?: boolean;
  onSaved?: (data: BusinessHoursData) => void;
  /** Fires with the server state on initial load (summary for parent UIs). */
  onLoaded?: (data: BusinessHoursData) => void;
  onDirtyChange?: (dirty: boolean) => void;
  registerApi?: (api: EmbeddedSectionApi | null) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [week, setWeek] = useState<BusinessHoursDayInput[]>(WEEK_DAYS.map(DEFAULT_DAY));
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [specialDates, setSpecialDates] = useState<BusinessSpecialHoursInput[]>([]);
  const [configured, setConfigured] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [liveAssistant, setLiveAssistant] = useState(false);
  const [sync, setSync] = useState<BusinessHoursSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [openStatusText, setOpenStatusText] = useState("");
  const [suggestion, setSuggestion] = useState<BusinessHoursData["suggestion"]>(null);

  const applyServerData = useCallback((data: BusinessHoursData) => {
    setWeek(normalizeWeek(data.hours));
    setTimeZone(data.timeZone || "America/New_York");
    setSpecialDates(data.specialDates ?? []);
    setConfigured(data.configured);
    setConfirmedAt(data.confirmedAt);
    setLiveAssistant(data.liveAssistant);
    setOpenStatusText(data.openStatus?.description ?? "");
    setSuggestion(data.suggestion ?? null);
    if (data.sync) setSync(data.sync);
    setDirty(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    getBusinessHours().then((response) => {
      if (!mounted) return;
      if (response.success && response.data) {
        applyServerData(response.data);
        onLoaded?.(response.data);
      } else {
        setError(response.error ?? "Could not load Business Hours");
      }
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, [applyServerData]);

  // Unsaved-change warning on tab close / navigation away. In embedded mode
  // the parent page owns this warning (one warning, not two).
  useEffect(() => {
    if (!dirty || embedded) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, embedded]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const dayErrors = useMemo(() => week.map(validateDay), [week]);
  const hasErrors = dayErrors.some(Boolean);

  function patchDay(day: BusinessHoursWeekday, patch: Partial<BusinessHoursDayInput>) {
    setWeek((current) => current.map((row) => (row.day === day ? { ...row, ...patch } : row)));
    setDirty(true);
    setStatusMsg("");
  }

  function patchPeriod(day: BusinessHoursWeekday, index: number, key: "open" | "close", value: string) {
    setWeek((current) =>
      current.map((row) =>
        row.day === day
          ? {
              ...row,
              periods: row.periods.map((period, i) => (i === index ? { ...period, [key]: value } : period))
            }
          : row
      )
    );
    setDirty(true);
    setStatusMsg("");
  }

  function addPeriod(day: BusinessHoursWeekday) {
    setWeek((current) =>
      current.map((row) => {
        if (row.day !== day) return row;
        const last = row.periods[row.periods.length - 1];
        // "Add break" and "add another period" are the same act: the gap
        // between two periods IS the break.
        const next = last ? { open: last.close, close: "18:00" } : { open: "09:00", close: "17:00" };
        return { ...row, periods: [...row.periods, next] };
      })
    );
    setDirty(true);
  }

  function removePeriod(day: BusinessHoursWeekday, index: number) {
    setWeek((current) =>
      current.map((row) =>
        row.day === day ? { ...row, periods: row.periods.filter((_, i) => i !== index) } : row
      )
    );
    setDirty(true);
  }

  function copyMondayToWeekdays() {
    setWeek((current) => {
      const monday = current.find((row) => row.day === "monday");
      if (!monday) return current;
      return current.map((row) =>
        WEEKDAYS_MON_FRI.includes(row.day)
          ? { ...row, closed: monday.closed, periods: monday.periods.map((period) => ({ ...period })) }
          : row
      );
    });
    setDirty(true);
  }

  function applySuggestion() {
    if (!suggestion) return;
    setWeek((current) =>
      current.map((row) => {
        const suggested = suggestion.days[row.day];
        if (!suggested) return { ...row, closed: true, periods: [] };
        return suggested.closed
          ? { ...row, closed: true, periods: [] }
          : { ...row, closed: false, periods: [{ open: suggested.open, close: suggested.close }] };
      })
    );
    setDirty(true);
    setStatusMsg("Detected hours loaded — review and save to confirm them.");
  }

  function addSpecialDate() {
    setSpecialDates((current) => [
      ...current,
      { date: "", closed: true, periods: [], kind: "holiday" }
    ]);
    setDirty(true);
  }

  function patchSpecialDate(index: number, patch: Partial<BusinessSpecialHoursInput>) {
    setSpecialDates((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setDirty(true);
  }

  function removeSpecialDate(index: number) {
    setSpecialDates((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  }

  async function performSave(): Promise<{ ok: boolean; error?: string }> {
    setError("");
    setStatusMsg("");

    if (hasErrors) {
      const message = "Fix the highlighted day rows before saving.";
      setError(message);
      return { ok: false, error: message };
    }
    const dates = specialDates.filter((entry) => entry.date.trim());
    const seen = new Set<string>();
    for (const entry of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
        const message = `Special date "${entry.date}" must use YYYY-MM-DD.`;
        setError(message);
        return { ok: false, error: message };
      }
      if (seen.has(entry.date)) {
        const message = `Special date ${entry.date} is listed twice.`;
        setError(message);
        return { ok: false, error: message };
      }
      seen.add(entry.date);
    }

    setSaving(true);
    const response = await putBusinessHours({ hours: week, timeZone, specialDates: dates });
    setSaving(false);

    if (!response.success || !response.data) {
      const message = response.error ?? "Could not save Business Hours";
      setError(message);
      return { ok: false, error: message };
    }

    applyServerData(response.data);
    onSaved?.(response.data);
    setStatusMsg(
      response.data.sync?.status === "failed"
        ? "Hours saved, but the live agent was NOT updated — retry the sync below."
        : "Business Hours saved."
    );
    return { ok: true };
  }

  async function handleSave() {
    await performSave();
  }

  // Embedded mode: the parent page saves through this handle. The ref is
  // refreshed every render so the registered functions always see live state.
  const embeddedApiRef = useRef<EmbeddedSectionApi>({
    save: async () => ({ ok: true }),
    isDirty: () => false
  });
  embeddedApiRef.current = { save: performSave, isDirty: () => dirty };

  useEffect(() => {
    if (!registerApi) return;
    registerApi({
      save: () => embeddedApiRef.current.save(),
      isDirty: () => embeddedApiRef.current.isDirty()
    });
    return () => registerApi(null);
  }, [registerApi]);

  async function handleRetrySync() {
    setSyncing(true);
    const response = await syncBusinessHoursToLiveAgent();
    setSyncing(false);
    if (response.success && response.data) {
      setSync(response.data.sync);
      setStatusMsg(
        response.data.sync.status === "synced"
          ? "Live agent updated with the new hours."
          : response.data.sync.status === "failed"
            ? "Live agent update failed again — please retry."
            : ""
      );
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" data-testid="business-hours-loading">
        <p className="text-sm text-slate-500">Loading Business Hours…</p>
      </div>
    );
  }

  return (
    <section
      className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
      data-testid="business-hours-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold tracking-tight text-slate-900" data-testid="business-hours-title">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Days and times customers can reach you. Your AI answers open/closed questions from this schedule —
            no document upload needed.
          </p>
        </div>
        <span
          data-testid="business-hours-confirmation-status"
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            configured && confirmedAt
              ? "bg-green-50 text-green-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {configured && confirmedAt ? "Confirmed" : "Business Hours not configured"}
        </span>
      </div>

      {openStatusText ? (
        <p className="mt-2 text-xs text-slate-500" data-testid="business-hours-open-status">
          {openStatusText}
        </p>
      ) : null}

      {suggestion ? (
        <div
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
          data-testid="business-hours-suggestion"
        >
          <p className="text-sm font-semibold text-amber-800">
            We found opening hours in {suggestion.sourceFilename ?? "an uploaded document"}.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            They are only a suggestion — review, edit, and save to confirm them. Your documents never
            change confirmed hours on their own.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="business-hours-suggestion-apply"
              onClick={applySuggestion}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-600"
            >
              Load detected hours
            </button>
            <button
              type="button"
              data-testid="business-hours-suggestion-dismiss"
              onClick={() => setSuggestion(null)}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-100"
            >
              Ignore
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-slate-600" htmlFor="business-hours-timezone">
          Timezone
        </label>
        <select
          id="business-hours-timezone"
          data-testid="business-hours-timezone-select"
          value={timeZone}
          onChange={(event) => {
            setTimeZone(event.target.value);
            setDirty(true);
          }}
          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-slate-700"
        >
          {[timeZone, ...COMMON_TIMEZONES.filter((zone) => zone !== timeZone)].map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>

        <button
          type="button"
          data-testid="business-hours-copy-monday"
          onClick={copyMondayToWeekdays}
          className="ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-gray-50"
        >
          Apply Monday to Mon–Fri
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {week.map((day, dayIndex) => (
          <div
            key={day.day}
            data-testid={`business-hours-day-${day.day}`}
            className={`rounded-xl border p-3 ${dayErrors[dayIndex] ? "border-red-200 bg-red-50/40" : "border-gray-100"}`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex w-28 items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  data-testid={`business-hours-open-toggle-${day.day}`}
                  checked={!day.closed}
                  onChange={(event) =>
                    patchDay(day.day, {
                      closed: !event.target.checked,
                      periods:
                        event.target.checked && day.periods.length === 0
                          ? [{ open: "09:00", close: "17:00" }]
                          : day.periods
                    })
                  }
                  className="h-4 w-4 accent-amber-500"
                />
                {DAY_LABELS[day.day]}
              </label>

              {day.closed ? (
                <span className="text-sm text-slate-400">Closed</span>
              ) : (
                <div className="flex flex-1 flex-col gap-2">
                  {day.periods.map((period, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        data-testid={`business-hours-open-${day.day}-${index}`}
                        value={period.open}
                        onChange={(event) => patchPeriod(day.day, index, "open", event.target.value)}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                      />
                      <span className="text-xs text-slate-400">to</span>
                      <input
                        type="time"
                        data-testid={`business-hours-close-${day.day}-${index}`}
                        value={period.close}
                        onChange={(event) => patchPeriod(day.day, index, "close", event.target.value)}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                      />
                      {day.periods.length > 1 ? (
                        <button
                          type="button"
                          data-testid={`business-hours-remove-period-${day.day}-${index}`}
                          onClick={() => removePeriod(day.day, index)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-50"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      data-testid={`business-hours-add-period-${day.day}`}
                      onClick={() => addPeriod(day.day)}
                      className="text-xs font-semibold text-amber-600 transition hover:text-amber-700"
                    >
                      + Add break / second period
                    </button>
                    {!compact ? (
                      <input
                        type="text"
                        data-testid={`business-hours-note-${day.day}`}
                        value={day.note ?? ""}
                        placeholder="Note (e.g. Emergency appointments only)"
                        onChange={(event) => patchDay(day.day, { note: event.target.value || undefined })}
                        className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-slate-600"
                      />
                    ) : null}
                  </div>
                </div>
              )}
            </div>
            {dayErrors[dayIndex] ? (
              <p className="mt-1 text-xs font-semibold text-red-600" data-testid={`business-hours-error-${day.day}`}>
                {dayErrors[dayIndex]}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {!compact ? (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-800">Holidays &amp; special dates</h4>
            <button
              type="button"
              data-testid="business-hours-add-special"
              onClick={addSpecialDate}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-gray-50"
            >
              + Add date
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            These override the weekly schedule for one date — holiday closures, early closing, temporary closures.
          </p>
          <div className="mt-2 space-y-2">
            {specialDates.map((entry, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 p-3" data-testid={`business-hours-special-${index}`}>
                <input
                  type="date"
                  data-testid={`business-hours-special-date-${index}`}
                  value={entry.date}
                  onChange={(event) => patchSpecialDate(index, { date: event.target.value })}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                />
                <select
                  value={entry.kind}
                  data-testid={`business-hours-special-kind-${index}`}
                  onChange={(event) =>
                    patchSpecialDate(index, { kind: event.target.value as BusinessSpecialHoursInput["kind"] })
                  }
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-slate-700"
                >
                  <option value="holiday">Holiday</option>
                  <option value="special">Special hours</option>
                  <option value="closure">Temporary closure</option>
                </select>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    data-testid={`business-hours-special-closed-${index}`}
                    checked={entry.closed}
                    onChange={(event) =>
                      patchSpecialDate(index, {
                        closed: event.target.checked,
                        periods: event.target.checked
                          ? []
                          : entry.periods.length
                            ? entry.periods
                            : [{ open: "09:00", close: "13:00" }]
                      })
                    }
                    className="h-4 w-4 accent-amber-500"
                  />
                  Closed all day
                </label>
                {!entry.closed
                  ? entry.periods.map((period, periodIndex) => (
                      <span key={periodIndex} className="flex items-center gap-1">
                        <input
                          type="time"
                          value={period.open}
                          onChange={(event) =>
                            patchSpecialDate(index, {
                              periods: entry.periods.map((p, i) =>
                                i === periodIndex ? { ...p, open: event.target.value } : p
                              )
                            })
                          }
                          className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                        />
                        <span className="text-xs text-slate-400">–</span>
                        <input
                          type="time"
                          value={period.close}
                          onChange={(event) =>
                            patchSpecialDate(index, {
                              periods: entry.periods.map((p, i) =>
                                i === periodIndex ? { ...p, close: event.target.value } : p
                              )
                            })
                          }
                          className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                        />
                      </span>
                    ))
                  : null}
                <input
                  type="text"
                  data-testid={`business-hours-special-note-${index}`}
                  value={entry.note ?? ""}
                  placeholder="Note (optional)"
                  onChange={(event) => patchSpecialDate(index, { note: event.target.value || undefined })}
                  className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-slate-600"
                />
                <button
                  type="button"
                  data-testid={`business-hours-special-remove-${index}`}
                  onClick={() => removeSpecialDate(index)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 rounded-xl bg-gray-50 p-3" data-testid="business-hours-weekly-summary">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Weekly schedule preview</p>
        <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
          {summarizeWeek(week).map((line) => (
            <li key={line} data-testid="business-hours-summary-line">
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!embedded ? (
          <button
            type="button"
            data-testid="business-hours-save"
            onClick={handleSave}
            disabled={saving || hasErrors}
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Business Hours"}
          </button>
        ) : null}

        {dirty ? (
          <span className="text-xs font-semibold text-amber-600" data-testid="business-hours-unsaved">
            Unsaved changes
          </span>
        ) : null}

        {liveAssistant && sync ? (
          <span
            data-testid="business-hours-sync-status"
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              sync.status === "synced"
                ? "bg-green-50 text-green-700"
                : sync.status === "failed"
                  ? "bg-red-50 text-red-600"
                  : "bg-gray-100 text-slate-500"
            }`}
          >
            {sync.status === "synced"
              ? "Live agent updated"
              : sync.status === "failed"
                ? "Live agent NOT updated"
                : "No live agent yet"}
          </span>
        ) : null}

        {liveAssistant && sync?.status === "failed" ? (
          <button
            type="button"
            data-testid="business-hours-sync-retry"
            onClick={handleRetrySync}
            disabled={syncing}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
          >
            {syncing ? "Retrying…" : "Retry live update"}
          </button>
        ) : null}
      </div>

      {statusMsg ? (
        <p className="mt-2 text-sm font-semibold text-green-700" data-testid="business-hours-status-msg">
          {statusMsg}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm font-semibold text-red-600" data-testid="business-hours-error-msg">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Read-only weekly summary — for the go-live review and test summaries. */
export function BusinessHoursSummary({ testIdPrefix = "business-hours-review" }: { testIdPrefix?: string }) {
  const [data, setData] = useState<BusinessHoursData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getBusinessHours().then((response) => {
      if (!mounted) return;
      if (response.success && response.data) setData(response.data);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return null;

  if (!data?.configured) {
    return (
      <p className="text-xs font-semibold text-amber-700" data-testid={`${testIdPrefix}-not-configured`}>
        Business Hours not configured — your AI will say hours are not confirmed. Add them in the Business step
        or Business Settings.
      </p>
    );
  }

  return (
    <div data-testid={`${testIdPrefix}-summary`}>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Business Hours ({data.timeZone})
      </p>
      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
        {(data.weeklySummary ?? []).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
