"use client";

/**
 * THE LOOP'S LIMIT — the platform's runaway-bill guard.
 *
 * An architect picks up to 25 rounds on the node; this is the ceiling above
 * every node. One number, because every round of every loop can be an AI call,
 * and a pasted spreadsheet must never become an invoice.
 */

import { useCallback, useEffect, useState } from "react";
import { getLoopLimits, saveLoopLimits } from "@/components/admin/features/api";

export function LoopLimitsPanel() {
  const [maxRounds, setMaxRounds] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getLoopLimits().then((response) => {
      if (!alive) return;
      if (response.success && response.data) setMaxRounds(response.data.maxRounds);
      else setProblem("This setting could not be loaded. Refresh the page to try again.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: number) => {
    setMaxRounds(next);
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const response = await saveLoopLimits(next);
    setSaving(false);
    if (response.success && response.data) {
      setMaxRounds(response.data.maxRounds);
      setSaved(true);
      return;
    }
    setProblem(response.error ?? "That could not be saved. Try again.");
  }, []);

  if (maxRounds === null) {
    return <p className="text-sm text-slate-500">{problem ?? "Loading…"}</p>;
  }

  return (
    <div data-testid="loop-limits-panel">
      <p className="mb-1 text-sm font-semibold text-slate-900">Limits</p>
      <div className="flex items-start justify-between gap-6 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Most rounds per run</p>
          <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
            The ceiling above every Loop on the platform. Every round can cost an AI call.
          </p>
        </div>
        <select
          className="h-9 shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-amber-400"
          data-testid="loop-max-rounds"
          value={String(maxRounds)}
          onChange={(event) => void save(Number(event.target.value))}
          disabled={saving}
        >
          {[5, 10, 25, 50, 100].map((count) => (
            <option key={count} value={count}>
              {count} rounds
            </option>
          ))}
        </select>
      </div>
      {problem ? (
        <p className="text-[12px] text-red-600">{problem}</p>
      ) : saved ? (
        <p className="text-[12px] text-emerald-700" data-testid="loop-limits-saved">
          Saved. Every Loop obeys this within a minute.
        </p>
      ) : null}
    </div>
  );
}
