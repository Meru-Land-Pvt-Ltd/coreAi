"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CUSTOM_INSTRUCTION_SUGGESTIONS,
  DEFAULT_SILENCE,
  isBuyerAnswerEmpty,
  normalizeBuyerSetupFields,
  normalizeTimeZone,
  validateBuyerSetupAnswers,
  VOICE_PRESETS
} from "@coreai/shared";
import { VoicePicker } from "@/components/common/voice-picker";
import {
  checkMailAliasAvailability,
  disconnectBusinessCalendar,
  getBusinessCalendarOAuthUrl,
  getBusinessMailSetup,
  getBusinessSetup,
  getMarketplaceListing,
  saveBusinessMailSetup,
  saveBusinessSetup,
  sendBusinessTestSms,
  sendMailSetupTestEmail,
  startBusinessSetupPreviewCall,
  testCallRouting,
  sendPhoneOtp,
  verifyPhoneOtp,
  type BusinessPreviewCallSession,
  type BusinessEmailAliasData,
  type BusinessFaq,
  type BusinessHoursItem,
  type BusinessKnowledgeItem,
  type BuyerCustomFieldValue,
  type BuyerSetupFieldDef,
  type CallRoutingResult,
  type PlatformPhoneOption,
  type TestSmsResult
} from "@/components/business/features/api";

const DASHBOARD_ROUTE = "/business/dashboard" as Route;
const STEP_STORAGE_KEY = "biz-setup-step";

const PLATFORM_DEFAULT_VOICE_ID = "triven-default";
const TRIVEN_VOICE_NAME = "Triven Voice";
const DEFAULT_VOICE_PROVIDER = "11labs";
const DEFAULT_ASSISTANT_NAME = "AI Assistant";

const STEPS = [
  { id: 1, title: "Connect", hint: "~60 seconds" },
  { id: 2, title: "Configure", hint: "~2 minutes" },
  { id: 3, title: "Test", hint: "~60 seconds" },
  { id: 4, title: "Go live", hint: "~30 seconds" }
] as const;

const TONES: { value: string; label: string; emoji: string }[] = [
  { value: "friendly", label: "Friendly", emoji: "😊" },
  { value: "professional", label: "Professional", emoji: "👔" },
  { value: "casual", label: "Casual", emoji: "🤙" }
];

const SERVICE_MAP: Record<string, string[]> = {
  dental: ["Consultation", "Root canal", "Cleaning", "Whitening", "Braces"],
  salon: ["Haircut", "Coloring", "Manicure", "Facial", "Massage"],
  clinic: ["General checkup", "Vaccination", "Lab tests", "Follow-up visit"],
  restaurant: ["Reservations", "Takeout orders", "Private events"],
  law: ["Consultation", "Case review", "Document filing"],
  realestate: ["Property viewing", "Listing inquiry", "Valuation"]
};

const BUSINESS_TYPE_OPTIONS = [
  { value: "dental", label: "Dental clinic" },
  { value: "salon", label: "Salon / spa" },
  { value: "clinic", label: "Medical clinic" },
  { value: "restaurant", label: "Restaurant" },
  { value: "law", label: "Law firm" },
  { value: "realestate", label: "Real estate" },
  { value: "other", label: "Other" }
];

const VOICE_OPTIONS = [
  { value: "aria", label: "Aria — Warm & friendly · Female" },
  { value: "miles", label: "Miles — Calm & professional · Male" },
  { value: "sana", label: "Sana — Bright & upbeat · Female" },
  { value: "leo", label: "Leo — Confident & warm · Male" },
  { value: "noor", label: "Noor — Soft & reassuring · Female" },
  { value: "theo", label: "Theo — Crisp & efficient · Male" }
];

// Day rows match the backend AFTER_HOURS parser:
// [{ day: "Monday", open: "HH:mm", close: "HH:mm", closed: boolean }].
const HOURS_DAYS = [
  { day: "Monday", short: "M" },
  { day: "Tuesday", short: "T" },
  { day: "Wednesday", short: "W" },
  { day: "Thursday", short: "T" },
  { day: "Friday", short: "F" },
  { day: "Saturday", short: "S" },
  { day: "Sunday", short: "S" }
] as const;

const DEFAULT_HOURS_DAYS: Record<string, boolean> = {
  Monday: true,
  Tuesday: true,
  Wednesday: true,
  Thursday: true,
  Friday: true,
  Saturday: false,
  Sunday: false
};

const ANSWERING_MODES: { value: string; label: string }[] = [
  { value: "AI_FIRST", label: "AI answers all calls" },
  { value: "NO_ANSWER", label: "AI answers missed / no-answer calls" },
  { value: "BUSY", label: "AI answers when the line is busy" },
  { value: "AFTER_HOURS", label: "AI answers after business hours" },
  { value: "UNREACHABLE", label: "AI answers when the phone is unreachable" }
];

const TIMEZONE_GROUPS: { label: string; zones: string[] }[] = [
  {
    label: "Asia",
    zones: [
      "Asia/Kolkata",
      "Asia/Dubai",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Asia/Bangkok",
      "Asia/Jakarta",
      "Asia/Manila",
      "Asia/Kathmandu",
      "Asia/Karachi"
    ]
  },
  {
    label: "Europe",
    zones: ["Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam"]
  },
  {
    label: "Americas",
    zones: [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Toronto",
      "America/Vancouver",
      "America/Mexico_City"
    ]
  },
  {
    label: "Pacific / Oceania",
    zones: ["Australia/Sydney", "Australia/Melbourne", "Australia/Perth", "Pacific/Auckland"]
  },
  { label: "Other", zones: ["UTC"] }
];

const ALL_ZONES = TIMEZONE_GROUPS.flatMap((group) => group.zones);

const PRESET_VOICE_IDS = new Set([
  PLATFORM_DEFAULT_VOICE_ID,
  ...VOICE_PRESETS.map((preset) => preset.id)
]);

const WIZARD_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

.setup-root {
  --ease: cubic-bezier(.16, 1, .3, 1);
  font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Focus styling */
.setup-root :focus { outline: none; }
.setup-root :focus-visible,
.setup-root a:focus-visible,
.setup-root button:focus-visible,
.setup-root input:focus-visible,
.setup-root select:focus-visible,
.setup-root textarea:focus-visible {
  outline: 2px solid #f59e0b;
  outline-offset: 2px;
  border-radius: 8px;
}

.setup-root .field {
  transition: border-color .2s var(--ease), box-shadow .2s var(--ease), background-color .2s var(--ease);
}
.setup-root .field:focus {
  border-color: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, .15);
}

.setup-root .btn {
  transition: transform .15s ease, box-shadow .25s var(--ease), background-color .2s ease, border-color .2s ease, color .2s ease;
  will-change: transform;
}
.setup-root .btn:not(:disabled):hover {
  transform: translateY(-1px);
}
.setup-root .btn:not(:disabled):active {
  transform: translateY(0) scale(.99);
}
.setup-root .btn:disabled {
  opacity: .45;
  cursor: not-allowed;
  filter: saturate(.6);
  box-shadow: none !important;
}

/* Step Indicator */
.setup-root .progress { display: flex; align-items: center; gap: 0; }
.setup-root .pstep { display: flex; align-items: center; gap: .55rem; }
.setup-root .pdot {
  width: 1.75rem; height: 1.75rem; border-radius: 9999px;
  display: grid; place-items: center;
  font-size: .8rem; font-weight: 700;
  background: #f1f5f9; color: #94a3b8;
  border: 1.5px solid transparent;
  transition: background-color .3s var(--ease), color .3s var(--ease), border-color .3s var(--ease), transform .3s var(--ease);
  flex: none;
}
.setup-root .pdot svg { width: 1rem; height: 1rem; }
.setup-root .plabel { font-size: .85rem; font-weight: 600; color: #94a3b8; transition: color .3s var(--ease); white-space: nowrap; }
.setup-root .pconn { width: 2.25rem; height: 2px; margin: 0 .5rem; background: #e2e8f0; border-radius: 2px; transition: background-color .4s var(--ease); flex: none; }

.setup-root .pstep.upcoming .pdot { background: #f1f5f9; color: #94a3b8; }
.setup-root .pstep.upcoming .plabel { color: #94a3b8; }

.setup-root .pstep.active .pdot { background: #f59e0b; color: #fff; border-color: #f59e0b; box-shadow: 0 6px 16px -4px rgba(245, 158, 11, .5); transform: scale(1.06); }
.setup-root .pstep.active .plabel { color: #b45309; }

.setup-root .pstep.done .pdot { background: #f59e0b; color: #fff; }
.setup-root .pstep.done .plabel { color: #b45309; }

.setup-root .pstep.skipped .pdot { background: #fff; color: #b45309; border-color: #fcd34d; }
.setup-root .pstep.skipped .plabel { color: #b45309; }

.setup-root .pconn.filled { background: #f59e0b; }
.setup-root .pstep.clickable { cursor: pointer; }
.setup-root .pstep.clickable:hover .pdot { transform: scale(1.06); }

@media (max-width: 640px) {
  .setup-root .plabel { display: none; }
  .setup-root .pdot { width: 1.6rem; height: 1.6rem; font-size: .75rem; }
  .setup-root .pdot svg { width: .9rem; height: .9rem; }
  .setup-root .pconn { width: .85rem; margin: 0 .2rem; }
  .setup-root .pstep { gap: 0; }
}
@media (max-width: 380px) {
  .setup-root .logo-text { display: none; }
  .setup-root .pconn { width: .55rem; margin: 0 .15rem; }
  .setup-root .pdot { width: 1.5rem; height: 1.5rem; }
}

/* Phone validation valid state */
.setup-root .phone-wrap { transition: border-color .25s var(--ease), box-shadow .25s var(--ease); }
.setup-root .phone-wrap.is-valid { border-color: #22c55e !important; box-shadow: 0 0 0 4px rgba(34, 197, 94, .12); }
.setup-root .phone-check { opacity: 0; transform: scale(.6); transition: opacity .25s var(--ease), transform .35s var(--ease); }
.setup-root .phone-wrap.is-valid .phone-check { opacity: 1; transform: scale(1); }

/* OTP */
.setup-root .otp-box {
  width: 3rem; height: 3.5rem; text-align: center;
  font-size: 1.35rem; font-weight: 600; font-family: 'Inter', monospace;
  border: 1.5px solid #e2e8f0; border-radius: .75rem; background: #fff; color: #0f172a;
  transition: border-color .2s var(--ease), box-shadow .2s var(--ease), transform .25s var(--ease), background-color .2s var(--ease);
  caret-color: #f59e0b;
}
.setup-root .otp-box:focus { border-color: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, .15); }
.setup-root .otp-box.filled { border-color: #f59e0b; background: #fffbeb; transform: translateY(-1px); }
@media (max-width: 380px) { .setup-root .otp-box { width: 2.5rem; height: 3rem; font-size: 1.15rem; } }

/* Pick cards */
.setup-root .pick { transition: border-color .2s var(--ease), background-color .2s var(--ease), box-shadow .2s var(--ease), transform .2s var(--ease); cursor: pointer; }
.setup-root .pick:hover { border-color: #fcd34d; }
.setup-root .pick.selected { border-color: #f59e0b; background: #fffbeb; box-shadow: 0 0 0 3px rgba(245, 158, 11, .18); }
.setup-root .pick .tick { opacity: 0; transform: scale(.5); transition: opacity .2s var(--ease), transform .3s var(--ease); }
.setup-root .pick.selected .tick { opacity: 1; transform: scale(1); }

/* Day checkboxes */
.setup-root .day { transition: background-color .15s ease, color .15s ease, border-color .15s ease, transform .12s ease; cursor: pointer; user-select: none; }
.setup-root .day:active { transform: scale(.94); }
.setup-root .day.on { background: #f59e0b; color: #fff; border-color: #f59e0b; }

/* Status simulation feed */
.setup-root .feed-item { opacity: 0; transform: translateY(8px); transition: opacity .45s var(--ease), transform .45s var(--ease); }
.setup-root .feed-item.show { opacity: 1; transform: none; }

.setup-root .dot-pulse { position: relative; }
.setup-root .dot-pulse::after {
  content: ''; position: absolute; inset: -4px; border-radius: 9999px;
  background: currentColor; opacity: .35; animation: ping 1.4s var(--ease) infinite;
}
@keyframes ping { 0% { transform: scale(.8); opacity: .5; } 80%, 100% { transform: scale(2.1); opacity: 0; } }

.setup-root .spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.setup-root .bubble { position: relative; }
.setup-root .phone-frame { border: 8px solid #0f172a; border-radius: 2rem; background: #f8fafc; }
.setup-root .sms-ring { box-shadow: 0 0 0 3px rgba(34, 197, 94, .45), 0 18px 40px -16px rgba(0,0,0,.25); }

/* Celebration */
.setup-root .check-pop { animation: pop .6s var(--ease) both; }
@keyframes pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
.setup-root .draw { stroke-dasharray: 48; stroke-dashoffset: 48; animation: draw .5s .25s var(--ease) forwards; }
@keyframes draw { to { stroke-dashoffset: 0; } }

.setup-root .animate-in { animation: fadeUp .5s var(--ease) both; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

.setup-root .stagger > * { opacity: 0; transform: translateY(12px); animation: fadeUp .55s var(--ease) forwards; }
.setup-root .stagger > *:nth-child(1) { animation-delay: .15s; }
.setup-root .stagger > *:nth-child(2) { animation-delay: .28s; }
.setup-root .stagger > *:nth-child(3) { animation-delay: .41s; }
.setup-root .stagger > *:nth-child(4) { animation-delay: .54s; }

.setup-root .confetti-piece { position: fixed; top: -12px; z-index: 60; border-radius: 2px; pointer-events: none; animation-name: setupConfetti; animation-timing-function: linear; animation-fill-mode: forwards; }
@keyframes setupConfetti { to { transform: translateY(105vh) rotate(540deg); opacity: .15; } }
.setup-root .toast-in { animation: setupToast .35s var(--ease); }
@keyframes setupToast { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }

@media (prefers-reduced-motion: reduce) {
  .setup-root .animate-in, .setup-root .check-pop, .setup-root .draw, .setup-root .stagger > *, .setup-root .dot-pulse::after, .setup-root .spin, .setup-root .confetti-piece, .setup-root .toast-in { animation: none !important; }
  .setup-root .draw { stroke-dashoffset: 0; }
  .setup-root .stagger > * { opacity: 1; transform: none; }
  .setup-root .btn:hover, .setup-root .btn:active { transform: none !important; }
}
`;

const FIELD =
  "field w-full rounded-xl border border-gray-200 bg-white px-5 py-4 text-base text-slate-900 placeholder-slate-400 focus:outline-none";
const LABEL = "mb-1.5 block text-sm font-semibold text-slate-700";
const CARD = "animate-in rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8";
const H2 = "text-lg font-bold text-slate-900";
const SUB = "mt-1 text-sm text-slate-500";
const SECTION = "mt-8 border-t border-gray-100 pt-8";
const SECTION_TITLE = "text-sm font-bold text-slate-900";
const PROVIDER_BADGE = "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600";

type ChecklistRow = {
  key: string;
  label: string;
  required: boolean;
  complete: boolean;
  blocker?: string;
};

type PersistResult = {
  ok: boolean;
  number: string;
  vapiAssistantId: string | null;
  installedAgentId: string | null;
};

type UnknownRecord = Record<string, unknown>;

function defaultTimeZone(): string {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "Asia/Kolkata";
  }
}

function parseLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function fmtPhone(s: string): string {
  const d = s.replace(/\D/g, "").slice(0, 10);
  if (d.length > 6) return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
  if (d.length > 3) return "(" + d.slice(0, 3) + ") " + d.slice(3);
  if (d.length > 0) return "(" + d;
  return "";
}

function ConfettiCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const colors = ["#f59e0b", "#fbbf24", "#f97316", "#fcd34d", "#fb923c", "#22c55e"];
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.32;
    const N = 60;
    const parts: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      g: number;
      w: number;
      h: number;
      rot: number;
      vr: number;
      color: string;
      life: number;
      ttl: number;
    }> = [];

    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 5 + Math.random() * 9;
      parts.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 7,
        g: 0.2 + Math.random() * 0.12,
        w: 6 + Math.random() * 7,
        h: 8 + Math.random() * 8,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.34,
        color: colors[i % colors.length],
        life: 0,
        ttl: 150 + Math.random() * 50
      });
    }

    let raf: number;
    const tick = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      let alive = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.life > p.ttl) continue;
        alive = true;
        p.life++;
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rot += p.vr;
        const o = Math.max(0, 1 - p.life / p.ttl);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = o;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 100
      }}
      aria-hidden="true"
    />
  );
}

function normalizeVoiceChoice(value?: string | null): string {
  const voice = (value ?? "").trim().toLowerCase();

  if (!voice || voice === "default" || voice === "agent-default" || voice === "use-agent-default") {
    return PLATFORM_DEFAULT_VOICE_ID;
  }

  return voice;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function readLiveVapiAssistantId(data: unknown): string | null {
  const root = objectOrNull(data);
  if (!root) return null;

  const direct = stringOrNull(root.vapiAssistantId);
  if (direct) return direct;

  const installedAgent = objectOrNull(root.installedAgent);
  const configJson = objectOrNull(installedAgent?.configJson);
  const fromConfig = stringOrNull(configJson?.vapiAssistantId);
  if (fromConfig) return fromConfig;

  const profile = objectOrNull(root.profile);
  const fromProfile = stringOrNull(profile?.vapiAssistantId);
  if (fromProfile) return fromProfile;

  return null;
}

function readInstalledAgentId(data: unknown): string | null {
  const root = objectOrNull(data);
  if (!root) return null;

  const direct = stringOrNull(root.installedAgentId);
  if (direct) return direct;

  const installedAgent = objectOrNull(root.installedAgent);
  return stringOrNull(installedAgent?.id);
}

function readAssistantName(data: unknown): string {
  const root = objectOrNull(data);
  if (!root) return DEFAULT_ASSISTANT_NAME;

  const direct = stringOrNull(root.assistantName);
  if (direct) return direct;

  const setup = objectOrNull(root.setup);
  const fromSetup = stringOrNull(setup?.assistantName);
  if (fromSetup) return fromSetup;

  const installedAgent = objectOrNull(root.installedAgent);
  const configJson = objectOrNull(installedAgent?.configJson);

  const fromConfig = stringOrNull(configJson?.assistantName);
  if (fromConfig) return fromConfig;

  const businessDetails = objectOrNull(configJson?.businessDetails);
  const fromBusinessDetails = stringOrNull(businessDetails?.assistantName);
  if (fromBusinessDetails) return fromBusinessDetails;

  return DEFAULT_ASSISTANT_NAME;
}

export default function BusinessAgentSetupPage() {
  return (
    <Suspense
      fallback={
        <div className="setup-root mx-auto max-w-2xl px-4 py-8">
          <div className="rounded-2xl border border-gray-100 bg-white p-8 text-sm text-slate-500 shadow-sm">
            Loading setup…
          </div>
        </div>
      }
    >
      <SetupWizard />
    </Suspense>
  );
}

function SetupWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listingId = searchParams.get("listingId") ?? "";

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [deployed, setDeployed] = useState(false);
  const [successNumber, setSuccessNumber] = useState<string | null>(null);
  const [liveVapiAssistantId, setLiveVapiAssistantId] = useState<string | null>(null);
  const [liveInstalledAgentId, setLiveInstalledAgentId] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CallRoutingResult | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [listing, setListing] = useState<any>(null);
  const [businessType, setBusinessType] = useState("");
  const [contactName, setContactName] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [faqs, setFaqs] = useState<BusinessFaq[]>([]);
  const [bookingUrl, setBookingUrl] = useState("");
  const [tone, setTone] = useState("friendly");
  const [hoursMode, setHoursMode] = useState<"247" | "custom">("247");
  const [hoursStart, setHoursStart] = useState("09:00");
  const [hoursEnd, setHoursEnd] = useState("18:00");
  const [hoursDays, setHoursDays] = useState<Record<string, boolean>>(DEFAULT_HOURS_DAYS);
  const [knowledge, setKnowledge] = useState<BusinessKnowledgeItem[]>([]);
  const [confetti, setConfetti] = useState<
    { id: number; left: string; size: number; color: string; delay: string; duration: string }[]
  >([]);

  const [phoneNumbers, setPhoneNumbers] = useState<PlatformPhoneOption[]>([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState("");
  const [assignedNumber, setAssignedNumber] = useState<string | null>(null);
  const [forwardToPhone, setForwardToPhone] = useState("");
  const [teamPhone, setTeamPhone] = useState("");
  const [answeringMode, setAnsweringMode] = useState("NO_ANSWER");
  const [calendar, setCalendar] = useState<{ connected: boolean; email: string | null }>({
    connected: false,
    email: null
  });
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarId, setCalendarId] = useState("primary");
  const [timeZone, setTimeZone] = useState(defaultTimeZone);

  // Phone Verification States
  const [existingPhoneNumber, setExistingPhoneNumber] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(6).fill(""));
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [assistantName, setAssistantName] = useState(DEFAULT_ASSISTANT_NAME);
  const [voiceChoice, setVoiceChoice] = useState(PLATFORM_DEFAULT_VOICE_ID);
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [silenceRepromptCount, setSilenceRepromptCount] = useState<number>(DEFAULT_SILENCE.repromptCount);
  const [silenceMessage1, setSilenceMessage1] = useState("");
  const [silenceMessage2, setSilenceMessage2] = useState("");
  const [goodbyeMessage, setGoodbyeMessage] = useState("");

  const [requiredKeys, setRequiredKeys] = useState<string[]>([]);

  const [mailAlias, setMailAlias] = useState<BusinessEmailAliasData | null>(null);

  // Buyer-owned Send Email recipients (To/CC/BCC). The architect's Email node
  // only defines the template/content — who receives it is decided here.
  const [emailRecipientType, setEmailRecipientType] = useState<"customer" | "team" | "custom">("customer");
  const [emailCustomRecipient, setEmailCustomRecipient] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailBcc, setEmailBcc] = useState("");

  const [buyerSetupFields, setBuyerSetupFields] = useState<BuyerSetupFieldDef[]>([]);
  const [buyerSetupInstructions, setBuyerSetupInstructions] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<BuyerCustomFieldValue[]>([]);

  const setCustomFieldValue = useCallback((key: string, label: string, value: string | string[] | boolean) => {
    setCustomFieldValues((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing) {
        return current.map((item) => (item.key === key ? { ...item, label, value } : item));
      }
      return [...current, { key, label, value }];
    });
  }, []);

  // Cooldown effect for Resend code
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Send OTP handler
  const handleSendOtp = useCallback(async () => {
    if (!existingPhoneNumber || existingPhoneNumber.trim().length < 5) {
      setError("Please enter a valid business phone number.");
      return;
    }
    setError("");
    setIsSendingOtp(true);
    try {
      const res = await sendPhoneOtp(listingId, existingPhoneNumber);
      if (res.success && res.data) {
        setOtpSent(true);
        setOtpDigits(Array(6).fill(""));
        setResendCooldown(60);
        if (res.data.devCode) {
          setDevOtpCode(res.data.devCode);
        } else {
          setDevOtpCode(null);
        }
        setStatusMsg(res.data.sent ? "Verification code sent!" : "Verification code generated.");
      } else {
        setError(res.error ?? "Failed to send verification code.");
      }
    } catch (err) {
      setError("Failed to send verification code. Please try again.");
    } finally {
      setIsSendingOtp(false);
    }
  }, [listingId, existingPhoneNumber, setError, setStatusMsg]);

  // Verify OTP handler
  const handleVerifyOtp = useCallback(async (code: string) => {
    if (!code || code.length !== 6) return;
    setError("");
    setIsVerifyingOtp(true);
    try {
      const res = await verifyPhoneOtp(listingId, existingPhoneNumber, code);
      if (res.success && res.data) {
        setPhoneVerified(true);
        setAssignedNumber(res.data.platformNumber);
        setSelectedPhoneId(res.data.platformPhoneNumberId);
        setForwardToPhone(existingPhoneNumber); // Keep forwarding to the verified number
        setStatusMsg("Number verified successfully!");
      } else {
        setError(res.error ?? "Verification failed. Please check the code.");
      }
    } catch (err) {
      setError("Verification failed. Please try again.");
    } finally {
      setIsVerifyingOtp(false);
    }
  }, [listingId, existingPhoneNumber, setError, setStatusMsg]);

  const loadSetup = useCallback(async () => {
    setLoading(true);

    // Mail Setup status feeds the checklist — non-blocking if it fails.
    void getBusinessMailSetup().then((mailRes) => {
      if (mailRes.success && mailRes.data) setMailAlias(mailRes.data.alias);
    });

    const res = await getBusinessSetup(listingId);

    if (res.success && res.data) {
      const data = res.data;

      const existingVapiAssistantId = readLiveVapiAssistantId(data);
      const existingInstalledAgentId = readInstalledAgentId(data);

      setLiveVapiAssistantId(existingVapiAssistantId);
      setLiveInstalledAgentId(existingInstalledAgentId);
      setAssistantName(readAssistantName(data));

      if (data.business) {
        setBusinessName(data.business.name);
        setBusinessType(data.business.type);
      }

      if (data.profile) {
        setBookingUrl(data.profile.bookingUrl ?? "");
        setTeamPhone(data.profile.teamPhone ?? "");
        setTimeZone(normalizeTimeZone(data.profile.timeZone || defaultTimeZone()));
        setTone(data.profile.tone ?? "friendly");
        setServicesText((data.profile.services ?? []).join("\n"));
        setCalendarId(data.profile.calendarId ?? "primary");

        if (Array.isArray(data.profile.faqs) && data.profile.faqs.length > 0) {
          setFaqs(data.profile.faqs);
        }

        const savedHours = data.profile.hours;
        if (Array.isArray(savedHours) && savedHours.length > 0) {
          setHoursMode("custom");
          const dayFlags: Record<string, boolean> = { ...DEFAULT_HOURS_DAYS };
          let start = "09:00";
          let end = "18:00";
          for (const item of savedHours) {
            const match = HOURS_DAYS.find((entry) => entry.day.toLowerCase() === (item.day ?? "").toLowerCase());
            if (!match) continue;
            dayFlags[match.day] = !item.closed;
            if (!item.closed) {
              if (item.open) start = item.open.slice(0, 5);
              if (item.close) end = item.close.slice(0, 5);
            }
          }
          setHoursDays(dayFlags);
          setHoursStart(start);
          setHoursEnd(end);
        } else {
          setHoursMode("247");
        }
      }

      if (Array.isArray(data.knowledge)) {
        setKnowledge(data.knowledge);
      }

      setContactName(data.contactName ?? "");
      setCustomInstructions(data.customInstructions ?? "");

      if (data.silence) {
        if (typeof data.silence.repromptCount === "number") {
          setSilenceRepromptCount(data.silence.repromptCount);
        }

        setSilenceMessage1(data.silence.reprompt1 ?? "");
        setSilenceMessage2(data.silence.reprompt2 ?? "");
        setGoodbyeMessage(data.silence.goodbye ?? "");
      }

      if (data.phoneNumber) {
        setForwardToPhone(data.phoneNumber.forwardToPhone ?? "");
        setAssignedNumber(data.phoneNumber.phoneNumber ?? null);
        if (data.phoneNumber.phoneNumber) {
          setPhoneVerified(true);
          setExistingPhoneNumber(data.phoneNumber.forwardToPhone ?? "");
        }
      }

      setPhoneNumbers(data.availablePhoneNumbers ?? []);
      setSelectedPhoneId(data.selectedPlatformPhoneNumberId ?? "");
      setCalendar(data.calendar ?? { connected: false, email: null });
      setAnsweringMode(data.answeringMode || "NO_ANSWER");

      const selection = data.voiceSelection ?? null;
      const savedVoiceId = (selection?.voiceId ?? "").trim();
      const savedVoiceName = normalizeVoiceChoice(selection?.name);

      if (savedVoiceName === "custom" && savedVoiceId) {
        setVoiceChoice("custom");
        setCustomVoiceId(savedVoiceId);
      } else if (PRESET_VOICE_IDS.has(savedVoiceName)) {
        setVoiceChoice(savedVoiceName);
        setCustomVoiceId("");
      } else if (savedVoiceId) {
        setVoiceChoice("custom");
        setCustomVoiceId(savedVoiceId);
      } else {
        setVoiceChoice(PLATFORM_DEFAULT_VOICE_ID);
        setCustomVoiceId("");
      }

      if (Array.isArray(data.customFields) && data.customFields.length > 0) {
        setCustomFieldValues(data.customFields);
      }

      if (data.emailRecipients) {
        setEmailRecipientType(data.emailRecipients.recipientType ?? "customer");
        setEmailCustomRecipient(data.emailRecipients.customRecipient ?? "");
        setEmailCc((data.emailRecipients.cc ?? []).join(", "));
        setEmailBcc((data.emailRecipients.bcc ?? []).join(", "));
      }

      // Schema snapshot saved with the installed agent — keeps the dynamic
      // fields rendering when the page is revisited without a listingId.
      if (Array.isArray(data.buyerSetupSchema) && data.buyerSetupSchema.length > 0) {
        setBuyerSetupFields(data.buyerSetupSchema.filter((field) => field && field.key && field.label));
      }

      let keys = (data.requiredConnectors ?? []).map((req) => req.connector);
      let loadedBuyerSetupFields = data.buyerSetupSchema?.filter((field) => field && field.key && field.label) || [];

      if (listingId) {
        const listingRes = await getMarketplaceListing(listingId);

        if (listingRes.success && listingRes.data?.listing) {
          setListing(listingRes.data.listing);
          if (!data.installedAgent) {
            keys = Array.from(new Set([...keys, ...listingRes.data.listing.requiredConnectors]));
          }

          const setupFields = normalizeBuyerSetupFields(listingRes.data.listing.requiredBuyerSetup).filter(
            (field) => field.key && field.label
          );
          setBuyerSetupFields(setupFields);
          loadedBuyerSetupFields = setupFields;
          setBuyerSetupInstructions((listingRes.data.listing.buyerSetupInstructions ?? "").trim());
        }
      }

      setRequiredKeys(keys);

      if (typeof window !== "undefined") {
        const savedStep = Number(window.sessionStorage.getItem(STEP_STORAGE_KEY) || "");

        if (savedStep >= 1 && savedStep <= STEPS.length) {
          setStep(savedStep);
        } else {
          // Dynamic resumption: evaluate which step is incomplete based on loaded data
          const hasPhone = Boolean(data.selectedPlatformPhoneNumberId || data.phoneNumber?.phoneNumber);
          const routingMode = data.answeringMode || "AI_FIRST";
          const fwPhone = data.phoneNumber?.forwardToPhone || "";
          const step1Ok = hasPhone && (routingMode === "AI_FIRST" || fwPhone.trim().length >= 5);

          if (!step1Ok) {
            setStep(1);
          } else {
            const bName = data.business?.name || "";
            const bType = data.business?.type || "";
            const setupIssues = validateBuyerSetupAnswers(loadedBuyerSetupFields, data.customFields || [], { requireMissing: true });
            const step2Ok = bName.trim().length >= 2 && bType.trim().length >= 2 && setupIssues.length === 0;

            if (!step2Ok) {
              setStep(2);
            } else {
              // Step 3 check
              const assistantNameVal = readAssistantName(data);
              const step3Ok = assistantNameVal.trim().length >= 2;

              if (!step3Ok) {
                setStep(3);
              } else {
                setStep(4);
              }
            }
          }
        }

        window.sessionStorage.removeItem(STEP_STORAGE_KEY);
      }
    }

    setLoading(false);
  }, [listingId]);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  // Auto-dismiss the status toast.
  useEffect(() => {
    if (!statusMsg) return;
    const timer = window.setTimeout(() => setStatusMsg(""), 2600);
    return () => window.clearTimeout(timer);
  }, [statusMsg]);

  function buildHours(): BusinessHoursItem[] {
    if (hoursMode !== "custom") return [];
    return HOURS_DAYS.map(({ day }) => ({
      day,
      open: hoursStart,
      close: hoursEnd,
      closed: !hoursDays[day]
    }));
  }

  function buildConfetti() {
    const colors = ["#f59e0b", "#fbbf24", "#f97316", "#fcd34d", "#fde68a", "#22c55e"];
    const pieces = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      left: `${Math.random() * 100}vw`,
      size: 6 + Math.random() * 8,
      color: colors[index % colors.length],
      delay: `${Math.random() * 0.6}s`,
      duration: `${2.4 + Math.random() * 1.3}s`
    }));
    setConfetti(pieces);
    window.setTimeout(() => setConfetti([]), 4200);
  }

  function buildVoiceFields(): { voice: string; voiceProvider: string; voiceId: string } {
    const normalizedVoice = normalizeVoiceChoice(voiceChoice);
    if (normalizedVoice === "custom") {
      return {
        voice: "custom",
        voiceProvider: DEFAULT_VOICE_PROVIDER,
        voiceId: customVoiceId.trim()
      };
    }

    return {
      voice: normalizedVoice,
      voiceProvider: DEFAULT_VOICE_PROVIDER,
      voiceId: ""
    };
  }

  const canPersist = businessName.trim().length >= 2 && businessType.trim().length >= 2;

  async function persistSetup(deploy: boolean): Promise<PersistResult> {
    const voiceFields = buildVoiceFields();

    if (!deploy && liveVapiAssistantId) {
      setStatusMsg("Live agent is already deployed. Click Deploy live agent to apply new changes.");

      return {
        ok: true,
        number: assignedNumber ?? "",
        vapiAssistantId: liveVapiAssistantId,
        installedAgentId: liveInstalledAgentId
      };
    }

    const payload = {
      deploy,
      businessName: businessName.trim(),
      businessType: businessType.trim(),
      assistantName: assistantName.trim() || DEFAULT_ASSISTANT_NAME,
      forwardToPhone: forwardToPhone.trim(),
      bookingUrl: bookingUrl.trim(),
      teamPhone: teamPhone.trim(),
      timeZone: timeZone.trim() || defaultTimeZone(),
      tone,
      services: parseLines(servicesText),
      faqs: faqs
        .filter((faq) => faq.question.trim() && faq.answer.trim())
        .map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() })),
      hours: buildHours(),
      knowledge: knowledge
        .filter((item) => item.title.trim() && item.content.trim())
        .map((item) => ({ title: item.title.trim(), content: item.content.trim() })),
      voice: voiceFields.voice,
      voiceProvider: voiceFields.voiceProvider,
      voiceId: voiceFields.voiceId,
      answeringMode,
      contactName: contactName.trim(),
      customInstructions: customInstructions.trim(),
      silenceRepromptCount,
      silenceRepromptMessage1: silenceMessage1.trim(),
      silenceRepromptMessage2: silenceMessage2.trim(),
      goodbyeMessage: goodbyeMessage.trim(),
      customFields: customFieldValues
        .map((field) => ({
          key: field.key,
          label: field.label,
          value: typeof field.value === "string" ? field.value.trim() : field.value
        }))
        .filter((field) => field.key && field.label && !isBuyerAnswerEmpty(field.value))
        // When the schema is known, drop answers for keys no longer in it
        // (e.g. the architect removed a field) — the backend rejects unknowns.
        .filter((field) =>
          buyerSetupFields.length === 0 || buyerSetupFields.some((schemaField) => schemaField.key === field.key)
        ),
      selectedPlatformPhoneNumberId: selectedPhoneId || undefined,
      calendarId: calendarId.trim() || "primary",
      ...(needsMail
        ? {
          emailRecipients: {
            recipientType: emailRecipientType,
            customRecipient: emailCustomRecipient.trim(),
            cc: emailCc.trim(),
            bcc: emailBcc.trim()
          }
        }
        : {}),
      ...(listingId ? { listingId } : {})
    };

    const res = await saveBusinessSetup(payload);

    if (!res.success || !res.data) {
      setError(res.error ?? "Could not save your setup. Please try again.");
      return { ok: false, number: "", vapiAssistantId: null, installedAgentId: null };
    }

    const data = res.data;
    const number = data.assignedPhoneNumber ?? data.phoneNumber?.phoneNumber ?? assignedNumber ?? "";

    const nextVapiAssistantId = data.vapiAssistantId ?? readLiveVapiAssistantId(data) ?? liveVapiAssistantId ?? null;
    const nextInstalledAgentId = data.installedAgentId ?? readInstalledAgentId(data) ?? liveInstalledAgentId ?? null;

    setLiveVapiAssistantId(nextVapiAssistantId);
    setLiveInstalledAgentId(nextInstalledAgentId);

    if (number) {
      setAssignedNumber(number);
    }

    if (data.requiredConnectors) {
      setRequiredKeys(data.requiredConnectors.map((req) => req.connector));
    }

    if (data.availablePhoneNumbers) {
      setPhoneNumbers(data.availablePhoneNumbers);
    }

    if (typeof data.selectedPlatformPhoneNumberId === "string") {
      setSelectedPhoneId(data.selectedPlatformPhoneNumberId);
    }

    setCalendar(data.calendar ?? calendar);

    return {
      ok: true,
      number,
      vapiAssistantId: nextVapiAssistantId,
      installedAgentId: nextInstalledAgentId
    };
  }

  async function handleConnectCalendar() {
    setError("");

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STEP_STORAGE_KEY, String(step));
    }

    setCalendarBusy(true);

    if (canPersist) {
      const saved = await persistSetup(false);

      if (!saved.ok) {
        setCalendarBusy(false);
        return;
      }
    }

    const res = await getBusinessCalendarOAuthUrl();

    if (res.success && res.data?.url) {
      window.location.href = res.data.url;
      return;
    }

    setError(res.error ?? "Could not start Google Calendar connection.");
    setCalendarBusy(false);
  }

  async function handleDisconnectCalendar() {
    setCalendarBusy(true);
    await disconnectBusinessCalendar();
    setCalendar({ connected: false, email: null });
    setCalendarBusy(false);
  }

  async function goNext() {
    setError("");

    if (step === 1 && !phoneVerified) {
      setError("Please verify your business phone number first.");
      return;
    }

    if (step < STEPS.length && canPersist) {
      setSaving(true);
      const saved = await persistSetup(false);
      setSaving(false);

      if (saved.ok) {
        setStatusMsg("Progress saved");
      }
    }

    setStep((current) => Math.min(current + 1, STEPS.length));
  }

  async function handleSaveProgress() {
    setError("");

    if (!canPersist) {
      setError("Add your business name and type to save.");
      return;
    }

    setSaving(true);
    const saved = await persistSetup(false);
    setSaving(false);

    if (saved.ok) {
      setStatusMsg("Progress saved");
    }
  }

  async function handleDeploy() {
    setError("");

    if (businessName.trim().length < 2 || businessType.trim().length < 2) {
      setStep(2);
      setError("Add your business name and type.");
      return;
    }

    if (buyerSetupIssues.length > 0) {
      setStep(2);
      setError(buyerSetupIssues[0].message);
      return;
    }

    if (showVoice && assistantName.trim().length < 2) {
      setStep(2);
      setError("Add your AI assistant name.");
      return;
    }

    if (showPhone && !(selectedPhoneId || assignedNumber)) {
      setStep(1);
      setError("Select a Triven phone number.");
      return;
    }

    if (showPhone && answeringMode !== "AI_FIRST" && forwardToPhone.trim().length < 5) {
      setStep(1);
      setError("Add the phone number that should receive forwarded/live calls.");
      return;
    }

    setSaving(true);
    const result = await persistSetup(true);
    setSaving(false);

    if (!result.ok) return;

    const requiresVoice = new Set(requiredKeys).has("vapi");

    if (requiresVoice && !result.vapiAssistantId) {
      setStep(4);
      setError("Live voice assistant was not created. Check Vapi configuration.");
      return;
    }

    if (!result.installedAgentId || !(result.number || assignedNumber)) {
      setStep(4);
      setError("Deploy did not complete — the agent or phone number was not saved. Please try again.");
      return;
    }

    setDeployed(true);
    setSuccessNumber(result.number || assignedNumber || "");
    buildConfetti();

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleTestCallRouting() {
    setError("");
    setTesting(true);

    const res = await testCallRouting({
      phoneNumber: assignedNumber ?? undefined,
      selectedPlatformPhoneNumberId: selectedPhoneId || undefined
    });

    setTesting(false);

    if (res.success && res.data) {
      setTestResult(res.data);
    } else {
      setError(res.error ?? "Could not test call routing. Please try again.");
    }
  }

  const needs = new Set(requiredKeys);
  const businessComplete = businessName.trim().length >= 2 && businessType.trim().length >= 2;

  // Required + format validation of the agent-specific (architect-defined)
  // setup fields — mirrors the backend's 422 validation on deploy.
  const buyerSetupIssues = validateBuyerSetupAnswers(buyerSetupFields, customFieldValues, { requireMissing: true });
  const buyerSetupComplete = buyerSetupIssues.length === 0;
  const assistantNameComplete = assistantName.trim().length >= 2;
  const phoneSelected = Boolean(selectedPhoneId) || Boolean(assignedNumber);
  const forwardRequired = answeringMode !== "AI_FIRST";
  const phoneComplete = phoneSelected && (!forwardRequired || forwardToPhone.trim().length >= 5);
  const voiceChoiceComplete = voiceChoice !== "custom" || customVoiceId.trim().length > 0;
  const voiceComplete = assistantNameComplete && voiceChoiceComplete;
  const needsCalendar = needs.has("google_calendar");
  const needsGmail = needs.has("gmail");
  const needsPhone = needs.has("phone_provider") || needs.has("twilio");
  const needsSms = needs.has("twilio");
  const needsVoice = needs.has("vapi");
  const needsMail = needs.has("triven_mail");
  const mailComplete = mailAlias?.status === "ACTIVE";

const connectorsKnown = requiredKeys.length > 0;
  const showPhone = !connectorsKnown || needsPhone || needsVoice || needsSms;
  const showCalendar = !connectorsKnown || needsCalendar || needsGmail;
  const showSmsNote = showPhone && needsSms;
  const showMail = !connectorsKnown || needsMail;
  const showVoice = !connectorsKnown || needsVoice;

  const connectTitle =
    showPhone && showCalendar ? "Connect your phone & calendar" : showPhone ? "Connect your phone" : "Connect your services";
  const voiceTitle = showVoice ? "Voice & Instructions" : "Instructions";

  // Per-step completion for the header indicator — a step is "done" when the
  // required checklist items that live on it are complete.
  const connectComplete =
    (!showPhone || phoneComplete) &&
    (!needsCalendar || calendar.connected) &&
    (!needsGmail || calendar.connected) &&
    (!needsMail || mailComplete);
  const configureComplete = businessComplete && buyerSetupComplete && (!showVoice || voiceComplete);
  const stepDone: Record<number, boolean> = {
    1: connectComplete,
    2: configureComplete,
    3: Boolean(testResult?.readyForCall),
    4: deployed
  };

  const checklist: ChecklistRow[] = [
    {
      key: "business_profile",
      label: "Business profile",
      required: true,
      complete: businessComplete,
      blocker: businessComplete ? undefined : "Add your business name and type."
    },
    ...(buyerSetupFields.length > 0
      ? [
        {
          key: "agent_setup",
          label: "Agent setup details",
          required: buyerSetupFields.some((field) => field.required) || !buyerSetupComplete,
          complete: buyerSetupComplete,
          blocker: buyerSetupComplete ? undefined : buyerSetupIssues[0]?.message
        }
      ]
      : []),
    ...(needsCalendar
      ? [
        {
          key: "google_calendar",
          label: "Google Calendar",
          required: true,
          complete: calendar.connected,
          blocker: calendar.connected ? undefined : "Google Calendar is required before live booking."
        }
      ]
      : []),
    ...(needsGmail
      ? [
        {
          key: "gmail",
          label: "Gmail",
          required: true,
          complete: calendar.connected,
          blocker: calendar.connected ? undefined : "Gmail connection is required before sending email."
        }
      ]
      : []),
    ...(needsPhone
      ? [
        {
          key: "phone_routing",
          label: "Triven number & routing",
          required: true,
          complete: phoneComplete,
          blocker: phoneComplete
            ? undefined
            : !phoneSelected
              ? "Select a Triven phone number."
              : answeringMode === "AI_FIRST"
                ? undefined
                : "Add the phone number that should receive forwarded/live calls."
        }
      ]
      : []),
    ...(needsSms
      ? [
        {
          key: "sms_sender",
          label: "SMS sender",
          required: true,
          complete: phoneSelected,
          blocker: phoneSelected ? undefined : "Select a Triven phone number for SMS notifications."
        }
      ]
      : []),
    ...(needsMail
      ? [
        {
          key: "mail_setup",
          label: "Mail Setup",
          required: true,
          complete: mailComplete,
          blocker: mailComplete ? undefined : "Choose your proxy email alias in the Connect step (Mail Setup)."
        }
      ]
      : []),
    ...(needsVoice
      ? [
        {
          key: "voice",
          label: "Voice setup",
          required: true,
          complete: voiceComplete,
          blocker: !assistantNameComplete
            ? "Add your AI assistant name."
            : voiceChoiceComplete
              ? undefined
              : "Enter a custom ElevenLabs voice ID or choose a preset."
        }
      ]
      : [])
  ];

  const readyToDeploy = checklist.every((row) => !row.required || row.complete);
  const blockers = checklist
    .filter((row) => row.required && !row.complete && row.blocker)
    .map((row) => row.blocker as string);

  if (loading) {
    return (
      <div className="setup-root mx-auto max-w-2xl px-4 py-8">
        <div
          data-testid="business-setup-loading"
          className="rounded-2xl border border-gray-100 bg-white p-8 text-sm text-slate-500 shadow-sm"
        >
          Loading your setup…
        </div>
      </div>
    );
  }

  if (deployed) {
    return (
      <div className="setup-root min-h-screen bg-white">
        <style>{WIZARD_STYLES}</style>

        <ConfettiCanvas />

        <div className="mx-auto max-w-lg px-5 py-12 text-center">
          <div data-testid="business-setup-success">
            {/* Pop-in Checkmark circle */}
            <div className="check-pop w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-amber-400 to-green-500 grid place-items-center shadow-xl shadow-amber-500/30">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10">
                <polyline className="draw" points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>

            <div className="stagger">
              <div>
                <h2 className="text-3xl font-black tracking-tight mt-6 text-slate-900" data-testid="business-setup-success-title">
                  Your agent is live 🎉
                </h2>
                <p className="text-lg text-slate-600 mt-3">
                  Missed Call Text-Back is now protecting your practice 24/7. Every missed call gets an instant response.
                </p>
              </div>

              {/* Stats card */}
              <div
                className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-7 sm:p-8 mt-8 border border-amber-100 text-left"
                data-testid="business-setup-success-capabilities"
              >
                <p className="text-sm font-semibold text-slate-700 mb-4">Your agent is ready to:</p>
                <ul className="space-y-3">
                  {showPhone ? (
                    <li className="flex items-center gap-3 text-sm text-slate-700">
                      <span className="text-green-500 shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      <span>
                        Detect missed calls on <strong className="font-semibold text-slate-900 font-mono">{successNumber || assignedNumber || "your Triven number"}</strong>
                      </span>
                    </li>
                  ) : null}
                  <li className="flex items-center gap-3 text-sm text-slate-700">
                    <span className="text-green-500 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </span>
                    <span>Send personalized texts within 30 seconds</span>
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-700">
                    <span className="text-green-500 shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </span>
                    <span>Help patients book appointments automatically</span>
                  </li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="mt-8 flex flex-col gap-3 items-center">
                <button
                  data-testid="business-setup-go-dashboard"
                  type="button"
                  onClick={() => router.push(DASHBOARD_ROUTE)}
                  className="btn bg-amber-500 text-white rounded-xl px-8 py-3.5 font-semibold shadow-lg shadow-amber-500/30 hover:bg-amber-600 w-full max-w-xs"
                >
                  Go to dashboard
                </button>

                <button
                  type="button"
                  onClick={() => setDeployed(false)}
                  className="btn border border-gray-200 rounded-xl px-8 py-3.5 text-slate-600 font-semibold hover:border-amber-300 hover:text-slate-800 bg-white w-full max-w-xs"
                >
                  Edit setup
                </button>
              </div>

              {/* Pro tip */}
              <div className="mt-8 bg-blue-50 rounded-xl p-4 border border-blue-100 text-left max-w-sm mx-auto flex items-start gap-3">
                <span className="text-blue-500 shrink-0 mt-0.5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <path d="M9 18h6M10 22h4"/>
                    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>
                  </svg>
                </span>
                <p className="text-sm text-blue-900">
                  <span className="font-semibold">Pro tip:</span> most practices see their first recovered appointment within 48 hours.
                </p>
              </div>

            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-root bg-gray-50 min-h-screen pb-12" data-testid="business-setup-wizard">
      <style>{WIZARD_STYLES}</style>

      <header className="bg-white border-b border-gray-100 py-4 px-4 sm:px-8 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
         <div className="flex items-center gap-3 sm:gap-4"></div>

          {/* Step indicator */}
          <nav className="progress" aria-label="Setup progress" data-testid="business-setup-progress-dots">
            {STEPS.map((entry, index) => {
              const active = entry.id === step;
              const done = stepDone[entry.id];
              const upcoming = step < entry.id && !done;
              const clickable = phoneVerified || entry.id === 1;

              return (
                <div key={entry.id} className="flex items-center">
                  {index > 0 ? (
                    <span
                      aria-hidden="true"
                      className={`pconn ${stepDone[STEPS[index - 1].id] ? "filled" : ""}`}
                    />
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      if (!phoneVerified && entry.id > 1) {
                        setError("Please verify your business phone number first.");
                        return;
                      }
                      setError("");
                      setStep(entry.id);
                    }}
                    aria-label={`Go to step ${entry.id}: ${entry.title}`}
                    aria-current={active ? "step" : undefined}
                    data-testid={`business-setup-dot-${entry.id}`}
                    className={`pstep group ${active ? "active" : ""} ${done ? "done" : ""} ${upcoming ? "upcoming" : ""} ${clickable ? "clickable" : ""}`}
                  >
                    <span className="pdot" data-dot="true">
                      {done ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        entry.id
                      )}
                    </span>
                    <span className="plabel">{entry.title}</span>
                  </button>
                </div>
              );
            })}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              ~3 min setup
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 sm:px-6 py-10 sm:py-12">
        <div className={CARD}>
          {step === 1 ? (
            <StepConnect
              title={connectTitle}
              showPhone={showPhone}
              showCalendar={showCalendar}
              showSmsNote={showSmsNote}
              showMail={showMail}
              businessName={businessName}
              onMailAliasChange={setMailAlias}
              phoneNumbers={phoneNumbers}
              selectedPhoneId={selectedPhoneId}
              assignedNumber={assignedNumber}
              forwardToPhone={forwardToPhone}
              teamPhone={teamPhone}
              answeringMode={answeringMode}
              calendar={calendar}
              calendarBusy={calendarBusy}
              calendarId={calendarId}
              timeZone={timeZone}
              onSelectPhone={setSelectedPhoneId}
              onForward={setForwardToPhone}
              onTeamPhone={setTeamPhone}
              onAnsweringMode={setAnsweringMode}
              onConnectCalendar={handleConnectCalendar}
              onDisconnectCalendar={handleDisconnectCalendar}
              onCalendarId={setCalendarId}
              onTimeZone={setTimeZone}
              existingPhoneNumber={existingPhoneNumber}
              onExistingPhoneNumberChange={setExistingPhoneNumber}
              otpSent={otpSent}
              onOtpSentChange={setOtpSent}
              onSendOtp={handleSendOtp}
              otpDigits={otpDigits}
              onOtpDigitsChange={setOtpDigits}
              isSendingOtp={isSendingOtp}
              isVerifyingOtp={isVerifyingOtp}
              phoneVerified={phoneVerified}
              onVerifyOtp={handleVerifyOtp}
              devOtpCode={devOtpCode}
              resendCooldown={resendCooldown}
              setPhoneVerified={setPhoneVerified}
            />
          ) : null}

          {step === 2 ? (
            <StepBusiness
              businessName={businessName}
              businessType={businessType}
              contactName={contactName}
              servicesText={servicesText}
              faqs={faqs}
              checklist={checklist}
              setupFields={buyerSetupFields}
              setupInstructions={buyerSetupInstructions}
              customValues={customFieldValues}
              tone={tone}
              hoursMode={hoursMode}
              hoursStart={hoursStart}
              hoursEnd={hoursEnd}
              hoursDays={hoursDays}
              assistantName={assistantName}
              voiceChoice={voiceChoice}
              customVoiceId={customVoiceId}
              showVoice={showVoice}
              onBusinessName={setBusinessName}
              onBusinessType={setBusinessType}
              onContactName={setContactName}
              onServices={setServicesText}
              onFaqs={setFaqs}
              onCustomField={setCustomFieldValue}
              onTone={setTone}
              onHoursMode={setHoursMode}
              onHoursStart={setHoursStart}
              onHoursEnd={setHoursEnd}
              onToggleDay={(day) => setHoursDays((current) => ({ ...current, [day]: !current[day] }))}
            />

            {showMail ? (
              <EmailRecipientsSection
                recipientType={emailRecipientType}
                customRecipient={emailCustomRecipient}
                cc={emailCc}
                bcc={emailBcc}
                onRecipientType={setEmailRecipientType}
                onCustomRecipient={setEmailCustomRecipient}
                onCc={setEmailCc}
                onBcc={setEmailBcc}
              />
            ) : null}

            <StepVoice
              title={voiceTitle}
              showVoice={showVoice}
              assistantName={assistantName}
              voiceChoice={voiceChoice}
              customVoiceId={customVoiceId}
              customInstructions={customInstructions}
              silenceRepromptCount={silenceRepromptCount}
              silenceMessage1={silenceMessage1}
              silenceMessage2={silenceMessage2}
              goodbyeMessage={goodbyeMessage}
              onAssistantName={setAssistantName}
              onVoiceChoice={setVoiceChoice}
              onCustomVoiceId={setCustomVoiceId}
            />
          ) : null}

          {step === 3 ? (
            <StepTest
              showPreview={showVoice}
              showCallTest={showPhone}
              deployedLive={Boolean(liveVapiAssistantId)}
              assignedNumber={assignedNumber}
              businessName={businessName}
              tone={tone}
              testing={testing}
              testResult={testResult}
              onTestCallRouting={handleTestCallRouting}
              answeringMode={answeringMode}
              listing={listing}
            />
          ) : null}

          {step === 4 ? (
            <StepGoLive
              checklist={checklist}
              blockers={blockers}
              readyToDeploy={readyToDeploy}
              assignedNumber={assignedNumber}
            />
          ) : null}

          {error ? (
            <p data-testid="business-setup-error" role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <div className="mt-8 flex items-center justify-between gap-3 pt-6 border-t border-gray-100">
            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={step === 1 || saving}
                onClick={() => setStep((current) => Math.max(1, current - 1))}
                data-testid="business-setup-back"
                className="btn border border-gray-200 text-slate-600 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Back
              </button>

              {step < STEPS.length ? (
                <button
                  type="button"
                  onClick={() => setStep((current) => Math.min(current + 1, STEPS.length))}
                  disabled={saving}
                  data-testid="business-setup-skip"
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
                >
                  Skip for now
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={handleSaveProgress}
                disabled={saving}
                data-testid="business-setup-save"
                className="text-xs font-semibold text-slate-500 hover:text-slate-700 underline transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save progress"}
              </button>

              {step < STEPS.length ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={saving}
                  data-testid="business-setup-next"
                  className="btn bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition-colors shadow-lg shadow-amber-500/20"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDeploy}
                  disabled={saving || !readyToDeploy}
                  data-testid="business-setup-submit"
                  className="btn bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition-colors shadow-lg shadow-amber-500/20"
                >
                  {saving ? "Deploying…" : "Deploy live agent"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {statusMsg ? (
        <div
          role="status"
          data-testid="business-setup-toast"
          className="toast-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-xl"
        >
          {statusMsg}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------- shared -------------------------------- */

function ChecklistSummary({ checklist }: { checklist: ChecklistRow[] }) {
  return (
    <div data-testid="business-setup-checklist">
      <h3 className={SECTION_TITLE}>Setup progress</h3>

      <ul className="mt-3 space-y-2">
        {checklist.map((row) => (
          <li key={row.key} data-testid={`business-setup-checklist-${row.key}`} className="flex items-center gap-2.5 text-sm">
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${row.complete ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
                }`}
            >
              {row.complete ? "✓" : "•"}
            </span>

            <span className="font-semibold text-slate-800">{row.label}</span>

            <span className={`ml-auto text-xs font-semibold ${row.complete ? "text-green-600" : "text-slate-400"}`}>
              {row.complete ? "Done" : row.required ? "Required" : "Optional"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
/* --------------------- Configure step: business card --------------------- */

function StepBusiness({
  businessName,
  businessType,
  contactName,
  servicesText,
  faqs,
  checklist,
  setupFields,
  setupInstructions,
  customValues,
  tone,
  hoursMode,
  hoursStart,
  hoursEnd,
  hoursDays,
  assistantName,
  voiceChoice,
  customVoiceId,
  onBusinessName,
  onBusinessType,
  onContactName,
  onServices,
  onFaqs,
  onCustomField,
  onTone,
  onHoursMode,
  onHoursStart,
  onHoursEnd,
  onToggleDay,
  onAssistantName,
  onVoiceChoice,
  onCustomVoiceId,
  showVoice
}: {
  businessName: string;
  businessType: string;
  contactName: string;
  servicesText: string;
  faqs: BusinessFaq[];
  checklist: ChecklistRow[];
  setupFields: BuyerSetupFieldDef[];
  setupInstructions: string;
  customValues: BuyerCustomFieldValue[];
  tone: string;
  hoursMode: "247" | "custom";
  hoursStart: string;
  hoursEnd: string;
  hoursDays: Record<string, boolean>;
  assistantName: string;
  voiceChoice: string;
  customVoiceId: string;
  onBusinessName: (v: string) => void;
  onBusinessType: (v: string) => void;
  onContactName: (v: string) => void;
  onServices: (v: string) => void;
  onFaqs: (v: BusinessFaq[]) => void;
  onCustomField: (key: string, label: string, value: string | string[] | boolean) => void;
  onTone: (v: string) => void;
  onHoursMode: (v: "247" | "custom") => void;
  onHoursStart: (v: string) => void;
  onHoursEnd: (v: string) => void;
  onToggleDay: (day: string) => void;
  onAssistantName: (v: string) => void;
  onVoiceChoice: (v: string) => void;
  onCustomVoiceId: (v: string) => void;
  showVoice: boolean;
}) {
  const [selectedServices, setSelectedServices] = useState<string[]>(() =>
    servicesText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const [customServiceInput, setCustomServiceInput] = useState("");
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync selected services → servicesText state
  useEffect(() => {
    onServices(selectedServices.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServices]);

  // Derive service suggestions from businessType
  const typeKey = Object.keys(SERVICE_MAP).find(
    (key) => businessType.toLowerCase().includes(key)
  ) ?? "";
  const suggestions = (SERVICE_MAP[typeKey] ?? []).filter((s) => !selectedServices.includes(s));

  function addService(s: string) {
    if (!s.trim() || selectedServices.includes(s.trim())) return;
    setSelectedServices((prev) => [...prev, s.trim()]);
  }

  function removeService(idx: number) {
    setSelectedServices((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleVoicePlay() {
    if (voicePlaying) return;
    setVoicePlaying(true);
    setTimeout(() => setVoicePlaying(false), 1800);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setUploadedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...picked.filter((f) => !existing.has(f.name))];
    });
    // Reset input so the same file can be re-selected after removal
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleRemoveFile(idx: number) {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  const businessInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const initials = parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
    return initials || "AI";
  };

  const textBackMessage = buildTextBackMessage(businessName, tone);

  return (
    <div className="space-y-6">
      {/* Icon */}
      <div className="w-14 h-14 bg-violet-50 rounded-2xl grid place-items-center text-violet-600 mb-5" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
          <path d="M5 3v4M19 17v4M3 5h4M17 19h4" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold tracking-tight text-slate-900">Set up your agent</h2>
      <p className="text-slate-500 text-base mt-2 max-w-md">Tell us about your business, pick a voice, and give your agent what it needs to know.</p>
      <span className="inline-flex items-center gap-1 text-xs text-slate-400 mt-3 font-semibold mb-6">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        ~2 minutes
      </span>

      {/* Business details */}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Business details</h3>
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label htmlFor="biz-contact-name" className="block text-sm font-medium text-slate-700 mb-2">
              Your name <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="biz-contact-name"
              data-testid="business-setup-input-contact"
              type="text"
              value={contactName}
              onChange={(e) => onContactName(e.target.value)}
              placeholder="Dr. Khushi Kumari"
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="biz-name" className="block text-sm font-medium text-slate-700 mb-2">
              Business name
            </label>
            <div className="relative">
              <input
                id="biz-name"
                data-testid="business-setup-input-name"
                type="text"
                value={businessName}
                onChange={(e) => onBusinessName(e.target.value)}
                placeholder="Central Perk Hospital"
                className={`${FIELD} pr-12`}
              />
              {businessName.trim() && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="biz-type" className="block text-sm font-medium text-slate-700 mb-2">Business type</label>
          <select
            id="biz-type"
            data-testid="business-setup-input-type"
            value={businessType}
            onChange={(e) => onBusinessType(e.target.value)}
            className={FIELD}
          >
            <option value="">Select your business type</option>
            {BUSINESS_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Services offered */}
      <div className="mt-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">Services offered</label>
        <p className="text-xs text-slate-400 mb-3 font-semibold">Select what applies, or add your own.</p>
        <div id="serviceChips" className="flex flex-wrap gap-2">
          {selectedServices.map((s, i) => (
            <button
              key={i}
              type="button"
              className="text-xs font-semibold border border-amber-400 bg-amber-400 text-white rounded-full px-3 py-1.5 transition-colors hover:bg-amber-500"
              onClick={() => removeService(i)}
            >
              {s} ✕
            </button>
          ))}
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="text-xs font-semibold border border-gray-200 text-slate-600 rounded-full px-3 py-1.5 hover:border-amber-300 transition-colors"
              onClick={() => addService(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input
            id="custom-service"
            data-testid="business-setup-input-services"
            type="text"
            value={customServiceInput}
            onChange={(e) => setCustomServiceInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addService(customServiceInput); setCustomServiceInput(""); }
            }}
            placeholder="Add another service"
            className="field flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => { addService(customServiceInput); setCustomServiceInput(""); }}
            className="btn shrink-0 border border-gray-200 rounded-xl px-5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Agent voice */}
      {showVoice ? (
        <div className="mt-7">
          <span className="block text-sm font-medium text-slate-700 mb-2">Agent voice</span>
          <p className="text-xs text-slate-400 mb-3 font-semibold">Pick the voice your customers will hear on every call.</p>
          <div className="flex gap-2">
            <select
              id="voice-select"
              data-testid="business-setup-voice-select"
              value={voiceChoice}
              onChange={(e) => {
                onVoiceChoice(normalizeVoiceChoice(e.target.value));
                onCustomVoiceId("");
              }}
              className="field flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-slate-900 focus:outline-none"
            >
              {VOICE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              type="button"
              id="voice-play"
              data-testid="business-setup-voice-play"
              onClick={handleVoicePlay}
              aria-label="Listen to voice sample"
              className={`shrink-0 w-12 rounded-xl border border-gray-200 text-slate-600 grid place-items-center hover:bg-slate-50 transition-colors ${voicePlaying ? "bg-amber-50 border-amber-300" : ""}`}
            >
              {voicePlaying ? (
                <span className="inline-flex items-end gap-[2px] h-3">
                  <span className="w-[2.5px] bg-amber-500 rounded-sm animate-bounce" style={{ height: "4px", animationDelay: "0s" }} />
                  <span className="w-[2.5px] bg-amber-500 rounded-sm animate-bounce" style={{ height: "12px", animationDelay: "0.15s" }} />
                  <span className="w-[2.5px] bg-amber-500 rounded-sm animate-bounce" style={{ height: "4px", animationDelay: "0.3s" }} />
                </span>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.14v13.72a.5.5 0 0 0 .77.42l10.7-6.86a.5.5 0 0 0 0-.84L8.77 4.72a.5.5 0 0 0-.77.42z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      ) : null}

      {/* Agent name */}
      {showVoice ? (
        <div className="mt-7">
          <label htmlFor="agent-name" className="block text-sm font-medium text-slate-700 mb-2">Name your agent</label>
          <input
            id="agent-name"
            data-testid="business-setup-input-assistant-name"
            type="text"
            value={assistantName}
            onChange={(e) => onAssistantName(e.target.value)}
            placeholder={DEFAULT_ASSISTANT_NAME}
            className={FIELD}
          />
          <p className="text-xs text-slate-400 mt-2 font-semibold">
            Example: &ldquo;Hello, this is{" "}
            <span className="font-semibold text-slate-600">{assistantName.trim() || DEFAULT_ASSISTANT_NAME}</span>{" "}
            from{" "}
            <span className="font-semibold text-slate-600">{businessName.trim() || "your business"}</span>. How can I help today?&rdquo;
          </p>
        </div>
      ) : null}

      {/* Knowledge */}
      <div className="mt-7">
        <span className="block text-sm font-medium text-slate-700">Knowledge</span>
        <p className="text-xs text-slate-400 mt-1 mb-3 font-semibold">Provide the documents you want your AI agent to use, and what it needs to know.</p>

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700">
            FAQs <span className="text-slate-400 font-normal">(optional)</span>
          </span>
          <button
            type="button"
            data-testid="business-setup-faq-add"
            onClick={() => onFaqs([...faqs, { question: "", answer: "" }])}
            className="text-sm font-semibold text-amber-600 hover:text-amber-700 inline-flex items-center gap-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add FAQ
          </button>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, index) => (
            <div key={index} className="border border-gray-200 rounded-xl p-4 flex gap-3" data-testid="business-setup-faq-row">
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={faq.question}
                  onChange={(e) => onFaqs(faqs.map((f, i) => (i === index ? { ...f, question: e.target.value } : f)))}
                  className="field w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none"
                  placeholder="Question, e.g. Do you accept insurance?"
                />
                <textarea
                  rows={2}
                  value={faq.answer}
                  onChange={(e) => onFaqs(faqs.map((f, i) => (i === index ? { ...f, answer: e.target.value } : f)))}
                  className="field w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none resize-none"
                  placeholder="Answer the agent should give"
                />
              </div>
              <button
                type="button"
                onClick={() => onFaqs(faqs.filter((_, i) => i !== index))}
                className="text-slate-400 hover:text-red-500 shrink-0 self-start mt-1"
                aria-label="Remove FAQ"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        {/* File upload dropzone — always visible */}
        <label
          htmlFor="file-input"
          className="dropzone rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-2.5 mt-4 border-2 border-dashed border-gray-200 cursor-pointer hover:border-amber-300 hover:bg-amber-50/40 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-slate-400">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="text-sm text-slate-600">
            <span className="font-semibold text-amber-600">Click to upload</span> or drag and drop documents
          </span>
          <span className="text-xs text-slate-400 font-semibold">PDF, DOC, or TXT · up to 10 MB each · multiple allowed</span>
          <input
            ref={fileInputRef}
            id="file-input"
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            multiple
            className="sr-only"
            onChange={handleFileChange}
          />
        </label>

        {/* Uploaded files list */}
        {uploadedFiles.length > 0 ? (
          <div className="mt-3 space-y-2" data-testid="business-setup-uploaded-files">
            {uploadedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 group transition-colors hover:border-slate-200"
                data-testid="business-setup-file-chip"
              >
                <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 grid place-items-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                  <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(idx)}
                  className="text-slate-300 hover:text-red-500 shrink-0 transition-colors"
                  aria-label={`Remove ${file.name}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Availability */}
      <div className="mt-7" data-testid="business-setup-hours">
        <span className="block text-sm font-medium text-slate-700 mb-2">When should the agent respond?</span>
        <div className="space-y-3">
          <button
            type="button"
            role="radio"
            aria-checked={hoursMode === "247"}
            data-testid="business-setup-hours-247"
            onClick={() => onHoursMode("247")}
            className={`pick flex w-full items-start gap-3 rounded-xl border p-4 text-left ${hoursMode === "247" ? "selected" : "border-gray-200 bg-white"}`}
          >
            <span className={`mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${
              hoursMode === "247" ? "border-amber-500" : "border-slate-300"
            }`}>
              {hoursMode === "247" ? <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> : null}
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-800">24/7 — always respond</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">Recommended</span>
              </span>
              <span className="text-sm text-slate-500 block mt-0.5">Never miss a call, even after hours or on weekends.</span>
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={hoursMode === "custom"}
            data-testid="business-setup-hours-custom"
            onClick={() => onHoursMode("custom")}
            className={`pick flex w-full items-start gap-3 rounded-xl border p-4 text-left ${hoursMode === "custom" ? "selected" : "border-gray-200 bg-white"}`}
          >
            <span className={`mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${
              hoursMode === "custom" ? "border-amber-500" : "border-slate-300"
            }`}>
              {hoursMode === "custom" ? <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> : null}
            </span>
            <span className="flex-1">
              <span className="font-semibold text-slate-800 block">Business hours only</span>
              <span className="text-sm text-slate-500 block mt-0.5">Respond during the days and hours you choose.</span>
            </span>
          </button>

          {hoursMode === "custom" ? (
            <div className="rounded-xl border border-gray-100 bg-slate-50 p-4" data-testid="business-setup-hours-editor">
              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <label htmlFor="hours-start" className="block text-xs font-medium text-slate-500 mb-1">Start</label>
                  <input
                    id="hours-start"
                    data-testid="business-setup-hours-start"
                    type="time"
                    value={hoursStart}
                    onChange={(e) => onHoursStart(e.target.value)}
                    className="field border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
                  />
                </div>
                <span className="text-slate-400 mt-5">→</span>
                <div>
                  <label htmlFor="hours-end" className="block text-xs font-medium text-slate-500 mb-1">End</label>
                  <input
                    id="hours-end"
                    data-testid="business-setup-hours-end"
                    type="time"
                    value={hoursEnd}
                    onChange={(e) => onHoursEnd(e.target.value)}
                    className="field border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
                  />
                </div>
              </div>
              <div className="mt-4">
                <span className="block text-xs font-medium text-slate-500 mb-2">Active days</span>
                <div className="flex gap-1.5 flex-wrap">
                  {HOURS_DAYS.map((entry) => {
                    const on = Boolean(hoursDays[entry.day]);
                    return (
                      <button
                        key={entry.day}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={entry.day}
                        data-testid={`business-setup-hours-day-${entry.day.toLowerCase()}`}
                        onClick={() => onToggleDay(entry.day)}
                        className={`day w-10 h-10 grid place-items-center rounded-lg border text-sm font-semibold transition-colors ${
                          on ? "border-amber-500 bg-amber-500 text-white" : "border-gray-200 bg-white text-slate-600"
                        }`}
                      >
                        {entry.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Agent-specific custom fields */}
      {setupFields.length > 0 ? (
        <div className="mt-7 pt-7 border-t border-gray-100" data-testid="business-setup-custom-fields">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Agent setup details</h3>
          <p className="text-xs text-slate-400 mb-3 font-semibold">
            This agent asks for a few extra details so it can answer callers accurately.
          </p>
          {setupInstructions ? (
            <p
              className="mb-3 rounded-xl border border-amber-100 bg-amber-50/60 px-3.5 py-2.5 text-sm text-amber-900/90"
              data-testid="business-setup-buyer-instructions"
            >
              {setupInstructions}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {setupFields.map((field) => (
              <BuyerSetupFieldControl
                key={field.key}
                field={field}
                value={customValues.find((item) => item.key === field.key)?.value}
                onChange={(value) => onCustomField(field.key, field.label, value)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------- Architect-defined buyer setup field ------------------- */

/** Wide controls that should span both grid columns. */
const FULL_WIDTH_FIELD_TYPES = new Set(["textarea", "multiselect"]);

const HTML_INPUT_TYPE_BY_FIELD_TYPE: Record<string, string> = {
  phone: "tel",
  email: "email",
  url: "url",
  number: "number",
  date: "date",
  time: "time"
};

function BuyerSetupFieldControl({
  field,
  value,
  onChange
}: {
  field: BuyerSetupFieldDef;
  value: string | string[] | boolean | undefined;
  onChange: (value: string | string[] | boolean) => void;
}) {
  const inputId = `custom-field-${field.key}`;
  const testId = `business-setup-custom-field-${field.key}`;
  const options = (field.options ?? []).filter((option) => option.trim());

  const inlineIssue =
    value !== undefined && !isBuyerAnswerEmpty(value)
      ? validateBuyerSetupAnswers([field], [{ key: field.key, label: field.label, value }], {
        requireMissing: false
      })[0]
      : undefined;

  const textValue = typeof value === "string" ? value : "";
  const selectedOptions = Array.isArray(value)
    ? value
    : typeof value === "string" && value
      ? value.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
  const booleanValue = value === true || (typeof value === "string" && /^(yes|true)$/i.test(value));

  let control: ReactNode;

  if (field.type === "textarea") {
    control = (
      <textarea
        data-testid={testId}
        id={inputId}
        value={textValue}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={FIELD}
      />
    );
  } else if (field.type === "select") {
    control = (
      <select
        data-testid={testId}
        id={inputId}
        value={textValue}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      >
        <option value="">{field.placeholder || "Select an option…"}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "multiselect") {
    control = (
      <div data-testid={testId} className="mt-1 flex flex-wrap gap-2">
        {options.map((option, optionIndex) => {
          const checked = selectedOptions.includes(option);
          return (
            <label
              key={option}
              className={`pick flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${checked ? "selected border-amber-400" : "border-gray-200"
                }`}
            >
              <input
                type="checkbox"
                data-testid={`${testId}-option-${optionIndex}`}
                checked={checked}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selectedOptions, option]
                      : selectedOptions.filter((item) => item !== option)
                  )
                }
                className="h-3.5 w-3.5 accent-amber-500"
              />
              <span className="font-medium text-slate-700">{option}</span>
            </label>
          );
        })}
      </div>
    );
  } else if (field.type === "boolean") {
    control = (
      <label className="mt-1 flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          data-testid={testId}
          id={inputId}
          checked={booleanValue}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-amber-500"
        />
        Yes
      </label>
    );
  } else {
    control = (
      <input
        data-testid={testId}
        id={inputId}
        type={HTML_INPUT_TYPE_BY_FIELD_TYPE[field.type] ?? "text"}
        value={textValue}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
    );
  }

  return (
    <div className={FULL_WIDTH_FIELD_TYPES.has(field.type) ? "sm:col-span-2" : undefined}>
      <label className={LABEL} htmlFor={inputId}>
        {field.label} {field.required ? "" : "optional"}
      </label>
      {control}
      {field.helper ? <p className="mt-1 text-xs text-slate-400">{field.helper}</p> : null}
      {inlineIssue ? (
        <p className="mt-1 text-xs text-red-500" data-testid={`business-setup-custom-field-error-${field.key}`}>
          {inlineIssue.message}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------ Connect step ------------------------------ */

function StepConnect({
  title,
  showPhone,
  showCalendar,
  showSmsNote,
  showMail,
  phoneNumbers,
  selectedPhoneId,
  assignedNumber,
  forwardToPhone,
  teamPhone,
  answeringMode,
  calendar,
  calendarBusy,
  calendarId,
  timeZone,
  onSelectPhone,
  onForward,
  onTeamPhone,
  onAnsweringMode,
  onConnectCalendar,
  onDisconnectCalendar,
  onCalendarId,
  onTimeZone,
  businessName,
  onMailAliasChange,

  existingPhoneNumber,
  onExistingPhoneNumberChange,
  otpSent,
  onOtpSentChange,
  onSendOtp,
  otpDigits,
  onOtpDigitsChange,
  isSendingOtp,
  isVerifyingOtp,
  phoneVerified,
  onVerifyOtp,
  devOtpCode,
  resendCooldown,
  setPhoneVerified
}: {
  title: string;
  showPhone: boolean;
  showCalendar: boolean;
  showSmsNote: boolean;
  showMail: boolean;
  businessName: string;
  onMailAliasChange: (alias: BusinessEmailAliasData | null) => void;
  phoneNumbers: PlatformPhoneOption[];
  selectedPhoneId: string;
  assignedNumber: string | null;
  forwardToPhone: string;
  teamPhone: string;
  answeringMode: string;
  calendar: { connected: boolean; email: string | null };
  calendarBusy: boolean;
  calendarId: string;
  timeZone: string;
  onSelectPhone: (id: string) => void;
  onForward: (v: string) => void;
  onTeamPhone: (v: string) => void;
  onAnsweringMode: (v: string) => void;
  onConnectCalendar: () => void;
  onDisconnectCalendar: () => void;
  onCalendarId: (v: string) => void;
  onTimeZone: (v: string) => void;

  existingPhoneNumber: string;
  onExistingPhoneNumberChange: (v: string) => void;
  otpSent: boolean;
  onOtpSentChange: (v: boolean) => void;
  onSendOtp: () => void;
  otpDigits: string[];
  onOtpDigitsChange: React.Dispatch<React.SetStateAction<string[]>>;
  isSendingOtp: boolean;
  isVerifyingOtp: boolean;
  phoneVerified: boolean;
  onVerifyOtp: (code: string) => void;
  devOtpCode: string | null;
  resendCooldown: number;
  setPhoneVerified: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [countryFlag, setCountryFlag] = useState("🇺🇸");
  const [countryCode, setCountryCode] = useState("+1");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);

  const routingMode = answeringMode === "AI_FIRST" ? "direct" : "forward";
  const timezoneMissing = Boolean(timeZone) && !ALL_ZONES.includes(timeZone);

  const handleDigitChange = (index: number, value: string) => {
    const val = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = val;
    onOtpDigitsChange(newDigits);

    // Auto-focus next input
    if (val && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }

    // Auto verify if complete
    const fullCode = newDigits.join("");
    if (fullCode.length === 6 && /^\d{6}$/.test(fullCode)) {
      onVerifyOtp(fullCode);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`);
      prevInput?.focus();
    }
  };

  const phoneValid = existingPhoneNumber.replace(/\D/g, "").length === 10;

  return (
    <div className="space-y-6">
      {/* Icon */}
      <div className="w-14 h-14 bg-amber-50 rounded-2xl grid place-items-center text-amber-600 mb-5" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      <p className="text-slate-500 text-base mt-2 max-w-md">
        This is the number your patients call. We detect missed calls and text them back automatically.
      </p>
      <span className="inline-flex items-center gap-1 text-xs text-slate-400 mt-3 font-semibold mb-6">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        ~90 seconds
      </span>

      {/* Phone number input block */}
      {showPhone && !phoneVerified && !otpSent && (
        <div className="mt-4">
          <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-2">Business phone number</label>

          <div className={`phone-wrap flex items-stretch border rounded-xl overflow-hidden bg-white relative ${phoneValid ? "is-valid" : "border-gray-200"}`}>
            {/* Country code */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setCountryMenuOpen(!countryMenuOpen)}
                aria-haspopup="listbox"
                aria-expanded={countryMenuOpen}
                className="h-full flex items-center gap-1.5 bg-gray-50 border-r border-gray-200 px-4 py-4 text-base font-medium text-slate-700 hover:bg-gray-100 transition-colors"
              >
                <span className="text-lg leading-none">{countryFlag}</span>
                <span className="text-slate-700">{countryCode}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-slate-400">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {countryMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCountryMenuOpen(false)} />
                  <ul role="listbox" className="cc-menu absolute left-0 top-full mt-1.5 w-52 bg-white border border-gray-100 rounded-xl shadow-xl shadow-slate-900/10 py-1.5 z-50 text-sm">
                    <li onClick={() => { setCountryFlag("🇺🇸"); setCountryCode("+1"); setCountryMenuOpen(false); }} className="px-4 py-2.5 flex items-center gap-2.5 hover:bg-amber-50 cursor-pointer">🇺🇸 <span className="flex-1">United States</span><span className="text-slate-400">+1</span></li>
                    <li onClick={() => { setCountryFlag("🇨🇦"); setCountryCode("+1"); setCountryMenuOpen(false); }} className="px-4 py-2.5 flex items-center gap-2.5 hover:bg-amber-50 cursor-pointer">🇨🇦 <span className="flex-1">Canada</span><span className="text-slate-400">+1</span></li>
                    <li onClick={() => { setCountryFlag("🇬🇧"); setCountryCode("+44"); setCountryMenuOpen(false); }} className="px-4 py-2.5 flex items-center gap-2.5 hover:bg-amber-50 cursor-pointer">🇬🇧 <span className="flex-1">United Kingdom</span><span className="text-slate-400">+44</span></li>
                    <li onClick={() => { setCountryFlag("🇦🇺"); setCountryCode("+61"); setCountryMenuOpen(false); }} className="px-4 py-2.5 flex items-center gap-2.5 hover:bg-amber-50 cursor-pointer">🇦🇺 <span className="flex-1">Australia</span><span className="text-slate-400">+61</span></li>
                    <li onClick={() => { setCountryFlag("🇮🇳"); setCountryCode("+91"); setCountryMenuOpen(false); }} className="px-4 py-2.5 flex items-center gap-2.5 hover:bg-amber-50 cursor-pointer">🇮🇳 <span className="flex-1">India</span><span className="text-slate-400">+91</span></li>
                  </ul>
                </>
              )}
            </div>

            {/* Number input */}
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={existingPhoneNumber}
              onChange={(e) => {
                const formatted = fmtPhone(e.target.value);
                onExistingPhoneNumberChange(formatted);
              }}
              className="field flex-1 px-5 py-4 text-lg font-mono placeholder:text-slate-300 outline-none border-0"
              placeholder="(555) 123-4567"
            />

            {/* Check icon */}
            <span className="phone-check absolute right-4 top-1/2 -translate-y-1/2 text-green-500" aria-hidden="true" style={{ opacity: phoneValid ? 1 : 0, transform: phoneValid ? "scale(1)" : "scale(0.6)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
          </div>

          <p className="text-xs text-slate-400 mt-2 font-semibold">We&apos;ll send a verification code to confirm this is your number.</p>

          <button
            type="button"
            disabled={isSendingOtp || !phoneValid}
            onClick={onSendOtp}
            className="btn bg-amber-500 text-white rounded-xl px-8 py-3.5 font-semibold shadow-lg shadow-amber-500/30 hover:bg-amber-600 inline-flex items-center justify-center gap-2 mt-4 w-full sm:w-auto"
          >
            {isSendingOtp ? "Sending code…" : "Send verification code"}
          </button>
        </div>
      )}

      {/* Verification OTP Box */}
      {showPhone && !phoneVerified && otpSent && (
        <div id="verifyBlock" className="mt-6">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-slate-600 flex items-start gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-amber-500 mt-0.5 shrink-0">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
            <span>
              Enter the 6-digit code we sent to <strong className="text-slate-800">{existingPhoneNumber}</strong>.
            </span>
          </div>

          <div className="flex gap-2 sm:gap-2.5 mt-4 justify-between" id="otp" role="group" aria-label="6-digit verification code">
            {otpDigits.map((digit, idx) => (
              <input
                key={idx}
                id={`otp-${idx}`}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                className={`otp-box ${digit ? "filled" : ""}`}
                aria-label={`Digit ${idx + 1}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-4 mt-4 text-sm">
            {resendCooldown > 0 ? (
              <span className="text-slate-400 font-semibold">Resend code in {resendCooldown}s</span>
            ) : (
              <button
                type="button"
                id="resend"
                onClick={onSendOtp}
                className="text-amber-600 font-semibold hover:text-amber-700 transition-colors"
              >
                Resend code
              </button>
            )}
            <span className="text-slate-300">·</span>
            <button
              type="button"
              id="diffNum"
              onClick={() => {
                onOtpSentChange(false);
                onExistingPhoneNumberChange("");
              }}
              className="text-slate-500 font-semibold hover:text-slate-700 transition-colors"
            >
              Use a different number
            </button>
          </div>
          {devOtpCode ? (
            <p className="text-xs text-slate-500 font-semibold mt-2">
              Dev OTP Code: <strong className="font-mono text-slate-800">{devOtpCode}</strong> (Automatically generated in testing)
            </p>
          ) : (
            <p className="text-xs text-slate-300 mt-2 font-semibold">For this demo, any 6 digits will work.</p>
          )}

          {isVerifyingOtp && (
            <div id="verifying" className="flex items-center gap-2 text-sm text-slate-500 mt-3 font-semibold">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4 spin text-amber-500">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              Verifying…
            </div>
          )}
        </div>
      )}

      {/* Success Block */}
      {showPhone && phoneVerified && (
        <div className="space-y-6">
          <div id="phoneSuccess" className="bg-green-50 border border-green-100 rounded-xl p-4 flex items-center justify-between gap-3" role="status">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-green-500 grid place-items-center text-white shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
              <p className="text-sm text-green-800">
                <span className="font-semibold">Phone connected.</span> <span id="successNum" className="font-bold">{existingPhoneNumber}</span> is now linked to your agent.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onExistingPhoneNumberChange("");
                onOtpSentChange(false);
                setPhoneVerified(false);
              }}
              className="text-xs font-bold text-slate-500 hover:text-red-500 underline shrink-0 transition-colors"
            >
              Change
            </button>
          </div>

          <div className="mt-5 flex items-start gap-3 bg-slate-50 rounded-xl p-5 border border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 grid place-items-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Triven phone number is ready:</p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900">{assignedNumber || "Pending..."}</p>
            </div>
          </div>

          {/* Answering mode selection */}
          <div className="space-y-3">
            <span className="block text-sm font-semibold text-slate-700 mb-2">How should calls reach your agent?</span>

            <button
              type="button"
              onClick={() => onAnsweringMode("NO_ANSWER")}
              className={`pick w-full text-left rounded-xl border p-4 flex items-start gap-3 ${
                answeringMode !== "AI_FIRST" ? "selected" : "border-gray-200 bg-white"
              }`}
            >
              <span className={`mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${
                answeringMode !== "AI_FIRST" ? "border-amber-500" : "border-slate-300"
              }`}>
                {answeringMode !== "AI_FIRST" ? <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> : null}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-slate-900">Forward my existing number</span>
                <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Keep giving out {existingPhoneNumber}. Forward it to {assignedNumber || "your Triven number"} so calls reach your agent.
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => onAnsweringMode("AI_FIRST")}
              className={`pick w-full text-left rounded-xl border p-4 flex items-start gap-3 ${
                answeringMode === "AI_FIRST" ? "selected" : "border-gray-200 bg-white"
              }`}
            >
              <span className={`mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${
                answeringMode === "AI_FIRST" ? "border-amber-500" : "border-slate-300"
              }`}>
                {answeringMode === "AI_FIRST" ? <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> : null}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-slate-900">Use the CORE number directly</span>
                <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Give {assignedNumber || "your Triven number"} to customers as your main line. Calls go straight to your agent.
                </span>
              </span>
            </button>
          </div>
        </div>
      )}

      {showPhone && phoneVerified && routingMode === "forward" ? (
        <div className="mt-6 border-t border-gray-100 pt-6">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Call handling</h3>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="answering-mode">
              Answering mode
            </label>
            <select
              id="answering-mode"
              value={answeringMode}
              onChange={(e) => onAnsweringMode(e.target.value)}
              className="field w-full rounded-xl border border-gray-200 bg-white px-5 py-4 text-base text-slate-900 focus:outline-none"
            >
              {ANSWERING_MODES.filter(m => m.value !== "AI_FIRST").map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-400 font-semibold">
              Choose when the AI receptionist should answer calls forwarded from {existingPhoneNumber}.
            </p>
          </div>
        </div>
      ) : null}

      {/* Calendar Connection block */}
      {phoneVerified && showCalendar ? (
        <div className="mt-6 border-t border-gray-100 pt-6">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Calendar</h3>

          <div className={`flex items-center justify-between gap-4 rounded-2xl border p-5 ${
            calendar.connected 
              ? "border-green-100 bg-green-50/30" 
              : "border-gray-100 bg-slate-50"
          }`}>
            <div className="flex items-center gap-3">
              {/* Google Calendar Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm-5-8h-4v4h4v-4z"/>
                </svg>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {calendar.connected ? "Google Calendar connected" : "Google Calendar"}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {calendar.connected 
                    ? `Connected as ${calendar.email || "your account"}` 
                    : "Not connected. Connect so the agent can book appointments."}
                </p>
              </div>
            </div>

            {calendar.connected ? (
              <button
                type="button"
                disabled={calendarBusy}
                onClick={onDisconnectCalendar}
                className="btn shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:border-gray-300 shadow-sm"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                disabled={calendarBusy}
                onClick={onConnectCalendar}
                className="btn shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600 shadow-sm"
              >
                {calendarBusy ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="timezone">
              Business timezone
            </label>

            <select
              id="timezone"
              value={timeZone}
              onChange={(e) => onTimeZone(e.target.value)}
              className="field w-full rounded-xl border border-gray-200 bg-white px-5 py-4 text-base text-slate-900 focus:outline-none"
            >
              {timezoneMissing ? <option value={timeZone}>{timeZone}</option> : null}

              {TIMEZONE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <p className="mt-2 text-xs text-slate-400 font-semibold">All availability, bookings, and call times use this timezone.</p>
          </div>
        </div>
      ) : null}

      {showSmsNote ? (
        <div className={SECTION} data-testid="business-setup-sms-note">
          <h3 className={SECTION_TITLE}>SMS</h3>
          <p className="mt-1 text-sm text-slate-500">Confirmation SMS will be sent to your customers from Triven.</p>
        </div>
      ) : null}

      {phoneVerified && showMail ? <MailSetupSection businessName={businessName} onAliasChange={onMailAliasChange} /> : null}
    </div>
  );
}

/* ------------------------- Mail Setup (proxy email) ------------------------ */

const REPLY_MODE_OPTIONS: { value: BusinessEmailAliasData["replyHandlingMode"]; label: string }[] = [
  { value: "TRIVEN_AND_FORWARD", label: "Triven inbox + forward to my email" },
  { value: "FORWARD_ONLY", label: "Forward to my email only" },
  { value: "TRIVEN_INBOX", label: "Keep replies in my Triven inbox" }
];

function MailSetupSection({
  businessName,
  onAliasChange
}: {
  businessName: string;
  onAliasChange: (alias: BusinessEmailAliasData | null) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [savedAlias, setSavedAlias] = useState<BusinessEmailAliasData | null>(null);
  const [domain, setDomain] = useState("reply.triven.ai");
  const [displayName, setDisplayName] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [forwardToEmail, setForwardToEmail] = useState("");
  const [replyMode, setReplyMode] = useState<BusinessEmailAliasData["replyHandlingMode"]>("TRIVEN_AND_FORWARD");
  const [customerEmailsEnabled, setCustomerEmailsEnabled] = useState(true);
  const [summaryEmailsEnabled, setSummaryEmailsEnabled] = useState(true);
  const [availability, setAvailability] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");

  useEffect(() => {
    let cancelled = false;

    void getBusinessMailSetup().then((res) => {
      if (cancelled || !res.success || !res.data) return;
      setDomain(res.data.domain);
      if (res.data.alias) {
        setSavedAlias(res.data.alias);
        setDisplayName(res.data.alias.displayName);
        setLocalPart(res.data.alias.localPart);
        setForwardToEmail(res.data.alias.forwardToEmail ?? "");
        setReplyMode(res.data.alias.replyHandlingMode);
        setCustomerEmailsEnabled(res.data.alias.customerConfirmationEnabled ?? true);
        setSummaryEmailsEnabled(res.data.alias.internalSummaryEnabled ?? true);
        onAliasChange(res.data.alias);
      } else {
        setLocalPart(res.data.suggestedLocalPart);
        setDisplayName(businessName.trim());
      }
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  // Debounced availability check while the buyer edits the alias.
  useEffect(() => {
    if (!loaded || !localPart.trim() || localPart === savedAlias?.localPart) {
      setAvailability(null);
      return;
    }
    const timer = setTimeout(() => {
      void checkMailAliasAvailability(localPart).then((res) => {
        if (res.success && res.data) setAvailability({ available: res.data.available, reason: res.data.reason });
      });
    }, 450);
    return () => clearTimeout(timer);
  }, [loaded, localPart, savedAlias?.localPart]);

  async function handleSave() {
    setMessage("");
    if (savedAlias && localPart !== savedAlias.localPart) {
      const proceed = window.confirm(
        `Change your email alias from ${savedAlias.emailAddress} to ${localPart}@${domain}? Customers will see the new address; your old email history is kept.`
      );
      if (!proceed) return;
    }

    setBusy(true);
    const res = await saveBusinessMailSetup({
      localPart,
      displayName,
      forwardToEmail: forwardToEmail.trim() || undefined,
      replyHandlingMode: replyMode,
      customerConfirmationEnabled: customerEmailsEnabled,
      internalSummaryEnabled: summaryEmailsEnabled
    });
    setBusy(false);

    if (res.success && res.data) {
      setSavedAlias(res.data.alias);
      setLocalPart(res.data.alias.localPart);
      onAliasChange(res.data.alias);
      setMessageTone("ok");
      setMessage("Mail setup saved.");
    } else {
      setMessageTone("error");
      setMessage(res.error ?? "Could not save mail setup.");
    }
  }

  async function handleTestEmail() {
    setMessage("");
    setBusy(true);
    const res = await sendMailSetupTestEmail();
    setBusy(false);

    if (res.success && res.data) {
      setMessageTone("ok");
      setMessage(res.data.dryRun ? "Test email recorded (dry run — SES not configured yet)." : "Test email sent — check your inbox.");
    } else {
      setMessageTone("error");
      setMessage(res.error ?? "Could not send the test email.");
    }
  }

  const previewName = displayName.trim() || businessName.trim() || "Your business";
  const previewAddress = `${localPart.trim() || "your-alias"}@${domain}`;

  return (
    <div className={SECTION} data-testid="business-setup-mail">
      <h3 className={SECTION_TITLE}>Mail Setup</h3>
      <p className="mt-0.5 text-sm text-slate-500">
        Choose the email address customers will see when your AI assistant sends confirmations, summaries, and follow-ups.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="mail-display-name">
            Sender name
          </label>
          <input
            data-testid="business-setup-mail-display-name"
            id="mail-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={businessName.trim() || "Smile Dental"}
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="mail-alias">
            Email alias
          </label>
          <div className="flex items-center gap-2">
            <input
              data-testid="business-setup-mail-alias"
              id="mail-alias"
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value.toLowerCase())}
              placeholder="smile-dental"
              className={FIELD}
            />
            <span className="whitespace-nowrap text-sm font-semibold text-slate-500">@ {domain}</span>
          </div>
          {availability ? (
            <p
              data-testid="business-setup-mail-availability"
              className={`mt-1 text-xs font-semibold ${availability.available ? "text-green-600" : "text-red-500"}`}
            >
              {availability.available ? "Alias is available" : availability.reason ?? "Alias is not available"}
            </p>
          ) : null}
          {savedAlias && localPart !== savedAlias.localPart ? (
            <p className="mt-1 text-xs font-semibold text-amber-600" data-testid="business-setup-mail-change-warning">
              Changing your alias changes the address customers see. Old email history is kept.
            </p>
          ) : null}
        </div>

        <div>
          <label className={LABEL} htmlFor="mail-forward">
            Forward replies to
          </label>
          <input
            data-testid="business-setup-mail-forward"
            id="mail-forward"
            type="email"
            value={forwardToEmail}
            onChange={(e) => setForwardToEmail(e.target.value)}
            placeholder="frontdesk@yourbusiness.com"
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="mail-reply-mode">
            Reply handling
          </label>
          <select
            data-testid="business-setup-mail-reply-mode"
            id="mail-reply-mode"
            value={replyMode}
            onChange={(e) => setReplyMode(e.target.value as BusinessEmailAliasData["replyHandlingMode"])}
            className={FIELD}
          >
            {REPLY_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2.5 text-sm text-slate-600" htmlFor="mail-toggle-customer">
          <input
            data-testid="business-setup-mail-toggle-customer"
            id="mail-toggle-customer"
            type="checkbox"
            checked={customerEmailsEnabled}
            onChange={(e) => setCustomerEmailsEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
          />
          <span>
            <span className="font-semibold text-slate-700">Email customers</span>
            <span className="block text-xs text-slate-500">Booking confirmations and follow-ups after calls.</span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-slate-600" htmlFor="mail-toggle-summary">
          <input
            data-testid="business-setup-mail-toggle-summary"
            id="mail-toggle-summary"
            type="checkbox"
            checked={summaryEmailsEnabled}
            onChange={(e) => setSummaryEmailsEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
          />
          <span>
            <span className="font-semibold text-slate-700">Email my team call summaries</span>
            <span className="block text-xs text-slate-500">Lead details and call summaries to your forward-to address.</span>
          </span>
        </label>
      </div>

      <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3.5" data-testid="business-setup-mail-preview">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Customers will receive emails from</p>
        <p className="mt-1 text-sm font-semibold text-slate-800">
          {previewName} via Triven &lt;{previewAddress}&gt;
        </p>
        <p className="mt-1.5 text-xs text-slate-500">
          Replies will go to: <span className="font-semibold text-slate-700">{previewAddress}</span>
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="business-setup-mail-save"
          onClick={() => void handleSave()}
          disabled={busy || !localPart.trim() || !displayName.trim()}
          className="btn rounded-full bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
        >
          {busy ? "Working…" : savedAlias ? "Update mail setup" : "Save mail setup"}
        </button>
        <button
          type="button"
          data-testid="business-setup-mail-test"
          onClick={() => void handleTestEmail()}
          disabled={busy || !savedAlias}
          className="btn rounded-full border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-amber-300"
        >
          Send test email
        </button>
        {message ? (
          <p
            data-testid="business-setup-mail-message"
            className={`text-xs font-semibold ${messageTone === "ok" ? "text-green-600" : "text-red-500"}`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ----------------- Configure step: email recipients card ----------------- */

function EmailRecipientsSection({
  recipientType,
  customRecipient,
  cc,
  bcc,
  onRecipientType,
  onCustomRecipient,
  onCc,
  onBcc
}: {
  recipientType: "customer" | "team" | "custom";
  customRecipient: string;
  cc: string;
  bcc: string;
  onRecipientType: (value: "customer" | "team" | "custom") => void;
  onCustomRecipient: (value: string) => void;
  onCc: (value: string) => void;
  onBcc: (value: string) => void;
}) {
  return (
    <div className={CARD} data-testid="business-setup-email-recipients">
      <h2 className={H2}>Email recipients</h2>
      <p className={SUB}>
        Choose who receives the emails this agent sends — confirmations, follow-ups, and notifications. The email
        content comes from the agent; you control the recipients.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="email-recipient-type">
            Send To
          </label>
          <select
            data-testid="business-setup-email-recipient-type"
            id="email-recipient-type"
            value={recipientType}
            onChange={(e) => onRecipientType(e.target.value as "customer" | "team" | "custom")}
            className={FIELD}
          >
            <option value="customer">Customer (email collected during the call)</option>
            <option value="team">My team (Mail Setup forward-to address)</option>
            <option value="custom">A specific email address</option>
          </select>
        </div>

        {recipientType === "custom" ? (
          <div>
            <label className={LABEL} htmlFor="email-recipient-custom">
              Recipient email
            </label>
            <input
              data-testid="business-setup-email-recipient-custom"
              id="email-recipient-custom"
              type="email"
              value={customRecipient}
              onChange={(e) => onCustomRecipient(e.target.value)}
              placeholder="frontdesk@yourbusiness.com"
              className={FIELD}
            />
          </div>
        ) : null}

        <div>
          <label className={LABEL} htmlFor="email-recipients-cc">
            CC
          </label>
          <input
            data-testid="business-setup-email-recipients-cc"
            id="email-recipients-cc"
            value={cc}
            onChange={(e) => onCc(e.target.value)}
            placeholder="comma-separated emails (optional)"
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="email-recipients-bcc">
            BCC
          </label>
          <input
            data-testid="business-setup-email-recipients-bcc"
            id="email-recipients-bcc"
            value={bcc}
            onChange={(e) => onBcc(e.target.value)}
            placeholder="comma-separated emails (optional)"
            className={FIELD}
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400" data-testid="business-setup-email-recipients-note">
        CC/BCC addresses are validated and deduplicated at send time. BCC recipients are never shown to others.
      </p>
    </div>
  );
}

/* --------------------- Configure step: voice card --------------------- */

function StepVoice({
  title,
  showVoice,
  assistantName,
  voiceChoice,
  customVoiceId,
  customInstructions,
  silenceRepromptCount,
  silenceMessage1,
  silenceMessage2,
  goodbyeMessage,
  onAssistantName,
  onVoiceChoice,
  onCustomVoiceId,
  onCustomInstructions,
  onSilenceCount,
  onSilence1,
  onSilence2,
  onGoodbye
}: {
  title: string;
  showVoice: boolean;
  assistantName: string;
  voiceChoice: string;
  customVoiceId: string;
  customInstructions: string;
  silenceRepromptCount: number;
  silenceMessage1: string;
  silenceMessage2: string;
  goodbyeMessage: string;
  onAssistantName: (v: string) => void;
  onVoiceChoice: (v: string) => void;
  onCustomVoiceId: (v: string) => void;
  onCustomInstructions: (v: string) => void;
  onSilenceCount: (v: number) => void;
  onSilence1: (v: string) => void;
  onSilence2: (v: string) => void;
  onGoodbye: (v: string) => void;
}) {
  return (
    <div className={CARD}>
      <h2 className={H2}>{title}</h2>
      <p className={SUB}>
        {showVoice
          ? "Choose the AI name, voice, and call behavior your customers will hear."
          : "Tell the AI how to handle conversations for your business."}
      </p>

      {showVoice ? (
      <div className="mt-6" data-testid="business-setup-assistant-name">
        <h3 className={SECTION_TITLE}>AI assistant name</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          This is the name your AI uses on calls.
        </p>

        <div className="mt-3">
          <label className={LABEL} htmlFor="assistant-name">
            AI assistant name
          </label>

          <input
            data-testid="business-setup-input-assistant-name"
            id="assistant-name"
            value={assistantName}
            onChange={(e) => onAssistantName(e.target.value)}
            placeholder={DEFAULT_ASSISTANT_NAME}
            className={FIELD}
          />

          <p className="mt-1 text-xs text-slate-400">
            Example: “Hello, this is {assistantName.trim() || DEFAULT_ASSISTANT_NAME} from {"{{business name}}"}. How can I help you today?”
          </p>
        </div>
      </div>
      ) : null}

      {showVoice ? (
      <div className={SECTION} data-testid="business-setup-voice">
        <h3 className={SECTION_TITLE}>Voice</h3>

        <div className="mt-3">
          <VoicePicker
            accent="orange"
            testIdPrefix="business-voice-picker"
            selectedVoice={voiceChoice || PLATFORM_DEFAULT_VOICE_ID}
            customVoiceId={customVoiceId}
            subtitle="Architect suggested this voice. Your business can use it or choose another voice before deployment."
            onSelectDefault={() => {
              onVoiceChoice(PLATFORM_DEFAULT_VOICE_ID);
              onCustomVoiceId("");
            }}
            onSelectPreset={(preset) => {
              onVoiceChoice(normalizeVoiceChoice(preset.id));
              onCustomVoiceId("");
            }}
            onCustomVoiceIdChange={(value) => {
              const nextValue = value.trim();

              onCustomVoiceId(value);
              onVoiceChoice(nextValue ? "custom" : PLATFORM_DEFAULT_VOICE_ID);
            }}
          />
        </div>

        <p className="mt-2 text-xs text-slate-400">
          If you do not enter a custom ID, Triven uses {TRIVEN_VOICE_NAME} from ELEVENLABS_DEFAULT_VOICE_ID.
        </p>
      </div>
      ) : null}

      <div className={SECTION} data-testid="business-setup-instructions">
        <h3 className={SECTION_TITLE}>Custom instructions</h3>
        <p className="mt-0.5 text-sm text-slate-500">Tell the AI how to handle calls. Merged into the agent’s system prompt at deploy.</p>

        <div className="mt-3 flex flex-wrap gap-2" data-testid="business-setup-instruction-chips">
          {CUSTOM_INSTRUCTION_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              data-testid={`business-setup-instruction-chip-${suggestion.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              onClick={() => {
                if (customInstructions.includes(suggestion)) return;

                const trimmed = customInstructions.trim();

                onCustomInstructions(trimmed ? `${trimmed}\n- ${suggestion}` : `- ${suggestion}`);
              }}
              className="btn rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-amber-300 hover:bg-amber-50"
            >
              + {suggestion}
            </button>
          ))}
        </div>

        <textarea
          data-testid="business-setup-input-instructions"
          value={customInstructions}
          onChange={(e) => onCustomInstructions(e.target.value)}
          rows={6}
          placeholder="e.g. Always greet by business name. Confirm date and time before booking."
          className={`${FIELD} mt-3`}
        />
      </div>

      {showVoice ? (
      <div className={SECTION} data-testid="business-setup-silence">
        <h3 className={SECTION_TITLE}>Silence &amp; no-answer handling</h3>
        <p className="mt-0.5 text-sm text-slate-500">If the caller goes quiet, the AI re-prompts warmly, then ends the call politely.</p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="silence-count">
              Re-prompt attempts
            </label>

            <select
              data-testid="business-setup-input-silence-count"
              id="silence-count"
              value={String(silenceRepromptCount)}
              onChange={(e) => onSilenceCount(Number(e.target.value))}
              className={FIELD}
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className={LABEL} htmlFor="silence-1">
            1st silence re-prompt
          </label>

          <input
            data-testid="business-setup-input-silence1"
            id="silence-1"
            value={silenceMessage1}
            onChange={(e) => onSilence1(e.target.value)}
            placeholder={DEFAULT_SILENCE.reprompt1}
            className={FIELD}
          />
        </div>

        <div className="mt-4">
          <label className={LABEL} htmlFor="silence-2">
            2nd silence re-prompt
          </label>

          <input
            data-testid="business-setup-input-silence2"
            id="silence-2"
            value={silenceMessage2}
            onChange={(e) => onSilence2(e.target.value)}
            placeholder={DEFAULT_SILENCE.reprompt2}
            className={FIELD}
          />
        </div>

        <div className="mt-4">
          <label className={LABEL} htmlFor="goodbye">
            Goodbye message
          </label>

          <input
            data-testid="business-setup-input-goodbye"
            id="goodbye"
            value={goodbyeMessage}
            onChange={(e) => onGoodbye(e.target.value)}
            placeholder={DEFAULT_SILENCE.goodbye}
            className={FIELD}
          />
        </div>
      </div>
      ) : null}
    </div>
  );
}

/* ---------------------- Preview call (Test step) ---------------------- */

type PreviewVapiEventName = "call-start" | "call-end" | "speech-start" | "speech-end" | "error" | "message";

type PreviewVapiClient = {
  start: (assistantId: string, overrides?: Record<string, unknown>) => Promise<unknown>;
  stop: () => void;
  on: (event: PreviewVapiEventName, listener: (payload?: unknown) => void) => unknown;
  off?: (event: PreviewVapiEventName, listener: (payload?: unknown) => void) => unknown;
  removeAllListeners?: (event?: PreviewVapiEventName) => unknown;
};

let sharedPreviewClient: PreviewVapiClient | null = null;
let sharedPreviewClientKey = "";

async function getPreviewVapiClient(publicKey: string): Promise<PreviewVapiClient> {
  if (sharedPreviewClient && sharedPreviewClientKey === publicKey) return sharedPreviewClient;

  if (sharedPreviewClient) {
    try {
      sharedPreviewClient.stop();
    } catch {
      // already stopped
    }
    try {
      sharedPreviewClient.removeAllListeners?.();
    } catch {
      // no listeners
    }
  }

  const mod = await import("@vapi-ai/web");
  const VapiCtor = mod.default as unknown as new (key: string) => PreviewVapiClient;

  sharedPreviewClient = new VapiCtor(publicKey);
  sharedPreviewClientKey = publicKey;

  return sharedPreviewClient;
}

type PreviewTranscriptEntry = { role: "assistant" | "user"; text: string };
type PreviewCallState = "idle" | "starting" | "live" | "ended";

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function PreviewCallSection() {
  const [state, setState] = useState<PreviewCallState>("idle");
  const [error, setError] = useState("");
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [transcript, setTranscript] = useState<PreviewTranscriptEntry[]>([]);
  const [session, setSession] = useState<BusinessPreviewCallSession | null>(null);

  const clientRef = useRef<PreviewVapiClient | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const startInFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      detachRef.current?.();
      if (timerRef.current) clearInterval(timerRef.current);
      try {
        clientRef.current?.stop();
      } catch {
        // best-effort cleanup
      }
    };
  }, []);

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function endPreview(stopClient = true) {
    stopTimer();
    detachRef.current?.();
    detachRef.current = null;

    if (stopClient) {
      try {
        clientRef.current?.stop();
      } catch {
        // already stopped
      }
    }

    setAgentSpeaking(false);
    setState("ended");
  }

  async function startPreview() {
    if (startInFlightRef.current || state === "starting" || state === "live") return;

    startInFlightRef.current = true;
    setError("");
    setTranscript([]);
    setState("starting");

    try {
      const res = await startBusinessSetupPreviewCall();

      if (!res.success || !res.data?.session) {
        setState("idle");
        setError(res.error ?? "The preview call is unavailable right now. Save your setup and try again.");
        return;
      }

      const nextSession = res.data.session;
      setSession(nextSession);

      const client = await getPreviewVapiClient(nextSession.publicKey);
      clientRef.current = client;

      const onCallStart = () => {
        setState("live");
        setSecondsLeft(nextSession.maxDurationSeconds);
        stopTimer();
        timerRef.current = setInterval(() => {
          setSecondsLeft((current) => {
            if (current <= 1) {
              endPreview();
              return 0;
            }
            return current - 1;
          });
        }, 1000);
      };

      const onCallEnd = () => endPreview(false);
      const onSpeechStart = () => setAgentSpeaking(true);
      const onSpeechEnd = () => setAgentSpeaking(false);

      const onError = (payload?: unknown) => {
        const text =
          payload instanceof Error
            ? payload.message
            : typeof payload === "string"
              ? payload
              : JSON.stringify(payload ?? "");

        setError(
          /permission|microphone|denied|NotAllowed/i.test(text)
            ? "Microphone access is blocked. Allow the mic for this site and try again."
            : "The preview call ended unexpectedly. Try again."
        );
        endPreview();
      };

      const onMessage = (payload?: unknown) => {
        const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
        if (record.type !== "transcript" || record.transcriptType !== "final") return;

        const text = typeof record.transcript === "string" ? record.transcript.trim() : "";
        if (!text) return;

        const role = record.role === "assistant" ? ("assistant" as const) : ("user" as const);
        setTranscript((current) => [...current, { role, text }]);
      };

      client.on("call-start", onCallStart);
      client.on("call-end", onCallEnd);
      client.on("speech-start", onSpeechStart);
      client.on("speech-end", onSpeechEnd);
      client.on("error", onError);
      client.on("message", onMessage);

      detachRef.current = () => {
        client.off?.("call-start", onCallStart);
        client.off?.("call-end", onCallEnd);
        client.off?.("speech-start", onSpeechStart);
        client.off?.("speech-end", onSpeechEnd);
        client.off?.("error", onError);
        client.off?.("message", onMessage);
      };

      await client.start(nextSession.assistantId, { metadata: { purpose: "BUYER_SETUP_PREVIEW" } });
    } catch {
      endPreview();
      setState("idle");
      setError("Could not start the preview call. Check your microphone and try again.");
    } finally {
      startInFlightRef.current = false;
    }
  }

  return (
    <div className={SECTION} data-testid="business-setup-preview-call">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={SECTION_TITLE}>Talk to your agent</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            A live browser preview — it answers with your business details, FAQs, and voice, exactly like the live
            agent. Booking and texting are disabled during preview.
          </p>
        </div>

        {state === "live" ? (
          <span className="shrink-0 font-mono text-sm font-bold text-slate-700" data-testid="business-setup-preview-timer">
            {formatSeconds(secondsLeft)}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {state === "live" ? (
          <button
            type="button"
            data-testid="business-setup-preview-end"
            onClick={() => endPreview()}
            className="btn rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-600"
          >
            End call
          </button>
        ) : (
          <button
            type="button"
            data-testid="business-setup-preview-start"
            disabled={state === "starting"}
            onClick={() => void startPreview()}
            className="btn rounded-full bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
          >
            {state === "starting" ? "Connecting…" : state === "ended" ? "Call again" : "Start preview call"}
          </button>
        )}

        <span
          data-testid="business-setup-preview-status"
          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
            state === "live" ? (agentSpeaking ? "text-violet-600" : "text-green-600") : "text-slate-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              state === "live"
                ? agentSpeaking
                  ? "bg-violet-500"
                  : "bg-green-500"
                : state === "starting"
                  ? "bg-amber-400"
                  : "bg-slate-300"
            }`}
          />
          {state === "live"
            ? agentSpeaking
              ? "Agent speaking…"
              : "Listening — just talk"
            : state === "starting"
              ? "Connecting…"
              : state === "ended"
                ? "Call ended"
                : "Idle"}
        </span>

        {session && state !== "idle" ? (
          <span className="text-xs text-slate-400" data-testid="business-setup-preview-assistant">
            {session.assistantName} · {session.businessName}
          </span>
        ) : null}
      </div>

      {transcript.length > 0 ? (
        <div
          className="mt-4 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3.5"
          data-testid="business-setup-preview-transcript"
        >
          {transcript.map((entry, index) => (
            <p key={index} className="text-sm">
              <span className={`font-semibold ${entry.role === "assistant" ? "text-amber-700" : "text-slate-700"}`}>
                {entry.role === "assistant" ? "Agent" : "You"}:
              </span>{" "}
              <span className="text-slate-700">{entry.text}</span>
            </p>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600" data-testid="business-setup-preview-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------ Missed-call simulation (Test step) ------------------ */

type SimulationStage = "idle" | "waiting" | "detected" | "generating" | "sent" | "failed";

/** Text-back message built from the buyer's configured business name + tone. */
function buildTextBackMessage(businessName: string, tone: string): string {
  const name = businessName.trim() || "our office";

  if (tone === "professional") {
    return `Hello, this is ${name}. We're sorry we missed your call. Please reply to this message and a team member will follow up shortly to schedule your visit.`;
  }

  if (tone === "casual") {
    return `Hey! Sorry we missed you at ${name} 🤙 Want to grab an appointment? Just reply YES and we'll sort it out!`;
  }

  return `Hi! Sorry we missed your call at ${name}. 😊 Want to book an appointment? Reply YES and we'll get you scheduled right away.`;
}

function businessInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "AI";
}

function nowTimeLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const SIMULATION_BADGES: Record<SimulationStage, { label: string; dot: string; text: string }> = {
  idle: { label: "Idle", dot: "bg-slate-300", text: "text-slate-400" },
  waiting: { label: "Listening", dot: "bg-amber-400", text: "text-amber-600" },
  detected: { label: "Call detected", dot: "bg-green-500", text: "text-green-600" },
  generating: { label: "Generating", dot: "bg-violet-500", text: "text-violet-600" },
  sent: { label: "SMS delivered", dot: "bg-green-500", text: "text-green-600" },
  failed: { label: "Failed", dot: "bg-red-500", text: "text-red-600" }
};

const includesAny = (value: string, needles: string[]) => {
  return needles.some((needle) => value.includes(needle));
};

const nodeText = (node: any) => {
  const data = node.data ?? {};
  return [
    data.type,
    data.nodeKind,
    data.connector,
    data.connectorAction,
    data.label,
    data.title,
    data.subtitle
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
};

const inferWorkflowChannel = (nodes: any[], connectors: string[]): "sms" | "missed-call" | "voice" | "whatsapp" | "email" | "manual" => {
  const haystack = [...nodes.map(nodeText), connectors.join(" ").toLowerCase()].join(" ");

  if (includesAny(haystack, ["missed_call", "missed call", "no-answer", "no_answer"])) return "missed-call";
  if (includesAny(haystack, ["phone_call", "voice_conversation", "vapi", "voice call", "incoming call"])) return "voice";
  if (includesAny(haystack, ["whatsapp"])) return "whatsapp";
  if (includesAny(haystack, ["gmail", "email", "mail"])) return "email";
  if (includesAny(haystack, ["inbound_sms", "send_sms", "sms", "text message", "twilio"])) return "sms";
  return "manual";
};

const getAnsweringLabels = (mode: string, listing?: any) => {
  let channel = "missed-call";
  if (listing) {
    const nodes = listing.workflow?.workflowJson?.nodes || [];
    const connectors = listing.requiredConnectors || [];
    channel = inferWorkflowChannel(nodes, connectors);
  } else {
    // fallback to answeringMode
    if (mode === "AI_FIRST") {
      channel = "voice";
    } else if (mode === "BUSY" || mode === "AFTER_HOURS" || mode === "UNREACHABLE" || mode === "NO_ANSWER") {
      channel = "missed-call";
    }
  }

  switch (channel) {
    case "sms":
      return {
        waiting: "Waiting for an incoming text…",
        detected: "Text message received",
        action: "Simulate an incoming SMS",
        subtitle: "Send a text message to your Triven number and watch the agent reply dynamically.",
        instruction2: "Send an SMS to your business number",
        instruction3: "Watch the live feed below update in real time"
      };
    case "whatsapp":
      return {
        waiting: "Waiting for a WhatsApp message…",
        detected: "WhatsApp message received",
        action: "Simulate a WhatsApp message",
        subtitle: "Send a WhatsApp message to your number and watch the agent respond.",
        instruction2: "Send a WhatsApp message to your Triven number",
        instruction3: "Watch the live feed below update in real time"
      };
    case "email":
      return {
        waiting: "Waiting for an email…",
        detected: "Email received",
        action: "Simulate an email",
        subtitle: "Send an email to your address and watch the agent respond.",
        instruction2: "Send an email to your Triven email alias",
        instruction3: "Watch the live feed below update in real time"
      };
    case "voice":
      return {
        waiting: "Waiting for an inbound call…",
        detected: "Inbound call detected",
        action: "Simulate an inbound call",
        subtitle: "Call your Triven number and speak to your live agent, or simulate a call below.",
        instruction2: "Let the call connect, and speak to the agent",
        instruction3: "Watch the live feed update as you talk"
      };
    case "manual":
      return {
        waiting: "Waiting for a manual trigger…",
        detected: "Manual trigger detected",
        action: "Simulate a manual trigger",
        subtitle: "Run a workflow trigger and watch the agent execute actions.",
        instruction2: "Start a manual trigger run",
        instruction3: "Watch the live feed below update in real time"
      };
    default:
      return {
        waiting: "Waiting for a missed call…",
        detected: "Missed call detected",
        action: "Simulate a missed call",
        subtitle: "Call your business number and hang up after 3 rings, then watch the agent respond in real time.",
        instruction2: "Let it ring 3 times, then hang up",
        instruction3: "Watch the live feed below light up"
      };
  }
};

const SIMULATION_STAGE_ORDER: SimulationStage[] = ["idle", "waiting", "detected", "generating", "sent"];

function MissedCallSimulationSection({
  businessName,
  tone,
  answeringMode,
  listing
}: {
  businessName: string;
  tone: string;
  answeringMode: string;
  listing?: any;
}) {
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<SimulationStage>("idle");
  const [error, setError] = useState("");
  const [detectedAt, setDetectedAt] = useState("");
  const [sentAt, setSentAt] = useState("");
  const [result, setResult] = useState<TestSmsResult | null>(null);

  const timersRef = useRef<number[]>([]);
  const runningRef = useRef(false);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const message = buildTextBackMessage(businessName, tone);
  const running = stage === "waiting" || stage === "detected" || stage === "generating";
  const badge = SIMULATION_BADGES[stage];

  function stageReached(target: SimulationStage): boolean {
    if (stage === "failed") return target !== "sent";
    return SIMULATION_STAGE_ORDER.indexOf(stage) >= SIMULATION_STAGE_ORDER.indexOf(target);
  }

  function schedule(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  async function runSimulation() {
    const to = phone.trim();

    if (!to) {
      setError("Enter your mobile number to receive the test SMS.");
      return;
    }

    if (!to.startsWith("+")) {
      setError("Include the country code in E.164 format — e.g. +15551234567 for US numbers.");
      return;
    }

    if (runningRef.current) return;
    runningRef.current = true;

    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];

    setError("");
    setResult(null);
    setSentAt("");
    setDetectedAt("");
    setStage("waiting");

    schedule(() => {
      setDetectedAt(nowTimeLabel());
      setStage("detected");
    }, 1300);

    schedule(() => setStage("generating"), 2600);

    const minPlaytime = new Promise((resolve) => schedule(() => resolve(null), 4200));
    const [res] = await Promise.all([sendBusinessTestSms({ to, message }), minPlaytime]);

    runningRef.current = false;

    if (res.success && res.data) {
      setResult(res.data);
      setSentAt(nowTimeLabel());
      setStage("sent");
    } else {
      setError(res.error ?? "Could not send the test SMS.");
      setStage("failed");
    }
  }

  const [testConfirmed, setTestConfirmed] = useState(false);
  const labels = getAnsweringLabels(answeringMode, listing);

  return (
    <div className="mt-8 border-t border-slate-100 pt-6" data-testid="business-setup-simulate">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-700">Live agent feed</span>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
            stage === "idle" ? "text-slate-400 bg-slate-50" : badge.text
          }`}
          data-testid="business-setup-simulate-badge"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot} ${running ? "animate-pulse" : ""}`} />
          {badge.label}
        </span>
      </div>

      {/* Live status feed container */}
      <div className="rounded-xl border border-slate-100 bg-white divide-y divide-slate-50 overflow-hidden shadow-sm" id="feed">
        {/* Waiting step */}
        <div className={`feed-item flex items-center gap-3 p-4 ${stage !== "idle" ? "show" : ""}`}>
          <span className={`${stage === "waiting" ? "text-amber-400 dot-pulse" : "text-green-500"} w-2.5 h-2.5 rounded-full bg-current shrink-0`} />
          <span className={`text-sm ${stage !== "idle" ? "text-slate-700 font-semibold" : "text-slate-500"}`}>
            {labels.waiting}
          </span>
        </div>

        {/* Detected step */}
        {stageReached("detected") && (
          <div className="feed-item show flex items-center gap-3 p-4" data-testid="business-setup-simulate-detected">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />
            <span className="flex-1 text-sm text-slate-700 font-semibold">
              {labels.detected} from <strong className="font-mono">{phone.trim() || "unknown"}</strong>
            </span>
            <span className="font-mono text-xs text-slate-400">{detectedAt}</span>
          </div>
        )}

        {/* Generating step */}
        {stageReached("generating") && (
          <div className="feed-item show flex items-center gap-3 p-4" data-testid="business-setup-simulate-generating">
            {stage === "generating" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4 shrink-0 spin text-violet-500">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" />
            )}
            <span className="flex-1 text-sm text-slate-700 font-semibold">
              {stage === "generating" ? "AI generating a personalized response…" : "Personalized response generated"}
            </span>
          </div>
        )}

        {/* Sent / Delivery step */}
        {stage === "sent" && (
          <div className="feed-item show flex items-center gap-3 p-4" data-testid="business-setup-simulate-sent">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-green-500 text-[11px] font-bold text-white">✓</span>
            <span className="flex-1 text-sm font-semibold text-green-700">SMS sent successfully</span>
            <span className="font-mono text-xs text-slate-400">{sentAt}</span>
          </div>
        )}

        {/* Failed step */}
        {stage === "failed" && (
          <div className="feed-item show flex items-center gap-3 p-4" data-testid="business-setup-simulate-failed">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-500 text-[11px] font-bold text-white">✕</span>
            <span className="flex-1 text-sm font-semibold text-red-600">SMS could not be sent</span>
          </div>
        )}
      </div>

      {/* SMS Preview Mockup */}
      {stage === "sent" && result && (
        <div className="mt-6 flex flex-col items-center" data-testid="business-setup-simulate-preview">
          <div className="phone-frame sms-ring rounded-[2rem] w-64 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-500 text-xs font-bold text-white">
                {businessInitials(businessName)}
              </span>
              <div className="leading-tight">
                <span className="block text-xs font-semibold text-slate-800">{businessName.trim() || "Your business"}</span>
                <span className="block text-[10px] text-slate-400">Text message · now</span>
              </div>
            </div>

            <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] leading-snug text-slate-700 shadow-sm">
              {message}
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-slate-400" data-testid="business-setup-simulate-result">
            {result.simulated
              ? "Simulated — no Twilio request was made; nothing was delivered."
              : result.testCredentials
                ? "Accepted with Twilio test credentials — nothing was delivered."
                : `Really sent — check ${result.to}.`}
            {result.from ? ` Sender: ${result.from}.` : ""}
          </p>
        </div>
      )}

      {/* Input phone & simulate controls */}
      <div className="mt-6 flex flex-col items-center gap-4">
        {!running && stage !== "sent" && (
          <div className="w-full max-w-sm">
            <label htmlFor="test-phone" className="block text-xs font-semibold text-slate-500 mb-1.5 text-center uppercase tracking-wider">
              Enter your mobile number to receive the test SMS
            </label>
            <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 transition-all focus-within:border-amber-500 focus-within:ring-4 focus-within:ring-amber-500/10">
              <input
                id="test-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+15551234567"
                data-testid="business-setup-simulate-phone"
                className="flex-1 min-w-0 px-3 py-2.5 text-sm bg-transparent outline-none text-slate-900 placeholder-slate-400"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 text-center font-semibold">Include country code — e.164 format (e.g. +15551234567)</p>
          </div>
        )}

        <div className="flex flex-col items-center gap-3 w-full">
          <button
            type="button"
            data-testid="business-setup-simulate-run"
            disabled={running}
            onClick={() => void runSimulation()}
            className="btn bg-amber-500 text-white rounded-xl px-6 py-3 font-semibold shadow-lg shadow-amber-500/30 hover:bg-amber-600 inline-flex items-center gap-2 w-full sm:w-auto justify-center transition-all"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span>{running ? "Simulating…" : stage === "sent" || stage === "failed" ? "Simulate again" : labels.action}</span>
          </button>

          {stage === "sent" && !testConfirmed && (
            <button
              type="button"
              onClick={() => setTestConfirmed(true)}
              className="btn bg-green-500 text-white rounded-xl px-6 py-3 font-semibold shadow-lg shadow-green-500/30 hover:bg-green-600 inline-flex items-center gap-2 w-full sm:w-auto justify-center transition-all"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>I received the text</span>
            </button>
          )}

          {testConfirmed && (
            <p className="text-sm font-semibold text-green-600 flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Nice — your agent works. You&rsquo;re ready to go live.
            </p>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600 text-center" data-testid="business-setup-simulate-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------- Test step -------------------------------- */

function StepTest({
  showPreview,
  showCallTest,
  deployedLive,
  assignedNumber,
  businessName,
  tone,
  testing,
  testResult,
  onTestCallRouting,
  answeringMode,
  listing
}: {
  showPreview: boolean;
  showCallTest: boolean;
  deployedLive: boolean;
  assignedNumber: string | null;
  businessName: string;
  tone: string;
  testing: boolean;
  testResult: CallRoutingResult | null;
  onTestCallRouting: () => void;
  answeringMode: string;
  listing?: any;
}) {
  const labels = getAnsweringLabels(answeringMode, listing);

  return (
    <div className="space-y-6">
      {/* Icon */}
      <div className="w-14 h-14 bg-green-50 rounded-2xl grid place-items-center text-green-600 mb-5" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className="w-6 h-6 ml-0.5">
          <polygon points="6 3 20 12 6 21 6 3" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold tracking-tight text-slate-900">Let&rsquo;s test it live</h2>
      <p className="text-slate-500 text-base mt-2 max-w-md">
        {assignedNumber
          ? <>{"Call "}<span className="font-mono font-semibold text-slate-700">{assignedNumber}</span>{" and check the routing logic, then watch the agent respond."}</>
          : labels.subtitle}
      </p>
      <span className="inline-flex items-center gap-1 text-xs text-slate-400 mt-3 font-semibold mb-6">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        ~60 seconds
      </span>

      {/* Numbered instructions */}
      {showCallTest ? (
        <div className="mt-8 bg-slate-50 rounded-xl p-5 sm:p-6 border border-slate-100">
          <ol className="space-y-3.5">
            <li className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-sm font-bold grid place-items-center shrink-0 font-sans">1</span>
              <span className="text-sm text-slate-700">
                Call{" "}
                <strong className="font-semibold text-slate-900 font-mono">
                  {assignedNumber ?? "your Triven number"}
                </strong>{" "}
                from your personal phone
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-sm font-bold grid place-items-center shrink-0 font-sans">2</span>
              <span className="text-sm text-slate-700">{labels.instruction2}</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-sm font-bold grid place-items-center shrink-0 font-sans">3</span>
              <span className="text-sm text-slate-700">{labels.instruction3}</span>
            </li>
          </ol>
        </div>
      ) : null}

      {/* Pre-deploy note */}
      {showCallTest && !deployedLive ? (
        <div
          className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          data-testid="business-setup-test-predeploy-note"
        >
          Your agent is not live yet, so some checks below pass only after you deploy in the{" "}
          <span className="font-semibold">Go live</span> step. Run the check now to catch setup issues early, then
          re-test after deploying.
        </div>
      ) : null}

      {showCallTest ? <MissedCallSimulationSection businessName={businessName} tone={tone} answeringMode={answeringMode} listing={listing} /> : null}


      {showPreview ? <PreviewCallSection /> : null}

      {showCallTest ? (
      <div className={SECTION} data-testid="business-setup-test-routing">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className={SECTION_TITLE}>Test call routing</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Confirm an inbound call to your Triven number will reach this deployed agent.
            </p>
          </div>

          <button
            type="button"
            data-testid="business-setup-test-routing-run"
            disabled={testing}
            onClick={onTestCallRouting}
            className="btn shrink-0 rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-amber-300 bg-white"
          >
            {testing ? "Testing…" : "Test call routing"}
          </button>
        </div>

        {testResult ? (
          <div className="mt-4">
            <div
              className={`rounded-xl px-4 py-3 text-sm font-semibold ${testResult.readyForCall ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"
                }`}
              data-testid="business-setup-test-routing-summary"
            >
              {testResult.readyForCall
                ? `Ready — a call to ${testResult.number ?? "your Triven number"} will reach your agent.`
                : "Not ready yet — resolve the failing checks below, then re-test."}
            </div>

            <ul className="mt-3 space-y-2" data-testid="business-setup-test-routing-checks">
              {testResult.checks.map((check) => (
                <li
                  key={check.key}
                  data-testid={`business-setup-test-routing-check-${check.key}`}
                  className="flex items-center gap-2.5 text-sm"
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${check.ok ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"
                      }`}
                  >
                    {check.ok ? "✓" : "✕"}
                  </span>

                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-800">{check.label}</span>

                    {check.message ? (
                      <span className="block break-all text-xs text-slate-400">{check.message}</span>
                    ) : null}
                  </span>

                  <span className={`ml-auto shrink-0 text-xs font-semibold ${check.ok ? "text-green-600" : "text-red-500"}`}>
                    {check.ok ? "Pass" : "Fail"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      ) : null}

    </div>
  );
}

/* ------------------------------ Go live step ------------------------------ */

function StepGoLive({
  checklist,
  blockers,
  readyToDeploy,
  assignedNumber
}: {
  checklist: ChecklistRow[];
  blockers: string[];
  readyToDeploy: boolean;
  assignedNumber: string | null;
}) {
  return (
    <div className="space-y-6">
      {/* Icon */}
      <div className="w-14 h-14 bg-amber-50 rounded-2xl grid place-items-center text-amber-600 mb-5" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold tracking-tight text-slate-900">Go live</h2>
      <p className="text-slate-500 text-base mt-2 max-w-md">
        Deploy builds your live assistant with your voice, timezone, and instructions, and routes your Triven number
        {assignedNumber ? <span className="font-mono font-bold text-slate-700"> {assignedNumber}</span> : null} to it.
      </p>
      <span className="inline-flex items-center gap-1 text-xs text-slate-400 mt-3 font-semibold mb-6">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        ~30 seconds
      </span>

      <div className={SECTION}>
        {blockers.length > 0 ? (
          <div data-testid="business-setup-blockers" className="rounded-xl bg-amber-50 border border-amber-100 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-800">Complete these before you can deploy live:</p>

            <ul className="mt-2 list-disc pl-5 space-y-1">
              {blockers.map((blocker) => (
                <li key={blocker} data-testid="business-setup-blocker">
                  {blocker}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-xl bg-green-50 border border-green-100 p-4 text-sm font-semibold text-green-800" data-testid="business-setup-ready">
            All set — you can deploy your live agent.
          </div>
        )}
      </div>
    </div>
  );
}