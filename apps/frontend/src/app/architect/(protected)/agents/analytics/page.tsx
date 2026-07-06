"use client";

import { useEffect, useRef } from "react";

const ANALYTICS_STYLES = `
  :root {
    --gold-a: #DAA520;
    --gold-b: #FFD700;
  }
  .triven-analytics { font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }

  .text-gold-gradient {
    background: linear-gradient(135deg, var(--gold-a) 0%, var(--gold-b) 100%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }
  .bg-gold-gradient { background: linear-gradient(135deg, var(--gold-a) 0%, var(--gold-b) 100%); }
  .bg-gold-soft { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); }
  .text-gold-600 { color: #DAA520; }
  .shadow-pop { box-shadow: 0 12px 32px -8px rgba(218,165,32,0.30); }
  .shadow-card { box-shadow: 0 1px 2px 0 rgba(15,23,42,0.04), 0 1px 3px 0 rgba(15,23,42,0.06); }
  .shadow-cardhover, .hover\\:shadow-cardhover:hover { box-shadow: 0 10px 28px -8px rgba(15,23,42,0.16), 0 4px 10px -4px rgba(15,23,42,0.08); }

  .nums { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }

  .pulse-dot { position: relative; }
  .pulse-dot::before {
    content: ""; position: absolute; inset: -4px; border-radius: 9999px;
    background: currentColor; opacity: 0.45; animation: pulsering 1.8s ease-out infinite;
  }
  @keyframes pulsering {
    0% { transform: scale(0.6); opacity: 0.5; }
    70% { transform: scale(2.2); opacity: 0; }
    100% { opacity: 0; }
  }

  .feed-enter { animation: feedIn 420ms cubic-bezier(0.22, 1, 0.36, 1); }
  @keyframes feedIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .scroll-thin { scrollbar-width: thin; scrollbar-color: #e2e8f0 transparent; }
  .scroll-thin::-webkit-scrollbar { width: 8px; }
  .scroll-thin::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 9999px; }
  .scroll-thin::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
  .scroll-thin::-webkit-scrollbar-track { background: transparent; }

  .chart-tip {
    position: absolute; pointer-events: none; z-index: 30; opacity: 0;
    transform: translate(-50%, -112%); transition: opacity 140ms ease;
    background: #0f172a; color: #fff; border-radius: 10px; padding: 8px 11px;
    font-size: 12px; line-height: 1.35; white-space: nowrap;
    box-shadow: 0 10px 24px -6px rgba(15,23,42,0.45); border: 1px solid rgba(255,255,255,0.06);
  }
  .chart-tip.show { opacity: 1; }
  .chart-tip::after {
    content: ""; position: absolute; left: 50%; bottom: -5px; width: 10px; height: 10px;
    background: #0f172a; transform: translateX(-50%) rotate(45deg);
    border-right: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  .seg { transition: stroke-width 180ms ease, opacity 180ms ease; cursor: pointer; }
  .bar-rect { transition: opacity 160ms ease, transform 160ms ease; transform-box: fill-box; transform-origin: bottom; }
  .bar-rect:hover { opacity: 0.88; }

  .agent-detail { max-height: 0; overflow: hidden; transition: max-height 320ms cubic-bezier(0.4,0,0.2,1); }
  .agent-row.open + .agent-detail { max-height: 220px; }
  .agent-row .chev { transition: transform 220ms ease; }
  .agent-row.open .chev { transform: rotate(180deg); }

  .metric-value { letter-spacing: -0.02em; }
  .pill { transition: all 180ms ease; }

  @media (prefers-reduced-motion: reduce) {
    .triven-analytics *, .triven-analytics *::before, .triven-analytics *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
    .pulse-dot::before { display: none; }
  }
`;

const ANALYTICS_MARKUP = `
  <header class="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-sm">
    <div class="flex items-center gap-4 px-4 sm:px-6 lg:px-8 h-16">
      <h1 class="text-lg sm:text-2xl font-bold tracking-tight whitespace-nowrap">Agent Analytics</h1>
    </div>
  </header>

  <main class="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">

    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
      <div>
        <p class="text-[13px] text-slate-500"></p>
        
      </div>
      <div id="range-pills" role="tablist" aria-label="Time range" class="inline-flex items-center gap-1 rounded-xl border border-gray-100 bg-white p-1 shadow-sm self-start sm:self-auto">
        <button role="tab" data-range="7D" class="pill rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">7D</button>
        <button role="tab" data-range="30D" class="pill rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">30D</button>
        <button role="tab" data-range="90D" class="pill rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">90D</button>
        <button role="tab" data-range="6M" aria-selected="true" class="pill rounded-lg bg-amber-500 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm">6M</button>
        <button role="tab" data-range="1Y" class="pill rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">1Y</button>
        <button role="tab" data-range="Custom" class="pill rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">Custom</button>
      </div>
    </div>

    <section aria-label="Key metrics" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-6">

      <div class="group rounded-2xl border border-gray-100 bg-white p-5 shadow-card hover:shadow-cardhover transition-shadow">
        <div class="flex items-start justify-between">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z"/></svg></span>
          <span class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">—</span>
        </div>
        <p class="mt-4 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Total Executions</p>
        <div class="mt-1 flex items-end justify-between gap-2">
          <span id="m-exec" class="metric-value nums text-3xl font-black text-slate-900">0</span>
          <svg id="m-exec-spark" class="mb-1.5" width="74" height="30" viewBox="0 0 74 30" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
        <p id="m-exec-delta" class="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-600"></p>
      </div>

      <div class="group rounded-2xl border border-gray-100 bg-white p-5 shadow-card hover:shadow-cardhover transition-shadow">
        <div class="flex items-start justify-between">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
          <svg width="46" height="46" viewBox="0 0 46 46" class="-mt-0.5" aria-hidden="true">
            <circle cx="23" cy="23" r="18" fill="none" stroke="#f1f5f9" stroke-width="5"/>
            <circle id="ring-progress" cx="23" cy="23" r="18" fill="none" stroke="url(#ringGrad)" stroke-width="5" stroke-linecap="round" stroke-dasharray="113.1" stroke-dashoffset="113.1" transform="rotate(-90 23 23)"/>
            <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD700"/><stop offset="1" stop-color="#DAA520"/></linearGradient></defs>
          </svg>
        </div>
        <p class="mt-4 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Success Rate</p>
        <div class="mt-1 flex items-end gap-1">
          <span id="m-success" class="metric-value nums text-3xl font-black text-slate-900">0</span>
          <span class="mb-1 text-xl font-black text-slate-300">%</span>
        </div>
        <p id="m-success-delta" class="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-600"></p>
      </div>

      <div class="group rounded-2xl border border-gray-100 bg-white p-5 shadow-card hover:shadow-cardhover transition-shadow">
        <div class="flex items-start justify-between">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
          <svg id="m-avg-spark" class="mt-1.5" width="74" height="30" viewBox="0 0 74 30" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
        <p class="mt-4 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Avg Execution Time</p>
        <div class="mt-1 flex items-end gap-1">
          <span id="m-avg" class="metric-value nums text-3xl font-black text-slate-900">0</span>
          <span class="mb-1 text-xl font-black text-slate-300">s</span>
        </div>
        <p id="m-avg-delta" class="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-600"></p>
      </div>

      <div class="group rounded-2xl border border-gray-100 bg-white p-5 shadow-card hover:shadow-cardhover transition-shadow">
        <div class="flex items-start justify-between">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22"/><path d="M17 5.5C17 3.6 14.8 3 12 3S7 3.6 7 5.8 9.2 8.5 12 9s5 .9 5 3.2S14.8 15 12 15s-5-.7-5-2.7"/></svg></span>
          <svg id="m-rev-spark" class="mb-1.5" width="74" height="30" viewBox="0 0 74 30" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
        <p class="mt-4 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Revenue Generated</p>
        <div class="mt-1 flex items-end gap-1">
          <span class="mb-1 text-xl font-black text-slate-300">$</span>
          <span id="m-rev" class="metric-value nums text-3xl font-black text-slate-900">0</span>
        </div>
        <p id="m-rev-delta" class="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-600"></p>
      </div>
    </section>

    <section class="rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 shadow-card mb-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 class="text-base font-bold">Executions</h2>
          <p class="text-[12px] text-slate-400 mt-0.5">Successful vs failed runs over the selected period</p>
        </div>
        <div class="flex items-center gap-4 text-[12px] font-medium">
          <span class="inline-flex items-center gap-1.5 text-slate-600"><span class="h-2.5 w-2.5 rounded-full bg-amber-500"></span>Successful</span>
          <span class="inline-flex items-center gap-1.5 text-slate-600"><span class="h-2.5 w-2.5 rounded-full bg-rose-400"></span>Failed</span>
        </div>
      </div>
      <div id="exec-wrap" class="relative" style="height:300px">
        <div id="exec-chart" class="h-full w-full"></div>
        <div id="exec-tip" class="chart-tip"></div>
      </div>
    </section>

    <section class="rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 shadow-card mb-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 class="text-base font-bold">Revenue</h2>
          <p class="text-[12px] text-slate-400 mt-0.5">Gross revenue generated across all your agents</p>
        </div>
        <span class="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[12.5px] font-bold text-amber-700">
          Total <span id="rev-total" class="nums">$0</span>
        </span>
      </div>
      <div id="rev-wrap" class="relative" style="height:240px">
        <div id="rev-chart" class="h-full w-full"></div>
        <div id="rev-tip" class="chart-tip"></div>
      </div>
      <div class="mt-3 flex items-center gap-2 text-[12.5px]">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 7-8"/><path d="M17 7h4v4"/></svg>
        <span class="text-slate-500">Projected next period:</span>
        <span id="rev-proj" class="font-bold text-amber-600">$0</span>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

      <div class="rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 shadow-card">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-base font-bold">Failure Breakdown</h2>
            <p class="text-[12px] text-slate-400 mt-0.5">Why runs didn't complete</p>
          </div>
          <span id="fail-count-badge" class="rounded-lg bg-rose-50 px-2.5 py-1 text-[12px] font-bold text-rose-600">0 failures</span>
        </div>
        <div class="flex flex-col sm:flex-row items-center gap-6">
          <div class="relative shrink-0" style="width:172px;height:172px">
            <svg id="donut-chart" width="172" height="172" viewBox="0 0 172 172"></svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span id="donut-total" class="nums text-2xl font-black text-slate-900">0</span>
              <span class="text-[11px] font-medium text-slate-400">failures</span>
            </div>
          </div>
          <ul id="donut-legend" class="flex-1 w-full space-y-2.5"></ul>
        </div>
      </div>

      <div class="rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 shadow-card">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-base font-bold">Client Retention</h2>
            <p class="text-[12px] text-slate-400 mt-0.5">Cohort analysis</p>
          </div>
          <span class="rounded-lg bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-700">By signup week</span>
        </div>
        <div class="overflow-x-auto -mx-1 px-1">
          <table class="w-full border-separate" style="border-spacing:4px">
            <thead>
              <tr class="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                <th class="text-left font-semibold pb-1 pr-2">Cohort</th>
                <th class="font-semibold pb-1">At hire</th>
                <th class="font-semibold pb-1">1 wk</th>
                <th class="font-semibold pb-1">2 wks</th>
                <th class="font-semibold pb-1">4 wks</th>
              </tr>
            </thead>
            <tbody id="cohort-grid"></tbody>
          </table>
        </div>
        <div class="mt-4 flex items-center justify-between rounded-xl bg-amber-50/70 px-4 py-3">
          <span class="text-[12.5px] font-medium text-slate-600">Average 4-week retention</span>
          <span id="cohort-avg" class="nums text-lg font-black text-amber-700">0%</span>
        </div>
      </div>
    </section>

    <section class="rounded-2xl border border-gray-100 bg-white shadow-card mb-6 overflow-hidden">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 sm:p-6 pb-4 border-b border-gray-100">
        <div>
          <h2 class="text-base font-bold">Agent Performance</h2>
          <p class="text-[12px] text-slate-400 mt-0.5">Lifetime metrics per published agent</p>
        </div>
        <div id="agent-filter" class="inline-flex items-center gap-1 rounded-xl border border-gray-100 bg-gray-50 p-1 self-start">
          <button data-filter="all" class="rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 shadow-sm">All</button>
          <button data-filter="top" class="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-800 transition">Top Performers</button>
          <button data-filter="attention" class="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-800 transition">Needs Attention</button>
        </div>
      </div>
      <div class="hidden md:grid grid-cols-[1.6fr_1fr_1fr_0.8fr_1fr_1.1fr] gap-4 px-6 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 bg-gray-50/60">
        <span>Agent</span><span class="text-right">Executions</span><span class="text-right">Success</span><span class="text-right">Avg Time</span><span class="text-right">Revenue</span><span class="text-right pr-7">Status</span>
      </div>
      <div id="agent-tbody" class="divide-y divide-gray-50"></div>
    </section>

    <section class="rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden">
      <div class="flex items-center justify-between p-5 sm:p-6 pb-4 border-b border-gray-100">
        <div class="flex items-center gap-2.5">
          <h2 class="text-base font-bold">Live Executions</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">No activity</span>
        </div>
        <button id="feed-pause" type="button" class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-gray-50 hover:text-slate-700 transition">
          <svg id="feed-pause-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          <span id="feed-pause-label">Pause</span>
        </button>
      </div>
      <ul id="feed-list" class="divide-y divide-gray-50 overflow-y-auto scroll-thin" style="max-height:300px" aria-live="polite" aria-label="Live execution feed"></ul>
    </section>

  </main>

  <div id="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 hidden">
    <div class="flex items-center gap-2.5 rounded-xl bg-slate-900 px-4 py-3 text-[13px] font-medium text-white shadow-cardhover">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      <span id="toast-msg">Done</span>
    </div>
  </div>
`;

const ANALYTICS_SCRIPT = `
"use strict";

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
const $ = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
const clamp = (v,a,b)=> Math.max(a,Math.min(b,v));
const fmtInt = n => Math.round(n).toLocaleString('en-US');
const fmtMoney = n => '$' + Math.round(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS6  = ['Jan','Feb','Mar','Apr','May','Jun'];
const MONTHS12 = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];
function lastNDayLabels(n){
  const out=[]; const now=new Date();
  for(let i=n-1;i>=0;i--){ const d=new Date(now); d.setDate(now.getDate()-i);
    out.push(n<=7 ? WEEKDAYS[d.getDay()] : (d.getMonth()+1)+'/'+d.getDate()); }
  return out;
}
const last3Months = () => MONTHS6.slice(-3);

const ZERO_RANGE = { exec:0, sr:0, avg:0, rev:0, dExec:'0', dSr:'0%', dAvg:'0', dRev:'$0', proj:'$0', execN:6, revKind:'month6' };
const RANGES = {
  '7D':  Object.assign({}, ZERO_RANGE, { execN:7,  revKind:'day' }),
  '30D': Object.assign({}, ZERO_RANGE, { execN:4,  revKind:'week4' }),
  '90D': Object.assign({}, ZERO_RANGE, { execN:3,  revKind:'month3' }),
  '6M':  Object.assign({}, ZERO_RANGE, { execN:6,  revKind:'month6' }),
  '1Y':  Object.assign({}, ZERO_RANGE, { execN:12, revKind:'month12' }),
};
RANGES['Custom'] = Object.assign({}, RANGES['30D'], { custom:true });

function execLabels(key,n){
  if(key==='6M') return MONTHS6.slice();
  if(key==='1Y') return MONTHS12.slice();
  if(key==='90D') return Array.from({length:n},(_,i)=>'W'+(i+1));
  return lastNDayLabels(n);
}
function genExecSeries(key){
  const r = RANGES[key], n = r.execN;
  const labels = execLabels(key, n);
  const success = labels.map(()=>0);
  const fail = labels.map(()=>0);
  return { labels, success, fail, successTotal:0, failTotal:0 };
}
function splitAgents(vals){
  return vals.map(()=>({a:0,b:0,c:0}));
}
function genRevSeries(key){
  const r = RANGES[key];
  const kind = r.revKind;
  let n, labels;
  if(kind==='day'){ n=7; labels=lastNDayLabels(7); }
  else if(kind==='week4'){ n=4; labels=['Wk 1','Wk 2','Wk 3','Wk 4']; }
  else if(kind==='month3'){ n=3; labels=last3Months(); }
  else if(kind==='month6'){ n=6; labels=MONTHS6.slice(); }
  else { n=12; labels=MONTHS12.slice(); }
  const vals = labels.map(()=>0);
  return { labels, vals, agents: splitAgents(vals) };
}
function genSpark(){
  return [0,0,0,0,0,0,0,0,0,0,0,0];
}

const FAILURES = [];
const COHORTS = [];
const AGENTS = [];

function easeOutCubic(t){ return 1 - Math.pow(1-t,3); }
function animateValue(el, to, opts){
  opts = opts || {};
  const decimals = opts.decimals||0, money = !!opts.money, dur = REDUCED?0:(opts.dur||1100);
  const from = parseFloat((el.dataset.cur!=null?el.dataset.cur:'0')) || 0;
  const start = performance.now();
  function frame(now){
    const p = dur===0 ? 1 : clamp((now-start)/dur,0,1);
    const v = from + (to-from)*easeOutCubic(p);
    el.textContent = money ? Math.round(v).toLocaleString('en-US')
                           : (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US'));
    if(p<1) requestAnimationFrame(frame); else el.dataset.cur = to;
  }
  requestAnimationFrame(frame);
}

function niceCeil(v){ if(v<=0) return 1; const p=Math.pow(10,Math.floor(Math.log10(v))); const n=v/p; let m; if(n<=1)m=1;else if(n<=2)m=2;else if(n<=5)m=5;else m=10; return m*p; }
function kfmt(v){ if(v>=1000) return (v/1000).toFixed(v%1000===0?0:1)+'k'; return ''+Math.round(v); }
function smoothPath(pts){
  if(pts.length<2) return pts.length? 'M'+pts[0][0]+' '+pts[0][1] : '';
  let d='M'+pts[0][0].toFixed(1)+' '+pts[0][1].toFixed(1);
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[i-1]||pts[i], p1=pts[i], p2=pts[i+1], p3=pts[i+2]||p2;
    const c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6;
    const c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
    d+=' C'+c1x.toFixed(1)+' '+c1y.toFixed(1)+' '+c2x.toFixed(1)+' '+c2y.toFixed(1)+' '+p2[0].toFixed(1)+' '+p2[1].toFixed(1);
  }
  return d;
}
function roundedTopRect(x,y,w,h,r){
  r=Math.min(r,w/2,Math.max(0,h)); if(h<=0) return 'M'+x+' '+y;
  return 'M'+x+' '+(y+h)+' L'+x+' '+(y+r)+' Q'+x+' '+y+' '+(x+r)+' '+y+' L'+(x+w-r)+' '+y+' Q'+(x+w)+' '+y+' '+(x+w)+' '+(y+r)+' L'+(x+w)+' '+(y+h)+' Z';
}

function renderSpark(svg, data, color, fillId){
  const W=74,H=30,n=data.length,pad=2;
  const max=Math.max.apply(null,data), min=Math.min.apply(null,data), rng=(max-min)||1;
  const xs=i=> pad + i*(W-2*pad)/(n-1);
  const ys=v=> H-pad - ((v-min)/rng)*(H-2*pad-3);
  let d=''; data.forEach((v,i)=>{ d+=(i?'L':'M')+xs(i).toFixed(1)+' '+ys(v).toFixed(1)+' '; });
  const area=d+'L'+xs(n-1).toFixed(1)+' '+H+' L'+xs(0).toFixed(1)+' '+H+' Z';
  svg.innerHTML='<defs><linearGradient id="'+fillId+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+color+'" stop-opacity="0.30"/><stop offset="1" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+area+'" fill="url(#'+fillId+')"/>'+
    '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
}

let execData=null;
function renderExecChart(){
  const wrap=$('#exec-chart'), tip=$('#exec-tip');
  if(!wrap) return;
  const W=Math.max(280, wrap.clientWidth||640), H=300;
  const d=execData, n=d.success.length;
  const padL=46, padR=16, padT=16, padB=30, baseY=H-padB;
  const ax=i=> padL + (n===1?(W-padL-padR)/2 : i*(W-padL-padR)/(n-1));
  const niceMax=niceCeil(Math.max.apply(null,d.success.concat(d.fail,[1])));
  const ay=v=> padT + (1 - v/niceMax)*(H-padT-padB);
  const sucPts=d.success.map((v,i)=>[ax(i),ay(v)]);
  const faiPts=d.fail.map((v,i)=>[ax(i),ay(v)]);
  const sucLine=smoothPath(sucPts), faiLine=smoothPath(faiPts);
  const sucArea=sucLine+' L'+ax(n-1).toFixed(1)+' '+baseY+' L'+ax(0).toFixed(1)+' '+baseY+' Z';
  const faiArea=faiLine+' L'+ax(n-1).toFixed(1)+' '+baseY+' L'+ax(0).toFixed(1)+' '+baseY+' Z';
  let grid=''; const T=4;
  for(let t=0;t<=T;t++){ const val=niceMax*t/T, y=ay(val);
    grid+='<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="3 4"/>';
    grid+='<text x="'+(padL-8)+'" y="'+(y+3.5).toFixed(1)+'" text-anchor="end" font-size="10.5" fill="#94a3b8">'+kfmt(val)+'</text>'; }
  let xl=''; const step=n>14?Math.ceil(n/6):1;
  d.labels.forEach((lb,i)=>{ if(i%step!==0 && i!==n-1) return;
    xl+='<text x="'+ax(i).toFixed(1)+'" y="'+(H-9)+'" text-anchor="middle" font-size="10.5" fill="#94a3b8">'+esc(lb)+'</text>'; });
  wrap.innerHTML=
  '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="display:block">'+
    '<defs>'+
      '<linearGradient id="sucFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity="0.22"/><stop offset="0.92" stop-color="#f59e0b" stop-opacity="0.02"/></linearGradient>'+
      '<linearGradient id="faiFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fb7185" stop-opacity="0.16"/><stop offset="1" stop-color="#fb7185" stop-opacity="0"/></linearGradient>'+
      '<linearGradient id="sucStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#DAA520"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>'+
    '</defs>'+grid+xl+
    '<path d="'+faiArea+'" fill="url(#faiFill)"/>'+
    '<path d="'+sucArea+'" fill="url(#sucFill)"/>'+
    '<path d="'+faiLine+'" fill="none" stroke="#fb7185" stroke-width="1.6" stroke-dasharray="4 4" stroke-linecap="round" stroke-linejoin="round"/>'+
    '<path class="exec-anim" d="'+sucLine+'" fill="none" stroke="url(#sucStroke)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'+
    '<line id="exec-guide" x1="0" y1="'+padT+'" x2="0" y2="'+baseY+'" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>'+
    '<circle id="exec-dot-f" r="3.5" fill="#fb7185" stroke="#fff" stroke-width="2" opacity="0"/>'+
    '<circle id="exec-dot-s" r="4.5" fill="#f59e0b" stroke="#fff" stroke-width="2" opacity="0"/>'+
    '<rect id="exec-hit" x="'+padL+'" y="'+padT+'" width="'+(W-padL-padR)+'" height="'+(H-padT-padB)+'" fill="transparent" style="cursor:crosshair"/>'+
  '</svg>';
  if(!REDUCED){ const p=$('.exec-anim'); const len=p.getTotalLength(); p.style.strokeDasharray=len; p.style.strokeDashoffset=len; p.getBoundingClientRect(); p.style.transition='stroke-dashoffset 900ms ease'; requestAnimationFrame(()=>{p.style.strokeDashoffset=0;}); }
  const hit=$('#exec-hit'), guide=$('#exec-guide'), dotS=$('#exec-dot-s'), dotF=$('#exec-dot-f');
  function move(ev){
    const rect=hit.getBoundingClientRect();
    const cx=((ev.touches?ev.touches[0].clientX:ev.clientX)-rect.left)*(W-padL-padR)/rect.width;
    let i=Math.round(cx/((W-padL-padR)/(n-1||1))); i=clamp(i,0,n-1);
    const x=ax(i), ys=ay(d.success[i]), yf=ay(d.fail[i]);
    [guide,dotS,dotF].forEach(e=>e.setAttribute('opacity','1'));
    guide.setAttribute('x1',x); guide.setAttribute('x2',x);
    dotS.setAttribute('cx',x); dotS.setAttribute('cy',ys);
    dotF.setAttribute('cx',x); dotF.setAttribute('cy',yf);
    tip.innerHTML='<div style="font-weight:700;margin-bottom:3px">'+esc(d.labels[i])+'</div>'+
      '<div style="display:flex;align-items:center;gap:6px"><span style="width:7px;height:7px;border-radius:9px;background:#f59e0b;display:inline-block"></span>'+fmtInt(d.success[i])+' successful</div>'+
      '<div style="display:flex;align-items:center;gap:6px;margin-top:2px"><span style="width:7px;height:7px;border-radius:9px;background:#fb7185;display:inline-block"></span>'+fmtInt(d.fail[i])+' failed</div>';
    tip.style.left=x+'px'; tip.style.top=Math.min(ys,yf)+'px'; tip.classList.add('show');
  }
  function leave(){ [guide,dotS,dotF].forEach(e=>e.setAttribute('opacity','0')); tip.classList.remove('show'); }
  hit.addEventListener('mousemove',move); hit.addEventListener('mouseleave',leave);
  hit.addEventListener('touchstart',move,{passive:true}); hit.addEventListener('touchmove',move,{passive:true}); hit.addEventListener('touchend',leave);
}

let revData=null;
function renderRevChart(){
  const wrap=$('#rev-chart'), tip=$('#rev-tip');
  if(!wrap) return;
  const W=Math.max(280, wrap.clientWidth||640), H=240;
  const d=revData, n=d.vals.length;
  const padL=46, padR=16, padT=14, padB=30, baseY=H-padB;
  const maxV=niceCeil(Math.max.apply(null,d.vals.concat([1])));
  const ay=v=> padT + (1 - v/maxV)*(H-padT-padB);
  const slot=(W-padL-padR)/n, bw=Math.min(48, slot*0.56);
  let grid=''; const T=4;
  for(let t=0;t<=T;t++){ const val=maxV*t/T, y=ay(val);
    grid+='<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="3 4"/>';
    grid+='<text x="'+(padL-8)+'" y="'+(y+3.5).toFixed(1)+'" text-anchor="end" font-size="10.5" fill="#94a3b8">$'+kfmt(val)+'</text>'; }
  let bars='', xl='';
  d.vals.forEach((v,i)=>{ const x=padL+slot*i+slot/2-bw/2, y=ay(v), h=baseY-y;
    bars+='<path class="bar-rect" data-i="'+i+'" d="'+roundedTopRect(x,y,bw,h,Math.min(7,bw/2))+'" fill="url(#barGrad)"/>';
    xl+='<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-9)+'" text-anchor="middle" font-size="10.5" fill="#94a3b8">'+esc(d.labels[i])+'</text>'; });
  wrap.innerHTML=
  '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="display:block">'+
    '<defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD700"/><stop offset="1" stop-color="#DAA520"/></linearGradient></defs>'+
    grid+xl+bars+'</svg>';
  $$('.bar-rect',wrap).forEach(bar=>{
    bar.addEventListener('mouseenter',()=>{ const i=+bar.dataset.i;
      tip.innerHTML='<div style="font-weight:700;margin-bottom:4px">'+esc(d.labels[i])+' · '+fmtMoney(d.vals[i])+'</div>';
      const bb=bar.getBBox(); tip.style.left=(bb.x+bb.width/2)+'px'; tip.style.top=bb.y+'px'; tip.classList.add('show'); });
    bar.addEventListener('mouseleave',()=>tip.classList.remove('show'));
  });
  if(!REDUCED){ $$('.bar-rect',wrap).forEach((bar,i)=>{ bar.style.transformOrigin='center bottom'; bar.style.transform='scaleY(0)'; bar.style.transition='transform 620ms cubic-bezier(.22,1,.36,1)'; bar.style.transitionDelay=(i*55)+'ms'; requestAnimationFrame(()=>{bar.style.transform='scaleY(1)';}); }); }
}

function renderDonut(failCount){
  const svg=$('#donut-chart'); if(!svg) return; const cx=86, cy=86, r=62, sw=22, C=2*Math.PI*r;
  let off=0, segs='';
  FAILURES.forEach((f,idx)=>{ const len=(f.pct/100)*C, gap=C-len;
    segs+='<circle class="seg" data-i="'+idx+'" cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+f.color+'" stroke-width="'+sw+'" stroke-dasharray="'+len.toFixed(2)+' '+gap.toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" stroke-linecap="butt" transform="rotate(-90 '+cx+' '+cy+')"/>';
    off+=len; });
  svg.innerHTML='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="#f8fafc" stroke-width="'+sw+'"/>'+segs;
  const legend=$('#donut-legend');
  legend.innerHTML = FAILURES.length
    ? FAILURES.map((f,idx)=>(
        '<li class="seg-leg flex items-center justify-between px-2 py-1 -mx-2 rounded-lg text-[12.5px] transition" data-i="'+idx+'">'+
          '<span class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background:'+f.color+'"></span><span class="text-slate-600 font-medium">'+esc(f.label)+'</span></span>'+
          '<span class="flex items-center gap-2"><span class="text-slate-400 nums">0</span><span class="font-bold text-slate-700 w-9 text-right nums">0%</span></span>'+
        '</li>'
      )).join('')
    : '<li class="px-2 py-2 text-[12.5px] text-slate-400">No failure data yet</li>';
  $$('.seg',svg).forEach(seg=>{
    const i=+seg.dataset.i, li=legend.querySelector('.seg-leg[data-i="'+i+'"]');
    const enter=()=>{ seg.setAttribute('stroke-width',sw+4); $$('.seg',svg).forEach(s=>{ if(s!==seg) s.style.opacity='0.4'; }); if(li) li.classList.add('bg-gray-50'); };
    const leave=()=>{ seg.setAttribute('stroke-width',sw); $$('.seg',svg).forEach(s=>s.style.opacity='1'); if(li) li.classList.remove('bg-gray-50'); };
    seg.addEventListener('mouseenter',enter); seg.addEventListener('mouseleave',leave);
    if(li){ li.addEventListener('mouseenter',enter); li.addEventListener('mouseleave',leave); }
  });
  if(!REDUCED){ $$('.seg',svg).forEach((s,idx)=>{ s.style.opacity='0'; s.style.transition='opacity 480ms ease '+(idx*90)+'ms'; requestAnimationFrame(()=>{s.style.opacity='1';}); }); }
}

function renderCohort(){
  const tb=$('#cohort-grid'); if(!tb) return;
  tb.innerHTML = COHORTS.length
    ? COHORTS.map(c=>{
        const cells=c.vals.map(v=>{
          const op=(0.12+(v/100)*0.80).toFixed(2);
          const txt = v>=72 ? '#fff' : '#92400e';
          return '<td class="text-center"><div class="rounded-lg py-2 text-[12.5px] font-bold nums" style="background:rgba(217,119,6,'+op+');color:'+txt+'" title="'+esc(c.name)+' cohort · '+v+'% retained">'+v+'%</div></td>';
        }).join('');
        return '<tr><td class="text-left text-[12px] font-semibold text-slate-600 pr-2 whitespace-nowrap">'+esc(c.name)+'</td>'+cells+'</tr>';
      }).join('')
    : '<tr><td colspan="5" class="py-6 text-center text-[13px] text-slate-400">No retention data yet</td></tr>';
  $('#cohort-avg').textContent='0%';
}

function drawAgentSpark(svg,data){
  const W=320,H=56,n=data.length,pad=3;
  const max=Math.max.apply(null,data),min=Math.min.apply(null,data),rng=(max-min)||1;
  const xs=i=>pad+i*(W-2*pad)/(n-1), ys=v=>H-pad-((v-min)/rng)*(H-2*pad);
  const pts=data.map((v,i)=>[xs(i),ys(v)]);
  const line=smoothPath(pts), area=line+' L'+xs(n-1).toFixed(1)+' '+H+' L'+xs(0).toFixed(1)+' '+H+' Z';
  const gid='ag'+Math.floor(Math.random()*1e6);
  svg.innerHTML='<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity="0.25"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+area+'" fill="url(#'+gid+')"/>'+
    '<path d="'+line+'" fill="none" stroke="#DAA520" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
}
function statusPillHTML(healthy){
  return healthy
    ? '<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-600"><span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>Healthy</span>'
    : '<span class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11.5px] font-semibold text-amber-600"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>Attention</span>';
}
function renderAgents(filter){
  filter=filter||'all';
  const host=$('#agent-tbody'); if(!host) return;
  const list=AGENTS.filter(a=> filter==='all' ? true : filter==='top' ? a.status==='Healthy' : a.status==='Attention');
  if(list.length===0){ host.innerHTML='<div class="px-6 py-10 text-center text-[13px] text-slate-400">No agent performance data yet.</div>'; return; }
  host.innerHTML=list.map((a,idx)=>{
    const healthy=a.status==='Healthy';
    const initials=a.name.split(' ').slice(0,2).map(w=>w[0]).join('');
    const border=healthy?'':'border-l-2 border-amber-400';
    const pill=statusPillHTML(healthy);
    return '<div class="agent-block" data-name="'+esc(a.name.toLowerCase())+'">'+
      '<button type="button" class="agent-row '+border+' w-full text-left px-5 sm:px-6 py-4 hover:bg-gray-50/70 transition" data-i="'+idx+'" aria-expanded="false">'+
        '<div class="md:grid md:grid-cols-[1.6fr_1fr_1fr_0.8fr_1fr_1.1fr] md:gap-4 md:items-center">'+
          '<div class="flex items-center gap-3 min-w-0">'+
            '<span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold-soft text-amber-700 text-[12px] font-bold">'+esc(initials)+'</span>'+
            '<span class="min-w-0"><span class="block text-[13.5px] font-semibold text-slate-800 truncate">'+esc(a.name)+'</span>'+
              '<span class="inline-block mt-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500 font-mono">'+esc(a.ver)+'</span></span></div>'+
          '<div class="hidden md:block text-right nums text-[13.5px] font-semibold text-slate-700">'+fmtInt(a.exec)+'</div>'+
          '<div class="hidden md:block text-right nums text-[13.5px] font-semibold '+(a.sr>=97?'text-slate-700':'text-amber-600')+'">'+a.sr.toFixed(1)+'%</div>'+
          '<div class="hidden md:block text-right nums text-[13.5px] text-slate-600">'+a.time.toFixed(1)+'s</div>'+
          '<div class="hidden md:block text-right nums text-[13.5px] font-bold text-slate-800">'+fmtMoney(a.rev)+'</div>'+
          '<div class="hidden md:flex justify-end items-center gap-2">'+pill+'<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></div>'+
          '<div class="md:hidden mt-3 grid grid-cols-4 gap-2 text-center">'+
            '<div><div class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Runs</div><div class="nums text-[12.5px] font-bold text-slate-700">'+fmtInt(a.exec)+'</div></div>'+
            '<div><div class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Success</div><div class="nums text-[12.5px] font-bold text-slate-700">'+a.sr.toFixed(1)+'%</div></div>'+
            '<div><div class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Time</div><div class="nums text-[12.5px] font-bold text-slate-700">'+a.time.toFixed(1)+'s</div></div>'+
            '<div><div class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Revenue</div><div class="nums text-[12.5px] font-bold text-slate-800">'+fmtMoney(a.rev)+'</div></div></div>'+
          '<div class="md:hidden mt-2 flex items-center justify-between">'+pill+'<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></div>'+
        '</div></button>'+
      '<div class="agent-detail px-5 sm:px-6"><div class="pb-4 pt-1"><div class="rounded-xl bg-gray-50 border border-gray-100 p-4">'+
        '<div class="flex items-center justify-between mb-2"><span class="text-[12px] font-semibold text-slate-500">Executions trend · last 16 days</span><span class="text-[11.5px] text-amber-600 font-semibold">'+esc(a.name)+' '+esc(a.ver)+'</span></div>'+
        '<svg class="agent-spark w-full" height="56" viewBox="0 0 320 56" preserveAspectRatio="none" data-i="'+idx+'"></svg></div></div></div></div>';
  }).join('');
  $$('.agent-spark',host).forEach(svg=>{ drawAgentSpark(svg, list[+svg.dataset.i].spark); });
  $$('.agent-row',host).forEach(row=>{
    row.addEventListener('click',()=>{ const open=row.classList.toggle('open'); row.setAttribute('aria-expanded',open?'true':'false'); });
  });
}

let feedTimer=null, feedPaused=false;
let rzT=null;
function pad2(x){return String(x).padStart(2,'0');}
function fmtClock(d){ let h=d.getHours(); const m=pad2(d.getMinutes()), s=pad2(d.getSeconds()); const ap=h>=12?'PM':'AM'; h=h%12||12; return h+':'+m+':'+s+' '+ap; }
function feedItemHTML(it){
  const ok=it.status==='Success';
  const dot=ok?'bg-emerald-500':'bg-rose-500';
  const right=ok
    ? '<span class="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600 shrink-0"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'+it.time.toFixed(1)+'s</span>'
    : '<span class="inline-flex items-center gap-1 text-[12px] font-semibold text-rose-600 shrink-0"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'+esc(it.reason)+'</span>';
  return '<li class="'+(REDUCED?'':'feed-enter')+' flex items-center gap-3 px-5 sm:px-6 py-3">'+
    '<span class="h-2 w-2 rounded-full '+dot+' shrink-0"></span>'+
    '<span class="font-mono text-[11.5px] text-slate-400 w-[74px] shrink-0">'+esc(it.t)+'</span>'+
    '<span class="min-w-0 flex-1 truncate"><span class="text-[13px] font-medium '+(ok?'text-slate-700':'text-rose-700')+'">'+esc(it.agent)+'</span><span class="text-slate-400 text-[12.5px]"> · '+esc(it.client)+'</span></span>'+
    right+'</li>';
}
function seedFeed(){
  const list=$('#feed-list'); if(!list) return;
  list.innerHTML='<li class="px-5 sm:px-6 py-8 text-center text-[13px] text-slate-400">No live executions yet</li>';
}
function scheduleFeed(){
  clearTimeout(feedTimer);
}

let currentRange='6M';
function arrowUp(){return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';}
function arrowDown(){return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';}
function applyRange(key){
  currentRange=key;
  const r=RANGES[key];
  execData=genExecSeries(key);
  revData=genRevSeries(key);
  animateValue($('#m-exec'), r.exec);
  animateValue($('#m-success'), r.sr, {decimals:1});
  animateValue($('#m-avg'), r.avg, {decimals:1});
  animateValue($('#m-rev'), r.rev, {money:true});
  $('#m-exec-delta').textContent = r.dExec + ' this period';
  $('#m-success-delta').textContent = r.dSr + ' vs last period';
  $('#m-avg-delta').textContent = r.dAvg + ' avg time';
  $('#m-rev-delta').textContent = r.dRev + ' this period';
  const liveLabel=$('#range-label-live');
  if(liveLabel) liveLabel.textContent = AGENTS.length ? (AGENTS.length + ' agent' + (AGENTS.length===1?'':'s') + ' online') : '0 agents online';
  const ringC=2*Math.PI*18, ring=$('#ring-progress');
  ring.style.transition=REDUCED?'none':'stroke-dashoffset 1100ms cubic-bezier(.22,1,.36,1)';
  ring.setAttribute('stroke-dashoffset',(ringC*(1-r.sr/100)).toFixed(2));
  renderSpark($('#m-exec-spark'), genSpark(), '#f59e0b','spkExec');
  renderSpark($('#m-avg-spark'),  genSpark(), '#10b981','spkAvg');
  renderSpark($('#m-rev-spark'),  genSpark(), '#DAA520','spkRev');
  renderExecChart(); renderRevChart();
  const gross=revData.vals.reduce((a,b)=>a+b,0);
  $('#rev-total').textContent=fmtMoney(gross);
  $('#rev-proj').textContent=r.proj;
  renderDonut(0);
  $('#donut-total').textContent='0';
  $('#fail-count-badge').textContent='0 failures';
}
function setActivePill(key){
  $$('#range-pills [role=tab]').forEach(b=>{
    const on=b.dataset.range===key;
    b.setAttribute('aria-selected',on?'true':'false');
    b.classList.toggle('bg-amber-500',on); b.classList.toggle('text-white',on); b.classList.toggle('shadow-sm',on);
    b.classList.toggle('text-slate-500',!on); b.classList.toggle('hover:text-slate-800',!on);
  });
}

function showToast(msg){
  const t=$('#toast'), box=t.firstElementChild;
  $('#toast-msg').textContent=msg; t.classList.remove('hidden');
  box.style.transition='none'; box.style.opacity='0'; box.style.transform='translateY(8px)';
  requestAnimationFrame(()=>{ box.style.transition='all 220ms ease'; box.style.opacity='1'; box.style.transform='translateY(0)'; });
  clearTimeout(showToast._t); showToast._t=setTimeout(()=>{ box.style.opacity='0'; box.style.transform='translateY(8px)'; setTimeout(()=>t.classList.add('hidden'),240); },2200);
}
function exportCSV(){
  const r=RANGES[currentRange];
  const rows=[['TRIVEN.AI Agent Analytics','Range: '+currentRange],[],
    ['Metric','Value'],
    ['Total Executions', r.exec],
    ['Success Rate', r.sr+'%'],
    ['Avg Execution Time', r.avg+'s'],
    ['Revenue (your earnings)', '$'+r.rev],
    ['Failed Executions', genExecSeries(currentRange).failTotal],
    [],
    ['Agent','Version','Executions','Success Rate','Avg Time','Revenue','Status']];
  AGENTS.forEach(a=>rows.push([a.name,a.ver,a.exec,a.sr+'%',a.time+'s','$'+a.rev,a.status]));
  const csv=rows.map(row=>row.map(c=>{ const s=String(c); return /[",\\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(',')).join('\\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download='triven-analytics-'+currentRange.toLowerCase()+'.csv'; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url),1500);
  showToast('Report exported · triven-analytics-'+currentRange.toLowerCase()+'.csv');
}

function wire(){
  const pills=$$('#range-pills [role=tab]');
  pills.forEach((b,i)=>{
    b.addEventListener('click',()=>{ setActivePill(b.dataset.range); applyRange(b.dataset.range); },{signal});
    b.addEventListener('keydown',e=>{
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){ e.preventDefault();
        const dir=e.key==='ArrowRight'?1:-1; const next=pills[(i+dir+pills.length)%pills.length];
        next.focus(); setActivePill(next.dataset.range); applyRange(next.dataset.range);
      }
    },{signal});
  });
  $$('#agent-filter [data-filter]').forEach(b=>{
    b.addEventListener('click',()=>{
      $$('#agent-filter [data-filter]').forEach(x=>{ x.classList.remove('bg-white','text-slate-700','shadow-sm'); x.classList.add('text-slate-500'); });
      b.classList.add('bg-white','text-slate-700','shadow-sm'); b.classList.remove('text-slate-500');
      renderAgents(b.dataset.filter);
    },{signal});
  });
  const search=$('#search-input');
  document.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){ e.preventDefault(); search&&search.focus(); }
    if(e.key==='Escape'){ if(document.activeElement===search) search.blur(); closeBell(); }
  },{signal});
  if(search){ search.addEventListener('input',()=>{ const q=search.value.trim().toLowerCase();
    $$('#agent-tbody .agent-block').forEach(bl=>{ bl.style.display = (!q||bl.dataset.name.indexOf(q)>-1)?'':'none'; }); },{signal}); }
  const bell=$('#bell-btn'), menu=$('#bell-menu');
  bell.addEventListener('click',e=>{ e.stopPropagation(); const open=menu.classList.toggle('hidden'); bell.setAttribute('aria-expanded', open?'false':'true'); },{signal});
  document.addEventListener('click',e=>{ if(!menu.classList.contains('hidden') && !menu.contains(e.target) && !bell.contains(e.target)) closeBell(); },{signal});
  function closeBellInner(){ menu.classList.add('hidden'); bell.setAttribute('aria-expanded','false'); }
  window.closeBell=closeBellInner;
  $('#export-btn').addEventListener('click',exportCSV,{signal});
  $('#feed-pause').addEventListener('click',()=>{
    feedPaused=!feedPaused;
    $('#feed-pause-label').textContent=feedPaused?'Resume':'Pause';
    $('#feed-pause-icon').outerHTML = feedPaused
      ? '<svg id="feed-pause-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg id="feed-pause-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    if(!feedPaused) scheduleFeed();
  },{signal});
  window.addEventListener('resize',()=>{ clearTimeout(rzT); rzT=setTimeout(()=>{ renderExecChart(); renderRevChart(); },150); },{signal});
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && !feedPaused) scheduleFeed(); },{signal});
}
function init(){
  renderCohort();
  renderAgents('all');
  seedFeed();
  wire();
  setActivePill('6M');
  applyRange('6M');
}
init();
return function(){ try{clearTimeout(feedTimer);}catch(e){} try{clearTimeout(rzT);}catch(e){} try{clearTimeout(showToast._t);}catch(e){} };
`;

export default function ArchitectAgentAnalyticsPage() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    let cleanup: (() => void) | undefined;
    try {
      // eslint-disable-next-line no-new-func
      const run = new Function("signal", ANALYTICS_SCRIPT) as (
        signal: AbortSignal
      ) => (() => void) | undefined;
      cleanup = run(ac.signal);
    } catch {
      /* analytics script failed to initialize */
    }
    return () => {
      ac.abort();
      if (typeof cleanup === "function") cleanup();
    };
  }, []);

  return (
    <div
      className="triven-analytics bg-gray-50 text-slate-900 antialiased"
      data-testid="architect-analytics-page"
    >
      <style dangerouslySetInnerHTML={{ __html: ANALYTICS_STYLES }} />
      <div ref={rootRef} dangerouslySetInnerHTML={{ __html: ANALYTICS_MARKUP }} />
    </div>
  );
}
