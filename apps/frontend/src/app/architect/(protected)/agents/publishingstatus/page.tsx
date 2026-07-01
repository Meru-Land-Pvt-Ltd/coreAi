"use client";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatDate } from "@/components/architect/ui/architect-ui";
import { getArchitectListings } from "@/components/architect/features/api";
import type { ArchitectListing } from "@/components/architect/features/types";
import { ARCHITECT_MY_AGENTS_PATH } from "@/lib/routes";

type StatusState = 1 | 2 | 3 | 4;

const PUBLISH_STATUS_STYLES = `
:root{--ps-amber:#f59e0b;--ps-green:#10b981;--ps-red:#ef4444;--ps-blue:#3b82f6}
@keyframes psDotp{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
.ps-dot-pulse span{display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin:0 2px;animation:psDotp 1.2s infinite ease-in-out}
.ps-dot-pulse span:nth-child(2){animation-delay:.2s}
.ps-dot-pulse span:nth-child(3){animation-delay:.4s}
.ps-bar-fill{position:relative;overflow:hidden;transition:width 1.1s cubic-bezier(.4,0,.2,1)}
.ps-bar-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:translateX(-100%);animation:psShim 2.2s infinite}
@keyframes psShim{100%{transform:translateX(100%)}}
.ps-pop{animation:psPop .5s cubic-bezier(.34,1.56,.64,1)}
@keyframes psPop{0%{transform:scale(0);opacity:0}100%{transform:scale(1);opacity:1}}
.ps-ring{position:relative}
.ps-ring::before{content:'';position:absolute;inset:-6px;border-radius:9999px;border:2px solid var(--ps-green);animation:psRing 1.7s ease-out infinite}
@keyframes psRing{0%{transform:scale(.85);opacity:.6}100%{transform:scale(1.5);opacity:0}}
.ps-pulse-blue{animation:psPb 1.8s ease-in-out infinite}
@keyframes psPb{0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,.45)}50%{box-shadow:0 0 0 8px rgba(59,130,246,0)}}
.ps-tl-pulse{animation:psPa 1.8s ease-in-out infinite}
@keyframes psPa{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.55)}50%{box-shadow:0 0 0 6px rgba(245,158,11,0)}}
.ps-reveal{animation:psRv .45s ease both}
@keyframes psRv{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.ps-glow-amber{box-shadow:0 0 0 1px rgba(245,158,11,.22),0 10px 28px -12px rgba(245,158,11,.4)}
.ps-glow-green{box-shadow:0 0 0 1px rgba(16,185,129,.22),0 10px 28px -12px rgba(16,185,129,.4)}
.ps-glow-blue{box-shadow:0 0 0 1px rgba(59,130,246,.22),0 10px 28px -12px rgba(59,130,246,.4)}
#ps-confetti{position:fixed;inset:0;pointer-events:none;z-index:60;overflow:hidden}
#ps-confetti i{position:absolute;top:-12px;width:8px;height:8px;opacity:.95;animation:psFall var(--d) linear forwards}
@keyframes psFall{to{transform:translate(var(--x),106vh) rotate(720deg);opacity:.9}}
@media (prefers-reduced-motion: reduce){
  .ps-dot-pulse span,.ps-bar-fill,.ps-bar-fill::after,.ps-pop,.ps-ring::before,.ps-pulse-blue,.ps-tl-pulse,.ps-reveal{animation:none !important}
  #ps-confetti{display:none}
}
`;

function statusToState(status: ArchitectListing["status"]): StatusState {
  if (status === "APPROVED") return 2;
  if (status === "REJECTED" || status === "SUSPENDED") return 3;
  return 1;
}

const TL_BASE = [
  { t: "Step 1", d: "Agent submitted for review", c: "green" },
  { t: "Step 2", d: "Automated security scan passed", c: "green" },
  { t: "Step 3", d: "Assigned to reviewer", c: "blue" }
];

const DOT: Record<string, string> = {
  green: "#10b981",
  blue: "#3b82f6",
  amber: "#f59e0b",
  red: "#ef4444"
};

type TimelineEntry = { t: string; d: string; c: string; pulse?: boolean };

function ReviewTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" data-testid="publishing-status-timeline">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">Review timeline</h3>
      <ol className="relative mt-1">
        {entries.map((e, i) => (
          <li
            key={`${e.d}-${i}`}
            className={`ps-reveal relative pl-7 ${i === entries.length - 1 ? "" : "pb-5"}`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {i === entries.length - 1 ? null : (
              <span className="absolute left-[5px] top-3 bottom-0 w-px bg-slate-200" />
            )}
            <span
              className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full ${e.pulse ? "ps-tl-pulse" : ""}`}
              style={{ background: DOT[e.c] }}
            />
            <div className="text-[12px] text-slate-400">{e.t}</div>
            <div className={`text-sm ${e.pulse ? "font-semibold text-slate-900" : "text-slate-700"}`}>{e.d}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function AgentGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 1 1 17 0z" />
    </svg>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-[#eef2f7] bg-[#f8fafc] px-3.5 py-3">
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function UnderReviewPanel({
  agent,
  onEditSubmission,
  onCancelSubmission
}: {
  agent: ResolvedAgent;
  onEditSubmission: () => void;
  onCancelSubmission: () => void;
}) {
  return (
    <div className="ps-reveal" role="status" aria-label="Agent status: Under Review" data-testid="publishing-status-panel-under-review">
      <div className="ps-glow-amber rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" style={{ borderLeft: "4px solid var(--ps-amber)" }}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
          <span className="ps-dot-pulse" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Under Review
        </span>
        <h2 className="mt-3 text-xl font-bold text-slate-900">Your agent is being reviewed by our team</h2>
        <p className="mt-1 text-sm text-slate-500">
          Estimated completion: <span className="font-medium text-slate-700">24–48 hours from submission</span>
        </p>
        <div className="mt-5">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-sm">
            <span className="font-medium text-slate-600">Review in progress</span>
            <span className="text-slate-400">Submitted {formatDate(agent.createdAt)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={60} aria-valuemin={0} aria-valuemax={100}>
            <div className="ps-bar-fill h-full rounded-full" style={{ width: "60%", background: "var(--ps-amber)" }} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatBox value="#3" label="Position in queue" />
        <StatBox value="2" label="Agents ahead" />
        <StatBox value="18h" label="Avg. review time" />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" data-testid="publishing-status-while-you-wait">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">While you wait</h3>
        <div className="flex flex-col items-start gap-3">
          <button
            type="button"
            onClick={onEditSubmission}
            data-testid="publishing-status-edit-submission"
            className="border-0 bg-transparent p-0 text-sm font-medium text-amber-700 hover:underline"
          >
            Edit submission
          </button>
          <button
            type="button"
            onClick={onCancelSubmission}
            data-testid="publishing-status-cancel-submission"
            className="border-0 bg-transparent p-0 text-sm font-medium text-amber-700 hover:underline"
          >
            Cancel submission
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-3 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm" style={{ color: "#92400e" }}>
        <svg className="mt-0.5 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4h16v12H5.2L4 17.2z" />
        </svg>
        <div>
          <p>You&apos;ll receive an email when the review is complete.</p>
          <p className="mt-0.5 opacity-80">Reviews are conducted Monday–Friday, 9 AM – 6 PM EST.</p>
        </div>
      </div>
    </div>
  );
}

function ApprovedConfetti() {
  const [pieces] = useState(() => {
    const cols = ["#f59e0b", "#fbbf24", "#fcd34d", "#d97706", "#fde68a"];
    return Array.from({ length: 46 }).map((_, i) => ({
      left: 50 + (Math.random() * 36 - 18),
      x: Math.random() * 60 - 30,
      d: 1.6 + Math.random() * 1.3,
      bg: cols[i % cols.length],
      round: i % 3 === 0
    }));
  });
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShow(false), 3400);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div id="ps-confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={
            {
              left: `${p.left}%`,
              background: p.bg,
              borderRadius: p.round ? "50%" : undefined,
              "--x": `${p.x}vw`,
              "--d": `${p.d}s`
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function ApprovedPanel({ agent, architectName, onViewAgent }: { agent: ResolvedAgent; architectName: string; onViewAgent: () => void }) {
  return (
    <div className="ps-reveal" role="status" aria-label="Agent status: Approved" data-testid="publishing-status-panel-approved">
      <div className="ps-glow-green rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" style={{ borderLeft: "4px solid var(--ps-green)" }}>
        <div className="flex items-start gap-4">
          <div className="ps-ring shrink-0">
            <div className="ps-pop grid h-12 w-12 place-items-center rounded-full text-white" style={{ background: "var(--ps-green)" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
          </div>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "var(--ps-green)" }}>
              Approved ✓
            </span>
            <h2 className="mt-2 text-xl font-bold text-slate-900">Congratulations! Your agent is live on the marketplace 🎉</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Listed on {formatDate(agent.createdAt)} · Reviewed by <span className="font-medium text-slate-700">Triven Quality Team</span>
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Marketplace listing</h3>
          <button
            type="button"
            onClick={onViewAgent}
            data-testid="publishing-status-view-live-link"
            className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium text-amber-700 hover:underline"
          >
            View Agent <ArrowIcon />
          </button>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}>
            <AgentGlyph className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900">{agent.name}</div>
            <div className="text-xs text-slate-500">
              {agent.category} · by {architectName}
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">Listed</span>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">📈 Boost your visibility</h3>
        <ul className="space-y-2.5 text-sm text-slate-700">
          <li className="flex gap-2.5">
            <CheckIcon className="mt-0.5 shrink-0 text-emerald-500" />
            <span>
              Add a video demo — agents with video get <strong>2.3× more installs</strong>
            </span>
          </li>
          <li className="flex gap-2.5">
            <CheckIcon className="mt-0.5 shrink-0 text-emerald-500" />
            Share your listing on social media
          </li>
          <li className="flex gap-2.5">
            <CheckIcon className="mt-0.5 shrink-0 text-emerald-500" />
            Ask early users for reviews
          </li>
          <li className="flex gap-2.5">
            <CheckIcon className="mt-0.5 shrink-0 text-emerald-500" />
            Complete your architect profile
          </li>
        </ul>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={onViewAgent}
          data-testid="publishing-status-view-live-button"
          className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-transparent bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
        >
          View Agent
        </button>
      </div>
    </div>
  );
}

type ChangeIssue = {
  n: number;
  cat: string;
  sev: "Required" | "Recommended";
  title: string;
  fix: string;
};

const CHANGE_ISSUES: ChangeIssue[] = [
  {
    n: 1,
    cat: "Security",
    sev: "Required",
    title: "API key is hardcoded in the agent logic",
    fix: "Move the API key to the Secure Credentials Vault and reference it via a credential token instead of inlining it."
  },
  {
    n: 2,
    cat: "Quality",
    sev: "Required",
    title: "Agent fails when a phone number includes a country code (+1)",
    fix: "Add phone-number normalization so international formats are handled before sending."
  },
  {
    n: 3,
    cat: "Guidelines",
    sev: "Recommended",
    title: "Description mentions a competitor by name",
    fix: "Remove competitor references and focus on your agent's own capabilities."
  }
];

const TAG_COLORS: Record<string, [string, string]> = {
  Security: ["#fee2e2", "#b91c1c"],
  Quality: ["#fef3c7", "#b45309"],
  Guidelines: ["#dbeafe", "#1d4ed8"],
  Accuracy: ["#ede9fe", "#6d28d9"]
};

function ChangesRequiredPanel({ agent }: { agent: ResolvedAgent }) {
  const [fixed, setFixed] = useState<Record<number, boolean>>({});

  const requiredLeft = CHANGE_ISSUES.filter((it) => it.sev === "Required" && !fixed[it.n]).length;
  const recommendedLeft = CHANGE_ISSUES.filter((it) => it.sev === "Recommended" && !fixed[it.n]).length;
  const canResubmit = requiredLeft === 0;

  return (
    <div className="ps-reveal" role="status" aria-label="Agent status: Changes Required" data-testid="publishing-status-panel-changes-required">
      <div className="ps-glow-amber rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" style={{ borderLeft: "4px solid var(--ps-amber)" }}>
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full" style={{ background: "#fef3c7", color: "#d97706" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </div>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "var(--ps-red)" }}>
              Changes Required
            </span>
            <h2 className="mt-2 text-xl font-bold text-slate-900">Your agent needs some changes before it can go live</h2>
            <p className="mt-1.5 text-sm text-slate-600">Don&apos;t worry — most agents are approved on the second submission.</p>
            <p className="mt-1 text-sm text-slate-400">Reviewed on {formatDate(agent.createdAt)}</p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="px-1 text-sm font-semibold text-slate-900">Issues found</h3>
        {CHANGE_ISSUES.map((it) => {
          const [bg, fg] = TAG_COLORS[it.cat] ?? ["#f1f5f9", "#475569"];
          const isFixed = Boolean(fixed[it.n]);
          const sevRed = it.sev === "Required";
          return (
            <div key={it.n} className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm font-bold" style={{ background: "#f1f5f9", color: "#475569" }}>
                  {it.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: bg, color: fg }}>
                      {it.cat}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${sevRed ? "text-red-600" : "text-amber-600"}`}>
                      <span className="h-2 w-2 rounded-full" style={{ background: sevRed ? "var(--ps-red)" : "var(--ps-amber)" }} />
                      {it.sev}
                    </span>
                  </div>
                  <p className={`mt-1.5 text-sm font-semibold ${isFixed ? "text-slate-400 line-through" : "text-slate-900"}`}>{it.title}</p>
                  <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">How to fix</div>
                    <p className="text-slate-600">{it.fix}</p>
                    <label className="mt-3 inline-flex cursor-pointer select-none items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={isFixed}
                        onChange={(e) => setFixed((prev) => ({ ...prev, [it.n]: e.target.checked }))}
                        className="h-4 w-4 rounded accent-amber-500"
                      />
                      <span className="text-slate-600">Mark as fixed</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Resubmit for review</h3>
        <p className="text-sm text-slate-600">
          Fix the required issues, then resubmit. Recommended issues are optional but improve your approval chances.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--ps-red)" }} />
            Required: <strong className="text-slate-900">{requiredLeft}</strong> remaining
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--ps-amber)" }} />
            Recommended: <strong className="text-slate-900">{recommendedLeft}</strong> optional
          </span>
        </div>
        <div className="mt-4">
          <button
            type="button"
            disabled={!canResubmit}
            data-testid="publishing-status-resubmit-button"
            className={`inline-flex items-center justify-center gap-2 rounded-[10px] border border-transparent bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition ${
              canResubmit ? "hover:bg-amber-600" : "cursor-not-allowed opacity-50"
            }`}
          >
            Resubmit for Review
          </button>
          <p className="mt-2 text-xs text-slate-400">
            {canResubmit
              ? "All required issues fixed — ready to resubmit."
              : "Resubmit unlocks once both required issues are marked fixed."}
          </p>
        </div>
      </div>
    </div>
  );
}

function ReReviewPanel({ agent }: { agent: ResolvedAgent }) {
  return (
    <div className="ps-reveal" role="status" aria-label="Agent status: Re-review Pending" data-testid="publishing-status-panel-re-review">
      <div className="ps-glow-blue rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" style={{ borderLeft: "4px solid var(--ps-blue)" }}>
        <div className="flex items-start gap-4">
          <div className="ps-pulse-blue grid h-12 w-12 shrink-0 place-items-center rounded-full text-white" style={{ background: "var(--ps-blue)" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </div>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "var(--ps-blue)" }}>
              Re-review Pending
            </span>
            <h2 className="mt-2 text-xl font-bold text-slate-900">Your updated agent is back in the review queue</h2>
            <p className="mt-1.5 text-sm text-slate-400">Resubmitted {formatDate(agent.createdAt)}</p>
            <p className="mt-1 text-sm font-medium" style={{ color: "#1d4ed8" }}>
              Priority review — resubmissions are reviewed within 12 hours.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Previous issues addressed</h3>
        <ul className="space-y-3 text-sm">
          <li className="flex items-start gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: "#d1fae5", color: "#059669" }}>
              <CheckIcon />
            </span>
            <span className="text-slate-400 line-through">API key moved to Secure Credentials Vault</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: "#d1fae5", color: "#059669" }}>
              <CheckIcon />
            </span>
            <span className="text-slate-400 line-through">Phone-number normalization added</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: "#dbeafe", color: "#1d4ed8" }}>
              <ArrowIcon />
            </span>
            <span className="text-slate-400 line-through">Competitor reference removed</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

type ResolvedAgent = {
  id: string;
  name: string;
  category: string;
  createdAt: string;
  status: ArchitectListing["status"];
  workflowId: string | null;
};

function PublishingStatusContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listingId = searchParams.get("listingId") ?? "";

  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<ResolvedAgent | null>(null);
  const [architectName] = useState("you");
  const [activeState, setActiveState] = useState<StatusState>(1);

  useEffect(() => {
    let active = true;

    async function load() {
      const result = await getArchitectListings();
      if (!active) return;

      if (result.success && result.data) {
        const match = result.data.listings.find((item) => item.id === listingId);
        if (match) {
          const resolved: ResolvedAgent = {
            id: match.id,
            name: match.name,
            category: match.tags[0] ?? "Agent",
            createdAt: match.createdAt,
            status: match.status,
            workflowId: match.workflowId
          };
          setAgent(resolved);
          setActiveState(statusToState(match.status));
        }
      }

      setLoading(false);
    }

    void load();

    return () => {
      active = false;
    };
  }, [listingId]);

  const headerAgent = useMemo<ResolvedAgent>(
    () =>
      agent ?? {
        id: listingId,
        name: "Your agent",
        category: "Agent",
        createdAt: new Date().toISOString(),
        status: "PENDING_REVIEW",
        workflowId: null
      },
    [agent, listingId]
  );

  function goToMyAgents() {
    router.push(ARCHITECT_MY_AGENTS_PATH);
  }

  function viewAgent() {
    router.push(
      (headerAgent.workflowId
        ? `/architect/workflows/${headerAgent.workflowId}/builder`
        : "/architect/agents/publish") as Route
    );
  }

  function editSubmission() {
    router.push(
      (headerAgent.workflowId
        ? `/architect/workflows/${headerAgent.workflowId}/builder`
        : "/architect/agents/publish") as Route
    );
  }

  function cancelSubmission() {
    router.push(ARCHITECT_MY_AGENTS_PATH);
  }

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      <style dangerouslySetInnerHTML={{ __html: PUBLISH_STATUS_STYLES }} />
      <main className="px-4 py-6 sm:px-8">
        <div className="mx-auto w-full max-w-full">
          <button
            type="button"
            onClick={goToMyAgents}
            data-testid="publishing-status-back-link"
            className="mb-4 inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to My Agents
          </button>

          <section className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-center sm:flex-row sm:items-center sm:p-6 sm:text-left">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}>
              <AgentGlyph className="h-[30px] w-[30px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h1 className="text-lg font-bold text-slate-900" data-testid="publishing-status-agent-name">
                  {headerAgent.name}
                </h1>
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "#eff6ff", color: "#1d4ed8" }}>
                  {headerAgent.category}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-slate-500">
                Submitted {formatDate(headerAgent.createdAt)}
                {headerAgent.id ? (
                  <>
                    {" · "}
                    <span className="text-slate-600">#{headerAgent.id.slice(0, 12)}</span>
                  </>
                ) : null}
              </p>
            </div>
          </section>

          <div className="mt-5">
            {loading ? (
              <div className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            ) : (
              <>
                {activeState === 1 ? (
                  <UnderReviewPanel
                    agent={headerAgent}
                    onEditSubmission={editSubmission}
                    onCancelSubmission={cancelSubmission}
                  />
                ) : null}
                {activeState === 2 ? (
                  <>
                    <ApprovedConfetti />
                    <ApprovedPanel agent={headerAgent} architectName={architectName} onViewAgent={viewAgent} />
                  </>
                ) : null}
                {activeState === 3 ? <ChangesRequiredPanel agent={headerAgent} /> : null}
                {activeState === 4 ? <ReReviewPanel agent={headerAgent} /> : null}

                {activeState === 3 ? (
                  <ReviewTimeline
                    entries={[...TL_BASE, { t: "Latest", d: "Review completed — Changes required", c: "amber" }]}
                  />
                ) : null}
                {activeState === 4 ? (
                  <ReviewTimeline
                    entries={[
                      ...TL_BASE,
                      { t: "Earlier", d: "Review completed — Changes required", c: "amber" },
                      { t: "Resubmitted", d: "Resubmitted with fixes", c: "blue" },
                      { t: "In progress", d: "Re-review in progress", c: "amber", pulse: true }
                    ]}
                  />
                ) : null}
              </>
            )}
          </div>

          <p className="mb-2 mt-8 text-center text-xs text-slate-400">
            Triven.ai Agent Platform · Marketplace review is transparent at every step.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function ArchitectPublishingStatusPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f9fafb]" />}>
      <PublishingStatusContent />
    </Suspense>
  );
}
