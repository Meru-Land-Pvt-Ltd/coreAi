"use client";

/**
 * THE TIMER'S FLOOR — how fast any agent may wake itself.
 *
 * One number for the whole platform. An agent waking every minute is a bill
 * with nobody watching it; the shipped floor is an hour, and this dial can
 * tighten it to 15 minutes for a platform that trusts its architects — never
 * below.
 */

import { useCallback, useEffect, useState } from "react";
import { getTimerLimits, saveTimerLimits } from "@/components/admin/features/api";

const CHOICES = [
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 240, label: "Every 4 hours" },
  { value: 1440, label: "Once a day" }
];

export function TimerLimitsPanel() {
  const [floorMinutes, setFloorMinutes] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getTimerLimits().then((response) => {
      if (!alive) return;
      if (response.success && response.data) setFloorMinutes(response.data.floorMinutes);
      else setProblem("This setting could not be loaded. Refresh the page to try again.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: number) => {
    setFloorMinutes(next);
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const response = await saveTimerLimits(next);
    setSaving(false);
    if (response.success && response.data) {
      setFloorMinutes(response.data.floorMinutes);
      setSaved(true);
      return;
    }
    setProblem(response.error ?? "That could not be saved. Try again.");
  }, []);

  if (floorMinutes === null) {
    return <p className="text-sm text-slate-500">{problem ?? "Loading…"}</p>;
  }

  return (
    <div data-testid="timer-limits-panel">
      <p className="mb-1 text-sm font-semibold text-slate-900">Limits</p>
      <div className="flex items-start justify-between gap-6 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Fastest wake-up</p>
          <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
            No Timer on the platform may run faster than this, whatever an architect picks.
          </p>
        </div>
        <select
          className="h-9 shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-amber-400"
          data-testid="timer-floor-select"
          value={String(floorMinutes)}
          onChange={(event) => void save(Number(event.target.value))}
          disabled={saving}
        >
          {CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
      {problem ? (
        <p className="text-[12px] text-red-600">{problem}</p>
      ) : saved ? (
        <p className="text-[12px] text-emerald-700" data-testid="timer-limits-saved">
          Saved. Every Timer obeys this within a minute.
        </p>
      ) : null}
    </div>
  );
}
