"use client";

/**
 * KNOWLEDGE'S LIMITS — the admin's half of the library.
 *
 * The architect owns the node's meaning; the business owns the facts (their
 * documents, uploaded once at setup). These three are the platform's, because
 * each one is a bill: document bytes live in the database, and every character
 * handed to a Brain is tokens on every answer of every agent.
 *
 * The defaults are exactly what the platform did before this screen existed.
 * An admin who never opens it sees no change whatsoever.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getKnowledgeLimits,
  saveKnowledgeLimits,
  type KnowledgeLimits
} from "@/components/admin/features/api";

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

export function KnowledgeLimitsPanel() {
  const [limits, setLimits] = useState<KnowledgeLimits | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getKnowledgeLimits().then((response) => {
      if (!alive) return;
      if (response.success && response.data) setLimits(response.data.knowledgeLimits);
      else setProblem("These settings could not be loaded. Refresh the page to try again.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: KnowledgeLimits) => {
    setLimits(next);
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const response = await saveKnowledgeLimits(next);
    setSaving(false);
    if (response.success && response.data) {
      setLimits(response.data.knowledgeLimits);
      setSaved(true);
      return;
    }
    setProblem(response.error ?? "That could not be saved. Try again.");
  }, []);

  if (!limits) {
    return (
      <p className="text-sm text-slate-500" data-testid="knowledge-limits-loading">
        {problem ?? "Loading…"}
      </p>
    );
  }

  const change = (patch: Partial<KnowledgeLimits>) => void save({ ...limits, ...patch });

  return (
    <div data-testid="knowledge-limits-panel">
      <p className="mb-1 text-sm font-semibold text-slate-900">Limits</p>
      <p className="mb-3 text-[12px] leading-5 text-slate-500">
        What the platform allows the library to cost. Businesses upload their documents; these decide
        how big the shelf may grow and how much of it one answer may carry.
      </p>

      <Row
        name="Biggest document"
        what="Anything larger is refused at upload, and the business is told the limit. Document bytes live in the platform's database."
      >
        <select
          className={SELECT}
          data-testid="knowledge-biggest-file"
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
        name="Documents per business"
        what="The length of one business's shelf. Past it, uploads are refused until something is removed."
      >
        <select
          className={SELECT}
          data-testid="knowledge-max-files"
          value={String(limits.maxFiles)}
          onChange={(event) => change({ maxFiles: Number(event.target.value) })}
          disabled={saving}
        >
          {[10, 20, 50, 100, 200].map((count) => (
            <option key={count} value={count}>
              {count} documents
            </option>
          ))}
        </select>
      </Row>

      <Row
        name="How much one answer may carry"
        what="The most library one retrieval hands a Brain. More is not smarter — past a point the model drowns, and the tokens are pure cost."
      >
        <select
          className={SELECT}
          data-testid="knowledge-chars-per-answer"
          value={String(limits.charsPerAnswer)}
          onChange={(event) => change({ charsPerAnswer: Number(event.target.value) })}
          disabled={saving}
        >
          {[4000, 8000, 12000, 20000].map((chars) => (
            <option key={chars} value={chars}>
              {chars.toLocaleString()} characters
            </option>
          ))}
        </select>
      </Row>

      {problem ? (
        <p className="mt-3 text-[12px] text-red-600" data-testid="knowledge-limits-problem">
          {problem}
        </p>
      ) : saved ? (
        <p className="mt-3 text-[12px] text-emerald-700" data-testid="knowledge-limits-saved">
          Saved. Every agent uses this from the next run.
        </p>
      ) : null}
    </div>
  );
}
