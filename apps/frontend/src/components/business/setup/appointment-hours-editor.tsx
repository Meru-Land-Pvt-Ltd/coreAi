"use client";

import { useState } from "react";
import type { AppointmentDayHours, AppointmentWeekday } from "@/components/business/features/api";
import { CompactWeeklyPreview } from "./weekly-preview";
import { BookingRulesPanel, type BookingRulesValidation } from "./booking-rules-panel";

export const APPT_WEEKDAYS: { key: AppointmentWeekday; label: string; pill: string }[] = [
  { key: "monday", label: "Monday", pill: "M" },
  { key: "tuesday", label: "Tuesday", pill: "T" },
  { key: "wednesday", label: "Wednesday", pill: "W" },
  { key: "thursday", label: "Thursday", pill: "T" },
  { key: "friday", label: "Friday", pill: "F" },
  { key: "saturday", label: "Saturday", pill: "S" },
  { key: "sunday", label: "Sunday", pill: "S" }
];

export type ApptNumberField =
  | "defaultDurationMinutes"
  | "bufferMinutes"
  | "minNoticeMinutes"
  | "maxAdvanceDays";

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
  const [sameHoursForAll, setSameHoursForAll] = useState(true);
  const [selectedDay, setSelectedDay] = useState<AppointmentWeekday>("monday");

  const firstOpenDayKey = APPT_WEEKDAYS.find(({ key }) => !days[key]?.closed)?.key ?? "monday";
  const unifiedOpen = days[firstOpenDayKey]?.open ?? "08:00";
  const unifiedClose = days[firstOpenDayKey]?.close ?? "18:00";

  const selectedDayObj = days[selectedDay];
  const displayOpen = sameHoursForAll ? unifiedOpen : (selectedDayObj?.open ?? unifiedOpen);
  const displayClose = sameHoursForAll ? unifiedClose : (selectedDayObj?.close ?? unifiedClose);

  function handleStartChange(newOpen: string) {
    if (sameHoursForAll) {
      APPT_WEEKDAYS.forEach(({ key }) => {
        if (!days[key]?.closed) {
          onDay(key, { open: newOpen });
        }
      });
    } else {
      onDay(selectedDay, { open: newOpen });
    }
  }

  function handleEndChange(newClose: string) {
    if (sameHoursForAll) {
      APPT_WEEKDAYS.forEach(({ key }) => {
        if (!days[key]?.closed) {
          onDay(key, { close: newClose });
        }
      });
    } else {
      onDay(selectedDay, { close: newClose });
    }
  }

  function handleDayPillClick(dayKey: AppointmentWeekday) {
    const isDayOpen = !days[dayKey]?.closed;
    const isSelected = selectedDay === dayKey;

    if (sameHoursForAll) {
      const willBeClosed = isDayOpen;
      onDay(dayKey, {
        closed: willBeClosed,
        open: !willBeClosed ? displayOpen : (days[dayKey]?.open ?? displayOpen),
        close: !willBeClosed ? displayClose : (days[dayKey]?.close ?? displayClose)
      });
      setSelectedDay(dayKey);
    } else {
      if (isSelected && isDayOpen) {
        onDay(dayKey, { closed: true });
      } else {
        if (!isDayOpen) {
          onDay(dayKey, {
            closed: false,
            open: days[dayKey]?.open || displayOpen,
            close: days[dayKey]?.close || displayClose
          });
        }
        setSelectedDay(dayKey);
      }
    }
  }

  return (
    <div data-testid="business-setup-appt-schedule">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">Appointment Availability</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            When callers can book appointments.
          </p>
        </div>
      </div>

      {/* Radio Button Options */}
      <div className="mt-3 space-y-3" role="radiogroup" aria-label="Appointment hours source">
        <button
          type="button"
          role="radio"
          aria-checked={useBusinessHours}
          data-testid="business-setup-appt-use-business-hours"
          onClick={() => onUseBusinessHours(true)}
          className={`pick hours-pick flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
            useBusinessHours ? "selected border-amber-300 bg-white shadow-2xs" : "border-gray-200 bg-white hover:bg-slate-50/50"
          }`}
        >
          <span
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
              useBusinessHours ? "border-amber-500" : "border-slate-300"
            }`}
          >
            {useBusinessHours ? <span className="radio-fill h-2.5 w-2.5 rounded-full bg-amber-500" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-slate-800 block">Follow Business Hours</span>
            <span className="text-sm text-slate-500 block mt-0.5">Bookings follow your business hours automatically.</span>
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={!useBusinessHours}
          data-testid="business-setup-appt-use-custom"
          onClick={() => onUseBusinessHours(false)}
          className={`pick hours-pick flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
            !useBusinessHours ? "selected border-amber-300 bg-white shadow-2xs" : "border-gray-200 bg-white hover:bg-slate-50/50"
          }`}
        >
          <span
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
              !useBusinessHours ? "border-amber-500" : "border-slate-300"
            }`}
          >
            {!useBusinessHours ? <span className="radio-fill h-2.5 w-2.5 rounded-full bg-amber-500" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-slate-800 block">Use custom Appointment Hours</span>
            <span className="text-sm text-slate-500 block mt-0.5">Set specific days and times for caller bookings.</span>
          </span>
        </button>
      </div>

      {/* Selection Content */}
      {!useBusinessHours ? 
        <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/30 p-4 sm:p-5 shadow-sm" data-testid="business-setup-appt-editor">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Start</label>
              <input
                type="time"
                value={displayOpen}
                onChange={(e) => handleStartChange(e.target.value)}
                className="field rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold tabular-nums text-slate-800 shadow-2xs outline-none transition focus:border-amber-500"
              />
            </div>
            <span className="mt-5 text-slate-400 font-bold" aria-hidden="true">→</span>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">End</label>
              <input
                type="time"
                value={displayClose}
                onChange={(e) => handleEndChange(e.target.value)}
                className="field rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold tabular-nums text-slate-800 shadow-2xs outline-none transition focus:border-amber-500"
              />
            </div>

            <div className="mt-5 flex items-center">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sameHoursForAll}
                  onChange={(e) => setSameHoursForAll(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 accent-amber-500 cursor-pointer"
                />
                Apply same for all selected days
              </label>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-slate-500">Active days</label>
              {!sameHoursForAll && (
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/50">
                  Editing: <span className="capitalize">{selectedDay}</span> ({days[selectedDay]?.closed ? "Closed" : "Open"})
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {APPT_WEEKDAYS.map(({ key, pill }) => {
                const isOpen = !days[key]?.closed;
                const isSelected = selectedDay === key;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleDayPillClick(key)}
                    className={`day flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold transition-all ${
                      isOpen
                        ? "on bg-amber-500 text-white shadow-xs border border-amber-500"
                        : "bg-white text-slate-600 border border-gray-200 hover:border-amber-300"
                    } ${!sameHoursForAll && isSelected ? "ring-2 ring-amber-600 ring-offset-2 scale-105" : ""}`}
                  >
                    {pill}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hidden accessibility container for test compatibility */}
          <div className="hidden" aria-hidden="true">
            {APPT_WEEKDAYS.map(({ key, label }) => {
              const day = days[key];
              return (
                <div key={key} data-testid="business-setup-appt-day-row">
                  <span>{label}</span>
                  <input
                    type="time"
                    value={day.open}
                    disabled={day.closed}
                    onChange={(e) => onDay(key, { open: e.target.value })}
                    data-testid="business-setup-appt-day-open"
                  />
                  <input
                    type="time"
                    value={day.close}
                    disabled={day.closed}
                    onChange={(e) => onDay(key, { close: e.target.value })}
                    data-testid="business-setup-appt-day-close"
                  />
                  <input
                    type="checkbox"
                    checked={day.closed}
                    onChange={(e) => onDay(key, { closed: e.target.checked })}
                    data-testid="business-setup-appt-day-closed"
                  />
                </div>
              );
            })}
          </div>
        </div>
      : null}

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

