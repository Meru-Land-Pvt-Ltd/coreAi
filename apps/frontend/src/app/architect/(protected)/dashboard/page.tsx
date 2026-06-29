"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Point = { x: number; y: number };

function easeOutExpo(t: number) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function formatNum(n: number, decimals: number, sep: boolean) {
  const fixed = Number(n).toFixed(decimals);
  if (!sep) return fixed;
  const parts = fixed.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function smoothPath(pts: Point[]) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function AnimatedNumber({
  value,
  prefix = "",
  decimals = 0
}: {
  value: number;
  prefix?: string;
  decimals?: number;
}) {
  const [display, setDisplay] = useState(`${prefix}${formatNum(0, decimals, false)}`);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const useSep = decimals === 0 ? value >= 1000 : true;

    if (reduceMotion) {
      setDisplay(prefix + formatNum(value, decimals, useSep));
      return;
    }

    let raf = 0;
    const duration = 1400;
    const start = performance.now();
    const frame = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const val = value * easeOutExpo(p);
      setDisplay(prefix + formatNum(val, decimals, useSep));
      if (p < 1) raf = requestAnimationFrame(frame);
      else setDisplay(prefix + formatNum(value, decimals, useSep));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value, prefix, decimals]);

  return <>{display}</>;
}

function Sparkline({ values, className = "" }: { values: number[]; className?: string }) {
  const W = 64;
  const H = 24;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * (W - pad * 2),
    y: H - pad - ((v - min) / range) * (H - pad * 2)
  }));
  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(2)} ${H} L ${pts[0].x.toFixed(2)} ${H} Z`;
  const gid = useMemo(() => `spark-${Math.random().toString(36).slice(2)}`, []);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`h-6 w-16 ${className}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ranges = ["7D", "30D", "90D", "6M", "1Y"] as const;
type RangeKey = (typeof ranges)[number];

const datasets: Record<RangeKey, { labels: string[]; values: number[]; ticks: number[] }> = {
  "7D": { labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], values: [180, 240, 210, 330, 300, 420, 390], ticks: [0, 100, 200, 300, 400, 500] },
  "30D": { labels: ["May 24", "May 31", "Jun 7", "Jun 14", "Jun 21", "Jun 23"], values: [480, 640, 720, 860, 910, 980], ticks: [0, 250, 500, 750, 1000] },
  "90D": { labels: ["Mar 29", "Apr 12", "Apr 26", "May 10", "May 24", "Jun 7"], values: [3600, 4100, 4800, 5500, 6100, 6800], ticks: [0, 2000, 4000, 6000, 8000] },
  "6M": { labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], values: [2100, 3400, 4200, 5800, 6100, 7240], ticks: [0, 2000, 4000, 6000, 8000] },
  "1Y": { labels: ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"], values: [1200, 1500, 1800, 2200, 2600, 3100, 2100, 3400, 4200, 5800, 6100, 7240], ticks: [0, 2000, 4000, 6000, 8000] }
};

function fmtMoney(v: number) {
  if (v >= 1000) {
    const k = v / 1000;
    return "$" + (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + "K";
  }
  return "$" + v;
}

function fmtFull(v: number) {
  return "$" + Math.round(v).toLocaleString("en-US");
}

function RevenueChart() {
  const [range, setRange] = useState<RangeKey>("6M");
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = datasets[range];

  const TabRow = (
    <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
      {ranges.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => setRange(r)}
          data-testid={`architect-dashboard-range-${r}`}
          className={
            r === range
              ? "rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
              : "rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-700"
          }
        >
          {r}
        </button>
      ))}
    </div>
  );

  const H = 280;
  const padL = 46;
  const padR = 14;
  const padT = 18;
  const padB = 30;
  const W = width || 600;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const yMax = data.ticks[data.ticks.length - 1];
  const baseY = padT + plotH;
  const n = data.values.length;

  const pts = data.values.map((v, i) => ({
    x: padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW),
    y: padT + plotH * (1 - v / yMax),
    v,
    label: data.labels[i]
  }));

  const line = smoothPath(pts);
  const area = `${line} L ${pts[n - 1].x.toFixed(2)} ${baseY} L ${pts[0].x.toFixed(2)} ${baseY} Z`;
  const labelStep = Math.ceil((n * 46) / plotW);
  const hoverPt = hover != null ? pts[hover] : null;

  return (
    <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold text-slate-900" data-testid="architect-dashboard-revenue-overview-heading">Revenue Overview</h2>
      {TabRow}
    </div>
    <div ref={containerRef} className="relative mt-6" style={{ height: 280 }}>
      <svg className="block h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
        </defs>

        {data.ticks.map((t) => {
          const y = padT + plotH * (1 - t / yMax);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 5" />
              <text x={padL - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
                {fmtMoney(t)}
              </text>
            </g>
          );
        })}

        {pts.map((p, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text key={`xl-${i}`} x={p.x} y={H - 8} textAnchor="middle" fontSize="11" fill="#94a3b8">
              {p.label}
            </text>
          ) : null
        )}

        <path d={area} fill="url(#areaGrad)" />
        <path d={line} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {hoverPt ? (
          <>
            <line x1={hoverPt.x} y1={padT} x2={hoverPt.x} y2={baseY} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
            <circle cx={hoverPt.x} cy={hoverPt.y} r="5" fill="#f59e0b" stroke="#fff" strokeWidth="2.5" />
          </>
        ) : null}

        {pts.map((p, i) => {
          const segW = plotW / Math.max(n - 1, 1);
          const zoneW = i === 0 || i === n - 1 ? segW / 2 : segW;
          const zoneX = i === 0 ? padL : p.x - segW / 2;
          return (
            <rect
              key={`zone-${i}`}
              x={zoneX}
              y={padT}
              width={zoneW}
              height={plotH}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>

      {hoverPt ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[130%] whitespace-nowrap rounded-[10px] bg-slate-900 px-[11px] py-2 text-xs text-white shadow-[0_12px_28px_-10px_rgba(15,23,42,.5)]"
          style={{ left: (hoverPt.x / W) * 100 + "%", top: hoverPt.y }}
        >
          <span className="opacity-70">{hoverPt.label}</span> <strong className="ml-1">{fmtFull(hoverPt.v)}</strong>
        </div>
      ) : null}
    </div>
    </>
  );
}

function Donut() {
  const segments = [
    { value: 1890, color: "#f59e0b" },
    { value: 940, color: "#fbbf24" },
    { value: 410, color: "#fcd34d" }
  ];
  const total = segments.reduce((s, x) => s + x.value, 0);
  const cx = 80;
  const cy = 80;
  const r = 60;
  const sw = 18;
  const C = 2 * Math.PI * r;
  const gap = 0.018 * C;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  let offset = 0;
  const circles = segments.map((seg) => {
    const frac = seg.value / total;
    const len = Math.max(frac * C - gap, 0);
    const dashoffset = -offset;
    offset += frac * C;
    return { len, dashoffset, color: seg.color };
  });

  return (
    <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={sw} />
      {circles.map((c, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={c.color}
          strokeWidth={sw}
          strokeDasharray={`${mounted ? c.len : 0} ${C}`}
          strokeDashoffset={c.dashoffset}
          style={{ transition: `stroke-dasharray .9s cubic-bezier(.4,0,.2,1) ${0.15 * i + 0.2}s` }}
        />
      ))}
    </svg>
  );
}

function RatingStars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const frac = rating - full;
  const path = "M12 2.5 14.9 8.4 21.4 9.3l-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z";
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        if (i < full) {
          return (
            <svg key={i} viewBox="0 0 24 24" className="h-4 w-4" fill="#f59e0b">
              <path d={path} />
            </svg>
          );
        }
        if (i === full && frac > 0) {
          const gid = `sg${i}`;
          return (
            <svg key={i} viewBox="0 0 24 24" className="h-4 w-4">
              <defs>
                <linearGradient id={gid}>
                  <stop offset={`${frac * 100}%`} stopColor="#f59e0b" />
                  <stop offset={`${frac * 100}%`} stopColor="#e2e8f0" />
                </linearGradient>
              </defs>
              <path d={path} fill={`url(#${gid})`} />
            </svg>
          );
        }
        return (
          <svg key={i} viewBox="0 0 24 24" className="h-4 w-4" fill="#e2e8f0">
            <path d={path} />
          </svg>
        );
      })}
    </div>
  );
}

const agentRows = [
  { name: "Missed Call Text-Back", version: "v2.1", meta: "Communication • Missed Call", price: "$100", installs: "180", rating: "4.9★" },
  { name: "Lead Follow-Up Sequence", version: "v1.4", meta: "Nurture • Sequence", price: "$149", installs: "134", rating: "4.8★" },
  { name: "Appointment Reminder", version: "v1.2", meta: "Scheduling • Reminder", price: "$79", installs: "98", rating: "4.7★" }
];

const agentFilters = ["All", "Live", "Draft", "In Review"];

const activity = [
  { dot: "bg-amber-500 ring-amber-100", title: "New install", rest: " — Missed Call Text-Back", sub: "Rodriguez HVAC · 2 hours ago" },
  { dot: "bg-amber-500 ring-amber-100", title: "5-star review", rest: " received — Lead Follow-Up Sequence", sub: "5 hours ago" },
  { dot: "bg-green-500 ring-green-100", title: "Payout processed", rest: ": $6,100 → Bank ****4521", sub: "Yesterday" },
  { dot: "bg-amber-500 ring-amber-100", title: "New install", rest: " — Appointment Reminder", sub: "Luxe Med Spa · 2 days ago" },
  { dot: "bg-slate-300 ring-slate-100", title: "Agent update approved", rest: " — Missed Call Text-Back v2.1", sub: "3 days ago" }
];

const WORKFLOWS_ROUTE = "/architect/workflows" as Route;

export default function ArchitectDashboardPage() {
  const [bannerOpen, setBannerOpen] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All");
  const [tierWidth, setTierWidth] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pct = (412 / 500) * 100;
    if (reduceMotion) {
      setTierWidth(pct);
      return;
    }
    const raf = requestAnimationFrame(() => setTierWidth(pct));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-slate-900">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-100 bg-white/90 px-4 py-3.5 shadow-sm backdrop-blur-md sm:px-6 lg:px-8" data-testid="architect-dashboard-topbar">
        <h1 className="text-2xl font-bold text-slate-900" data-testid="architect-dashboard-title-heading">Dashboard</h1>

        <div className="relative mx-auto hidden w-full max-w-md md:block">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search agents, connectors, docs…"
            data-testid="architect-dashboard-search-input"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-16 text-sm text-slate-700 placeholder:text-slate-400 transition focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
          />
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link
            href={WORKFLOWS_ROUTE}
            data-testid="architect-dashboard-create-agent-link"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 hover:shadow-md sm:px-5"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="hidden sm:inline">Create New Agent</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 space-y-6 p-4 pb-28 sm:p-6 lg:p-8 lg:pb-8">
        {bannerOpen ? (
          <div className="relative overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 p-5 sm:p-6" data-testid="architect-dashboard-welcome-banner">
            <button
              type="button"
              aria-label="Dismiss"
              data-testid="architect-dashboard-dismiss-banner"
              onClick={() => setBannerOpen(false)}
              className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-amber-400 transition hover:bg-amber-100/70 hover:text-amber-600"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <p className="pr-8 text-base font-semibold text-slate-800 sm:text-lg">
              Welcome back. Your agents earned{" "}
              <span className="font-extrabold text-amber-700">
                <AnimatedNumber value={847} prefix="$" />
              </span>{" "}
              while you were away.
            </p>
            <Link href={WORKFLOWS_ROUTE} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-amber-600 hover:text-amber-700" data-testid="architect-dashboard-view-earnings-link">
              View earnings
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-4">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md sm:p-6">
            <div className="flex items-start justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="1.5" x2="12" y2="22.5" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </span>
              <Sparkline values={[12, 18, 15, 24, 21, 30, 28, 36]} className="text-amber-500" />
            </div>
            <p className="mt-4 text-sm text-slate-500">Total Earnings</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-slate-900" data-testid="architect-dashboard-total-earnings-text">
              <AnimatedNumber value={47820} prefix="$" />
            </p>
            <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-green-600">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="6" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
              +$3,240 this month
            </p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md sm:p-6">
            <div className="flex items-start justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </span>
              <Sparkline values={[8, 11, 10, 16, 14, 19, 23, 27]} className="text-amber-500" />
            </div>
            <p className="mt-4 text-sm text-slate-500">Total Installs</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-slate-900" data-testid="architect-dashboard-total-installs-text">
              <AnimatedNumber value={412} />
            </p>
            <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-green-600">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="6" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
              +28 this month
            </p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md sm:p-6">
            <div className="flex items-start justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </span>
            </div>
            <p className="mt-4 text-sm text-slate-500">Active Agents</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-slate-900" data-testid="architect-dashboard-active-agents-text">
              <AnimatedNumber value={3} />
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
              <span className="h-2 w-2 rounded-full bg-green-500" /> All healthy
            </p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md sm:p-6">
            <div className="flex items-start justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <path d="M12 2.5 14.9 8.4 21.4 9.3l-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z" />
                </svg>
              </span>
            </div>
            <p className="mt-4 text-sm text-slate-500">Average Rating</p>
            <p className="mt-1 flex items-baseline gap-1 text-3xl font-black tracking-tight text-slate-900">
              <span data-testid="architect-dashboard-average-rating-text">
                <AnimatedNumber value={4.9} decimals={1} />
              </span>
              <span className="text-lg font-semibold text-slate-400">/5</span>
            </p>
            <div className="mt-2 flex items-center gap-2">
              <RatingStars rating={4.9} />
              <span className="text-sm text-slate-500">47 reviews</span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8" data-testid="architect-dashboard-revenue-section">
          <RevenueChart />

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-gray-50 pt-4">
            <p className="text-sm text-slate-600">
              This month so far: <span className="font-semibold text-slate-900">$3,240</span>
            </p>
            <p className="text-sm text-slate-600">
              Projected: <span className="font-semibold text-amber-600">$7,800</span>
            </p>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm" data-testid="architect-dashboard-agents-section">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-slate-900">Your Agents</h2>
              <Link href={"/architect/agents" as Route} className="text-sm font-medium text-amber-600 hover:text-amber-700" data-testid="architect-dashboard-view-all-agents-link">
                View all →
              </Link>
            </div>
            <div className="flex items-center gap-1 text-sm">
              {agentFilters.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActiveFilter(f)}
                  data-testid={`architect-dashboard-agent-filter-${f.toLowerCase().replace(/\s+/g, "-")}`}
                  className={
                    activeFilter === f
                      ? "rounded-lg bg-amber-50 px-3 py-1.5 font-semibold text-amber-700"
                      : "rounded-lg px-3 py-1.5 font-medium text-slate-500 hover:bg-gray-50"
                  }
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {agentRows.map((agent) => (
            <div key={agent.name} className="group flex items-center gap-4 border-t border-gray-50 px-5 py-4 transition hover:bg-gray-50 sm:px-6">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-slate-900">{agent.name}</p>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">{agent.version}</span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">{agent.meta}</p>
              </div>
              <div className="hidden items-center gap-8 md:flex">
                <span className="w-12 text-right font-semibold text-slate-900">{agent.price}</span>
                <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18" />
                    <path d="m7 14 3-3 3 2 4-5" />
                  </svg>
                  {agent.installs}
                </span>
                <span className="text-sm font-medium text-amber-600">{agent.rating}</span>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-green-600">
                <span className="h-2 w-2 rounded-full bg-green-500" /> Live
              </span>
            </div>
          ))}

          <div className="border-t border-gray-50 p-4 sm:p-5">
            <Link
              href={WORKFLOWS_ROUTE}
              data-testid="architect-dashboard-create-agent-cta-link"
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-medium text-slate-500 transition hover:border-amber-300 hover:bg-amber-50/40 hover:text-amber-600"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create New Agent
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Activity</h2>
              <Link href={"/architect/agents" as Route} className="text-sm font-medium text-amber-600 hover:text-amber-700">
                View all
              </Link>
            </div>

            <ol className="relative mt-5 space-y-5 border-l border-gray-100 pl-6">
              {activity.map((item, i) => (
                <li key={i} className="relative">
                  <span className={`absolute -left-[27px] top-1 h-2.5 w-2.5 rounded-full ring-4 ${item.dot}`} />
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">{item.title}</span>
                    {item.rest}
                  </p>
                  <p className="text-xs text-slate-400">{item.sub}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">This Month&apos;s Earnings</h2>

            <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
              <div className="relative h-40 w-40 shrink-0">
                <Donut />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xs text-slate-400">Earned</span>
                  <span className="text-2xl font-black text-slate-900">
                    <AnimatedNumber value={3240} prefix="$" />
                  </span>
                </div>
              </div>

              <ul className="w-full flex-1 space-y-3">
                <li className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5 text-sm text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#f59e0b" }} /> Missed Call Text-Back
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    $1,890 <span className="font-normal text-slate-400">58%</span>
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5 text-sm text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#fbbf24" }} /> Lead Follow-Up
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    $940 <span className="font-normal text-slate-400">29%</span>
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5 text-sm text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#fcd34d" }} /> Appointment Reminder
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    $410 <span className="font-normal text-slate-400">13%</span>
                  </span>
                </li>
              </ul>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-50 pt-4">
              <p className="text-sm text-slate-600">
                Available for withdrawal: <span className="font-bold text-slate-900">$3,240</span>
              </p>
              <Link href={"/architect/payouts" as Route} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 hover:shadow-md" data-testid="architect-dashboard-withdraw-link">
                Withdraw
              </Link>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 to-yellow-50 p-5 sm:p-6">
          <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[auto_1fr_auto]">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-amber-500 text-white shadow-[0_18px_40px_-16px_rgba(245,158,11,0.45)]">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
                  <path d="M12 2.5 14.9 8.4 21.4 9.3l-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z" />
                </svg>
              </span>
              <div>
                <p className="text-2xl font-black tracking-tight text-amber-600">GOLD</p>
                <p className="text-sm text-amber-700/80">50+ installs achieved</p>
              </div>
            </div>

            <div className="lg:px-4">
              <div className="mb-2 flex items-center justify-between text-sm font-medium text-amber-800">
                <span>
                  <span className="font-bold">412</span> / 500 installs
                </span>
                <span className="text-amber-600">82%</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-amber-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,.25),0_6px_18px_-6px_rgba(245,158,11,.55)]"
                  style={{ width: `${tierWidth}%`, transition: "width 1.4s cubic-bezier(.4,0,.2,1) .2s" }}
                />
              </div>
            </div>

            <div className="lg:text-right">
              <p className="text-sm font-bold text-slate-800">
                Next: <span className="text-amber-600">PLATINUM</span>
              </p>
              <p className="mt-0.5 max-w-xs text-sm text-slate-500 lg:ml-auto">Unlocks 80% revenue share + a dedicated success manager</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
