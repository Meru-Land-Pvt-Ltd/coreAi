"use client";

/**
 * FILE UPLOAD'S LIMITS — pictures on or off, and a pointer to the size dial.
 *
 * The size lives on Memory's page because it IS Memory's dial — one fact, one
 * home. Showing a second control here that could drift from it is exactly the
 * bug this platform keeps deleting.
 */

import { useCallback, useEffect, useState } from "react";
import { getFileUploadLimits, saveFileUploadLimits } from "@/components/admin/features/api";

export function FileUploadLimitsPanel() {
  const [imagesAllowed, setImagesAllowed] = useState<boolean | null>(null);
  const [biggestFileMb, setBiggestFileMb] = useState<number>(5);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getFileUploadLimits().then((response) => {
      if (!alive) return;
      if (response.success && response.data) {
        setImagesAllowed(response.data.imagesAllowed);
        setBiggestFileMb(response.data.biggestFileMb);
      } else setProblem("These settings could not be loaded. Refresh the page to try again.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: boolean) => {
    setImagesAllowed(next);
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const response = await saveFileUploadLimits(next);
    setSaving(false);
    if (response.success && response.data) {
      setImagesAllowed(response.data.imagesAllowed);
      setSaved(true);
      return;
    }
    setProblem(response.error ?? "That could not be saved. Try again.");
  }, []);

  if (imagesAllowed === null) {
    return <p className="text-sm text-slate-500">{problem ?? "Loading…"}</p>;
  }

  return (
    <div data-testid="file-upload-limits-panel">
      <p className="mb-1 text-sm font-semibold text-slate-900">Limits</p>

      <div className="flex items-start justify-between gap-6 border-b border-gray-100 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Pictures</p>
          <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
            On, a customer's photo goes to the Brain's own eyes. Off, the page refuses it with a
            plain sentence. Videos are always refused — no model here can watch one yet.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={imagesAllowed}
          aria-label="Pictures allowed"
          data-testid="file-upload-images-toggle"
          disabled={saving}
          onClick={() => void save(!imagesAllowed)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
            imagesAllowed ? "bg-amber-500" : "bg-gray-200"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              imagesAllowed ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      <div className="py-4">
        <p className="text-sm font-semibold text-slate-900">Biggest file: {biggestFileMb} MB</p>
        <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
          This dial lives on the Memory node's page — one fact, one home. Change it there and every
          upload door obeys it.
        </p>
      </div>

      {problem ? (
        <p className="text-[12px] text-red-600">{problem}</p>
      ) : saved ? (
        <p className="text-[12px] text-emerald-700" data-testid="file-upload-limits-saved">
          Saved. Every upload door obeys this within a minute.
        </p>
      ) : null}
    </div>
  );
}
