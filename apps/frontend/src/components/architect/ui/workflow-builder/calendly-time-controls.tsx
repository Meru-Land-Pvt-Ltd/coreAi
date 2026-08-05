"use client";

import { useEffect, useMemo, useState } from "react";
import { COMMON_TIMEZONES } from "@coreai/shared";
import {
  CALENDLY_WINDOW_DURATION_OPTIONS,
  DEFAULT_CALENDLY_WINDOW_DURATION_MS,
  addMsToIso,
  datetimeLocalToIso,
  formatIsoForDisplay,
  groupAvailableSlotsByDay,
  inferWindowDurationMs,
  isoToDatetimeLocal,
  nowDatetimeLocalInZone
} from "./calendly-datetime";

const fldClass =
  "fld w-full cursor-pointer rounded-xl border border-gray-100 bg-gray-50/40 px-3.5 py-2.5 text-[14px] text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60";

const inspectorFldClass =
  "w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-400 transition-colors disabled:opacity-60";

function timezoneOptions(current: string) {
  if (!current.trim() || COMMON_TIMEZONES.some((option) => option.value === current)) {
    return COMMON_TIMEZONES;
  }
  return [{ value: current, label: current }, ...COMMON_TIMEZONES];
}

export function CalendlyTimezoneSelect({
  value,
  onChange,
  disabled = false,
  testId,
  variant = "test"
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId: string;
  variant?: "test" | "inspector";
}) {
  return (
    <select
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={variant === "test" ? fldClass : inspectorFldClass}
    >
      {timezoneOptions(value).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function CalendlyDatetimeLocalInput({
  valueIso,
  timeZone,
  onChangeIso,
  disabled = false,
  minIso,
  testId,
  variant = "test"
}: {
  valueIso: string;
  timeZone: string;
  onChangeIso: (iso: string) => void;
  disabled?: boolean;
  minIso?: string;
  testId: string;
  variant?: "test" | "inspector";
}) {
  const localValue = isoToDatetimeLocal(valueIso, timeZone);
  const minLocal = minIso ? isoToDatetimeLocal(minIso, timeZone) : undefined;

  return (
    <input
      data-testid={testId}
      type="datetime-local"
      value={localValue}
      min={minLocal || undefined}
      disabled={disabled}
      onChange={(event) => onChangeIso(datetimeLocalToIso(event.target.value, timeZone))}
      className={
        variant === "test"
          ? fldClass.replace("cursor-pointer ", "")
          : inspectorFldClass.replace("cursor-pointer ", "")
      }
    />
  );
}

/**
 * Teams-style range: pick start + duration; end is calculated automatically.
 */
export function CalendlyTeamsRangePicker({
  startValue,
  endValue,
  timeZone,
  onChange,
  disabled = false,
  requiredMark = false,
  testIdPrefix,
  variant = "test",
  valueMode = "iso",
  startLabel = "Start",
  durationLabel = "Duration"
}: {
  startValue: string;
  endValue: string;
  timeZone: string;
  onChange: (next: { start: string; end: string }) => void;
  disabled?: boolean;
  requiredMark?: boolean;
  testIdPrefix: string;
  variant?: "test" | "inspector";
  /** `iso` stores UTC ISO strings; `local` stores datetime-local wall times. */
  valueMode?: "iso" | "local";
  startLabel?: string;
  durationLabel?: string;
}) {
  const fieldClass = variant === "test" ? fldClass : inspectorFldClass;
  const labelClass =
    variant === "test"
      ? "mb-1.5 block text-[13px] font-semibold text-slate-700"
      : "mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500";

  const startIso =
    valueMode === "iso"
      ? startValue
      : startValue.trim()
        ? datetimeLocalToIso(startValue, timeZone)
        : "";
  const endIso =
    valueMode === "iso"
      ? endValue
      : endValue.trim()
        ? datetimeLocalToIso(endValue, timeZone)
        : "";

  const inferredDuration = useMemo(
    () =>
      startIso && endIso
        ? inferWindowDurationMs(startIso, endIso)
        : DEFAULT_CALENDLY_WINDOW_DURATION_MS,
    [startIso, endIso]
  );

  const [durationMs, setDurationMs] = useState(inferredDuration);

  useEffect(() => {
    setDurationMs(inferredDuration);
  }, [inferredDuration]);

  const activeDuration = durationMs;

  function emitRange(nextStartIso: string, nextDurationMs: number) {
    const nextEndIso = addMsToIso(nextStartIso, nextDurationMs);
    if (!nextStartIso || !nextEndIso) {
      onChange({ start: "", end: "" });
      return;
    }
    if (valueMode === "local") {
      onChange({
        start: isoToDatetimeLocal(nextStartIso, timeZone),
        end: isoToDatetimeLocal(nextEndIso, timeZone)
      });
      return;
    }
    onChange({ start: nextStartIso, end: nextEndIso });
  }

  function handleStartLocalChange(local: string) {
    const nextStartIso = local.trim() ? datetimeLocalToIso(local, timeZone) : "";
    if (!nextStartIso) {
      onChange({ start: "", end: "" });
      return;
    }
    emitRange(nextStartIso, activeDuration);
  }

  function handleDurationChange(nextMs: number) {
    setDurationMs(nextMs);
    const baseStartIso =
      startIso || datetimeLocalToIso(nowDatetimeLocalInZone(timeZone), timeZone);
    emitRange(baseStartIso, nextMs);
  }

  const displayEndIso = startIso ? addMsToIso(startIso, activeDuration) || endIso : endIso;
  const startLocal = startIso
    ? isoToDatetimeLocal(startIso, timeZone)
    : valueMode === "local"
      ? startValue
      : "";

  return (
    <div
      className={
        variant === "test" ? "col-span-1 grid gap-3 sm:col-span-2 sm:grid-cols-2" : "space-y-4"
      }
      data-testid={testIdPrefix}
    >
      <label data-testid={`${testIdPrefix}-start-label`}>
        <span className={labelClass}>
          {startLabel}
          {requiredMark ? <span className="font-bold text-amber-600"> *</span> : null}
        </span>
        <input
          data-testid={`${testIdPrefix}-start-input`}
          type="datetime-local"
          value={startLocal}
          disabled={disabled}
          onChange={(event) => handleStartLocalChange(event.target.value)}
          className={fieldClass.replace("cursor-pointer ", "")}
        />
      </label>

      <label data-testid={`${testIdPrefix}-duration-label`}>
        <span className={labelClass}>
          {durationLabel}
          {requiredMark ? <span className="font-bold text-amber-600"> *</span> : null}
        </span>
        <select
          data-testid={`${testIdPrefix}-duration-input`}
          value={String(activeDuration)}
          disabled={disabled}
          onChange={(event) => handleDurationChange(Number(event.target.value))}
          className={fieldClass}
        >
          {CALENDLY_WINDOW_DURATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div
        className={
          variant === "test"
            ? "col-span-1 rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-3 sm:col-span-2"
            : "rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5"
        }
        data-testid={`${testIdPrefix}-end-preview`}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ends</p>
        <p className="mt-0.5 text-[14px] font-medium text-slate-800">
          {displayEndIso ? formatIsoForDisplay(displayEndIso, timeZone) : "Pick a start time"}
        </p>
      </div>
    </div>
  );
}

export function CalendlyAvailableSlotButtons({
  options,
  value,
  onChange,
  timeZone,
  loading,
  disabled,
  emptyHint,
  error,
  testIdPrefix
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (iso: string) => void;
  timeZone: string;
  loading?: boolean;
  disabled?: boolean;
  emptyHint: string;
  error?: string | null;
  testIdPrefix: string;
}) {
  const groups = groupAvailableSlotsByDay(options, timeZone);

  if (loading) {
    return (
      <p className="text-[12px] text-slate-500" data-testid={`${testIdPrefix}-loading`}>
        Loading available times…
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="text-[12px] text-slate-500" data-testid={`${testIdPrefix}-empty`}>
        {emptyHint}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid={testIdPrefix}>
      {groups.map((group) => (
        <div key={group.dayKey} data-testid={`${testIdPrefix}-day-${group.dayKey}`}>
          <p className="mb-1.5 text-[12px] font-semibold text-slate-600">{group.dayLabel}</p>
          <div className="flex flex-wrap gap-2">
            {group.options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  title={option.label}
                  aria-pressed={selected}
                  data-testid={`${testIdPrefix}-slot`}
                  data-slot-value={option.value}
                  onClick={() => onChange(option.value)}
                  className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition disabled:opacity-60 ${
                    selected
                      ? "border-amber-500 bg-amber-500 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50"
                  }`}
                >
                  {option.timeLabel}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {error ? (
        <p className="text-[12px] text-rose-600" data-testid={`${testIdPrefix}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
