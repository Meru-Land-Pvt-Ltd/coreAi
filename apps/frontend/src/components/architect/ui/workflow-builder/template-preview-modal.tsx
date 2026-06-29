"use client";

import { useEffect, useState } from "react";
import { getArchitectTemplate, type TemplateDetail } from "@/components/architect/features/api";

/**
 * Read-only preview of a template's node flow. Opening this never touches the
 * canvas — it only fetches GET /architect/templates/:slug and lists the nodes.
 */
export function TemplatePreviewModal({
  slug,
  onClose,
  onUse
}: {
  slug: string | null;
  onClose: () => void;
  onUse: (slug: string) => void;
}) {
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slug) {
      setTemplate(null);
      return;
    }
    let active = true;
    setLoading(true);
    void (async () => {
      const result = await getArchitectTemplate(slug);
      if (!active) return;
      if (result.success && result.data) setTemplate(result.data.template);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  if (!slug) return null;

  const nodes = (template?.workflowJson?.nodes ?? []) as Array<{ id: string; data?: Record<string, unknown> }>;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
      data-testid="template-preview-modal"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-[min(92vw,560px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-xl scroll-thin"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900" data-testid="template-preview-title">
              {template?.title ?? "Loading…"}
            </h3>
            {template ? (
              <p className="mt-0.5 text-[11px] text-slate-400">
                {template.category} · {template.difficulty} · {template.nodeCount} nodes
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="template-preview-close"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>

        {template ? <p className="mt-2 text-sm leading-6 text-slate-600">{template.description}</p> : null}

        <div className="mt-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Flow</p>
          {loading ? (
            <p className="text-sm text-slate-400">Loading flow…</p>
          ) : (
            <ol className="space-y-1.5" data-testid="template-preview-nodes">
              {nodes.map((node, index) => {
                const title = String(node.data?.title ?? node.data?.label ?? node.id);
                return (
                  <li key={node.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
                      {index + 1}
                    </span>
                    <span className="font-medium">{title}</span>
                    {index < nodes.length - 1 ? <span className="text-slate-300">→</span> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => onUse(slug)}
            data-testid="template-preview-use"
            className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-violet-700"
          >
            Use this template
          </button>
        </div>
      </div>
    </div>
  );
}
