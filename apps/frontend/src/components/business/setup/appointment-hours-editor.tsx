"use client";

import type { AppointmentDayHours, AppointmentWeekday } from "@/components/business/features/api";
import { BookingRulesPanel, type BookingRulesValidation } from "./booking-rules-panel";

export const APPT_WEEKDAYS: { key: AppointmentWeekday; label: string }[] = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" }
];

export type ApptNumberField =
  | "defaultDurationMinutes"
  | "bufferMinutes"
  | "slotIntervalMinutes"
  | "minNoticeMinutes"
  | "maxAdvanceDays"
  | "maxSpokenSuggestions";

export function AppointmentHoursEditor({
  useBusinessHours,
  onUseBusinessHours,
  businessHoursSummary,
  businessHoursConfigured,
  days,
  onDay,
  fields,
  onField,
  rulesValidation,
  confirmed,
  onConfirmed
}: {
  useBusinessHours: boolean;
  onUseBusinessHours: (value: boolean) => void;
  /** "Monday: 9 AM–5 PM" lines of the authoritative Business Hours (null = unconfigured). */
  businessHoursSummary: string[] | null;
  businessHoursConfigured: boolean;
  days: Record<AppointmentWeekday, AppointmentDayHours>;
  onDay: (day: AppointmentWeekday, patch: Partial<AppointmentDayHours>) => void;
  fields: Record<ApptNumberField, number>;
  onField: (field: ApptNumberField, value: number) => void;
  /** Page-level booking-rules validation — errors render inline here. */
  rulesValidation: BookingRulesValidation;
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
}) {
  return (
    <div data-testid="business-setup-appt-schedule">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Appointment Availability</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            When callers can book. Never changes your Business Hours.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            useBusinessHours ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"
          }`}
          data-testid="business-setup-appt-source"
        >
          {useBusinessHours ? "Using Business Hours" : "Custom Appointment Hours"}
        </span>
      </div>

      {/* Source — segmented choice. */}
      <div
        className="mt-3 grid grid-cols-1 gap-1 rounded-xl border border-gray-200 bg-slate-50 p-1 sm:grid-cols-2"
        role="radiogroup"
        aria-label="Appointment hours source"
      >
        <button
          type="button"
          role="radio"
          aria-checked={useBusinessHours}
          data-testid="business-setup-appt-use-business-hours"
          onClick={() => onUseBusinessHours(true)}
          className={`rounded-lg px-3 py-2 text-left transition ${
            useBusinessHours ? "bg-white shadow-sm ring-1 ring-amber-300" : "hover:bg-white/60"
          }`}
        >
          <span className={`block text-sm font-semibold ${useBusinessHours ? "text-slate-900" : "text-slate-600"}`}>
            Follow Business Hours
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">Bookings follow your hours automatically.</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!useBusinessHours}
          data-testid="business-setup-appt-use-custom"
          onClick={() => onUseBusinessHours(false)}
          className={`rounded-lg px-3 py-2 text-left transition ${
            !useBusinessHours ? "bg-white shadow-sm ring-1 ring-amber-300" : "hover:bg-white/60"
          }`}
        >
          <span className={`block text-sm font-semibold ${!useBusinessHours ? "text-slate-900" : "text-slate-600"}`}>
            Use custom Appointment Hours
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">Different days or times for bookings.</span>
        </button>
      </div>

      {useBusinessHours ? (
        <div
          className="mt-3 rounded-xl border border-gray-100 bg-slate-50 px-4 py-3"
          data-testid="business-setup-appt-inherited-summary"
        >
          {businessHoursConfigured && businessHoursSummary ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Appointments follow Business Hours
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {businessHoursSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs font-semibold text-amber-700" data-testid="business-setup-appt-inherit-unconfigured">
              Set your Business Hours above first so callers are offered real times.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-100 bg-white" data-testid="business-setup-appt-editor">
          {APPT_WEEKDAYS.map(({ key, label }) => {
            const day = days[key];
            return (
              <div
                key={key}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-100 px-3.5 py-2.5 last:border-b-0"
                data-testid="business-setup-appt-day-row"
              >
                <span className="w-28 shrink-0 text-sm font-semibold text-slate-700">{label}</span>
                <input
                  type="time"
                  value={day.open}
                  disabled={day.closed}
                  aria-label={`${label} booking opens`}
                  onChange={(e) => onDay(key, { open: e.target.value })}
                  data-testid="business-setup-appt-day-open"
                  className="field rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium tabular-nums text-slate-700 outline-none disabled:opacity-40"
                />
                <span className="text-xs text-slate-400" aria-hidden="true">
                  –
                </span>
                <input
                  type="time"
                  value={day.close}
                  disabled={day.closed}
                  aria-label={`${label} booking closes`}
                  onChange={(e) => onDay(key, { close: e.target.value })}
                  data-testid="business-setup-appt-day-close"
                  className="field rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium tabular-nums text-slate-700 outline-none disabled:opacity-40"
                />
                <label className="ml-auto flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <input
                    type="checkbox"
                    checked={day.closed}
                    aria-label={`${label} no bookings`}
                    onChange={(e) => onDay(key, { closed: e.target.checked })}
                    data-testid="business-setup-appt-day-closed"
                    className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                  />
                  No bookings
                </label>
              </div>
            );
          })}
        </div>
      )}

      {/* Booking rules apply to BOTH sources — duration, buffers, and notice
          windows matter even when the days follow Business Hours. */}
      <BookingRulesPanel
        values={fields}
        validation={rulesValidation}
        onField={onField}
        confirmed={confirmed}
        onConfirmed={onConfirmed}
      />
    </div>
  );
}
