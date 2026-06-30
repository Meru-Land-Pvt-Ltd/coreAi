"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { apiGet, apiPost } from "@/lib/api";
import { BUSINESS_AGENTS_PATH, BUSINESS_MARKETPLACE_PATH } from "@/lib/routes";

const BUSINESS_DASHBOARD_PATH = "/business/dashboard" as Route;

const WIZARD_STYLES = `
.setup-root { --ease: cubic-bezier(.16, 1, .3, 1); }
.setup-root .field { transition: border-color .2s var(--ease), box-shadow .2s var(--ease), background-color .2s var(--ease); }
.setup-root .field:focus { border-color: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, .15); }
.setup-root .btn { transition: transform .15s ease, box-shadow .25s var(--ease), background-color .2s ease, border-color .2s ease, color .2s ease; }
.setup-root .btn:not([disabled]):hover { transform: translateY(-1px); }
.setup-root .btn:not([disabled]):active { transform: translateY(0) scale(.99); }
.setup-root .btn[disabled] { opacity: .45; box-shadow: none !important; cursor: not-allowed; filter: saturate(.6); }
.setup-root .phone-wrap { transition: border-color .25s var(--ease), box-shadow .25s var(--ease); }
.setup-root .phone-wrap.is-valid { border-color: #22c55e !important; box-shadow: 0 0 0 4px rgba(34, 197, 94, .12); }
.setup-root .otp-box { width: 3rem; height: 3.5rem; text-align: center; font-size: 1.35rem; font-weight: 600; border: 1.5px solid #e2e8f0; border-radius: .75rem; background: #fff; color: #0f172a; transition: border-color .2s var(--ease), box-shadow .2s var(--ease), transform .25s var(--ease), background-color .2s var(--ease); caret-color: #f59e0b; outline: none; }
.setup-root .otp-box:focus { border-color: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, .15); }
.setup-root .otp-box.filled { border-color: #f59e0b; background: #fffbeb; transform: translateY(-1px); }
.setup-root .pick { transition: border-color .2s var(--ease), background-color .2s var(--ease), box-shadow .2s var(--ease), transform .2s var(--ease); cursor: pointer; }
.setup-root .pick:hover { border-color: #fcd34d; }
.setup-root .pick.selected { border-color: #f59e0b; background: #fffbeb; box-shadow: 0 0 0 3px rgba(245, 158, 11, .18); }
.setup-root .day { transition: background-color .15s ease, color .15s ease, border-color .15s ease, transform .12s ease; cursor: pointer; user-select: none; }
.setup-root .day:active { transform: scale(.94); }
.setup-root .day.on { background: #f59e0b; color: #fff; border-color: #f59e0b; }
.setup-root .pdot { transition: background-color .3s var(--ease), color .3s var(--ease), border-color .3s var(--ease), transform .3s var(--ease); }
.setup-root .spin { animation: setup-spin 1s linear infinite; }
@keyframes setup-spin { to { transform: rotate(360deg); } }
.setup-root .dot-pulse { position: relative; }
.setup-root .dot-pulse::after { content: ''; position: absolute; inset: -4px; border-radius: 9999px; background: currentColor; opacity: .35; animation: setup-ping 1.4s var(--ease) infinite; }
@keyframes setup-ping { 0% { transform: scale(.8); opacity: .5; } 80%, 100% { transform: scale(2.1); opacity: 0; } }
.setup-root .animate-in { animation: setup-fadeUp .5s var(--ease) both; }
@keyframes setup-fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.setup-root .check-pop { animation: setup-pop .6s var(--ease) both; }
@keyframes setup-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .setup-root .animate-in, .setup-root .check-pop, .setup-root .dot-pulse::after, .setup-root .spin { animation: none !important; }
}
`;

type ApiAgentSetup = {
  listing: {
    id: string;
    name: string;
    shortDescription?: string | null;
    description?: string | null;
    priceCents?: number | null;
    tags?: string[];
    architectName?: string | null;
  };
  business: { id: string; name: string; type: string } | null;
  phone: { forwardToPhone?: string | null; platformNumber?: string | null; verified?: boolean } | null;
  setup: {
    phoneVerified: boolean;
    verifiedPhone: string | null;
    tone: string;
    message: string | null;
    messageEdited: boolean;
    hoursMode: string;
    startTime: string;
    endTime: string;
    days: Record<string, boolean> | null;
    tested: boolean;
    live: boolean;
  };
  status: string | null;
};

type ToneId = "friendly" | "professional" | "casual";

const TONES: { id: ToneId; emoji: string; label: string }[] = [
  { id: "friendly", emoji: "😊", label: "Friendly" },
  { id: "professional", emoji: "👔", label: "Professional" },
  { id: "casual", emoji: "🤙", label: "Casual" }
];

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
  { key: "sun", label: "S" }
];

const COUNTRIES = [
  { flag: "🇺🇸", code: "+1", name: "United States" },
  { flag: "🇨🇦", code: "+1", name: "Canada" },
  { flag: "🇬🇧", code: "+44", name: "United Kingdom" },
  { flag: "🇦🇺", code: "+61", name: "Australia" },
  { flag: "🇮🇳", code: "+91", name: "India" }
];

const STEPS = [
  { n: 1, label: "Connect" },
  { n: 2, label: "Configure" },
  { n: 3, label: "Test" },
  { n: 4, label: "Go live" }
];

function digitsOnly(value: string) {
  return (value || "").replace(/\D/g, "");
}

function formatPhone(value: string) {
  const d = digitsOnly(value).slice(0, 10);
  if (d.length > 6) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length > 3) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  if (d.length > 0) return `(${d}`;
  return "";
}

function genMessage(tone: ToneId, name: string) {
  const n = name.trim() || "our office";
  if (tone === "professional")
    return `Hello, this is ${n}. We're sorry we missed your call. Please reply to this message and a team member will follow up shortly to schedule your visit.`;
  if (tone === "casual")
    return `Hey! Sorry we missed you at ${n} 🤙 Want to grab an appointment? Just reply YES and we'll sort it out!`;
  return `Hi! Sorry we missed your call at ${n}. 😊 Want to book an appointment? Reply YES and we'll get you scheduled right away.`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "MD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function BusinessAgentSetupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <SetupWizard />
    </Suspense>
  );
}

function SetupWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listingId = searchParams.get("listingId") ?? "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [agent, setAgent] = useState<ApiAgentSetup | null>(null);

  const [step, setStep] = useState(1);
  const [completed, setCompleted] = useState<Record<number, boolean>>({ 1: false, 2: false, 3: false, 4: false });

  // Step 1 — phone + OTP
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [ccOpen, setCcOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otp, setOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [devCode, setDevCode] = useState("");
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const autoSentRef = useRef(false);

  // Step 2 — configure
  const [bizName, setBizName] = useState("");
  const [tone, setTone] = useState<ToneId>("friendly");
  const [message, setMessage] = useState("");
  const [messageEdited, setMessageEdited] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [hoursMode, setHoursMode] = useState<"247" | "custom">("247");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("18:00");
  const [days, setDays] = useState<Record<string, boolean>>({
    mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Step 3 — test
  const [testStage, setTestStage] = useState<0 | 1 | 2 | 3>(0);
  const [testRunning, setTestRunning] = useState(false);
  const [testConfirmed, setTestConfirmed] = useState(false);
  const testTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Step 4
  const [goingLive, setGoingLive] = useState(false);
  const confettiRef = useRef<HTMLCanvasElement | null>(null);

  const e164Phone = useMemo(() => `${country.code}${digitsOnly(phone)}`, [country, phone]);
  const phoneValid = digitsOnly(phone).length === 10;
  const shownNumber = phoneValid ? formatPhone(phone) : agent?.setup.verifiedPhone || "(555) 867-5309";

  // ---- Load the purchased agent ----
  useEffect(() => {
    if (!listingId) {
      setLoading(false);
      setLoadError("No agent selected. Open this page from My Agents.");
      return;
    }

    let mounted = true;

    (async () => {
      setLoading(true);
      setLoadError("");

      const res = await apiGet<ApiAgentSetup>(`/setup/agent/${listingId}`);
      if (!mounted) return;

      if (!res.success || !res.data) {
        setLoadError(res.error ?? "Could not load this agent.");
        setLoading(false);
        return;
      }

      const data = res.data;
      setAgent(data);

      const initialName = data.setup.message && data.business?.name ? data.business.name : data.business?.name || data.listing.name;
      setBizName(initialName);

      const initialTone = (["friendly", "professional", "casual"].includes(data.setup.tone) ? data.setup.tone : "friendly") as ToneId;
      setTone(initialTone);
      setMessageEdited(data.setup.messageEdited);
      setMessage(data.setup.message || genMessage(initialTone, initialName));
      setHoursMode(data.setup.hoursMode === "custom" ? "custom" : "247");
      setStartTime(data.setup.startTime || "08:00");
      setEndTime(data.setup.endTime || "18:00");
      if (data.setup.days) setDays((prev) => ({ ...prev, ...data.setup.days }));

      if (data.setup.phoneVerified) {
        setPhoneVerified(true);
        if (data.setup.verifiedPhone) {
          setPhone(digitsOnly(data.setup.verifiedPhone).slice(-10));
        }
        setCompleted((prev) => ({ ...prev, 1: true }));
      }
      if (data.setup.tested) {
        setTestConfirmed(true);
        setTestStage(3);
        setCompleted((prev) => ({ ...prev, 2: true, 3: true }));
      }

      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [listingId]);

  // Keep the suggested message in sync with tone/name unless manually edited.
  useEffect(() => {
    if (!messageEdited) setMessage(genMessage(tone, bizName));
  }, [tone, bizName, messageEdited]);

  // ---- Step 1: OTP ----
  const sendOtp = useCallback(async () => {
    if (!phoneValid || phoneVerified || !listingId) return;
    setSendingOtp(true);
    setOtpError("");
    setDevCode("");
    setShowVerify(true);

    const res = await apiPost<{ sent: boolean; devCode?: string }>("/setup/send-otp", {
      listingId,
      phone: e164Phone
    });

    setSendingOtp(false);

    if (!res.success) {
      setOtpError(res.error ?? "Could not send the code. Try again.");
      return;
    }
    if (res.data?.devCode) setDevCode(res.data.devCode);
    setTimeout(() => otpRefs.current[0]?.focus(), 120);
  }, [phoneValid, phoneVerified, listingId, e164Phone]);

  // Auto-send once the number is complete.
  useEffect(() => {
    if (phoneValid && !phoneVerified && !autoSentRef.current) {
      autoSentRef.current = true;
      const t = setTimeout(sendOtp, 500);
      return () => clearTimeout(t);
    }
    if (!phoneValid) {
      autoSentRef.current = false;
      setShowVerify(false);
    }
  }, [phoneValid, phoneVerified, sendOtp]);

  const verifyOtp = useCallback(
    async (code: string) => {
      if (!listingId) return;
      setVerifying(true);
      setOtpError("");

      const res = await apiPost<{ verified: boolean }>("/setup/verify-otp", {
        listingId,
        phone: e164Phone,
        code
      });

      setVerifying(false);

      if (!res.success) {
        setOtpError(res.error ?? "That code didn't work. Try again.");
        setOtp(["", "", "", "", "", ""]);
        setTimeout(() => otpRefs.current[0]?.focus(), 60);
        return;
      }

      setPhoneVerified(true);
      setShowVerify(false);
      setCompleted((prev) => ({ ...prev, 1: true }));
    },
    [listingId, e164Phone]
  );

  function handleOtpChange(index: number, value: string) {
    const v = value.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[index] = v;
    setOtp(next);
    if (v && index < 5) otpRefs.current[index + 1]?.focus();

    const code = next.join("");
    if (code.length === 6 && !next.includes("")) verifyOtp(code);
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      e.preventDefault();
      const next = [...otp];
      next[index - 1] = "";
      setOtp(next);
      otpRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const txt = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!txt) return;
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < txt.length; i++) next[i] = txt[i];
    setOtp(next);
    const target = Math.min(txt.length, 5);
    otpRefs.current[target]?.focus();
    if (txt.length === 6) verifyOtp(txt);
  }

  function useDifferentNumber() {
    setPhoneVerified(false);
    setShowVerify(false);
    setPhone("");
    setOtp(["", "", "", "", "", ""]);
    setOtpError("");
    setDevCode("");
    autoSentRef.current = false;
    setCompleted((prev) => ({ ...prev, 1: false }));
  }

  // ---- Step 2: configure ----
  async function saveConfig() {
    if (!listingId) return;
    setSavingConfig(true);

    const res = await apiPost<{ configured: boolean }>("/setup/configure", {
      listingId,
      businessName: bizName.trim() || agent?.listing.name || "My Business",
      tone,
      message,
      messageEdited,
      hoursMode,
      startTime,
      endTime,
      days
    });

    setSavingConfig(false);
    if (!res.success) return;

    setCompleted((prev) => ({ ...prev, 2: true }));
    goToStep(3);
  }

  // ---- Step 3: test ----
  const clearTestTimers = useCallback(() => {
    testTimers.current.forEach(clearTimeout);
    testTimers.current = [];
  }, []);

  function runTest() {
    clearTestTimers();
    setTestRunning(true);
    setTestStage(0);

    if (listingId) {
      apiPost("/setup/test-sms", { listingId }).catch(() => undefined);
    }

    testTimers.current.push(setTimeout(() => setTestStage(1), 2400));
    testTimers.current.push(setTimeout(() => setTestStage(2), 4600));
    testTimers.current.push(
      setTimeout(() => {
        setTestStage(3);
        setTestRunning(false);
      }, 7200)
    );
  }

  useEffect(() => clearTestTimers, [clearTestTimers]);

  function confirmTest() {
    setTestConfirmed(true);
    setCompleted((prev) => ({ ...prev, 3: true }));
  }

  // ---- Step 4: go live ----
  const goLive = useCallback(async () => {
    if (!listingId) return;
    setGoingLive(true);
    const res = await apiPost<{ live: boolean }>("/setup/go-live", { listingId });
    setGoingLive(false);
    if (res.success) setCompleted((prev) => ({ ...prev, 4: true }));
  }, [listingId]);

  function goToStep(n: number) {
    const next = Math.max(1, Math.min(4, n));
    setStep(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    if (next === 4) {
      goLive();
      fireConfetti();
    }
  }

  // ---- confetti ----
  function fireConfetti() {
    const canvas = confettiRef.current;
    if (!canvas) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.display = "block";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = ["#f59e0b", "#fbbf24", "#f97316", "#fcd34d", "#fb923c", "#22c55e"];
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.3;
    const parts = Array.from({ length: 60 }, (_, i) => {
      const a = Math.random() * Math.PI * 2;
      const sp = 5 + Math.random() * 9;
      return {
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 7,
        g: 0.2 + Math.random() * 0.12, w: 6 + Math.random() * 7, h: 8 + Math.random() * 8,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.34,
        color: colors[i % colors.length], life: 0, ttl: 150 + Math.random() * 50
      };
    });

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of parts) {
        if (p.life > p.ttl) continue;
        alive = true;
        p.life++;
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.ttl);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(tick);
      else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = "none";
      }
    };
    cancelAnimationFrame(raf);
    tick();
  }

  const charCount = message.length;
  const avatar = initials(bizName);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 text-slate-900">
        <div className="mx-auto max-w-2xl px-5 py-12">
          <div className="h-12 w-48 animate-pulse rounded-lg bg-white" />
          <div className="mt-8 h-96 animate-pulse rounded-2xl border border-gray-100 bg-white" />
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-gray-50 text-slate-900">
        <div className="mx-auto max-w-xl px-5 py-16 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-2xl">⚠️</div>
          <h1 className="mt-4 text-lg font-semibold" data-testid="agent-setup-error-heading">Could not open setup</h1>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500" data-testid="agent-setup-error-text">{loadError}</p>
          <button
            type="button"
            onClick={() => router.push(BUSINESS_AGENTS_PATH)}
            data-testid="agent-setup-back-to-agents"
            className="mt-6 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            Back to My Agents
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="setup-root min-h-screen bg-gray-50 text-slate-900">
      <style dangerouslySetInnerHTML={{ __html: WIZARD_STYLES }} />

      {/* Wizard header / progress */}
      <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 px-4 py-4 backdrop-blur sm:px-8" data-testid="agent-setup-header">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold tracking-tight text-slate-900" data-testid="agent-setup-agent-name">
              {agent?.listing.name ?? "Set up your agent"}
            </p>
            <p className="text-xs text-slate-400">Set up your agent</p>
          </div>

          <nav className="flex items-center" aria-label="Setup progress">
            {STEPS.map((s, idx) => {
              const isDone = completed[s.n];
              const isActive = s.n === step;
              return (
                <div key={s.n} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (completed[s.n] || s.n <= step) goToStep(s.n);
                    }}
                    className="flex items-center gap-2"
                    data-testid={`agent-setup-step-${s.n}`}
                  >
                    <span
                      className={`pdot grid h-7 w-7 place-items-center rounded-full border text-xs font-bold ${
                        isActive
                          ? "scale-105 border-amber-500 bg-amber-500 text-white shadow-md shadow-amber-500/40"
                          : isDone
                            ? "border-amber-500 bg-amber-500 text-white"
                            : "border-transparent bg-slate-100 text-slate-400"
                      }`}
                    >
                      {isDone ? <CheckIcon /> : s.n}
                    </span>
                    <span
                      className={`hidden text-sm font-semibold sm:inline ${
                        isActive || isDone ? "text-amber-700" : "text-slate-400"
                      }`}
                    >
                      {s.label}
                    </span>
                  </button>
                  {idx < STEPS.length - 1 ? (
                    <span className={`mx-2 h-0.5 w-6 rounded-full sm:w-9 ${completed[s.n] ? "bg-amber-500" : "bg-slate-200"}`} />
                  ) : null}
                </div>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-10 sm:px-6 sm:py-12">
        {/* ===================== STEP 1 — CONNECT ===================== */}
        {step === 1 ? (
          <section className="animate-in rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8" data-testid="agent-setup-panel-1">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>

            <h1 className="mt-5 text-2xl font-bold tracking-tight">Connect your business phone</h1>
            <p className="mt-2 max-w-md text-base text-slate-500">
              This is the number your customers call. We detect missed calls and text them back automatically.
            </p>

            <div className="mt-8">
              <label htmlFor="setup-phone" className="mb-2 block text-sm font-medium text-slate-700">Business phone number</label>
              <div className={`phone-wrap relative flex items-stretch overflow-hidden rounded-xl border border-gray-200 bg-white ${phoneValid && !phoneVerified ? "is-valid" : ""}`}>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCcOpen((v) => !v)}
                    className="flex h-full items-center gap-1.5 border-r border-gray-200 bg-gray-50 px-4 py-4 text-base font-medium text-slate-700 transition-colors hover:bg-gray-100"
                    data-testid="agent-setup-country-button"
                  >
                    <span className="text-lg leading-none">{country.flag}</span>
                    <span>{country.code}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-slate-400">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {ccOpen ? (
                    <ul className="absolute left-0 z-40 mt-2 w-52 rounded-xl border border-gray-100 bg-white py-1.5 text-sm shadow-xl">
                      {COUNTRIES.map((cn) => (
                        <li key={`${cn.name}-${cn.code}`}>
                          <button
                            type="button"
                            onClick={() => {
                              setCountry(cn);
                              setCcOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 px-4 py-2.5 hover:bg-amber-50"
                          >
                            <span className="text-lg">{cn.flag}</span>
                            <span className="flex-1 text-left">{cn.name}</span>
                            <span className="text-slate-400">{cn.code}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <input
                  id="setup-phone"
                  type="tel"
                  inputMode="numeric"
                  value={formatPhone(phone)}
                  readOnly={phoneVerified}
                  onChange={(e) => setPhone(digitsOnly(e.target.value).slice(0, 10))}
                  className="field flex-1 border-0 px-5 py-4 font-mono text-lg outline-none placeholder:text-slate-300"
                  placeholder="(555) 123-4567"
                  data-testid="agent-setup-phone-input"
                />
                {phoneValid && !phoneVerified ? (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500">
                    <CheckIcon className="h-5 w-5" />
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-slate-400">We&apos;ll send a verification code to confirm this is your number.</p>
            </div>

            {showVerify && !phoneVerified ? (
              <div className="mt-6" data-testid="agent-setup-verify-block">
                <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-slate-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-5 w-5 shrink-0 text-amber-500">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                  <span>
                    Enter the 6-digit code we sent to <strong className="text-slate-800">{formatPhone(phone)}</strong>.
                  </span>
                </div>

                <div className="mt-4 flex justify-between gap-2 sm:gap-2.5">
                  {otp.map((value, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        otpRefs.current[i] = el;
                      }}
                      inputMode="numeric"
                      maxLength={1}
                      value={value}
                      disabled={verifying}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      onPaste={handleOtpPaste}
                      aria-label={`Digit ${i + 1}`}
                      className={`otp-box ${value ? "filled" : ""}`}
                      data-testid={`agent-setup-otp-${i}`}
                    />
                  ))}
                </div>

                <div className="mt-3 flex items-center gap-4 text-sm">
                  <button
                    type="button"
                    onClick={sendOtp}
                    disabled={sendingOtp}
                    className="font-medium text-amber-600 transition-colors hover:text-amber-700 disabled:opacity-50"
                    data-testid="agent-setup-resend"
                  >
                    {sendingOtp ? "Sending…" : "Resend code"}
                  </button>
                  <span className="text-slate-300">·</span>
                  <button
                    type="button"
                    onClick={useDifferentNumber}
                    className="font-medium text-slate-500 transition-colors hover:text-slate-700"
                    data-testid="agent-setup-different-number"
                  >
                    Use a different number
                  </button>
                </div>

                {devCode ? (
                  <p className="mt-2 text-xs text-slate-400">Dev code: <span className="font-mono font-semibold text-slate-600">{devCode}</span></p>
                ) : null}
                {otpError ? <p className="mt-2 text-xs text-red-600" data-testid="agent-setup-otp-error">{otpError}</p> : null}

                {verifying ? (
                  <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="spin h-4 w-4 text-amber-500">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Verifying…
                  </div>
                ) : null}
              </div>
            ) : null}

            {phoneVerified ? (
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-green-100 bg-green-50 p-4" data-testid="agent-setup-phone-success">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-green-500 text-white">
                  <CheckIcon />
                </span>
                <p className="text-sm text-green-800">
                  <span className="font-semibold">Phone connected.</span> {formatPhone(phone) || shownNumber} is now linked to your agent.
                </p>
              </div>
            ) : null}

            <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="self-center text-sm font-medium text-slate-400 transition-colors hover:text-slate-600 sm:self-auto"
                data-testid="agent-setup-skip-1"
              >
                Skip for now
              </button>
              <button
                type="button"
                disabled={!phoneVerified}
                onClick={() => goToStep(2)}
                className="btn inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-8 py-3.5 font-semibold text-white shadow-lg shadow-amber-500/30 hover:bg-amber-600 sm:w-auto"
                data-testid="agent-setup-continue-1"
              >
                Continue
                <ArrowRight />
              </button>
            </div>
          </section>
        ) : null}

        {/* ===================== STEP 2 — CONFIGURE ===================== */}
        {step === 2 ? (
          <section className="animate-in rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8" data-testid="agent-setup-panel-2">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-50 text-violet-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
                <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
              </svg>
            </div>

            <h2 className="mt-5 text-2xl font-bold tracking-tight">Customize your text-back message</h2>
            <p className="mt-2 max-w-md text-base text-slate-500">
              This is what customers receive when you miss their call. Our AI personalizes it — you set the tone.
            </p>

            <div className="mt-8">
              <label htmlFor="setup-bizname" className="mb-2 block text-sm font-medium text-slate-700">
                Your business name <span className="font-normal text-slate-400">(as it appears in texts)</span>
              </label>
              <div className="relative">
                <input
                  id="setup-bizname"
                  type="text"
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  className="field w-full rounded-xl border border-gray-200 px-5 py-4 pr-12 text-base outline-none"
                  data-testid="agent-setup-bizname-input"
                />
                {bizName.trim() ? (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500">
                    <CheckIcon className="h-5 w-5" />
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-6">
              <span className="mb-2 block text-sm font-medium text-slate-700">Message tone</span>
              <div className="grid grid-cols-3 gap-3">
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTone(t.id);
                      setMessageEdited(false);
                    }}
                    className={`pick relative rounded-xl border border-gray-200 p-4 text-center ${tone === t.id ? "selected" : ""}`}
                    data-testid={`agent-setup-tone-${t.id}`}
                  >
                    {tone === t.id ? (
                      <span className="absolute right-2 top-2 text-amber-500">
                        <CheckIcon />
                      </span>
                    ) : null}
                    <span className="block text-2xl">{t.emoji}</span>
                    <span className="mt-1.5 block text-sm font-semibold text-slate-700">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <span className="mb-2 block text-sm font-medium text-slate-700">Preview</span>
              <div className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-bold text-violet-600">{avatar}</span>
                <div className="min-w-0 flex-1">
                  <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-700 shadow-sm" data-testid="agent-setup-message-preview">
                    {message}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowEditor((v) => !v)}
                      className="text-sm font-medium text-amber-600 transition-colors hover:text-amber-700"
                      data-testid="agent-setup-edit-toggle"
                    >
                      {showEditor ? "Hide editor" : "Edit message"}
                    </button>
                    <span className={`text-xs ${charCount > 160 ? "text-red-600" : "text-slate-400"}`}>{charCount}/160 characters</span>
                  </div>
                  {showEditor ? (
                    <div className="mt-2">
                      <textarea
                        rows={4}
                        value={message}
                        onChange={(e) => {
                          setMessage(e.target.value);
                          setMessageEdited(true);
                        }}
                        className="field w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none"
                        data-testid="agent-setup-message-editor"
                      />
                      <button
                        type="button"
                        onClick={() => setMessageEdited(false)}
                        className="mt-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
                        data-testid="agent-setup-reset-message"
                      >
                        Reset to suggested message
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <span className="mb-2 block text-sm font-medium text-slate-700">When should the agent respond?</span>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setHoursMode("247")}
                  className={`pick flex w-full items-start gap-3 rounded-xl border border-gray-200 p-4 text-left ${hoursMode === "247" ? "selected" : ""}`}
                  data-testid="agent-setup-hours-247"
                >
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${hoursMode === "247" ? "border-amber-500" : "border-slate-300"}`}>
                    <span className={`h-2.5 w-2.5 rounded-full bg-amber-500 ${hoursMode === "247" ? "" : "hidden"}`} />
                  </span>
                  <span className="flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">24/7 — always respond</span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Recommended</span>
                    </span>
                    <span className="mt-0.5 block text-sm text-slate-500">Never miss a call, even after hours or on weekends.</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setHoursMode("custom")}
                  className={`pick flex w-full items-start gap-3 rounded-xl border border-gray-200 p-4 text-left ${hoursMode === "custom" ? "selected" : ""}`}
                  data-testid="agent-setup-hours-custom"
                >
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${hoursMode === "custom" ? "border-amber-500" : "border-slate-300"}`}>
                    <span className={`h-2.5 w-2.5 rounded-full bg-amber-500 ${hoursMode === "custom" ? "" : "hidden"}`} />
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold text-slate-800">Business hours only</span>
                    <span className="mt-0.5 block text-sm text-slate-500">Respond during the hours you choose.</span>
                  </span>
                </button>

                {hoursMode === "custom" ? (
                  <div className="rounded-xl border border-gray-100 bg-slate-50 p-4" data-testid="agent-setup-custom-hours">
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <label htmlFor="setup-start" className="mb-1 block text-xs font-medium text-slate-500">Start</label>
                        <input
                          id="setup-start"
                          type="time"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="field rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
                        />
                      </div>
                      <span className="mt-5 text-slate-400">→</span>
                      <div>
                        <label htmlFor="setup-end" className="mb-1 block text-xs font-medium text-slate-500">End</label>
                        <input
                          id="setup-end"
                          type="time"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="field rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <span className="mb-2 block text-xs font-medium text-slate-500">Active days</span>
                      <div className="flex flex-wrap gap-1.5">
                        {DAYS.map((d, i) => (
                          <button
                            key={`${d.key}-${i}`}
                            type="button"
                            onClick={() => setDays((prev) => ({ ...prev, [d.key]: !prev[d.key] }))}
                            className={`day grid h-10 w-10 place-items-center rounded-lg border border-gray-200 text-sm font-semibold text-slate-600 ${days[d.key] ? "on" : ""}`}
                            data-testid={`agent-setup-day-${d.key}`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => goToStep(1)}
                className="self-center text-sm font-medium text-slate-400 transition-colors hover:text-slate-600 sm:self-auto"
                data-testid="agent-setup-back-2"
              >
                Back
              </button>
              <button
                type="button"
                disabled={savingConfig || !bizName.trim()}
                onClick={saveConfig}
                className="btn inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-8 py-3.5 font-semibold text-white shadow-lg shadow-amber-500/30 hover:bg-amber-600 sm:w-auto"
                data-testid="agent-setup-continue-2"
              >
                {savingConfig ? "Saving…" : "Continue"}
                {savingConfig ? null : <ArrowRight />}
              </button>
            </div>
          </section>
        ) : null}

        {/* ===================== STEP 3 — TEST ===================== */}
        {step === 3 ? (
          <section className="animate-in rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8" data-testid="agent-setup-panel-3">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-green-50 text-green-600">
              <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-6 w-6">
                <polygon points="6 3 20 12 6 21 6 3" />
              </svg>
            </div>

            <h2 className="mt-5 text-2xl font-bold tracking-tight">Let&apos;s test it live</h2>
            <p className="mt-2 max-w-md text-base text-slate-500">
              We&apos;ll send a sample text to your verified number so you can see exactly what your customers receive.
            </p>

            <div className="mt-8 rounded-xl border border-slate-100 bg-slate-50 p-5 sm:p-6">
              <ol className="space-y-3.5">
                <li className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">1</span>
                  <span className="text-sm text-slate-700">Tap <strong>Send a test text</strong> below</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">2</span>
                  <span className="text-sm text-slate-700">Watch the live feed light up</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">3</span>
                  <span className="text-sm text-slate-700">Check <strong>{shownNumber}</strong> for the text-back</span>
                </li>
              </ol>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Live agent feed</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${testStage >= 3 ? "bg-green-500" : testRunning ? "bg-amber-500" : "bg-slate-300"}`} />
                  {testStage >= 3 ? "Test passed" : testRunning ? "Listening" : "Idle"}
                </span>
              </div>

              <div className="divide-y divide-slate-50 rounded-xl border border-slate-100 bg-white">
                <div className={`flex items-center gap-3 p-4 transition-opacity ${testRunning || testStage > 0 ? "opacity-100" : "opacity-40"}`}>
                  <span className="dot-pulse h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 text-amber-400" />
                  <span className="text-sm text-slate-500">Waiting for a missed call…</span>
                </div>
                <div className={`flex items-center gap-3 p-4 transition-opacity ${testStage >= 1 ? "opacity-100" : "opacity-30"}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />
                  <span className="flex-1 text-sm text-slate-700">Missed call detected</span>
                </div>
                <div className={`flex items-center gap-3 p-4 transition-opacity ${testStage >= 2 ? "opacity-100" : "opacity-30"}`}>
                  {testStage === 2 ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="spin h-4 w-4 shrink-0 text-violet-500">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" />
                  )}
                  <span className="flex-1 text-sm text-slate-700">AI generating a personalized response…</span>
                </div>
                <div className={`flex items-center gap-3 p-4 transition-opacity ${testStage >= 3 ? "opacity-100" : "opacity-30"}`}>
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-green-500 text-white">
                    <CheckIcon className="h-3 w-3" />
                  </span>
                  <span className="flex-1 text-sm font-semibold text-green-700">SMS sent successfully</span>
                </div>
              </div>

              {testStage >= 3 ? (
                <div className="mt-5 flex justify-center">
                  <div className="w-64 rounded-[2rem] border-8 border-slate-900 bg-slate-50 p-4 shadow-xl">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-500 text-xs font-bold text-white">{avatar}</span>
                      <div className="leading-tight">
                        <p className="text-xs font-semibold text-slate-800">{bizName.trim() || "Your business"}</p>
                        <p className="text-[10px] text-slate-400">Text message · now</p>
                      </div>
                    </div>
                    <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] leading-snug text-slate-700 shadow-sm">
                      {message}
                    </div>
                  </div>
                </div>
              ) : null}

              {!testConfirmed ? (
                <div className="mt-6 flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={testRunning}
                    className="btn inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow-lg shadow-amber-500/30 hover:bg-amber-600 sm:w-auto"
                    data-testid="agent-setup-run-test"
                  >
                    {testRunning ? (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="spin h-4 w-4">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        Listening…
                      </>
                    ) : testStage >= 3 ? (
                      "Run again"
                    ) : (
                      "Send a test text"
                    )}
                  </button>
                  {testStage >= 3 ? (
                    <button
                      type="button"
                      onClick={confirmTest}
                      className="btn inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 px-6 py-3 font-semibold text-white shadow-lg shadow-green-500/30 hover:bg-green-600 sm:w-auto"
                      data-testid="agent-setup-confirm-test"
                    >
                      <CheckIcon />
                      I received the text
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-green-600" data-testid="agent-setup-test-confirmed">
                  <CheckIcon />
                  Nice — your agent works. You&apos;re ready to go live.
                </p>
              )}
            </div>

            <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="self-center text-sm font-medium text-slate-400 transition-colors hover:text-slate-600 sm:self-auto"
                data-testid="agent-setup-back-3"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!testConfirmed}
                onClick={() => goToStep(4)}
                className="btn inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-8 py-3.5 font-semibold text-white shadow-lg shadow-amber-500/30 hover:bg-amber-600 sm:w-auto"
                data-testid="agent-setup-continue-3"
              >
                Continue
                <ArrowRight />
              </button>
            </div>
          </section>
        ) : null}

        {/* ===================== STEP 4 — GO LIVE ===================== */}
        {step === 4 ? (
          <section className="mx-auto max-w-lg text-center" data-testid="agent-setup-panel-4">
            <div className="check-pop mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-green-500 shadow-xl shadow-amber-500/30">
              <CheckIcon className="h-10 w-10 text-white" />
            </div>

            <h2 className="mt-6 text-3xl font-black tracking-tight">Your agent is live 🎉</h2>
            <p className="mt-3 text-lg text-slate-600">
              {agent?.listing.name ?? "Your agent"} is now protecting your business. Every missed call gets an instant response.
            </p>

            <div className="mt-8 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-7 text-left sm:p-8">
              <p className="mb-4 text-sm font-semibold text-slate-700">Your agent is ready to:</p>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-sm text-slate-700">
                  <span className="shrink-0 text-green-500"><CheckIcon /></span>
                  Detect missed calls on <strong>{shownNumber}</strong>
                </li>
                <li className="flex items-center gap-3 text-sm text-slate-700">
                  <span className="shrink-0 text-green-500"><CheckIcon /></span>
                  Send personalized texts within 30 seconds
                </li>
                <li className="flex items-center gap-3 text-sm text-slate-700">
                  <span className="shrink-0 text-green-500"><CheckIcon /></span>
                  Help customers book appointments automatically
                </li>
              </ul>
              <div className="my-5 h-px bg-amber-200/70" />
              <p className="text-sm font-medium text-amber-700">
                {goingLive ? "Activating your agent…" : "Estimated value: $500–$2,000/month in recovered appointments"}
              </p>
            </div>

            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => router.push(BUSINESS_DASHBOARD_PATH)}
                className="btn w-full max-w-xs rounded-xl bg-amber-500 px-8 py-3.5 font-semibold text-white shadow-lg shadow-amber-500/30 hover:bg-amber-600"
                data-testid="agent-setup-go-dashboard"
              >
                Go to dashboard
              </button>
              <button
                type="button"
                onClick={() => router.push(BUSINESS_MARKETPLACE_PATH)}
                className="btn w-full max-w-xs rounded-xl border border-gray-200 bg-white px-8 py-3.5 font-semibold text-slate-600 hover:border-amber-300 hover:text-slate-800"
                data-testid="agent-setup-browse-more"
              >
                Browse more agents
              </button>
            </div>
          </section>
        ) : null}
      </main>

      <canvas
        ref={confettiRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[100] hidden h-full w-full"
      />
    </div>
  );
}
