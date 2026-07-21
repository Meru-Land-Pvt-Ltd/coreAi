"use client";

import { useId } from "react";
import type { ApptNumberField } from "./appointment-hours-editor";

export type BookingRulesValues = Record<ApptNumberField, number>;

export type BookingRulesValidation = {
  /** Per-field blocking errors (empty object = valid). */
  errors: Partial<Record<ApptNumberField, string>>;
  /** True when the configuration can be saved. */
  valid: boolean;
  intervalConflict: { occupiedMinutes: number; recommendedMinutes: number } | null;
};

const RULE_BOUNDS: Record<ApptNumberField, { min: number; max: number; label: string }> = {
  defaultDurationMinutes: { min: 5, max: 480, label: "Duration" },
  bufferMinutes: { min: 0, max: 120, label: "Buffer" },
  slotIntervalMinutes: { min: 5, max: 240, label: "Interval" },
  minNoticeMinutes: { min: 0, max: 10080, label: "Notice" },
  maxAdvanceDays: { min: 1, max: 365, label: "Booking window" },
  maxSpokenSuggestions: { min: 2, max: 10, label: "Suggestions" }
};

export function validateBookingRules(values: BookingRulesValues): BookingRulesValidation {
  const errors: Partial<Record<ApptNumberField, string>> = {};

  for (const key of Object.keys(RULE_BOUNDS) as ApptNumberField[]) {
    const bounds = RULE_BOUNDS[key];
    const value = values[key];
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
      errors[key] = `${bounds.label} must be a whole number between ${bounds.min} and ${bounds.max}.`;
    }
  }

let intervalConflict: BookingRulesValidation["intervalConflict"] = null;
  if (!errors.defaultDurationMinutes && !errors.bufferMinutes && !errors.slotIntervalMinutes) {
    const occupiedMinutes = values.defaultDurationMinutes + values.bufferMinutes;
    if (values.slotIntervalMinutes < occupiedMinutes) {
      const recommendedMinutes = Math.ceil(occupiedMinutes / 5) * 5;
      intervalConflict = { occupiedMinutes, recommendedMinutes };
      errors.slotIntervalMinutes = `Start-time interval is shorter than the ${occupiedMinutes}-minute appointment and buffer. Use at least ${occupiedMinutes} minutes; ${recommendedMinutes} minutes is recommended.`;
    }
  }

  return { errors, valid: Object.keys(errors).length === 0, intervalConflict };
}

/** "9:00" + minutes → "9:35" (display-only, 24h clock keeps it simple). */
function addMinutesLabel(startHour: number, startMinute: number, minutes: number): string {
  const total = startHour * 60 + startMinute + minutes;
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

const RULE_FIELDS: {
  key: ApptNumberField;
  label: string;
  unit: string;
  help: string;
}[] = [
  {
    key: "defaultDurationMinutes",
    label: "Appointment duration",
    unit: "minutes",
    help: "How long the actual appointment lasts."
  },
  {
    key: "bufferMinutes",
    label: "Buffer after appointment",
    unit: "minutes",
    help: "Reserved time after an appointment."
  },
  {
    key: "slotIntervalMinutes",
    label: "Available start times every",
    unit: "minutes",
    help: "How frequently potential start times are generated."
  },
  {
    key: "minNoticeMinutes",
    label: "Minimum booking notice",
    unit: "minutes",
    help: "How soon the next appointment may begin."
  },
  {
    key: "maxAdvanceDays",
    label: "Booking window",
    unit: "days ahead",
    help: "How far in advance customers can book."
  },
  {
    key: "maxSpokenSuggestions",
    label: "Suggestions per call",
    unit: "times",
    help: "Available times the agent offers in one response (2\u201310)."
  }
];

const PRESETS: { label: string; duration: number; interval: number }[] = [
  { label: "30 min appointment", duration: 30, interval: 30 },
  { label: "45 min appointment", duration: 45, interval: 45 },
  { label: "60 min appointment", duration: 60, interval: 60 }
];

export function BookingRulesPanel({
  values,
  validation,
  onField,
  confirmed,
  onConfirmed
}: {
  values: BookingRulesValues;
  validation: BookingRulesValidation;
  onField: (field: ApptNumberField, value: number) => void;
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
}) {
  const baseId = useId();
  const { errors, intervalConflict } = validation;

  // Example schedule preview from a 9:00 start.
  const previewApptEnd = addMinutesLabel(9, 0, values.defaultDurationMinutes || 0);
  const previewBufferEnd = addMinutesLabel(9, 0, (values.defaultDurationMinutes || 0) + (values.bufferMinutes || 0));
  const previewNextStart = addMinutesLabel(9, 0, Math.max(values.slotIntervalMinutes || 0, 0));

  function applyPreset(preset: (typeof PRESETS)[number]) {
onField("defaultDurationMinutes", preset.duration);
    onField("slotIntervalMinutes", Math.max(preset.interval, preset.duration + (values.bufferMinutes || 0)));
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-100 bg-white p-4" data-testid="business-setup-booking-rules">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Booking rules</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Booking rule presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              data-testid={`business-setup-booking-preset-${preset.duration}`}
              onClick={() => applyPreset(preset)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-amber-300 hover:bg-amber-50"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {RULE_FIELDS.map(({ key, label, unit, help }) => {
          const fieldError = errors[key];
          const inputId = `appt-${key}`;
          const helpId = `${baseId}-${key}-help`;
          const errorId = `${baseId}-${key}-error`;

          return (
            <div key={key}>
              <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-slate-600">
                {label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={inputId}
                  type="number"
                  min={RULE_BOUNDS[key].min}
                  max={RULE_BOUNDS[key].max}
                  step={1}
                  value={Number.isFinite(values[key]) ? values[key] : ""}
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    onField(key, e.target.value === "" || !Number.isFinite(parsed) ? Number.NaN : parsed);
                  }}
                  aria-describedby={fieldError ? errorId : helpId}
                  aria-invalid={fieldError ? true : undefined}
                  data-testid={`business-setup-appt-field-${key}`}
                  className={`field w-24 rounded-lg border bg-white px-3 py-2 text-sm tabular-nums text-slate-800 outline-none ${
                    fieldError ? "border-rose-300 bg-rose-50/40" : "border-gray-200"
                  }`}
                />
                <span className="text-xs text-slate-500">{unit}</span>
              </div>
              <p id={helpId} className="mt-1 text-xs text-slate-400">
                {help}
              </p>
              {fieldError && key !== "slotIntervalMinutes" ? (
                <p id={errorId} role="alert" className="mt-1 text-xs font-semibold text-rose-600">
                  {fieldError}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {intervalConflict ? (
        <div
          role="alert"
          id={`${baseId}-slotIntervalMinutes-error`}
          className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2.5"
          data-testid="business-setup-booking-interval-warning"
        >
          <p className="text-xs font-semibold text-rose-700">
            Start-time interval is shorter than the {intervalConflict.occupiedMinutes}-minute appointment and
            buffer. Use at least {intervalConflict.occupiedMinutes} minutes;{" "}
            {intervalConflict.recommendedMinutes} minutes is recommended.
          </p>
          <button
            type="button"
            data-testid="business-setup-booking-interval-fix"
            onClick={() => onField("slotIntervalMinutes", intervalConflict.recommendedMinutes)}
            className="mt-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
          >
            Use {intervalConflict.recommendedMinutes} minutes
          </button>
        </div>
      ) : errors.slotIntervalMinutes ? (
        <p
          role="alert"
          id={`${baseId}-slotIntervalMinutes-error`}
          className="mt-3 text-xs font-semibold text-rose-600"
        >
          {errors.slotIntervalMinutes}
        </p>
      ) : null}

      <div className="mt-3 rounded-lg bg-slate-50 px-3.5 py-2.5" data-testid="business-setup-booking-preview">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Example schedule</p>
        <ul className="mt-1 space-y-0.5 text-xs tabular-nums text-slate-600">
          <li>9:00 appointment</li>
          <li>{previewApptEnd} appointment ends</li>
          <li>{previewBufferEnd} buffer ends</li>
          <li>Next start: {previewNextStart}</li>
        </ul>
      </div>

      <label className="mt-4 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmed(e.target.checked)}
          data-testid="business-setup-appt-confirm"
          className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
        />
        I have reviewed these booking rules
      </label>
    </div>
  );
}
