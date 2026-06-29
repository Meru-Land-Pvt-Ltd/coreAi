"use client";

import { useEffect, useState } from "react";
import { getArchitectTemplates, type TemplateCard } from "@/components/architect/features/api";

/**
 * Empty-canvas Template Gallery. Fetches cards from GET /architect/templates —
 * templates are NOT hardcoded here. "Use" imports the workflowJson into the
 * canvas (handled by the parent); "Preview" opens a read-only modal.
 */
export function TemplateGallery({
  busySlug,
  onUse,
  onPreview
}: {
  busySlug: string | null;
  onUse: (slug: string) => void;
  onPreview: (slug: string) => void;
}) {
  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await getArchitectTemplates();
      if (!active) return;
      if (result.success && result.data) {
        // Recommended first, then by forks.
        const sorted = [...result.data.templates].sort(
          (a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)) || b.forks - a.forks
        );
        setTemplates(sorted);
      } else {
        setError(result.error ?? "Could not load templates");
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div
      className="scroll-thin absolute inset-0 z-10 overflow-y-auto bg-white/95 px-5 py-6 backdrop-blur"
      data-testid="template-gallery"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-lg font-black text-slate-900" data-testid="template-gallery-title">Template Gallery</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            {templates.length} ready-made workflows
          </span>
        </div>
        <p className="mb-5 text-sm text-slate-500">
          Pick a template to import its nodes onto the canvas. Each node behaves exactly like a node you drag from the
          component library.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400" data-testid="template-gallery-loading">Loading templates…</p>
        ) : error ? (
          <p className="text-sm text-red-500" data-testid="template-gallery-error">{error}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <div
                key={template.slug}
                data-testid={`template-card-${template.slug}`}
                className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md ${
                  template.recommended ? "border-violet-300 ring-1 ring-violet-200" : "border-gray-200"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {template.category}
                  </span>
                  {template.recommended ? (
                    <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white" data-testid={`template-recommended-${template.slug}`}>
                      Recommended · Latest
                    </span>
                  ) : null}
                </div>

                <p className="text-[11px] font-medium text-slate-400">
                  {template.difficulty} · {template.nodeCount} nodes
                </p>
                <h3 className="mt-0.5 text-sm font-black text-slate-900">{template.title}</h3>
                <p className="mt-1 flex-1 text-xs leading-5 text-slate-500">{template.description}</p>

                <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                  <span title="Forks">⑂ {template.forks}</span>
                  <span title="Rating">★ {template.rating.toFixed(1)}</span>
                  <span title="Reviews">({template.reviewCount})</span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {template.tags.map((tag) => (
                    <span key={tag} className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-slate-500">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onUse(template.slug)}
                    disabled={busySlug === template.slug}
                    data-testid={`template-use-${template.slug}`}
                    className="flex-1 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-violet-700 disabled:opacity-60"
                  >
                    {busySlug === template.slug ? "Importing…" : "Use template"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreview(template.slug)}
                    data-testid={`template-preview-${template.slug}`}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-violet-300 hover:text-slate-800"
                  >
                    Preview
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
