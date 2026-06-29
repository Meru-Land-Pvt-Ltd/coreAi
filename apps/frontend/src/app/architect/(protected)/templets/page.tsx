"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getArchitectTemplate,
  getArchitectTemplates,
  useArchitectTemplate,
  type TemplateCard
} from "@/components/architect/features/api";

type WorkflowNode = {
  id: string;
  col: number;
  row: number;
  type: string;
  label: string;
  color: string;
};

type Workflow = { nodes: WorkflowNode[]; edges: [string, string][] };

const CAT: Record<string, { pill: string; dot: string }> = {
  Communication: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  Reviews: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  Scheduling: { pill: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  "Lead Gen": { pill: "bg-purple-50 text-purple-700", dot: "bg-purple-500" },
  "Customer Service": { pill: "bg-teal-50 text-teal-700", dot: "bg-teal-500" },
  Integrations: { pill: "bg-orange-50 text-orange-700", dot: "bg-orange-500" },
  Dental: { pill: "bg-sky-50 text-sky-700", dot: "bg-sky-500" }
};

const CAT_FALLBACK = { pill: "bg-slate-100 text-slate-700", dot: "bg-slate-500" };
const catStyle = (category: string) => CAT[category] ?? CAT_FALLBACK;

const COMPLEXITY: Record<string, { dot: string }> = {
  Beginner: { dot: "bg-emerald-500" },
  Intermediate: { dot: "bg-amber-500" },
  Advanced: { dot: "bg-rose-500" }
};

const complexityDot = (difficulty: string) =>
  COMPLEXITY[difficulty.split("/")[0]]?.dot ?? "bg-slate-400";

// Builder node accents → diagram colors (matches the workflow builder palette).
const ACCENT_HEX: Record<string, string> = {
  amber: "#f59e0b",
  violet: "#8b5cf6",
  orange: "#f97316",
  green: "#10b981",
  blue: "#3b82f6",
  red: "#ef4444",
  slate: "#64748b"
};

const CHAIN_COLORS = ["#f59e0b", "#8b5cf6", "#10b981", "#3b82f6", "#f97316", "#14b8a6", "#a855f7", "#ef4444"];

// Compact placeholder diagram derived purely from a node count (used on cards,
// where the API list does not include the full workflowJson).
function chainWorkflow(count: number): Workflow {
  const n = Math.max(1, Math.min(Math.round(count) || 1, 8));
  const nodes: WorkflowNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    col: i,
    row: 0,
    type: "",
    label: "",
    color: CHAIN_COLORS[i % CHAIN_COLORS.length]
  }));
  const edges = nodes.slice(1).map((_, i) => [`n${i}`, `n${i + 1}`] as [string, string]);
  return { nodes, edges };
}

type RawNode = { id?: unknown; position?: { x?: unknown; y?: unknown }; data?: Record<string, unknown> };
type RawEdge = { source?: unknown; target?: unknown };

// Convert a real builder workflowJson (from the template detail endpoint) into the
// diagram shape, using node positions for layout and node.data.accent for color.
function workflowFromJson(json: { nodes?: unknown[]; edges?: unknown[] } | null | undefined): Workflow {
  const raw = (json?.nodes ?? []) as RawNode[];
  if (!raw.length) return { nodes: [], edges: [] };

  const xOf = (n: RawNode) => Math.round(Number(n.position?.x ?? 0));
  const yOf = (n: RawNode) => Math.round(Number(n.position?.y ?? 0));
  const xs = Array.from(new Set(raw.map(xOf))).sort((a, b) => a - b);
  const ys = Array.from(new Set(raw.map(yOf))).sort((a, b) => a - b);
  const midRow = (ys.length - 1) / 2;

  const nodes: WorkflowNode[] = raw.map((n, index) => {
    const data = (n.data ?? {}) as Record<string, unknown>;
    return {
      id: String(n.id ?? `node-${index}`),
      col: Math.max(0, xs.indexOf(xOf(n))),
      row: ys.indexOf(yOf(n)) - midRow,
      type: String(data.nodeKind ?? data.kind ?? ""),
      label: String(data.title ?? data.label ?? n.id ?? "Step"),
      color: ACCENT_HEX[String(data.accent ?? "slate")] ?? ACCENT_HEX.slate
    };
  });

  const ids = new Set(nodes.map((n) => n.id));
  const edges = ((json?.edges ?? []) as RawEdge[])
    .map((e) => [String(e.source), String(e.target)] as [string, string])
    .filter(([s, t]) => ids.has(s) && ids.has(t));

  return { nodes, edges };
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function compactWorkflowSVG(wf: Workflow) {
  if (!wf.nodes.length) return "";
  const cellW = 54;
  const cellH = 30;
  const p = 10;
  const r = 5;
  const maxCol = Math.max(...wf.nodes.map((n) => n.col));
  const rows = wf.nodes.map((n) => n.row);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const W = p * 2 + r * 2 + maxCol * cellW;
  const H = p * 2 + r * 2 + (maxRow - minRow) * cellH;
  const X = (n: WorkflowNode) => p + r + n.col * cellW;
  const Y = (n: WorkflowNode) => p + r + (n.row - minRow) * cellH;

  let edges = "";
  wf.edges.forEach(([s, t]) => {
    const A = wf.nodes.find((n) => n.id === s)!;
    const B = wf.nodes.find((n) => n.id === t)!;
    const x1 = X(A);
    const y1 = Y(A);
    const x2 = X(B);
    const y2 = Y(B);
    const mx = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    edges += `<path d="${d}" fill="none" stroke="#cbd5e1" stroke-width="1.5"/><path d="${d}" fill="none" stroke="#f59e0b" stroke-width="1.5" class="wf-flow"/>`;
  });
  let dots = "";
  wf.nodes.forEach((n, i) => {
    const x = X(n);
    const y = Y(n);
    const delay = (i * 0.1).toFixed(2);
    dots += `<circle cx="${x}" cy="${y}" r="9" fill="${n.color}" opacity="0.14" class="wf-halo" style="animation-delay:${delay}s"/><circle cx="${x}" cy="${y}" r="${r}" fill="${n.color}" class="wf-dot" style="animation-delay:${delay}s"/><circle cx="${x}" cy="${y}" r="2" fill="#ffffff" opacity="0.9"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="wf-compact" style="max-width:100%;height:auto;display:block;margin:0 auto" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${edges}${dots}</svg>`;
}

function fullWorkflowSVG(wf: Workflow, fit: boolean) {
  if (!wf.nodes.length) return "";
  const cw = 158;
  const ch = 50;
  const colSp = 196;
  const rowSp = 92;
  const p = 18;
  const maxCol = Math.max(...wf.nodes.map((n) => n.col));
  const rows = wf.nodes.map((n) => n.row);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const W = p * 2 + maxCol * colSp + cw;
  const H = p * 2 + (maxRow - minRow) * rowSp + ch;
  const NX = (n: WorkflowNode) => p + n.col * colSp;
  const NY = (n: WorkflowNode) => p + (n.row - minRow) * rowSp;

  let edges = "";
  wf.edges.forEach(([s, t]) => {
    const A = wf.nodes.find((n) => n.id === s)!;
    const B = wf.nodes.find((n) => n.id === t)!;
    const x1 = NX(A) + cw;
    const y1 = NY(A) + ch / 2;
    const x2 = NX(B);
    const y2 = NY(B) + ch / 2;
    const mx = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    edges += `<path d="${d}" fill="none" stroke="#cbd5e1" stroke-width="2" marker-end="url(#wf-arrow)"/><path d="${d}" fill="none" stroke="#f59e0b" stroke-width="2" class="wf-flow"/>`;
  });
  let chips = "";
  wf.nodes.forEach((n) => {
    const x = NX(n);
    const y = NY(n);
    chips +=
      `<g>` +
      `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="12" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" filter="url(#wf-shadow)"/>` +
      `<circle cx="${x + 18}" cy="${y + ch / 2}" r="9" fill="${n.color}" opacity="0.14"/>` +
      `<circle cx="${x + 18}" cy="${y + ch / 2}" r="5" fill="${n.color}"/>` +
      `<text x="${x + 34}" y="${y + 20}" font-family="ui-monospace, monospace" font-size="8" letter-spacing="1.2" fill="#94a3b8" font-weight="600">${esc((n.type || "").toUpperCase())}</text>` +
      `<text x="${x + 34}" y="${y + 34}" font-family="Inter, sans-serif" font-size="12.5" fill="#1e293b" font-weight="600">${esc(n.label)}</text>` +
      `</g>`;
  });
  const sizing = fit
    ? `width="100%" style="height:auto;display:block;max-width:100%"`
    : `width="${W}" height="${H}" style="height:auto;max-width:none;display:block"`;
  return (
    `<svg viewBox="0 0 ${W} ${H}" ${sizing} role="img" aria-label="Workflow diagram" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<marker id="wf-arrow" markerWidth="9" markerHeight="9" refX="6.5" refY="4" orient="auto"><path d="M1 1 L6 4 L1 7" fill="none" stroke="#cbd5e1" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>` +
    `<filter id="wf-shadow" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.08"/></filter>` +
    `</defs>${edges}${chips}</svg>`
  );
}

const WORKFLOWS_ROUTE = "/architect/workflows" as Route;

function StarRow({ n, size = "h-3.5 w-3.5" }: { n: number; size?: string }) {
  const path = "M12 2.6l2.7 5.5 6 .9-4.35 4.24 1.03 6L12 16.9 6.62 19.24l1.03-6L3.3 9l6-.9z";
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} viewBox="0 0 24 24" className={`${size} ${i < Math.round(n) ? "text-amber-400" : "text-slate-200"}`} fill="currentColor">
          <path d={path} />
        </svg>
      ))}
    </div>
  );
}

export default function ArchitectTemplateGalleryPage() {
  const router = useRouter();
  const [category, setCategory] = useState("All");
  const [industry, setIndustry] = useState("all");
  const [complexity, setComplexity] = useState("All");
  const [sort, setSort] = useState("popular");
  const [search, setSearch] = useState("");
  const [modalId, setModalId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usingSlug, setUsingSlug] = useState<string | null>(null);

  // Workflow diagrams come from the detail endpoint (the list has only metadata).
  const [featuredWorkflow, setFeaturedWorkflow] = useState<Workflow | null>(null);
  const [modalWorkflow, setModalWorkflow] = useState<Workflow | null>(null);
  const [modalWorkflowLoading, setModalWorkflowLoading] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (modalId) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [modalId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await getArchitectTemplates();
      if (!active) return;
      if (result.success && result.data) {
        setTemplates(result.data.templates);
      } else {
        setLoadError(result.error ?? "Could not load templates");
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(templates.map((t) => t.category))).sort();
    return ["All", ...unique];
  }, [templates]);

  const industries = useMemo(
    () => Array.from(new Set(templates.flatMap((t) => t.tags))).sort(),
    [templates]
  );

  const featured = useMemo(
    () => templates.find((t) => t.recommended) ?? templates[0] ?? null,
    [templates]
  );

  // Load the featured template's real workflow diagram.
  useEffect(() => {
    const slug = featured?.slug;
    if (!slug) return;
    let active = true;
    setFeaturedWorkflow(null);
    void (async () => {
      const result = await getArchitectTemplate(slug);
      if (!active) return;
      if (result.success && result.data) {
        setFeaturedWorkflow(workflowFromJson(result.data.template.workflowJson));
      }
    })();
    return () => {
      active = false;
    };
  }, [featured?.slug]);

  const visible = useMemo(() => {
    const matches = (t: TemplateCard) => {
      if (category !== "All" && t.category !== category) return false;
      if (complexity !== "All" && !t.difficulty.toLowerCase().includes(complexity.toLowerCase())) return false;
      if (industry !== "all") {
        const hay = t.tags.join(" ").toLowerCase();
        if (!hay.includes(industry.toLowerCase())) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = (t.title + " " + t.description + " " + t.category + " " + t.tags.join(" ")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
    const list = templates.filter(matches);
    if (sort === "popular") list.sort((x, y) => y.forks - x.forks || y.rating - x.rating);
    else if (sort === "newest") list.sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
    else if (sort === "forks") list.sort((x, y) => y.forks - x.forks);
    else if (sort === "rated") list.sort((x, y) => y.rating - x.rating || y.reviewCount - x.reviewCount);
    return list;
  }, [templates, category, industry, complexity, sort, search]);

  const modalTemplate = modalId ? templates.find((t) => t.id === modalId) ?? null : null;

  // Load the open modal template's real workflow diagram.
  useEffect(() => {
    const slug = modalTemplate?.slug;
    if (!slug) {
      setModalWorkflow(null);
      return;
    }
    let active = true;
    setModalWorkflow(null);
    setModalWorkflowLoading(true);
    void (async () => {
      const result = await getArchitectTemplate(slug);
      if (!active) return;
      if (result.success && result.data) {
        setModalWorkflow(workflowFromJson(result.data.template.workflowJson));
      }
      setModalWorkflowLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [modalTemplate?.slug]);

  function clearFilters() {
    setCategory("All");
    setIndustry("all");
    setComplexity("All");
    setSort("popular");
    setSearch("");
  }

  // Clone the template's workflowJson into a new workflow, then open the builder.
  async function useTemplate(slug: string | undefined) {
    if (!slug || usingSlug) return;
    setUsingSlug(slug);
    setToast("Opening template in Agent Builder…");
    const result = await useArchitectTemplate(slug);
    if (result.success && result.data) {
      router.push(`/architect/workflows/${result.data.workflowId}/builder` as Route);
      return;
    }
    setToast(result.error ?? "Could not open this template");
    setUsingSlug(null);
  }

  const selectClass =
    "cursor-pointer rounded-xl border border-slate-200 bg-white py-2.5 pl-3.5 pr-9 text-sm font-medium text-slate-700 transition hover:border-slate-300 focus:border-amber-300 focus:outline-none";

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800 antialiased">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes wfFlow { to { stroke-dashoffset: -22; } }
            .wf-flow { stroke-dasharray: 2 9; stroke-linecap: round; animation: wfFlow 1.15s linear infinite; }
            .wf-compact .wf-flow { opacity: 0; animation: none; }
            .group:hover .wf-compact .wf-flow { opacity: 1; animation: wfFlow 1.15s linear infinite; }
            .canvas-grid-amber { background-color:#fffdf6; background-image: radial-gradient(rgba(245,158,11,.22) 1px, transparent 1px); background-size: 16px 16px; }
            .canvas-grid { background-color:#ffffff; background-image: radial-gradient(#e2e8f0 1px, transparent 1px); background-size: 16px 16px; }
            .no-scrollbar::-webkit-scrollbar { display: none; }
            .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          `
        }}
      />

      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1280px] items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl" data-testid="architect-templates-title-heading">
              Template Gallery
            </h1>
            <p className="hidden truncate text-sm font-medium text-slate-500 sm:block">
              Start with a proven blueprint. Customize and publish in minutes.
            </p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="relative">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates"
                aria-label="Search templates"
                data-testid="architect-templates-search-input"
                className="w-40 rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-sm font-medium text-slate-800 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:outline-none sm:w-72"
              />
            </div>
          </div>
        </div>
      </header>

      {featured ? (
      <section className="mx-auto w-full max-w-[1280px] px-4 pt-8 sm:px-6 lg:px-8 lg:pt-10">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">Featured template</span>
          <span className="h-px flex-1 bg-gradient-to-r from-amber-200 to-transparent" />
        </div>

        <div className="relative rounded-[26px] bg-gradient-to-r from-amber-200 via-orange-200 to-amber-200 p-[1.5px] shadow-[0_1px_2px_rgba(15,23,42,.04),0_10px_28px_-10px_rgba(15,23,42,.12)]">
          <div className="relative overflow-hidden rounded-[24.5px] bg-white">
            <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-amber-200/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-orange-100/40 blur-3xl" />

            <div className="relative grid items-center gap-8 p-7 sm:p-9 lg:grid-cols-2 lg:gap-12 lg:p-10">
              <div>
                <div className="mb-5 flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                      <path d="M12 2c2.5 3 3 4.8 1.8 6.6-.7 1-1.3 1.5-1.3 2.6a1.6 1.6 0 0 0 3.1.5c1 1.4 1.6 2.8 1.6 4.2a5.2 5.2 0 1 1-10.4 0c0-2 .9-3.7 2.2-5 .6 1 1.6 1.2 2.3.6.9-.7.7-1.8.2-3C10.7 6.8 10.5 4.7 12 2z" />
                    </svg>
                    {featured.recommended ? "Recommended" : "Most Popular"}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${catStyle(featured.category).pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${catStyle(featured.category).dot}`} />
                    {featured.category}
                  </span>
                </div>

                <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 lg:text-[2.5rem] lg:leading-[1.05]">{featured.title}</h2>
                <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600 lg:text-lg">
                  {featured.description}
                </p>

                <div className="mt-7 flex items-center gap-7">
                  <div>
                    <div className="text-2xl font-extrabold tracking-tight text-slate-900">{featured.forks}</div>
                    <div className="mt-0.5 text-xs font-medium text-slate-400">forks</div>
                  </div>
                  <div className="h-9 w-px bg-slate-200" />
                  <div>
                    <div className="flex items-center gap-1 text-2xl font-extrabold tracking-tight text-slate-900">
                      {featured.rating}
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-400" fill="currentColor">
                        <path d="M12 2.6l2.7 5.5 6 .9-4.35 4.24 1.03 6L12 16.9 6.62 19.24l1.03-6L3.3 9l6-.9z" />
                      </svg>
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-slate-400">rating</div>
                  </div>
                  <div className="h-9 w-px bg-slate-200" />
                  <div>
                    <div className="text-2xl font-extrabold tracking-tight text-slate-900">{featured.tags.length}</div>
                    <div className="mt-0.5 text-xs font-medium text-slate-400">industries</div>
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={() => useTemplate(featured.slug)}
                    disabled={usingSlug === featured.slug}
                    data-testid="architect-templates-featured-use"
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-[0_10px_26px_-8px_rgba(245,158,11,.55)] transition hover:bg-amber-600 hover:shadow-lg active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {usingSlug === featured.slug ? "Opening…" : "Use this template"}
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalId(featured.id)}
                    data-testid="architect-templates-featured-preview"
                    className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-amber-700 transition hover:text-amber-800"
                  >
                    Preview workflow
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>

              <div>
                <div className="canvas-grid-amber rounded-2xl border border-amber-100 p-6 shadow-[0_1px_2px_rgba(15,23,42,.04),0_1px_3px_rgba(15,23,42,.06)]">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-600/70">Workflow</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Live
                    </span>
                  </div>
                  <div className="overflow-x-auto no-scrollbar" dangerouslySetInnerHTML={{ __html: fullWorkflowSVG(featuredWorkflow ?? chainWorkflow(featured.nodeCount), true) }} />
                  <div className="mt-4 flex items-center justify-between text-[11px] font-medium text-slate-400">
                    <span>{featured.nodeCount} nodes · {featured.difficulty}</span>
                    <span className="font-mono">{featured.rating} ★ · {featured.reviewCount} reviews</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      ) : null}

      <div className="sticky top-[73px] z-20 mt-8 border-y border-gray-100 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-3 px-4 py-3.5 sm:px-6 lg:flex-nowrap lg:px-8">
          <div className="order-1 w-full min-w-0 overflow-x-auto no-scrollbar lg:w-auto lg:flex-1">
            <div className="flex w-max items-center gap-2" role="group" aria-label="Filter by category">
              {categories.map((c) => {
                const on = c === category;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={on}
                    data-testid={`architect-templates-category-${c.toLowerCase().replace(/\s+/g, "-")}`}
                    className={
                      "whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold transition " +
                      (on
                        ? "border-amber-500 bg-amber-50 text-amber-700 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50")
                    }
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="order-2 flex flex-shrink-0 items-center gap-2 overflow-x-auto no-scrollbar lg:overflow-visible">
            <select aria-label="Filter by industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className={selectClass} data-testid="architect-templates-industry-select">
              <option value="all">All industries</option>
              {industries.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
            <select aria-label="Filter by complexity" value={complexity} onChange={(e) => setComplexity(e.target.value)} className={selectClass} data-testid="architect-templates-complexity-select">
              <option value="All">All levels</option>
              <option value="Beginner">Beginner · 2–3 nodes</option>
              <option value="Intermediate">Intermediate · 4–6 nodes</option>
              <option value="Advanced">Advanced · 7+ nodes</option>
            </select>
            <select aria-label="Sort templates" value={sort} onChange={(e) => setSort(e.target.value)} className={selectClass} data-testid="architect-templates-sort-select">
              <option value="popular">Most popular</option>
              <option value="newest">Newest</option>
              <option value="forks">Most forks</option>
              <option value="rated">Highest rated</option>
            </select>
          </div>
        </div>
      </div>

      <section className="mx-auto w-full max-w-[1280px] px-4 pt-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-600">All templates</div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Browse the gallery</h2>
          </div>
          <div className="pb-1 text-sm font-medium text-slate-400" data-testid="architect-templates-count-text">
            {visible.length} {visible.length === 1 ? "template" : "templates"}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="architect-templates-loading">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-80 animate-pulse rounded-2xl border border-gray-100 bg-white" />
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-rose-200 bg-white px-6 py-20 text-center" data-testid="architect-templates-error">
            <h3 className="text-lg font-bold text-slate-900">Could not load templates</h3>
            <p className="mt-1.5 max-w-sm text-sm text-slate-500">{loadError}</p>
          </div>
        ) : visible.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="architect-templates-grid">
            {visible.map((t) => {
              const cat = catStyle(t.category);
              return (
                <article
                  key={t.id}
                  data-testid={`architect-templates-card-${t.id}`}
                  onClick={() => setModalId(t.id)}
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04),0_1px_3px_rgba(15,23,42,.06)] transition-all duration-300 hover:-translate-y-1 hover:border-amber-100 hover:shadow-[0_1px_2px_rgba(15,23,42,.04),0_10px_28px_-10px_rgba(15,23,42,.12)]"
                >
                  <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-400 to-orange-400 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="flex flex-1 flex-col p-6">
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cat.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${cat.dot}`} />
                        {t.category}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        <span className={`h-1.5 w-1.5 rounded-full ${complexityDot(t.difficulty)}`} />
                        {t.difficulty} · {t.nodeCount} nodes
                      </span>
                    </div>

                    <h3 className="text-lg font-extrabold tracking-tight text-slate-900">{t.title}</h3>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">{t.description}</p>

                    <div className="mt-5 flex min-h-[76px] items-center justify-center rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-3" dangerouslySetInnerHTML={{ __html: compactWorkflowSVG(chainWorkflow(t.nodeCount)) }} />

                    <div className="mt-auto">
                      <div className="mt-5 flex items-center gap-5">
                        <div className="flex items-center gap-1.5">
                          <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="18" r="3" />
                            <circle cx="6" cy="6" r="3" />
                            <circle cx="18" cy="6" r="3" />
                            <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
                            <path d="M12 12v3" />
                          </svg>
                          <span className="text-xl font-bold text-slate-900">{t.forks}</span>
                          <span className="text-xs font-medium text-slate-400">forks</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2.6l2.7 5.5 6 .9-4.35 4.24 1.03 6L12 16.9 6.62 19.24l1.03-6L3.3 9l6-.9z" />
                          </svg>
                          <span className="text-xl font-bold text-slate-900">{t.rating}</span>
                          <span className="text-xs font-medium text-slate-400">({t.reviewCount})</span>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {t.tags.map((i) => (
                          <span key={i} className="inline-flex items-center rounded-md border border-slate-100 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                            {i}
                          </span>
                        ))}
                      </div>

                      <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void useTemplate(t.slug);
                          }}
                          disabled={usingSlug === t.slug}
                          data-testid={`architect-templates-use-${t.id}`}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {usingSlug === t.slug ? "Opening…" : "Use template"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setModalId(t.id);
                          }}
                          data-testid={`architect-templates-preview-${t.id}`}
                          className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[.98]"
                        >
                          Preview
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-20 text-center" data-testid="architect-templates-empty">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-300">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <h3 className="mt-5 text-lg font-bold text-slate-900">No templates match these filters</h3>
            <p className="mt-1.5 max-w-sm text-sm text-slate-500">Try a different category or industry, or clear everything to see all templates.</p>
            <button
              type="button"
              onClick={clearFilters}
              data-testid="architect-templates-clear-filters"
              className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Clear filters
            </button>
          </div>
        )}
      </section>

      <section className="mx-auto w-full max-w-[1280px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="relative overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04),0_10px_28px_-10px_rgba(15,23,42,.12)]">
          <div className="canvas-grid absolute inset-0 opacity-60" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-amber-100/40 blur-3xl" />
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-orange-100/30 blur-3xl" />

          <div className="relative flex flex-col items-center justify-between gap-8 px-7 py-11 sm:px-10 lg:flex-row lg:px-14 lg:py-14">
            <div className="max-w-xl text-center lg:text-left">
              <h3 className="text-2xl font-extrabold tracking-tight text-slate-900 lg:text-3xl">Can&apos;t find what you need?</h3>
              <p className="mt-3 leading-relaxed text-slate-600">
                Request a template and the Triven team will consider building it — or start from a blank canvas and design your own agent from the ground up.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                <button
                  type="button"
                  onClick={() => setToast("Request received — we’ll review it soon")}
                  data-testid="architect-templates-request"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 active:scale-[.98]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Request a template
                </button>
                <button
                  type="button"
                  onClick={() => router.push(WORKFLOWS_ROUTE)}
                  data-testid="architect-templates-scratch"
                  className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-amber-700 transition hover:text-amber-800"
                >
                  Build from scratch
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-shrink-0 rounded-2xl border border-amber-100 bg-amber-50/70 px-9 py-7 text-center">
              <div className="text-4xl font-extrabold tracking-tight text-amber-600">4.2 hrs</div>
              <div className="mt-1.5 max-w-[12rem] text-sm font-medium text-slate-500">saved per agent, on average, by starting from a template</div>
            </div>
          </div>
        </div>
      </section>

      {modalTemplate ? (
        <div className="fixed inset-0 z-50" data-testid="architect-templates-modal">
          <button type="button" aria-label="Close" onClick={() => setModalId(null)} className="absolute inset-0 bg-slate-900/50 backdrop-blur-[6px]" data-testid="architect-templates-modal-backdrop" />
          <div className="absolute inset-0 flex items-stretch justify-center sm:items-center sm:p-6">
            <div role="dialog" aria-modal="true" className="relative flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl">
              <div className="flex items-start gap-4 border-b border-slate-100 p-5 sm:p-6">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${catStyle(modalTemplate.category).pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${catStyle(modalTemplate.category).dot}`} />
                      {modalTemplate.category}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      <span className={`h-1.5 w-1.5 rounded-full ${complexityDot(modalTemplate.difficulty)}`} />
                      {modalTemplate.difficulty} · {modalTemplate.nodeCount} nodes
                    </span>
                  </div>
                  <h2 className="text-2xl font-extrabold tracking-tight text-slate-900" data-testid="architect-templates-modal-name-heading">{modalTemplate.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{modalTemplate.description}</p>
                </div>
                <button type="button" aria-label="Close" onClick={() => setModalId(null)} data-testid="architect-templates-modal-close" className="-mr-1 -mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 space-y-8 overflow-y-auto px-5 py-6 sm:px-6">
                <div>
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Workflow preview</h3>
                  {modalWorkflowLoading ? (
                    <div className="canvas-grid flex min-h-[140px] items-center justify-center rounded-2xl border border-slate-100 p-5 text-sm font-medium text-slate-400" data-testid="architect-templates-modal-workflow-loading">
                      Loading workflow…
                    </div>
                  ) : modalWorkflow && modalWorkflow.nodes.length ? (
                    <div className="canvas-grid overflow-x-auto rounded-2xl border border-slate-100 p-5" data-testid="architect-templates-modal-workflow" dangerouslySetInnerHTML={{ __html: fullWorkflowSVG(modalWorkflow, false) }} />
                  ) : (
                    <div className="canvas-grid flex min-h-[140px] items-center justify-center rounded-2xl border border-slate-100 p-5 text-sm font-medium text-slate-400" data-testid="architect-templates-modal-workflow-empty">
                      Workflow preview unavailable
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Template details</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { label: "Category", value: modalTemplate.category },
                      { label: "Difficulty", value: modalTemplate.difficulty },
                      { label: "Nodes", value: String(modalTemplate.nodeCount) },
                      { label: "Forks", value: String(modalTemplate.forks) }
                    ].map((row) => (
                      <div key={row.label} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white text-amber-500">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 2 4.1 12.5a.8.8 0 0 0 .6 1.3H11l-1 8.2 8.9-10.5a.8.8 0 0 0-.6-1.3H12z" />
                          </svg>
                        </span>
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{row.label}</div>
                          <div className="mt-0.5 text-sm font-semibold text-slate-800">{row.value}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {modalTemplate.tags.length ? (
                  <div>
                    <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Industries</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {modalTemplate.tags.map((tag) => (
                        <span key={tag} className="inline-flex items-center rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Rating</h3>
                  <div className="flex items-center gap-2.5">
                    <StarRow n={modalTemplate.rating} />
                    <span className="text-sm font-semibold text-slate-800">{modalTemplate.rating}</span>
                    <span className="text-sm text-slate-400">· {modalTemplate.reviewCount} reviews</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 bg-white p-5 sm:p-6">
                <button
                  type="button"
                  onClick={() => useTemplate(modalTemplate.slug)}
                  disabled={usingSlug === modalTemplate.slug}
                  data-testid="architect-templates-modal-use"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3.5 text-sm font-bold text-white shadow-[0_10px_26px_-8px_rgba(245,158,11,.55)] transition hover:bg-amber-600 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {usingSlug === modalTemplate.slug ? "Opening…" : "Use this template"}
                  <span className="hidden font-medium text-amber-100 sm:inline">— opens in Agent Builder</span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 right-6 z-[60] max-w-[calc(100vw-3rem)]" role="status" aria-live="polite" data-testid="architect-templates-toast">
          <div className="flex items-center gap-3 rounded-xl bg-slate-900 py-3.5 pl-4 pr-5 text-white shadow-2xl">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-500">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span className="text-sm font-medium">{toast}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
