"use client";

/**
 * THE CONDITION'S LIMITS — the admin's half of the node.
 *
 * The architect names the roads; the platform decides how many they may have.
 * Nothing used to say no, so one step could grow twelve ways out — a flowchart
 * nobody can read, twelve prompts the AI door has to choose between, and twelve
 * chances to send a real customer somewhere nobody meant.
 *
 * One number, because there is exactly one decision here. A screen with one
 * setting on it is not a thin screen; it is an honest one.
 */

import { useCallback, useEffect, useState } from "react";
import { getConditionLimits, saveConditionLimits } from "@/components/admin/features/api";

export function ConditionLimitsPanel() {
  const [maxRoads, setMaxRoads] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getConditionLimits().then((response) => {
      if (!alive) return;
      if (response.success && response.data) setMaxRoads(response.data.maxRoads);
      else setProblem("This setting could not be loaded. Refresh the page to try again.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: number) => {
    setMaxRoads(next);
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const response = await saveConditionLimits(next);
    setSaving(false);
    if (response.success && response.data) {
      setMaxRoads(response.data.maxRoads);
      setSaved(true);
      return;
    }
    setProblem(response.error ?? "That could not be saved. Try again.");
  }, []);

  if (maxRoads === null) {
    return (
      <p className="text-sm text-slate-500" data-testid="condition-limits-loading">
        {problem ?? "Loading…"}
      </p>
    );
  }

  return (
    <div data-testid="condition-limits-panel">
      <p className="mb-1 text-sm font-semibold text-slate-900">Limits</p>
      <p className="mb-3 text-[12px] leading-5 text-slate-500">
        Architects name the roads out of a Condition. This is how many they may have.
      </p>

      <div className="flex items-start justify-between gap-6 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Most roads out</p>
          <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
            Anything else is always there on top of these, so nothing is ever lost. More roads than
            this and the step is really two steps.
          </p>
        </div>
        <select
          className="h-9 shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-amber-400"
          data-testid="condition-max-roads"
          value={String(maxRoads)}
          onChange={(event) => void save(Number(event.target.value))}
          disabled={saving}
        >
          {[2, 4, 6, 8, 10, 12, 16, 20].map((count) => (
            <option key={count} value={count}>
              {count} roads
            </option>
          ))}
        </select>
      </div>

      {problem ? (
        <p className="text-[12px] text-red-600" data-testid="condition-limits-problem">
          {problem}
        </p>
      ) : saved ? (
        <p className="text-[12px] text-emerald-700" data-testid="condition-limits-saved">
          Saved. Builders pick this up within a minute.
        </p>
      ) : null}
    </div>
  );
}
