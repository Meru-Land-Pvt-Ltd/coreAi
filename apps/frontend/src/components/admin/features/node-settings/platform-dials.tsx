"use client";

/**
 * ONE PANEL FOR EVERY NODE'S DIALS.
 *
 * There used to be a hand-written React panel per node — memory-limits,
 * condition-limits, loop-limits, timer-limits, email-limits, knowledge-limits,
 * file-upload-limits — each one repeating the same select-and-save, each one a
 * place where a number could disagree with the node that owns it.
 *
 * The founder's ruling (2026-08-26) made the node's own row the single truth,
 * with `whoFills: "admin"` marking the platform's ceilings. So this panel is
 * written once: it asks the platform which dials this node declares, draws
 * them, and saves them back with the node's own bounds enforced. A dial added
 * to a node's declaration appears here by itself — no screen to write, no
 * screen to forget.
 */

import { useCallback, useEffect, useState } from "react";
import { getPlatformDials, savePlatformDial, type PlatformDial } from "@/components/admin/features/api";

const SELECT =
  "h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-amber-400";

/** Sensible steps for a number dial, so an admin picks rather than types. */
function stepsFor(dial: PlatformDial): number[] {
  const min = dial.min ?? 1;
  const max = dial.max ?? 100;
  const seed = [min, Number(dial.default), max].filter((n) => Number.isFinite(n)) as number[];
  const spread = [
    min,
    Math.round(min + (max - min) * 0.1),
    Math.round(min + (max - min) * 0.25),
    Math.round(min + (max - min) * 0.5),
    max
  ];
  return [...new Set([...seed, ...spread])]
    .filter((n) => n >= min && n <= max)
    .sort((a, b) => a - b);
}

export function PlatformDialsPanel({ nodeType }: { nodeType: string }) {
  const [dials, setDials] = useState<PlatformDial[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getPlatformDials().then((response) => {
      if (!alive) return;
      if (response.success && response.data) {
        setDials(response.data.dials.filter((dial) => dial.nodeType === nodeType));
      } else {
        setProblem("These settings could not be loaded. Refresh the page to try again.");
      }
    });
    return () => {
      alive = false;
    };
  }, [nodeType]);

  const change = useCallback(
    async (dial: PlatformDial, value: string | number | boolean) => {
      setSaving(dial.key);
      setProblem(null);
      setSaved(false);
      setDials((current) =>
        (current ?? []).map((entry) => (entry.key === dial.key ? { ...entry, value } : entry))
      );
      const response = await savePlatformDial(dial.key, value);
      setSaving(null);
      if (response.success && response.data) {
        setDials((current) =>
          (current ?? []).map((entry) => (entry.key === dial.key ? response.data!.dial : entry))
        );
        setSaved(true);
        return;
      }
      setProblem(response.error ?? "That could not be saved. Try again.");
    },
    []
  );

  if (!dials) {
    return (
      <p className="text-sm text-slate-500" data-testid="platform-dials-loading">
        {problem ?? "Loading…"}
      </p>
    );
  }

  if (dials.length === 0) {
    /* Declared-empty is an answer: this node has nothing the platform caps. */
    return (
      <p className="text-sm text-slate-500" data-testid="platform-dials-none">
        This node has no platform limits — nothing here needs an admin&apos;s judgement.
      </p>
    );
  }

  return (
    <div data-testid="platform-dials-panel">
      <p className="mb-1 text-sm font-semibold text-slate-900">Limits</p>
      <p className="mb-3 text-[12px] leading-5 text-slate-500">
        What the platform allows this node to do. Architects decide meaning; businesses answer their
        own facts; these are the ceilings that cost money or carry risk.
      </p>

      {dials.map((dial) => (
        <div
          key={dial.key}
          className="flex items-start justify-between gap-6 border-b border-gray-100 py-4 last:border-0"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{dial.name}</p>
            <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{dial.whatItsFor}</p>
          </div>

          <div className="shrink-0">
            {dial.type === "on/off" ? (
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(dial.value)}
                aria-label={dial.name}
                data-testid={`dial-${dial.key}`}
                disabled={saving === dial.key}
                onClick={() => void change(dial, !dial.value)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                  dial.value ? "bg-amber-500" : "bg-gray-200"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    dial.value ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            ) : dial.choices && dial.choices.length > 0 ? (
              <select
                className={SELECT}
                data-testid={`dial-${dial.key}`}
                value={String(dial.value)}
                disabled={saving === dial.key}
                onChange={(event) => void change(dial, event.target.value)}
              >
                {dial.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className={SELECT}
                data-testid={`dial-${dial.key}`}
                value={String(dial.value)}
                disabled={saving === dial.key}
                onChange={(event) => void change(dial, Number(event.target.value))}
              >
                {stepsFor(dial).map((step) => (
                  <option key={step} value={step}>
                    {step.toLocaleString()}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      ))}

      {problem ? (
        <p className="mt-3 text-[12px] text-red-600" data-testid="platform-dials-problem">
          {problem}
        </p>
      ) : saved ? (
        <p className="mt-3 text-[12px] text-emerald-700" data-testid="platform-dials-saved">
          Saved. Every agent uses this from the next run.
        </p>
      ) : null}
    </div>
  );
}
