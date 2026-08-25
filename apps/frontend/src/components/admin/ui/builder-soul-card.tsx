"use client";

/**
 * THE BUILDER SOUL — the admin's window onto it.
 *
 * The Soul rides with every AI Builder request by itself; nothing here turns
 * it on or off. This card exists for one reason: the platform's intelligence
 * is property, and property you cannot hold in your hand is a rumour. One
 * button puts the whole Soul — the laws, every node's wisdom page, the
 * registry bones — in a zip on the admin's disk.
 *
 * It sits on the same screen as the Builder's brain settings on purpose: the
 * brain is the swappable battery, the Soul is the identity it wears.
 */

import { useEffect, useState } from "react";
import { getBuilderSoulMeta } from "@/components/admin/features/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export function BuilderSoulCard() {
  const [meta, setMeta] = useState<{ pages: number; totalChars: number; coveredNodes: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getBuilderSoulMeta().then((response) => {
      if (!alive) return;
      if (response.success && response.data) {
        setMeta({
          pages: response.data.pages.length,
          totalChars: response.data.totalChars,
          coveredNodes: response.data.coveredNodes
        });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  async function download() {
    setDownloading(true);
    setProblem(null);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("coreai-token") : null;
      const response = await fetch(`${API_URL}/admin/builder-soul.zip`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "builder-soul.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setProblem("The download did not start. Refresh and try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section
      className="mt-6 rounded-2xl border border-gray-200 bg-white p-5"
      data-testid="builder-soul-card"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">The Builder Soul</h2>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            The file that makes any brain become the AI Builder. It rides with every request by
            itself — swap the model above and the new brain reads it on its first answer. This
            button hands you the whole thing as files.
          </p>
          {meta ? (
            <p className="mt-2 text-[11px] text-slate-400" data-testid="builder-soul-meta">
              {meta.pages} files · {meta.coveredNodes} nodes covered ·{" "}
              {Math.round(meta.totalChars / 1000)}k characters
            </p>
          ) : null}
          {problem ? (
            <p className="mt-2 text-[12px] text-red-600" data-testid="builder-soul-problem">
              {problem}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading}
          data-testid="builder-soul-download"
          className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {downloading ? "Preparing…" : "Download as ZIP"}
        </button>
      </div>
    </section>
  );
}
