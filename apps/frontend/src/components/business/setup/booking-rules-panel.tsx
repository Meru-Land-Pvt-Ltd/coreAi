"use client";

import { useId } from "react";
import type { ApptNumberField } from "./appointment-hours-editor";
import { LABEL, SECTION_TITLE } from "./ui";
import { InfoTooltip } from "./InfoTooltip";

const RULE_DESCRIPTIONS: Record<ApptNumberField, string> = {
  defaultDurationMinutes: "The duration of each booked appointment session.",
  bufferMinutes: "The required gap or breathing room between consecutive appointments.",
  minNoticeMinutes: "The minimum lead time required before a booking can take place.",
  maxAdvanceDays: "How far into the future a slot can be booked."
};

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
  minNoticeMinutes: { min: 0, max: 10080, label: "Notice" },
  maxAdvanceDays: { min: 1, max: 365, label: "Booking window" }
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

  return { errors, valid: Object.keys(errors).length === 0, intervalConflict: null };
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
}[] = [
  {
    key: "defaultDurationMinutes",
    label: "Duration",
    unit: "mins"
  },
  {
    key: "bufferMinutes",
    label: "Buffer Time",
    unit: "mins"
  },
  {
    key: "minNoticeMinutes",
    label: "Min Notice",
    unit: "mins"
  },
  {
    key: "maxAdvanceDays",
    label: "Max Advance",
    unit: "days"
  }
];

const PRESETS: { label: string; duration: number }[] = [
  { label: "30 min", duration: 30 },
  { label: "45 min", duration: 45 },
  { label: "60 min", duration: 60 }
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
  const { errors } = validation;

  function applyPreset(preset: (typeof PRESETS)[number]) {
    onField("defaultDurationMinutes", preset.duration);
  }

  return (
    <div className="mt-6 pt-5 border-t border-gray-100" data-testid="business-setup-booking-rules">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h4 className={`${SECTION_TITLE} inline-flex items-center`}>
          Booking rules
          <InfoTooltip content="Configure booking limits, buffer times, minimum notices, and maximum advance booking periods." />
        </h4>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-4">
        {RULE_FIELDS.map(({ key, label, unit }) => {
          const fieldError = errors[key];
          const inputId = `appt-${key}`;
          const errorId = `${baseId}-${key}-error`;

          return (
            <div key={key} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
              <label htmlFor={inputId} className={`${LABEL} inline-flex items-center gap-1`}>
                {label}
                <InfoTooltip content={RULE_DESCRIPTIONS[key]} />
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
                  aria-describedby={fieldError ? errorId : undefined}
                  aria-invalid={fieldError ? true : undefined}
                  data-testid={`business-setup-appt-field-${key}`}
                  className={`field w-full rounded-lg border bg-white px-2.5 py-1 text-xs tabular-nums text-slate-800 outline-none transition focus:border-amber-500 ${
                    fieldError ? "border-rose-300 bg-rose-50/40" : "border-gray-200"
                  }`}
                />
                <span className="shrink-0 text-xs font-medium text-slate-500">{unit}</span>
              </div>
              {fieldError ? (
                <p id={errorId} role="alert" className="mt-1 text-[11px] font-semibold text-rose-600">
                  {fieldError}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
