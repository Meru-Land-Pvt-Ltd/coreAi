"use client";

import type { AppointmentDayHours, AppointmentWeekday } from "@/components/business/features/api";

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

const APPT_NUMBER_FIELDS: { key: ApptNumberField; label: string; min: number }[] = [
  { key: "defaultDurationMinutes", label: "Appointment duration (min)", min: 5 },
  { key: "bufferMinutes", label: "Buffer between bookings (min)", min: 0 },
  { key: "slotIntervalMinutes", label: "Slot interval (min)", min: 5 },
  { key: "minNoticeMinutes", label: "Minimum notice (min)", min: 0 },
  { key: "maxAdvanceDays", label: "Book up to (days ahead)", min: 1 },
  { key: "maxSpokenSuggestions", label: "Times suggested per call", min: 1 }
];

export function AppointmentHoursEditor({
  useBusinessHours,
  onUseBusinessHours,
  businessHoursSummary,
  businessHoursConfigured,
  days,
  onDay,
  fields,
  onField,
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
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
}) {
  return (
    <div data-testid="business-setup-appt-schedule">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-800">Appointment Hours</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            When callers can book appointments. This never changes your Business Hours.
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

      <div className="mt-3 space-y-2" role="radiogroup" aria-label="Appointment hours source">
        <button
          type="button"
          role="radio"
          aria-checked={useBusinessHours}
          data-testid="business-setup-appt-use-business-hours"
          onClick={() => onUseBusinessHours(true)}
          className={`pick flex w-full items-start gap-3 rounded-xl border p-3.5 text-left ${
            useBusinessHours ? "selected" : "border-gray-200 bg-white"
          }`}
        >
          <span
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
              useBusinessHours ? "border-amber-500" : "border-slate-300"
            }`}
          >
            {useBusinessHours ? <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-800">Use Business Hours</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Appointments automatically follow your Business Hours — including future changes.
            </span>
          </span>
        </button>

        {useBusinessHours ? (
          <div
            className="rounded-xl border border-gray-100 bg-slate-50 px-4 py-3"
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
                Business Hours are not configured yet — set them above so callers are offered real times.
              </p>
            )}
          </div>
        ) : null}

        <button
          type="button"
          role="radio"
          aria-checked={!useBusinessHours}
          data-testid="business-setup-appt-use-custom"
          onClick={() => onUseBusinessHours(false)}
          className={`pick flex w-full items-start gap-3 rounded-xl border p-3.5 text-left ${
            !useBusinessHours ? "selected" : "border-gray-200 bg-white"
          }`}
        >
          <span
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
              !useBusinessHours ? "border-amber-500" : "border-slate-300"
            }`}
          >
            {!useBusinessHours ? <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-800">Use custom Appointment Hours</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Book appointments on different days or times than your Business Hours.
            </span>
          </span>
        </button>
      </div>

      {!useBusinessHours ? (
        <div className="mt-3 rounded-xl border border-gray-100 bg-slate-50 p-4" data-testid="business-setup-appt-editor">
          <div className="space-y-2">
            {APPT_WEEKDAYS.map(({ key, label }) => {
              const day = days[key];
              return (
                <div key={key} className="flex flex-wrap items-center gap-3" data-testid="business-setup-appt-day-row">
                  <span className="w-24 text-sm font-medium text-slate-700">{label}</span>
                  <input
                    type="time"
                    value={day.open}
                    disabled={day.closed}
                    aria-label={`${label} booking opens`}
                    onChange={(e) => onDay(key, { open: e.target.value })}
                    data-testid="business-setup-appt-day-open"
                    className="field rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none disabled:opacity-50"
                  />
                  <span className="text-slate-400" aria-hidden="true">
                    →
                  </span>
                  <input
                    type="time"
                    value={day.close}
                    disabled={day.closed}
                    aria-label={`${label} booking closes`}
                    onChange={(e) => onDay(key, { close: e.target.value })}
                    data-testid="business-setup-appt-day-close"
                    className="field rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none disabled:opacity-50"
                  />
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
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
        </div>
      ) : null}

      {/* Slot configuration applies to BOTH sources — duration, buffers, and
          notice windows matter even when the days follow Business Hours. */}
      <div className="mt-3 rounded-xl border border-gray-100 bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Booking rules</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {APPT_NUMBER_FIELDS.map(({ key, label, min }) => (
            <div key={key}>
              <label htmlFor={`appt-${key}`} className="mb-1 block text-xs font-medium text-slate-500">
                {label}
              </label>
              <input
                id={`appt-${key}`}
                type="number"
                min={min}
                value={fields[key]}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  onField(key, Number.isFinite(parsed) ? parsed : 0);
                }}
                data-testid={`business-setup-appt-field-${key}`}
                className="field w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
              />
            </div>
          ))}
        </div>

        <label className="mt-4 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => onConfirmed(e.target.checked)}
            data-testid="business-setup-appt-confirm"
            className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
          />
          Confirm these appointment settings
        </label>
      </div>
    </div>
  );
}
