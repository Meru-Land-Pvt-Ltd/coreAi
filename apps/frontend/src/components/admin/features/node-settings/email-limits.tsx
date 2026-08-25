"use client";

/**
 * SEND EMAIL'S CEILING — the cannon guard.
 *
 * A Loop wired into the email hand could send a mail per item, per round.
 * Twenty-five in one run is already a campaign, not a notification — and a
 * refused mail is recoverable where a sent campaign is not.
 */

import { useCallback, useEffect, useState } from "react";
import { getEmailLimits, saveEmailLimits } from "@/components/admin/features/api";

export function EmailLimitsPanel() {
  const [maxPerRun, setMaxPerRun] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getEmailLimits().then((response) => {
      if (!alive) return;
      if (response.success && response.data) setMaxPerRun(response.data.maxPerRun);
      else setProblem("This setting could not be loaded. Refresh the page to try again.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: number) => {
    setMaxPerRun(next);
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const response = await saveEmailLimits(next);
    setSaving(false);
    if (response.success && response.data) {
      setMaxPerRun(response.data.maxPerRun);
      setSaved(true);
      return;
    }
    setProblem(response.error ?? "That could not be saved. Try again.");
  }, []);

  if (maxPerRun === null) {
    return <p className="text-sm text-slate-500">{problem ?? "Loading…"}</p>;
  }

  return (
    <div data-testid="email-limits-panel">
      <p className="mb-1 text-sm font-semibold text-slate-900">Limits</p>
      <div className="flex items-start justify-between gap-6 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Most emails in one run</p>
          <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
            Past this, the run says so in a sentence and stops sending. A refused mail is
            recoverable; a sent campaign is not.
          </p>
        </div>
        <select
          className="h-9 shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-amber-400"
          data-testid="email-max-per-run"
          value={String(maxPerRun)}
          onChange={(event) => void save(Number(event.target.value))}
          disabled={saving}
        >
          {[5, 10, 25, 50, 100, 200].map((count) => (
            <option key={count} value={count}>
              {count} emails
            </option>
          ))}
        </select>
      </div>
      {problem ? (
        <p className="text-[12px] text-red-600">{problem}</p>
      ) : saved ? (
        <p className="text-[12px] text-emerald-700" data-testid="email-limits-saved">
          Saved. Every run obeys this within a minute.
        </p>
      ) : null}
    </div>
  );
}
