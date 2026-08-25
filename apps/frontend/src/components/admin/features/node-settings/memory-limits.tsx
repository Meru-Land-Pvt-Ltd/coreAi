"use client";

/**
 * MEMORY'S LIMITS — the admin's half of the node.
 *
 * The architect owns the meaning: what an agent should always remember, and how
 * much of a conversation to keep. None of that is here, and it must never be.
 *
 * These four are the platform's: one legal, two that cost money on every single
 * answer of every agent, and one switch for when search by meaning is
 * unavailable. Every one of them was a constant compiled into the backend
 * until today, so changing how long a customer's words are kept meant a release.
 *
 * The defaults are exactly what the platform did before this screen existed. An
 * admin who never opens it sees no change whatsoever.
 */

import { useCallback, useEffect, useState } from "react";
import { getMemoryLimits, saveMemoryLimits, type MemoryLimits } from "@/components/admin/features/api";

const KEEP_FOR = [
  { value: 0, label: "Keep forever" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
  { value: 730, label: "2 years" }
];

function Row({
  name,
  what,
  children
}: {
  name: string;
  what: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-gray-100 py-4 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{name}</p>
        <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{what}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const SELECT =
  "h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-amber-400";

export function MemoryLimitsPanel() {
  const [limits, setLimits] = useState<MemoryLimits | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getMemoryLimits().then((response) => {
      if (!alive) return;
      if (response.success && response.data) setLimits(response.data.memoryLimits);
      else setProblem("These settings could not be loaded. Refresh the page to try again.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: MemoryLimits) => {
    // Shown immediately, then confirmed — an admin who has to wait a second to
    // see a dropdown move assumes it did not work and clicks it again.
    setLimits(next);
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const response = await saveMemoryLimits(next);
    setSaving(false);
    if (response.success && response.data) {
      setLimits(response.data.memoryLimits);
      setSaved(true);
      return;
    }
    setProblem(response.error ?? "That could not be saved. Try again.");
  }, []);

  if (!limits) {
    return (
      <p className="text-sm text-slate-500" data-testid="memory-limits-loading">
        {problem ?? "Loading…"}
      </p>
    );
  }

  const change = (patch: Partial<MemoryLimits>) => void save({ ...limits, ...patch });

  return (
    <div data-testid="memory-limits-panel">
      <p className="mb-1 text-sm font-semibold text-slate-900">Limits</p>
      <p className="mb-3 text-[12px] leading-5 text-slate-500">
        What the platform allows Memory to do. Architects decide what to remember; these decide how
        long it is kept and what it costs.
      </p>

      <Row
        name="How long it is kept"
        what="Memory older than this is deleted every night. A business that deletes a customer should not have their words left in a drawer."
      >
        <select
          className={SELECT}
          data-testid="memory-keep-for-days"
          value={String(limits.keepForDays)}
          onChange={(event) => change({ keepForDays: Number(event.target.value) })}
          disabled={saving}
        >
          {KEEP_FOR.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Row>

      <Row
        name="How much a brain reads per answer"
        what="More remembered pieces means better answers and a bigger bill, on every answer of every agent."
      >
        <select
          className={SELECT}
          data-testid="memory-pieces-per-answer"
          value={String(limits.piecesPerAnswer)}
          onChange={(event) => change({ piecesPerAnswer: Number(event.target.value) })}
          disabled={saving}
        >
          {[5, 10, 15, 20, 30].map((count) => (
            <option key={count} value={count}>
              {count} pieces
            </option>
          ))}
        </select>
      </Row>

      <Row
        name="Biggest file it will read"
        what="Anything larger is skipped, and the run says so. Reading a huge file into a text drawer costs money and remembers little."
      >
        <select
          className={SELECT}
          data-testid="memory-biggest-file"
          value={String(limits.biggestFileMb)}
          onChange={(event) => change({ biggestFileMb: Number(event.target.value) })}
          disabled={saving}
        >
          {[5, 10, 20, 50].map((mb) => (
            <option key={mb} value={mb}>
              {mb} MB
            </option>
          ))}
        </select>
      </Row>

      <Row
        name="Search by meaning"
        what="Finds the relevant part of a long history instead of the most recent. Off, memory still works from the timeline."
      >
        <button
          type="button"
          role="switch"
          aria-checked={limits.searchByMeaning}
          aria-label="Search by meaning"
          data-testid="memory-search-toggle"
          disabled={saving}
          onClick={() => change({ searchByMeaning: !limits.searchByMeaning })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
            limits.searchByMeaning ? "bg-amber-500" : "bg-gray-200"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              limits.searchByMeaning ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </Row>

      {problem ? (
        <p className="mt-3 text-[12px] text-red-600" data-testid="memory-limits-problem">
          {problem}
        </p>
      ) : saved ? (
        <p className="mt-3 text-[12px] text-emerald-700" data-testid="memory-limits-saved">
          Saved. Every agent uses this from the next run.
        </p>
      ) : null}
    </div>
  );
}
