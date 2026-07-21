"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import {
  COMMON_TIMEZONES,
  DEFAULT_SILENCE,
  getAgentSuccessMessage,
  getWorkflowTriggerKind,
  isBuyerAnswerEmpty,
  normalizeBuyerSetupFields,
  normalizeTimeZone,
  validateBuyerSetupAnswers,
  VOICE_PRESETS,
  type WorkflowTriggerKind
} from "@coreai/shared";
import { PhoneNumberSelectionSection } from "@/components/business/phone-number-selection";
import {
  BusinessHoursSummary,
  type EmbeddedSectionApi
} from "@/components/business/business-hours-section";
import { ConfigureSectionCard, type ConfigureSectionStatus } from "@/components/business/setup/configure-section-card";
import { BusinessProfileSection } from "@/components/business/setup/business-profile-section";
import { AgentIdentitySection } from "@/components/business/setup/agent-identity-section";
import { KnowledgeSection } from "@/components/business/setup/knowledge-section";
import { AgentBehaviorSection } from "@/components/business/setup/agent-behavior-section";
import { HoursAvailabilitySection } from "@/components/business/setup/hours-availability-section";
import { type ApptNumberField } from "@/components/business/setup/appointment-hours-editor";
import { validateBookingRules } from "@/components/business/setup/booking-rules-panel";
import {
  defaultAnsweringDays,
  type AiCoverageKind,
  type AnsweringDayRow
} from "@/components/business/setup/ai-call-coverage-editor";
import { businessSetupPath } from "@/lib/routes";
import {
  checkMailAliasAvailability,
  deleteBusinessTestEvent,
  disconnectBusinessCalendar,
  getAppointmentSchedule,
  getBusinessCalendarOAuthUrl,
  getBusinessFacts,
  getBusinessHours,
  getBusinessKnowledgeFiles,
  getBusinessMailSetup,
  getBusinessSetup,
  getMarketplaceListing,
  putBusinessHours,
  runBusinessSetupChatTest,
  saveBusinessMailSetup,
  saveBusinessSetup,
  sendMailSetupTestEmail,
  startBusinessSetupPreviewCall,
  testCallRouting,
  type AppointmentDayHours,
  type AppointmentWeekday,
  type BusinessChatTestMessage,
  type BusinessChatTestResult,
  type BusinessChatTestToolCall,
  type BusinessHoursData,
  type BusinessTestExecutedNode,
  type BusinessPreviewCallSession,
  type BusinessEmailAliasData,
  type BusinessFactsData,
  type BusinessFaq,
  type BusinessHoursItem,
  type BusinessKnowledgeItem,
  type BusinessTestCalendarEvent,
  type BuyerCustomFieldValue,
  type BuyerSetupFieldDef,
  type CallRoutingResult,
  type KnowledgeFileSummary,
  type PlatformPhoneOption
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

const DEFAULT_APPT_DAYS: Record<AppointmentWeekday, AppointmentDayHours> = {
  monday: { open: "09:00", close: "17:00", closed: false },
  tuesday: { open: "09:00", close: "17:00", closed: false },
  wednesday: { open: "09:00", close: "17:00", closed: false },
  thursday: { open: "09:00", close: "17:00", closed: false },
  friday: { open: "09:00", close: "17:00", closed: false },
  saturday: { open: "09:00", close: "17:00", closed: true },
  sunday: { open: "09:00", close: "17:00", closed: true }
};

const ANSWERING_MODES: { value: string; label: string }[] = [
  { value: "AI_FIRST", label: "AI answers all calls" },
  { value: "NO_ANSWER", label: "AI answers missed / no-answer calls" },
  { value: "BUSY", label: "AI answers when the line is busy" },
  { value: "AFTER_HOURS", label: "AI answers after business hours" },
  { value: "UNREACHABLE", label: "AI answers when the phone is unreachable" }
];


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
.setup-root button:focus-visible {
  outline: 2px solid #f59e0b;
  outline-offset: 2px;
  border-radius: 8px;
}
.setup-root input:focus,
.setup-root select:focus,
.setup-root textarea:focus,
.setup-root input:focus-visible,
.setup-root select:focus-visible,
.setup-root textarea:focus-visible {
  outline: none !important;
}

.setup-root .field {
  transition: border-color .2s var(--ease), background-color .2s var(--ease);
}
.setup-root .field:focus {
  border-color: #f59e0b;
  box-shadow: none;
}

.setup-root .btn {
  transition: transform .15s ease, background-color .2s ease, border-color .2s ease, color .2s ease;
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

.setup-root .pstep.active .pdot { background: #f59e0b; color: #fff; border-color: #f59e0b; box-shadow: none; transform: scale(1.06); }
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
.setup-root .phone-wrap { transition: border-color .25s var(--ease); }
.setup-root .phone-wrap.is-valid { border-color: #22c55e !important; box-shadow: none; }
.setup-root .phone-check { opacity: 0; transform: scale(.6); transition: opacity .25s var(--ease), transform .35s var(--ease); }
.setup-root .phone-wrap.is-valid .phone-check { opacity: 1; transform: scale(1); }

/* Pick cards */
.setup-root .pick { transition: border-color .2s var(--ease), background-color .2s var(--ease), transform .2s var(--ease); cursor: pointer; }
.setup-root .pick:hover { border-color: #fcd34d; }
.setup-root .pick.selected { border-color: #f59e0b; background: #fffbeb; box-shadow: none; }
.setup-root .pick .tick { opacity: 0; transform: scale(.5); transition: opacity .2s var(--ease), transform .3s var(--ease); }
.setup-root .pick.selected .tick { opacity: 1; transform: scale(1); }

/* Day checkboxes */
.setup-root .day { transition: background-color .15s ease, color .15s ease, border-color .15s ease, transform .12s ease; cursor: pointer; user-select: none; }
.setup-root .day:active { transform: scale(.94); }
.setup-root .day.on { background: #f59e0b; color: #fff; border-color: #f59e0b; }

.setup-root .spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

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
  .setup-root .animate-in, .setup-root .check-pop, .setup-root .draw, .setup-root .stagger > *, .setup-root .spin, .setup-root .confetti-piece, .setup-root .toast-in { animation: none !important; }
  .setup-root .draw { stroke-dashoffset: 0; }
  .setup-root .stagger > * { opacity: 1; transform: none; }
  .setup-root .btn:hover, .setup-root .btn:active { transform: none !important; }
}
`;

const FIELD =
  "field w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none";
const LABEL = "mb-1.5 block text-sm font-medium text-slate-700";
const CARD = "animate-in rounded-2xl border border-gray-100 bg-white p-6 sm:p-8";
const SECTION = "mt-8 border-t border-gray-100 pt-8";
const SECTION_TITLE = "text-sm font-bold text-slate-900";

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
  /** True when the main setup save was skipped (live agent) — progress toasts must not claim success. */
  mainSaveSkipped?: boolean;
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
          <div className="rounded-2xl border border-gray-100 bg-white p-8 text-sm text-slate-500">
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
  // Browser test-call outcome — lifted so the Go-live readiness list can show
  // "Test completed" as a recommendation.
  const [browserTestOutcome, setBrowserTestOutcome] = useState<"passed" | "failed" | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [listing, setListing] = useState<any>(null);
  const [businessType, setBusinessType] = useState("");
  const [contactName, setContactName] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [faqs, setFaqs] = useState<BusinessFaq[]>([]);
  const [bookingUrl, setBookingUrl] = useState("");
  const [tone, setTone] = useState("friendly");

  // AI Call Coverage — WHEN the AI answers calls. Independent of the Connect
  // step's answering mode (the forward condition) and of Business Hours.
  const [coverageKind, setCoverageKind] = useState<AiCoverageKind>("always");
  const [answeringDays, setAnsweringDays] = useState<AnsweringDayRow[]>(defaultAnsweringDays);

  // Authoritative Business Hours snapshot fed by the embedded editor — powers
  // the compact summaries (Appointment Hours, AI Coverage, Test, Go-live).
  const [businessHours, setBusinessHoursState] = useState<{
    configured: boolean;
    summary: string[] | null;
    timeZone: string;
  }>({ configured: false, summary: null, timeZone: "" });

  // Document counts reported by the Knowledge section (collapsed-card summary).
  const [knowledgeSummary, setKnowledgeSummary] = useState({ files: 0, ready: 0 });

  // Page-level unsaved-changes tracking: the wizard form plus the embedded
  // self-loading sections (Business Hours, Business Address).
  const [configDirty, setConfigDirty] = useState(false);
  const [bhDirty, setBhDirty] = useState(false);
  const [addressDirty, setAddressDirty] = useState(false);
  const bhApiRef = useRef<EmbeddedSectionApi | null>(null);
  const addressApiRef = useRef<EmbeddedSectionApi | null>(null);
  // Timezone last persisted to the server. The Connect step owns the timezone;
  // saves only send it when it changed this session, so a stale tab can never
  // clobber a newer value saved elsewhere (e.g. Business Settings).
  const savedTimeZoneRef = useRef("");

  // Appointment schedule (booking hours + slot config). Loaded from its own
  // endpoint; only included in the save payload once loaded so an unloaded
  // section never clobbers the server-side config with empty defaults.
  const [apptLoaded, setApptLoaded] = useState(false);
  const [apptDays, setApptDays] = useState<Record<AppointmentWeekday, AppointmentDayHours>>(DEFAULT_APPT_DAYS);
  const [apptFields, setApptFields] = useState<Record<ApptNumberField, number>>({
    defaultDurationMinutes: 30,
    bufferMinutes: 0,
    slotIntervalMinutes: 30,
    minNoticeMinutes: 0,
    maxAdvanceDays: 30,
    maxSpokenSuggestions: 3
  });
  const [apptConfirmed, setApptConfirmed] = useState(false);
  // True once the buyer edits a booking-rule number this session. A schedule
  // conflict loaded from the server warns without blocking; one the buyer
  // introduces (or touches) blocks saving until fixed.
  const [apptRulesTouched, setApptRulesTouched] = useState(false);
  const [apptNeedsConfirmation, setApptNeedsConfirmation] = useState(false);
  // True (default) = appointment days follow Business Hours; false = the
  // custom weekly editor is authoritative.
  const [apptUseBusinessHours, setApptUseBusinessHours] = useState(true);

  const [knowledge, setKnowledge] = useState<BusinessKnowledgeItem[]>([]);
  const [confetti, setConfetti] = useState<
    { id: number; left: string; size: number; color: string; delay: string; duration: string }[]
  >([]);

  const [phoneNumbers, setPhoneNumbers] = useState<PlatformPhoneOption[]>([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState("");
  const [assignedNumber, setAssignedNumber] = useState<string | null>(null);
  // Location-based number selection (country → state → city → search → confirm).
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

  const [tzEdited, setTzEdited] = useState(false);

  // The buyer's own business line — optional, forwarding target only. No OTP.
  const [existingPhoneNumber, setExistingPhoneNumber] = useState("");

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

  const [emailRecipientType, setEmailRecipientType] = useState<"customer" | "team" | "custom">("customer");
  const [emailCustomRecipient, setEmailCustomRecipient] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailBcc, setEmailBcc] = useState("");

  const [buyerSetupFields, setBuyerSetupFields] = useState<BuyerSetupFieldDef[]>([]);
  const [buyerSetupInstructions, setBuyerSetupInstructions] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<BuyerCustomFieldValue[]>([]);

  const [triggerKind, setTriggerKind] = useState<WorkflowTriggerKind>("none");

  const setCustomFieldValue = useCallback((key: string, label: string, value: string | string[] | boolean) => {
    setCustomFieldValues((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing) {
        return current.map((item) => (item.key === key ? { ...item, label, value } : item));
      }
      return [...current, { key, label, value }];
    });
    setConfigDirty(true);
  }, []);

  const registerBusinessHoursApi = useCallback((api: EmbeddedSectionApi | null) => {
    bhApiRef.current = api;
  }, []);
  const registerAddressApi = useCallback((api: EmbeddedSectionApi | null) => {
    addressApiRef.current = api;
  }, []);
  const handleBusinessHoursData = useCallback((data: BusinessHoursData) => {
    setBusinessHoursState({
      configured: data.configured,
      summary: data.weeklySummary ?? null,
      timeZone: data.timeZone
    });
  }, []);

  // Warn before leaving while any Configure section has unsaved changes.
  const anyUnsaved = configDirty || bhDirty || addressDirty;
  useEffect(() => {
    if (!anyUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyUnsaved]);

  useEffect(() => {
    const gmailResult = searchParams.get("gmail");
    if (!gmailResult) return;

    if (gmailResult === "connected") {
      setStatusMsg("Google Calendar connected");
    } else if (gmailResult === "denied") {
      setError("Google connection was cancelled — permission was not granted. You can retry anytime.");
    } else {
      setError("Google connection failed. Please try connecting again.");
    }

    router.replace(businessSetupPath(listingId || undefined));
  }, [searchParams, router, listingId]);

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
        savedTimeZoneRef.current = data.profile.timeZone ? normalizeTimeZone(data.profile.timeZone) : "";
        setTone(data.profile.tone ?? "friendly");
        setServicesText((data.profile.services ?? []).join("\n"));
        setCalendarId(data.profile.calendarId ?? "primary");

        if (Array.isArray(data.profile.faqs) && data.profile.faqs.length > 0) {
          setFaqs(data.profile.faqs);
        }
      }

      // AI Call Coverage (phoneRouting.coverage) + the custom answering
      // schedule rows. Legacy CUSTOM_HOURS mode arrives as coverage "custom".
      const savedCoverage = data.aiCallCoverage;
      setCoverageKind(
        savedCoverage === "custom" ? "custom" : savedCoverage === "business_hours" ? "business_hours" : "always"
      );
      const savedAnsweringHours = data.answeringHours;
      if (Array.isArray(savedAnsweringHours) && savedAnsweringHours.length > 0) {
        setAnsweringDays(
          defaultAnsweringDays().map((row) => {
            const saved = savedAnsweringHours.find(
              (item) => (item.day ?? "").toLowerCase() === row.day.toLowerCase()
            );
            if (!saved) return row;
            return {
              day: row.day,
              open: saved.open?.slice(0, 5) || row.open,
              close: saved.close?.slice(0, 5) || row.close,
              closed: saved.closed
            };
          })
        );
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
        setExistingPhoneNumber(data.phoneNumber.forwardToPhone ?? "");
      }

      setPhoneNumbers(data.availablePhoneNumbers ?? []);
      setSelectedPhoneId(data.selectedPlatformPhoneNumberId ?? "");
      setCalendar(data.calendar ?? { connected: false, email: null });
      // Legacy CUSTOM_HOURS answering mode is now expressed as coverage
      // "custom" — the Connect routing choice falls back to its default.
      setAnsweringMode(
        data.answeringMode === "CUSTOM_HOURS" ? "NO_ANSWER" : data.answeringMode || "NO_ANSWER"
      );

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

      if (data.triggerKind) {
        setTriggerKind(data.triggerKind);
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

          // Derive trigger kind from the listing's workflow JSON
          const listingWorkflowJson = listingRes.data.listing.workflowJson || listingRes.data.listing.workflow?.workflowJson;
          if (listingWorkflowJson) {
            setTriggerKind(getWorkflowTriggerKind(listingWorkflowJson));
          }
        }
      }

      setRequiredKeys(keys);

      if (typeof window !== "undefined") {
        const savedStep = Number(window.sessionStorage.getItem(STEP_STORAGE_KEY) || "");

        if (savedStep >= 1 && savedStep <= STEPS.length) {
          setStep(savedStep);
        } else {
          // Dynamic resumption: evaluate which step is incomplete based on loaded data.
          // Newly purchased agents (not live/ACTIVE yet) must always start at Step 1.
          const isDeployed = data.installedAgent?.status === "ACTIVE";
          const hasPhone = Boolean(data.selectedPlatformPhoneNumberId || data.phoneNumber?.phoneNumber);
          const routingMode = data.answeringMode || "AI_FIRST";
          const fwPhone = data.phoneNumber?.forwardToPhone || "";
          const step1Ok = hasPhone && (routingMode === "AI_FIRST" || fwPhone.trim().length >= 5);

          if (!isDeployed) {
            setStep(1);
          } else if (!step1Ok) {
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

  // Appointment schedule loads once on mount — independent of the main setup
  // payload so a failure here never blocks the wizard.
  useEffect(() => {
    let cancelled = false;

    void getAppointmentSchedule().then((res) => {
      if (cancelled || !res.success || !res.data) return;

      const { schedule, needsConfirmation } = res.data;

      setApptDays({ ...DEFAULT_APPT_DAYS, ...schedule.days });
      setApptFields({
        defaultDurationMinutes: schedule.defaultDurationMinutes,
        bufferMinutes: schedule.bufferMinutes,
        slotIntervalMinutes: schedule.slotIntervalMinutes,
        minNoticeMinutes: schedule.minNoticeMinutes,
        maxAdvanceDays: schedule.maxAdvanceDays,
        maxSpokenSuggestions: schedule.maxSpokenSuggestions
      });
      setApptConfirmed(schedule.confirmed);
      setApptUseBusinessHours(schedule.useBusinessHours ?? schedule.source !== "configured");
      setApptNeedsConfirmation(needsConfirmation);
      setApptLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Seed the Business Hours snapshot on mount so Configure summaries and the
  // Go-live checklist are accurate before the embedded editor ever mounts.
  // The editor's own onLoaded/onChange callbacks take over once it renders.
  useEffect(() => {
    let cancelled = false;

    void getBusinessHours().then((res) => {
      if (cancelled || !res.success || !res.data) return;
      setBusinessHoursState((current) =>
        current.configured
          ? current
          : {
              configured: res.data!.configured,
              summary: res.data!.weeklySummary ?? null,
              timeZone: res.data!.timeZone
            }
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateApptDay = useCallback((day: AppointmentWeekday, patch: Partial<AppointmentDayHours>) => {
    setApptDays((current) => ({ ...current, [day]: { ...current[day], ...patch } }));
    setConfigDirty(true);
  }, []);

  const updateApptField = useCallback((field: ApptNumberField, value: number) => {
    setApptFields((current) => ({ ...current, [field]: value }));
    setApptRulesTouched(true);
    setConfigDirty(true);
  }, []);

  const updateApptConfirmed = useCallback((value: boolean) => {
    setApptConfirmed(value);
    setConfigDirty(true);
  }, []);

  const updateApptUseBusinessHours = useCallback((value: boolean) => {
    setApptUseBusinessHours(value);
    setConfigDirty(true);
  }, []);

  const updateCoverageKind = useCallback((kind: AiCoverageKind) => {
    setCoverageKind(kind);
    setConfigDirty(true);
  }, []);

  const updateAnsweringDay = useCallback((day: string, patch: Partial<AnsweringDayRow>) => {
    setAnsweringDays((current) =>
      current.map((row) => (row.day === day ? { ...row, ...patch } : row))
    );
    setConfigDirty(true);
  }, []);

  // Auto-dismiss the status toast.
  useEffect(() => {
    if (!statusMsg) return;
    const timer = window.setTimeout(() => setStatusMsg(""), 2600);
    return () => window.clearTimeout(timer);
  }, [statusMsg]);

  /** Custom AI answering schedule rows for the save payload. */
  function buildAnsweringItems(): BusinessHoursItem[] {
    return answeringDays.map((row) => ({
      day: row.day,
      open: row.open,
      close: row.close,
      closed: row.closed
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

  const bookingRules = validateBookingRules(apptFields);
  const onlyLoadedConflict =
    !apptRulesTouched &&
    bookingRules.intervalConflict !== null &&
    Object.keys(bookingRules.errors).length === 1 &&
    Boolean(bookingRules.errors.slotIntervalMinutes);
  const bookingRulesBlocked = apptLoaded && !bookingRules.valid && !onlyLoadedConflict;

  function reportBookingRulesBlocked() {
    setError("Fix the booking rules in Configure → Hours & Availability before saving.");
    openSection("hours-availability");
  }

  async function persistSetup(deploy: boolean): Promise<PersistResult> {
    const voiceFields = buildVoiceFields();
    const tzValue = timeZone.trim() || defaultTimeZone();

    if (bookingRulesBlocked) {
      reportBookingRulesBlocked();
      return { ok: false, number: "", vapiAssistantId: null, installedAgentId: null };
    }

    const sectionFailures: string[] = [];
    if (bhApiRef.current?.isDirty()) {
      const saved = await bhApiRef.current.save();
      if (!saved.ok) sectionFailures.push(`Business Hours: ${saved.error ?? "could not be saved."}`);
      else {
        setBhDirty(false);
        if (tzEdited) {
          savedTimeZoneRef.current = tzValue;
          setTzEdited(false);
        }
      }
    }
    if (addressApiRef.current?.isDirty()) {
      const saved = await addressApiRef.current.save();
      if (!saved.ok) sectionFailures.push(`Business address: ${saved.error ?? "could not be saved."}`);
      else setAddressDirty(false);
    }

    if (!deploy && liveVapiAssistantId) {
      if (tzValue !== savedTimeZoneRef.current) {
        const hoursRes = await getBusinessHours();
        if (hoursRes.success && hoursRes.data && (hoursRes.data.hours?.length ?? 0) > 0) {
          const saved = await putBusinessHours({
            hours: hoursRes.data.hours ?? [],
            timeZone: tzValue,
            specialDates: hoursRes.data.specialDates ?? []
          });
          if (saved.success) {
            savedTimeZoneRef.current = tzValue;
            setTzEdited(false);
          }
          else sectionFailures.push(`Timezone: ${saved.error ?? "could not be saved."}`);
        } else if (!hoursRes.success) {
          sectionFailures.push("Timezone: could not be saved — please try again.");
        } else {
          sectionFailures.push(
            "Timezone: could not be saved for your live agent — set your Business Hours in Configure, then save again."
          );
        }
      }

      if (sectionFailures.length > 0) {
        setError(sectionFailures.join(" "));
      } else {
        setStatusMsg("Live agent is already deployed. Click Go live to apply new changes.");
      }

      return {
        ok: sectionFailures.length === 0,
        mainSaveSkipped: true,
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
      ...(tzValue !== savedTimeZoneRef.current ? { timeZone: tzValue } : {}),
      tone,
      services: parseLines(servicesText),
      faqs: faqs
        .filter((faq) => faq.question.trim() && faq.answer.trim())
        .map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() })),
      hours: [],
      aiCallCoverage: {
        kind: coverageKind,
        ...(coverageKind === "custom" ? { answeringHours: buildAnsweringItems() } : {})
      },
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
        .filter((field) =>
          buyerSetupFields.length === 0 || buyerSetupFields.some((schemaField) => schemaField.key === field.key)
        ),
      selectedPlatformPhoneNumberId: selectedPhoneId || undefined,
      calendarId: calendarId.trim() || "primary",
      ...(apptLoaded
        ? {
          appointmentSchedule: {
            useBusinessHours: apptUseBusinessHours,
            days: apptDays,
            defaultDurationMinutes: apptFields.defaultDurationMinutes,
            bufferMinutes: apptFields.bufferMinutes,
            slotIntervalMinutes: apptFields.slotIntervalMinutes,
            minNoticeMinutes: apptFields.minNoticeMinutes,
            maxAdvanceDays: apptFields.maxAdvanceDays,
            maxSpokenSuggestions: apptFields.maxSpokenSuggestions,
            confirmed: apptConfirmed
          }
        }
        : {}),
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
      setError(
        [...sectionFailures, `Setup: ${res.error ?? "could not be saved. Please try again."}`].join(" ")
      );
      return { ok: false, number: "", vapiAssistantId: null, installedAgentId: null };
    }

    setConfigDirty(false);
    savedTimeZoneRef.current = tzValue;
    setTzEdited(false);

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

    if (apptLoaded) {
      setApptNeedsConfirmation(!apptConfirmed);
    }

    setCalendar(data.calendar ?? calendar);

    if (sectionFailures.length > 0) {
      setError(sectionFailures.join(" "));
      return {
        ok: false,
        number,
        vapiAssistantId: nextVapiAssistantId,
        installedAgentId: nextInstalledAgentId
      };
    }

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

    const res = await getBusinessCalendarOAuthUrl(
      String(businessSetupPath(listingId || undefined))
    );

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

    if (bookingRulesBlocked) {
      setStep(2);
      reportBookingRulesBlocked();
      return;
    }

    if (step < STEPS.length && canPersist) {
      setSaving(true);
      const saved = await persistSetup(false);
      setSaving(false);

      if (saved.ok && !saved.mainSaveSkipped) {
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

    if (saved.ok && !saved.mainSaveSkipped) {
      setStatusMsg("Progress saved");
    }
  }

  async function handleDeploy() {
    setError("");

    if (bookingRulesBlocked) {
      setStep(2);
      reportBookingRulesBlocked();
      return;
    }

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

    if (showCallForwarding && answeringMode !== "AI_FIRST" && forwardToPhone.trim().length < 5) {
      setStep(1);
      setError("Add the phone number that should receive forwarded/live calls.");
      return;
    }

    setSaving(true);
    const result = await persistSetup(true);
    setSaving(false);

    if (!result.ok) return;

    // Only require a vapiAssistantId when the workflow actually uses Vapi voice.
    const requiresVoice = showVoice && needs.has("vapi");

    if (requiresVoice && !result.vapiAssistantId) {
      setStep(4);
      setError("Your live voice assistant could not be created. Try again, or contact Triven support if it keeps failing.");
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

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    "business-profile": true
  });

  const openSection = useCallback((id: string) => {
    const singleOpen =
      typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)").matches;
    setOpenSections((current) => (singleOpen ? { [id]: true } : { ...current, [id]: true }));
  }, []);
  const toggleSection = useCallback(
    (id: string, open: boolean) => {
      if (open) {
        openSection(id);
        return;
      }
      setOpenSections((current) => ({ ...current, [id]: false }));
    },
    [openSection]
  );
  function jumpToConfigureSection(id: string) {
    setError("");
    setStep(2);
    openSection(id);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Marks the Configure form dirty alongside the wrapped state setter. */
  function dirtyWrap<T>(setter: (value: T) => void): (value: T) => void {
    return (value) => {
      setter(value);
      setConfigDirty(true);
    };
  }

  const buyerSetupIssues = validateBuyerSetupAnswers(buyerSetupFields, customFieldValues, { requireMissing: true });
  const buyerSetupComplete = buyerSetupIssues.length === 0;
  const assistantNameComplete = assistantName.trim().length >= 2;
  const phoneSelected = Boolean(selectedPhoneId) || Boolean(assignedNumber);
  const forwardRequired = answeringMode !== "AI_FIRST";
  const phoneComplete = phoneSelected && (!forwardRequired || forwardToPhone.trim().length >= 5);
  const voiceChoiceComplete = voiceChoice !== "custom" || customVoiceId.trim().length > 0;
  const voiceComplete = assistantNameComplete && voiceChoiceComplete;

  const connectorsKnown = requiredKeys.length > 0 || (!loading && Boolean(listingId));
  const needsCalendar = needs.has("google_calendar");
  const needsGmail = needs.has("gmail");
  const needsPhone = needs.has("phone_provider") || needs.has("twilio") || needs.has("phone");
  const needsSms = needs.has("twilio") && triggerKind === "inbound_sms";
  const needsVoice = needs.has("vapi") || triggerKind === "voice";
  const needsMail = needs.has("triven_mail");
  const mailComplete = mailAlias?.status === "ACTIVE";

  // showPhone: always true (number verification is universal)
  const showPhone = true;
  // showCallForwarding: only for missed-call or voice workflows that need forwarding
  const showCallForwarding = triggerKind === "missed_call" || triggerKind === "voice";
  // showAnsweringMode: only for voice workflows (missed-call always uses NO_ANSWER / forward)
  const showAnsweringMode = triggerKind === "voice";
  const showCalendar = !connectorsKnown || needsCalendar || needsGmail;
  const showSmsNote = triggerKind === "inbound_sms" || needsSms;
  const showMail = !connectorsKnown || needsMail;
  const showVoice = !connectorsKnown ? triggerKind === "voice" : needsVoice;

  const connectTitle =
    showPhone && showCalendar ? "Connect your phone & calendar" : showPhone ? "Connect your phone" : "Connect your services";

  const connectComplete =
    (!showPhone || phoneSelected) &&
    (!showCallForwarding || forwardToPhone.trim().length >= 5 || answeringMode === "AI_FIRST") &&
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
    {
      key: "booking_rules",
      label: "Booking rules",
      required: true,
      complete: !bookingRulesBlocked,
      blocker: bookingRulesBlocked
        ? "Fix the booking rules in Configure → Hours & Availability."
        : undefined
    },
    {
      key: "business_hours",
      label: "Business Hours",
      required: false,
      complete: businessHours.configured,
      blocker: businessHours.configured ? undefined : "Set your Business Hours so the agent knows when you're open."
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
          label: "Google account",
          required: true,
          complete: calendar.connected,
          blocker: calendar.connected ? undefined : "Connect Google (calendar access) before going live."
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
              : "Enter a custom voice ID or choose a preset."
        }
      ]
      : [])
  ];

  const readyToDeploy = checklist.every((row) => !row.required || row.complete);

  if (loading) {
    return (
      <div className="setup-root mx-auto max-w-2xl px-4 py-8">
        <div
          data-testid="business-setup-loading"
          className="rounded-2xl border border-gray-100 bg-white p-8 text-sm text-slate-500"
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
            <div className="check-pop w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-amber-400 to-green-500 grid place-items-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10">
                <polyline className="draw" points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>

            <div className="stagger">
              {/* Dynamic success copy based on the workflow trigger kind */}
              {(() => {
                const msg = getAgentSuccessMessage(triggerKind);
                return (
                  <div>
                    <h2 className="text-3xl font-black tracking-tight mt-6 text-slate-900" data-testid="business-setup-success-title">
                      {msg.headline}
                    </h2>
                    <p className="text-lg text-slate-600 mt-3">
                      {msg.body}
                    </p>
                  </div>
                );
              })()}

              {/* Capability list */}
              <div
                className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-7 sm:p-8 mt-8 border border-amber-100 text-left"
                data-testid="business-setup-success-capabilities"
              >
                <p className="text-sm font-semibold text-slate-700 mb-4">Your agent is ready to:</p>
                <ul className="space-y-3">
                  {getAgentSuccessMessage(triggerKind).capabilities.map((cap: string) => (
                    <li key={cap} className="flex items-center gap-3 text-sm text-slate-700">
                      <span className="text-green-500 shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span>{cap}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="mt-8 flex flex-col gap-3 items-center">
                <button
                  data-testid="business-setup-go-dashboard"
                  type="button"
                  onClick={() => router.push(DASHBOARD_ROUTE)}
                  className="btn bg-amber-500 text-white rounded-xl px-8 py-3.5 font-semibold hover:bg-amber-600 w-full max-w-xs"
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
                    <path d="M9 18h6M10 22h4" />
                    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
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

      <header className="bg-white border-b border-gray-200/80 py-3 px-4 sm:px-6 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-slate-900">Agent setup</h1>
              <p className="truncate text-xs text-slate-500" data-testid="business-setup-header-context">
                {(typeof listing?.name === "string" && listing.name.trim()) || businessName.trim() || "Your AI agent"}
              </p>
            </div>

            <span className="shrink-0 text-xs font-semibold text-slate-500" data-testid="business-setup-step-count">
              Step {step} of {STEPS.length}
            </span>
          </div>

          {/* Step indicator */}
          <nav className="progress mt-2.5" aria-label="Setup progress" data-testid="business-setup-progress-dots">
            {STEPS.map((entry, index) => {
              const active = entry.id === step;
              const done = stepDone[entry.id];
              const upcoming = step < entry.id && !done;
              const clickable = true;

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
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8">
        <div className={CARD}>
          {step === 1 ? (
            <StepConnect
              title={connectTitle}
              showPhone={showPhone}
              showCallForwarding={showCallForwarding}
              showAnsweringMode={showAnsweringMode}
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
              onTimeZone={(value) => {
                setTimeZone(value);
                setTzEdited(true);
                setConfigDirty(true);
              }}
              onSelectPhone={setSelectedPhoneId}
              onForward={setForwardToPhone}
              onTeamPhone={setTeamPhone}
              onAnsweringMode={setAnsweringMode}
              onConnectCalendar={handleConnectCalendar}
              onDisconnectCalendar={handleDisconnectCalendar}
              onCalendarId={setCalendarId}
              existingPhoneNumber={existingPhoneNumber}
              onExistingPhoneNumberChange={setExistingPhoneNumber}
              listingId={listingId}
              installedAgentIdForPhone={liveInstalledAgentId}
              onNumberProvisioned={(phoneNumber) => {
                setAssignedNumber(phoneNumber);
                setStatusMsg("Your Triven AI number is ready!");
              }}
            />
          ) : null}

          {step === 2 ? (
            <div className="space-y-4" data-testid="business-setup-configure">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Configure your agent</h2>
                <p className="mt-1.5 text-sm text-slate-500">
                  Add the business information and rules your agent will use.
                </p>
              </div>

              <ConfigureSectionCard
                id="business-profile"
                title="Business Profile"
                description="Name, type, address, and services."
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <rect x="2" y="7" width="20" height="14" rx="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                }
                status={businessComplete ? "complete" : "incomplete"}
                summary={
                  businessComplete
                    ? `${businessName.trim()} · ${businessType.trim()}`
                    : "Add your business name and type."
                }
                open={Boolean(openSections["business-profile"])}
                onToggle={(open) => toggleSection("business-profile", open)}
              >
                <BusinessProfileSection
                  businessName={businessName}
                  businessType={businessType}
                  contactName={contactName}
                  servicesText={servicesText}
                  onBusinessName={dirtyWrap(setBusinessName)}
                  onBusinessType={dirtyWrap(setBusinessType)}
                  onContactName={dirtyWrap(setContactName)}
                  onServices={setServicesText}
                  onAddressDirtyChange={setAddressDirty}
                  registerAddressApi={registerAddressApi}
                />
              </ConfigureSectionCard>

              <ConfigureSectionCard
                id="agent-identity"
                title="Agent Identity"
                description="Name, voice, and tone."
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                }
                status={!showVoice ? "optional" : voiceComplete ? "complete" : "incomplete"}
                summary={
                  showVoice
                    ? `${assistantName.trim() || DEFAULT_ASSISTANT_NAME} · ${
                        voiceChoice === "custom"
                          ? "Custom voice"
                          : VOICE_PRESETS.find((preset) => preset.id === voiceChoice)?.name ?? TRIVEN_VOICE_NAME
                      } · ${tone}`
                    : `Tone: ${tone}`
                }
                open={Boolean(openSections["agent-identity"])}
                onToggle={(open) => toggleSection("agent-identity", open)}
              >
                <AgentIdentitySection
                  showVoice={showVoice}
                  assistantName={assistantName}
                  businessName={businessName}
                  voiceChoice={voiceChoice}
                  customVoiceId={customVoiceId}
                  tone={tone}
                  onAssistantName={dirtyWrap(setAssistantName)}
                  onVoiceChoice={dirtyWrap(setVoiceChoice)}
                  onCustomVoiceId={dirtyWrap(setCustomVoiceId)}
                  onTone={dirtyWrap(setTone)}
                />
              </ConfigureSectionCard>

              <ConfigureSectionCard
                id="knowledge"
                title="Knowledge"
                description="Documents and FAQs the agent answers from."
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                }
                status={knowledgeSummary.ready > 0 || faqs.some((faq) => faq.question.trim() && faq.answer.trim()) ? "complete" : "optional"}
                summary={`${knowledgeSummary.files} document${knowledgeSummary.files === 1 ? "" : "s"} · ${
                  faqs.filter((faq) => faq.question.trim() && faq.answer.trim()).length
                } FAQ${faqs.filter((faq) => faq.question.trim() && faq.answer.trim()).length === 1 ? "" : "s"}`}
                open={Boolean(openSections["knowledge"])}
                onToggle={(open) => toggleSection("knowledge", open)}
              >
                <KnowledgeSection
                  listingId={listingId}
                  installedAgentId={liveInstalledAgentId}
                  faqs={faqs}
                  onFaqs={dirtyWrap(setFaqs)}
                  onSummaryChange={setKnowledgeSummary}
                />
              </ConfigureSectionCard>

              <ConfigureSectionCard
                id="hours-availability"
                title="Hours & Availability"
                description="Business Hours, Appointment Availability, and AI Call Coverage."
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                }
                warningCount={apptLoaded ? Object.keys(bookingRules.errors).length : 0}
                status={
                  bookingRulesBlocked || bookingRules.intervalConflict
                    ? "attention"
                    : businessHours.configured
                      ? "complete"
                      : "attention"
                }
                summary={
                  bookingRulesBlocked
                    ? "Booking rules need attention before you can save."
                    : businessHours.configured
                      ? `Business Hours set · Appointments ${
                          apptUseBusinessHours ? "follow Business Hours" : "use custom hours"
                        } · AI answers ${
                          coverageKind === "always"
                            ? "24/7"
                            : coverageKind === "business_hours"
                              ? "during Business Hours"
                              : "on a custom schedule"
                        }`
                      : "Set your Business Hours so the agent knows when you're open."
                }
                open={Boolean(openSections["hours-availability"])}
                onToggle={(open) => toggleSection("hours-availability", open)}
              >
                <HoursAvailabilitySection
                  timeZone={timeZone}
                  persistTimeZone={tzEdited}
                  onBusinessHoursLoaded={handleBusinessHoursData}
                  onBusinessHoursSaved={handleBusinessHoursData}
                  onBusinessHoursChange={handleBusinessHoursData}
                  onBusinessHoursDirtyChange={setBhDirty}
                  registerBusinessHoursApi={registerBusinessHoursApi}
                  businessHoursSummary={businessHours.summary}
                  businessHoursConfigured={businessHours.configured}
                  apptUseBusinessHours={apptUseBusinessHours}
                  onApptUseBusinessHours={updateApptUseBusinessHours}
                  apptDays={apptDays}
                  onApptDay={updateApptDay}
                  apptFields={apptFields}
                  onApptField={updateApptField}
                  apptRulesValidation={bookingRules}
                  apptConfirmed={apptConfirmed}
                  onApptConfirmed={updateApptConfirmed}
                  apptLoaded={apptLoaded}
                  coverageKind={coverageKind}
                  onCoverageKind={updateCoverageKind}
                  answeringDays={answeringDays}
                  onAnsweringDay={updateAnsweringDay}
                  triggerKind={triggerKind}
                />
              </ConfigureSectionCard>

              <ConfigureSectionCard
                id="agent-behavior"
                title="Agent Behavior"
                description="Instructions, agent details, and call handling."
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <line x1="4" y1="21" x2="4" y2="14" />
                    <line x1="4" y1="10" x2="4" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12" y2="3" />
                    <line x1="20" y1="21" x2="20" y2="16" />
                    <line x1="20" y1="12" x2="20" y2="3" />
                    <line x1="1" y1="14" x2="7" y2="14" />
                    <line x1="9" y1="8" x2="15" y2="8" />
                    <line x1="17" y1="16" x2="23" y2="16" />
                  </svg>
                }
                status={
                  buyerSetupFields.length > 0
                    ? buyerSetupComplete
                      ? "complete"
                      : "incomplete"
                    : customInstructions.trim()
                      ? "complete"
                      : "optional"
                }
                summary={
                  buyerSetupFields.length > 0 && !buyerSetupComplete
                    ? buyerSetupIssues[0]?.message ?? "Complete the agent setup details."
                    : customInstructions.trim()
                      ? "Custom instructions set."
                      : "Default behavior — add instructions any time."
                }
                open={Boolean(openSections["agent-behavior"])}
                onToggle={(open) => toggleSection("agent-behavior", open)}
              >
                <AgentBehaviorSection
                  showVoice={showVoice}
                  customInstructions={customInstructions}
                  silenceRepromptCount={silenceRepromptCount}
                  silenceMessage1={silenceMessage1}
                  silenceMessage2={silenceMessage2}
                  goodbyeMessage={goodbyeMessage}
                  setupFields={buyerSetupFields}
                  setupInstructions={buyerSetupInstructions}
                  customValues={customFieldValues}
                  onCustomInstructions={dirtyWrap(setCustomInstructions)}
                  onSilenceCount={dirtyWrap(setSilenceRepromptCount)}
                  onSilence1={dirtyWrap(setSilenceMessage1)}
                  onSilence2={dirtyWrap(setSilenceMessage2)}
                  onGoodbye={dirtyWrap(setGoodbyeMessage)}
                  onCustomField={setCustomFieldValue}
                />
              </ConfigureSectionCard>
            </div>
          ) : null}

          {step === 3 ? (
            <StepTest
              showPreview={showVoice}
              showCallTest={showPhone}
              deployedLive={Boolean(liveVapiAssistantId)}
              assignedNumber={assignedNumber}
              testing={testing}
              testResult={testResult}
              browserOutcome={browserTestOutcome}
              onBrowserOutcome={setBrowserTestOutcome}
              onTestCallRouting={handleTestCallRouting}
              answeringMode={answeringMode}
              listing={listing}
              showCalendarTest={showCalendar}
              calendarConnected={calendar.connected}
              timeZone={timeZone}
              agentName={(typeof listing?.name === "string" ? listing.name : "") || assistantName}
              calendarId={calendarId}
              serviceName={
                servicesText
                  .split(/\r?\n/)
                  .map((item) => item.trim())
                  .filter(Boolean)[0] ?? ""
              }
              apptUseBusinessHours={apptUseBusinessHours}
              coverageKind={coverageKind}
              onEditConfigure={jumpToConfigureSection}
            />
          ) : null}

          {step === 4 ? (
            <StepGoLive
              checklist={checklist}
              readyToDeploy={readyToDeploy}
              assignedNumber={assignedNumber}
              apptNeedsConfirmation={apptLoaded && apptNeedsConfirmation}
              apptUseBusinessHours={apptUseBusinessHours}
              coverageKind={coverageKind}
              timeZone={timeZone}
              calendarConnected={calendar.connected}
              calendarRequired={needsCalendar || needsGmail}
              browserTestOutcome={browserTestOutcome}
              routingReady={testResult ? testResult.readyForCall : null}
              businessName={businessName}
              businessType={businessType}
              assistantName={assistantName}
              voiceLabel={
                voiceChoice === "custom"
                  ? "Custom voice"
                  : VOICE_PRESETS.find((preset) => preset.id === voiceChoice)?.name ?? TRIVEN_VOICE_NAME
              }
              tone={tone}
              answeringModeLabel={
                ANSWERING_MODES.find((mode) => mode.value === answeringMode)?.label ?? answeringMode
              }
              apptFields={apptFields}
              onEditConfigure={jumpToConfigureSection}
              onEditConnect={() => {
                setError("");
                setStep(1);
                if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ) : null}

          {error ? (
            <p data-testid="business-setup-error" role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </p>
          ) : null}

<div
  className="sticky bottom-0 z-20 mt-8 -mx-6 rounded-b-2xl border-t border-gray-100 bg-white/95 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur sm:-mx-8 sm:px-8"
  data-testid="business-setup-footer"
>
  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

    {/* Left Actions */}
    <div className="flex flex-wrap items-center gap-3 justify-between">
      <button
        type="button"
        disabled={step === 1 || saving}
        onClick={() => setStep((current) => Math.max(1, current - 1))}
        data-testid="business-setup-back"
        className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Back
      </button>

      {step < STEPS.length && (
        <button
          type="button"
          onClick={() =>
            setStep((current) => Math.min(current + 1, STEPS.length))
          }
          disabled={saving}
          data-testid="business-setup-skip"
          className="text-sm font-medium text-slate-500 transition hover:text-slate-700 disabled:opacity-50"
        >
          Skip for now
        </button>
      )}

{anyUnsaved && !saving && (
        <span
          className="text-center text-xs font-semibold text-amber-600 sm:text-left"
          data-testid="business-setup-unsaved"
        >
          Unsaved changes
        </span>
      )}

      <button
        type="button"
        onClick={handleSaveProgress}
        disabled={saving}
        data-testid="business-setup-save"
        className="text-center text-sm font-medium text-slate-500 underline transition hover:text-slate-700 disabled:opacity-50"
      >
        {saving
          ? "Saving..."
          : step === 2
          ? "Save draft"
          : "Save progress"}
      </button>
    </div>

    {/* Right Actions */}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">



      {step < STEPS.length ? (
        <button
          type="button"
          onClick={goNext}
          disabled={saving || (step === 2 && bookingRulesBlocked)}
          data-testid="business-setup-next"
          className="btn w-full rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-50 sm:w-auto"
        >
          {step === 2 ? "Save & Continue" : "Continue"}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleDeploy}
          disabled={saving || !readyToDeploy}
          data-testid="business-setup-submit"
          className="btn w-full rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-50 sm:w-auto"
        >
          {saving ? "Deploying…" : "Go live"}
        </button>
      )}
    </div>
  </div>
</div>
        </div>
      </div>

      {statusMsg ? (
        <div
          role="status"
          data-testid="business-setup-toast"
          className="toast-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
        >
          {statusMsg}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Connect step ------------------------------ */

function StepConnect({
  title,
  showPhone,
  showCallForwarding,
  showAnsweringMode,
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
  onTimeZone,
  onSelectPhone,
  onForward,
  onTeamPhone,
  onAnsweringMode,
  onConnectCalendar,
  onDisconnectCalendar,
  onCalendarId,
  businessName,
  onMailAliasChange,

  existingPhoneNumber,
  onExistingPhoneNumberChange,
  listingId,
  installedAgentIdForPhone,
  onNumberProvisioned
}: {
  title: string;
  showPhone: boolean;
  /** Show the call-forwarding number + answering-mode options. True for missed-call and voice workflows. */
  showCallForwarding: boolean;
  /** Show the answering-mode dropdown. True only for voice workflows. */
  showAnsweringMode: boolean;
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
  onTimeZone: (v: string) => void;
  onSelectPhone: (id: string) => void;
  onForward: (v: string) => void;
  onTeamPhone: (v: string) => void;
  onAnsweringMode: (v: string) => void;
  onConnectCalendar: () => void;
  onDisconnectCalendar: () => void;
  onCalendarId: (v: string) => void;

  existingPhoneNumber: string;
  onExistingPhoneNumberChange: (v: string) => void;
  listingId: string;
  installedAgentIdForPhone: string | null;
  onNumberProvisioned: (phoneNumber: string) => void;
}) {
  const [countryFlag, setCountryFlag] = useState("🇺🇸");
  const [countryCode, setCountryCode] = useState("+1");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);

  // Every timezone seen this session stays selectable — an off-list saved zone
  // must not vanish from the options after switching away from it. Friendly
  // labels are display-only; the stored value is always the IANA id.
  const seenTimeZonesRef = useRef<Set<string>>(new Set());
  if (timeZone.trim()) seenTimeZonesRef.current.add(timeZone.trim());
  const knownZoneValues = new Set(COMMON_TIMEZONES.map((option) => option.value));
  const timeZoneOptions = [
    ...[...seenTimeZonesRef.current]
      .filter((zone) => !knownZoneValues.has(zone))
      .map((zone) => ({ value: zone, label: zone })),
    ...COMMON_TIMEZONES
  ];

  const routingMode = answeringMode === "AI_FIRST" ? "direct" : "forward";

  const phoneValid = existingPhoneNumber.replace(/\D/g, "").length === 10;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          {showCallForwarding
            ? "Choose your Triven AI number, then decide how customers reach your agent."
            : "Choose your Triven AI number for this agent."}
        </p>
      </div>

      {/* SECTION 1 — Choose your Triven AI phone number. Always visible when
          the workflow needs a phone; never gated behind an existing phone,
          verification, or any other setup section. */}
      {showPhone && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-6" data-testid="business-setup-number-card">
          {assignedNumber ? (
            <div className="flex items-start justify-between gap-3.5">
              <div className="flex items-start gap-3.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-green-600 shrink-0 mt-0.5">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-500">Your Triven AI number</p>
                    <span
                      className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-green-700"
                      data-testid="business-setup-assigned-number-status"
                    >
                      Active
                    </span>
                  </div>
                  <p className="mt-1 text-3xl font-bold text-slate-900 tracking-tight" data-testid="business-setup-assigned-number">{assignedNumber}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Included with your Triven AI setup. To replace this number, contact Triven support.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <PhoneNumberSelectionSection
              installedAgentId={installedAgentIdForPhone}
              listingId={listingId}
              forwardToPhone={routingMode === "forward" ? existingPhoneNumber : ""}
              onProvisioned={(phoneNumber) => {
                onNumberProvisioned(phoneNumber);
              }}
            />
          )}
        </div>
      )}

      {/* SECTION 2 — Call routing. Appears once a Triven AI number exists. */}
      {showPhone && showCallForwarding && assignedNumber ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-6" data-testid="business-setup-routing-card">
          <span className="block text-sm font-semibold text-slate-700">How should customers reach your AI agent?</span>

          {showAnsweringMode ? (
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={() => onAnsweringMode("AI_FIRST")}
                className={`pick w-full text-left rounded-xl border p-4 flex items-start gap-3 focus:outline-none ${answeringMode === "AI_FIRST" ? "selected" : "border-gray-200 bg-white"
                  }`}
                style={answeringMode === "AI_FIRST" ? { boxShadow: "none" } : undefined}
                data-testid="business-setup-routing-direct"
              >
                <span className={`mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${answeringMode === "AI_FIRST" ? "border-amber-500" : "border-slate-300"
                  }`}>
                  {answeringMode === "AI_FIRST" ? <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> : null}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-bold text-slate-900">Use my Triven AI number directly</span>
                  <span className="block text-xs text-slate-500 mt-1 leading-relaxed">
                    Give {assignedNumber} to customers. Calls go directly to your AI agent.
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => onAnsweringMode("NO_ANSWER")}
                className={`pick w-full text-left rounded-xl border p-4 flex items-start gap-3 focus:outline-none ${answeringMode !== "AI_FIRST" ? "selected" : "border-gray-200 bg-white"
                  }`}
                style={answeringMode !== "AI_FIRST" ? { boxShadow: "none" } : undefined}
                data-testid="business-setup-routing-forward"
              >
                <span className={`mt-0.5 w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${answeringMode !== "AI_FIRST" ? "border-amber-500" : "border-slate-300"
                  }`}>
                  {answeringMode !== "AI_FIRST" ? <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> : null}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-bold text-slate-900">Keep using my existing business number</span>
                  <span className="block text-xs text-slate-500 mt-1 leading-relaxed">
                    Forward calls from your existing number to {assignedNumber}.
                  </span>
                </span>
              </button>
            </div>
          ) : (
            /* Missed-call workflow: always uses forwarding, no mode selector needed */
            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 text-sm text-slate-600">
              <span className="font-semibold text-slate-800">Forwarding is automatic.</span> Your provider sends missed-call notifications to your Triven AI number and the AI handles the rest.
            </div>
          )}

          {routingMode === "forward" || !showAnsweringMode ? (
            <div className="mt-6 border-t border-slate-200/80 pt-5">
              <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-2">Existing business phone number</label>

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
                      <polyline points="6 9 12 15 18 9" />
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
                    onForward(formatted);
                  }}
                  data-testid="business-setup-existing-phone"
                  className="field flex-1 px-5 py-4 text-lg font-mono placeholder:text-slate-300 outline-none border-0"
                  placeholder="(555) 123-4567"
                />

                {/* Check icon */}
                <span className="phone-check absolute right-4 top-1/2 -translate-y-1/2 text-green-500" aria-hidden="true" style={{ opacity: phoneValid ? 1 : 0, transform: phoneValid ? "scale(1)" : "scale(0.6)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              </div>

              <p className="text-xs text-slate-400 mt-2 font-semibold">
                Used only as the forwarding target — no verification needed.
              </p>
            </div>
          ) : null}

          {showAnsweringMode && routingMode === "forward" ? (
            <div className="mt-6 border-t border-slate-200/80 pt-5">
              <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="answering-mode">
                Answering mode
              </label>
              <select
                id="answering-mode"
                value={answeringMode}
                onChange={(e) => onAnsweringMode(e.target.value)}
                className="field w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none"
              >
                {ANSWERING_MODES.filter(m => m.value !== "AI_FIRST").map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-400 font-semibold">
                Choose when the AI receptionist should answer calls forwarded from {existingPhoneNumber || "your business number"}.
              </p>

              {/* How to actually turn on carrier forwarding — the buyer does
                  this on their own phone/provider; without it, forwarded
                  answering modes never reach the AI. */}
              <div
                className="mt-4 rounded-xl border border-amber-100 bg-amber-50/60 p-4"
                data-testid="business-setup-forwarding-steps"
              >
                <p className="text-sm font-semibold text-slate-800">
                  Set up call forwarding to your Triven AI number
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Your carrier forwards calls it can&apos;t complete to{" "}
                  <span className="font-mono font-bold text-slate-700">{assignedNumber || "your Triven AI number"}</span>. Do this once from the phone that uses your existing business number:
                </p>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-slate-600">
                  <li>
                    Dial the conditional-forwarding code for your carrier
                    {assignedNumber ? (
                      <>
                        {" "}with your Triven number <span className="font-mono font-semibold">{assignedNumber.replace(/[^\d+]/g, "")}</span>:
                      </>
                    ) : (
                      " with your Triven number (assigned in the step above):"
                    )}
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-500">
                      <li>
                        <span className="font-semibold text-slate-600">AT&amp;T, T-Mobile &amp; most GSM carriers:</span>{" "}
                        <span className="font-mono">**61*number#</span> (no answer) · <span className="font-mono">**67*number#</span> (busy) · <span className="font-mono">**62*number#</span> (unreachable)
                      </li>
                      <li>
                        <span className="font-semibold text-slate-600">Verizon &amp; many US carriers:</span>{" "}
                        <span className="font-mono">*71number</span> (busy / no answer)
                      </li>
                      <li>
                        <span className="font-semibold text-slate-600">Landline / VoIP:</span> turn on &ldquo;no-answer call forwarding&rdquo; to your Triven number in your provider&apos;s portal or app.
                      </li>
                    </ul>
                  </li>
                  <li>Wait for your carrier&apos;s confirmation tone or message — that means forwarding is active.</li>
                  <li>
                    Try it: call your business number from another phone and let it ring. Your AI agent should answer. The Test step&apos;s{" "}
                    <span className="font-semibold text-slate-700">Call routing check</span> verifies this too.
                  </li>
                </ol>
                <p className="mt-3 text-[11px] text-slate-400">
                  To turn forwarding off later: <span className="font-mono">##61#</span> / <span className="font-mono">##67#</span> / <span className="font-mono">##62#</span> (GSM) or <span className="font-mono">*73</span> (Verizon). Codes vary by carrier and country — if none work, ask your carrier to enable &ldquo;conditional call forwarding&rdquo; to your Triven number.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* SECTION 3 — Calendar Connection block */}
      {showCalendar ? (
        <div className="mt-6 border-t border-gray-100 pt-6">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Calendar</h3>

          <div className={`flex items-center justify-between gap-4 rounded-2xl border p-5 ${calendar.connected
              ? "border-green-100 bg-green-50/30"
              : "border-gray-100 bg-slate-50"
            }`}>
            <div className="flex items-center gap-3">
              {/* Google Calendar Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm-5-8h-4v4h4v-4z" />
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
                className="btn shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:border-gray-300"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                disabled={calendarBusy}
                onClick={onConnectCalendar}
                className="btn shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600"
              >
                {calendarBusy ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>

        </div>
      ) : null}

      {/* Business timezone — the ONE place it is edited. Availability,
          bookings, and call times all use this value. */}
      <div className="mt-6 border-t border-gray-100 pt-6">
        <h3 className="text-sm font-bold text-slate-900 mb-3">Timezone</h3>
        <div className="rounded-2xl border border-gray-100 bg-slate-50 p-5">
          <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="business-timezone">
            Business timezone
          </label>
          <select
            id="business-timezone"
            data-testid="business-setup-timezone-select"
            value={timeZone}
            onChange={(e) => onTimeZone(e.target.value)}
            className="field w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none"
          >
            {timeZoneOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs font-semibold text-slate-400">
            Used for availability, bookings, and call times.
          </p>
        </div>
      </div>

      {showSmsNote ? (
        <div className={SECTION} data-testid="business-setup-sms-note">
          <h3 className={SECTION_TITLE}>SMS</h3>
          <p className="mt-1 text-sm text-slate-500">Confirmation SMS will be sent to your customers from Triven.</p>
        </div>
      ) : null}

      {showMail ? <MailSetupSection businessName={businessName} onAliasChange={onMailAliasChange} /> : null}
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
          className="btn rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
        >
          {busy ? "Working…" : savedAlias ? "Update mail setup" : "Save mail setup"}
        </button>
        <button
          type="button"
          data-testid="business-setup-mail-test"
          onClick={() => void handleTestEmail()}
          disabled={busy || !savedAlias}
          className="btn rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-amber-300"
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

/* ---------------------- Preview call (Test step) ---------------------- */

type PreviewVapiEventName = "call-start" | "call-end" | "speech-start" | "speech-end" | "error" | "message";

type PreviewVapiClient = {
  start: (assistantId: string, overrides?: Record<string, unknown>) => Promise<unknown>;
  stop: () => void;
  setMuted?: (muted: boolean) => void;
  isMuted?: () => boolean;
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

function PreviewCallSection({
  onOutcome
}: {
  /** Reports the session outcome ("passed" once a call completed, "failed" on errors) to the test summary. */
  onOutcome?: (outcome: "passed" | "failed") => void;
}) {
  const [state, setState] = useState<PreviewCallState>("idle");
  const [error, setError] = useState("");
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [transcript, setTranscript] = useState<PreviewTranscriptEntry[]>([]);
  const [session, setSession] = useState<BusinessPreviewCallSession | null>(null);

  const clientRef = useRef<PreviewVapiClient | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const startInFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const failedRef = useRef(false);
  const onOutcomeRef = useRef(onOutcome);
  onOutcomeRef.current = onOutcome;

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
    setMicMuted(false);
    setState("ended");

    // A call that never connected or errored counts as failed; a completed
    // conversation counts as passed.
    onOutcomeRef.current?.(failedRef.current || elapsedRef.current === 0 ? "failed" : "passed");
  }

  /** Clears this section's local transcript/error state back to a fresh test. */
  function resetPreview() {
    if (state === "starting" || state === "live") return;
    setTranscript([]);
    setError("");
    setSecondsLeft(0);
    setElapsedSeconds(0);
    setMicMuted(false);
    setSession(null);
    setState("idle");
  }

  function toggleMute() {
    const client = clientRef.current;
    if (!client?.setMuted || state !== "live") return;

    const next = !(client.isMuted?.() ?? micMuted);

    try {
      client.setMuted(next);
      setMicMuted(next);
    } catch {
      // mute is best-effort — the call keeps going either way
    }
  }

  async function startPreview() {
    if (startInFlightRef.current || state === "starting" || state === "live") return;

    startInFlightRef.current = true;
    setError("");
    setTranscript([]);
    setElapsedSeconds(0);
    elapsedRef.current = 0;
    failedRef.current = false;
    setMicMuted(false);
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
        setElapsedSeconds(0);
        setMicMuted(false);
        try {
          clientRef.current?.setMuted?.(false);
        } catch {
          // best-effort — a fresh call starts unmuted anyway
        }
        stopTimer();
        timerRef.current = setInterval(() => {
          setElapsedSeconds((current) => {
            elapsedRef.current = current + 1;
            return current + 1;
          });
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
        failedRef.current = true;
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
      failedRef.current = true;
      endPreview();
      setState("idle");
      setError("Could not start the preview call. Check your microphone and try again.");
    } finally {
      startInFlightRef.current = false;
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6" data-testid="business-setup-preview-call">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={SECTION_TITLE}>Start browser test call</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Talk to your agent in the browser using your current configuration. SMS and email stay disabled in
            test mode; booking may create a clearly marked test event on your connected calendar.
          </p>
        </div>

        {state === "live" ? (
          <span className="shrink-0 text-right">
            <span className="block font-mono text-sm font-bold text-slate-700" data-testid="business-setup-preview-timer">
              {formatSeconds(secondsLeft)}
            </span>
            <span className="block font-mono text-[11px] font-semibold text-slate-400" data-testid="business-test-call-duration">
              {formatSeconds(elapsedSeconds)} elapsed
            </span>
          </span>
        ) : state === "ended" && elapsedSeconds > 0 ? (
          <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-400" data-testid="business-test-call-duration">
            Call length {formatSeconds(elapsedSeconds)}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {state === "live" ? (
          <>
            <button
              type="button"
              data-testid="business-setup-preview-end"
              onClick={() => endPreview()}
              className="btn rounded-xl bg-red-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-600"
            >
              End call
            </button>

            <button
              type="button"
              data-testid="business-test-call-mute"
              aria-pressed={micMuted}
              onClick={toggleMute}
              className={`btn rounded-xl border px-4 py-2.5 text-sm font-bold ${micMuted
                  ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  : "border-gray-200 bg-white text-slate-700 hover:border-amber-300"
                }`}
            >
              {micMuted ? "Unmute mic" : "Mute mic"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              data-testid="business-setup-preview-start"
              disabled={state === "starting"}
              onClick={() => void startPreview()}
              className="btn rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
            >
              {state === "starting" ? "Connecting…" : state === "ended" ? "Call again" : "Start test call"}
            </button>

            {state === "ended" || transcript.length > 0 || error ? (
              <button
                type="button"
                data-testid="business-test-call-reset"
                disabled={state === "starting"}
                onClick={resetPreview}
                className="btn rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-amber-300"
              >
                Reset test
              </button>
            ) : null}
          </>
        )}

        <span
          data-testid="business-setup-preview-status"
          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${state === "live" ? (agentSpeaking ? "text-violet-600" : "text-green-600") : "text-slate-400"
            }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${state === "live"
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
              : micMuted
                ? "Mic muted — the agent can't hear you"
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

/* --------------------------- Test step helpers --------------------------- */

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

const getAnsweringLabels = (mode: string, listing?: any, assignedNumber?: string | null) => {
  let channel = "missed-call";
  if (listing) {
    const nodes = listing.workflowJson?.nodes || listing.workflow?.workflowJson?.nodes || [];
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

  const numLabel = assignedNumber ?? "your Triven number";

  switch (channel) {
    case "sms":
      return {
        isVoice: false,
        usesNumber: true,
        cta: { scheme: "sms:", label: "Text now" },
        callTitle: "Text your number",
        callHint: `Send a text to ${numLabel} from your phone. This is a real inbound message to your agent.`
      };
    case "whatsapp":
      return {
        isVoice: false,
        usesNumber: true,
        cta: null,
        callTitle: "Message your number",
        callHint: `Send a WhatsApp message to ${numLabel}. This is a real inbound message to your agent.`
      };
    case "email":
      return {
        isVoice: false,
        usesNumber: false,
        cta: null,
        callTitle: "Email your agent",
        callHint: "Send an email to your Triven alias — a real inbound email to your agent."
      };
    case "voice":
      return {
        isVoice: true,
        usesNumber: true,
        cta: { scheme: "tel:", label: "Call now" },
        callTitle: "Call your Triven number",
        callHint: `Call ${numLabel} from your phone. Once deployed, this is a real call handled by your live agent.`
      };
    case "manual":
      return {
        isVoice: false,
        usesNumber: false,
        cta: null,
        callTitle: "Trigger a run",
        callHint: "Start a trigger run from the dashboard."
      };
    default:
      return {
        isVoice: true,
        usesNumber: true,
        cta: { scheme: "tel:", label: "Call now" },
        callTitle: "Call your Triven number",
        callHint: `Call ${numLabel}, let it ring, then hang up. Once deployed, the agent texts the caller back for real.`
      };
  }
};

/* -------------------------------- Test step -------------------------------- */

function StepTest({
  showPreview,
  showCallTest,
  deployedLive,
  assignedNumber,
  testing,
  testResult,
  browserOutcome = null,
  onBrowserOutcome,
  onTestCallRouting,
  answeringMode,
  listing,
  showCalendarTest = false,
  calendarConnected = false,
  timeZone = "",
  agentName = "",
  calendarId = "",
  serviceName = "",
  apptUseBusinessHours = true,
  coverageKind = "always",
  onEditConfigure
}: {
  showPreview: boolean;
  showCallTest: boolean;
  deployedLive: boolean;
  assignedNumber: string | null;
  testing: boolean;
  testResult: CallRoutingResult | null;
  /** Browser test-call outcome held at page level (feeds the Go-live checklist). */
  browserOutcome?: "passed" | "failed" | null;
  onBrowserOutcome?: (outcome: "passed" | "failed") => void;
  onTestCallRouting: () => void;
  answeringMode: string;
  listing?: any;
  showCalendarTest?: boolean;
  calendarConnected?: boolean;
  timeZone?: string;
  agentName?: string;
  calendarId?: string;
  serviceName?: string;
  apptUseBusinessHours?: boolean;
  coverageKind?: string;
  /** Jump back to a Configure section ("hours-availability", …). */
  onEditConfigure?: (sectionId: string) => void;
}) {
  const labels = getAnsweringLabels(answeringMode, listing, assignedNumber);

  // Step-level test summary state, fed by the chat test.
  const [chatSummary, setChatSummary] = useState<BusinessChatTestResult | null>(null);
  const [calendarOutcome, setCalendarOutcome] = useState<"created" | "simulated" | "failed" | null>(null);

  // Knowledge documents the test agent can draw on (uploaded in Configure).
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFileSummary[]>([]);
  const [businessFacts, setBusinessFacts] = useState<BusinessFactsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getBusinessKnowledgeFiles().then((res) => {
      if (!cancelled && res.success && res.data) setKnowledgeFiles(res.data.files);
    });
    void getBusinessFacts().then((res) => {
      if (!cancelled && res.success && res.data) setBusinessFacts(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const readyKnowledge = knowledgeFiles.filter((file) => file.ready);
  const knowledgeSectionCount = readyKnowledge.reduce((sum, file) => sum + file.actualChunkCount, 0);

  const handleChatResult = useCallback((result: BusinessChatTestResult) => {
    setChatSummary(result);
    if (result.calendarError) {
      setCalendarOutcome("failed");
    } else if (result.calendarEvent) {
      setCalendarOutcome(result.calendarEvent.status === "CREATED" ? "created" : "simulated");
    }
  }, []);

  const summaryNodes = chatSummary?.executedNodes ?? [];
  const nodeCounts = {
    completed: summaryNodes.filter((node) => node.status === "success").length,
    skipped: summaryNodes.filter((node) => node.status === "skipped").length,
    failed: summaryNodes.filter((node) => node.status === "error").length
  };

  const calendarSummary =
    calendarOutcome === "created"
      ? { label: "Passed", pill: "bg-green-100 text-green-700" }
      : calendarOutcome === "simulated"
        ? { label: "Simulated", pill: "bg-slate-100 text-slate-600" }
        : calendarOutcome === "failed"
          ? { label: "Failed", pill: "bg-rose-100 text-rose-700" }
          : { label: "Not run", pill: "bg-slate-100 text-slate-500" };

  const browserSummary =
    browserOutcome === "passed"
      ? { label: "Passed", pill: "bg-green-100 text-green-700" }
      : browserOutcome === "failed"
        ? { label: "Failed", pill: "bg-rose-100 text-rose-700" }
        : { label: "Not run", pill: "bg-slate-100 text-slate-500" };

  const routingSummary = testResult
    ? testResult.readyForCall
      ? { label: "Passed", pill: "bg-green-100 text-green-700" }
      : { label: "Failed", pill: "bg-rose-100 text-rose-700" }
    : { label: "Not run", pill: "bg-slate-100 text-slate-500" };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Test your agent</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Verify conversations, booking, knowledge, and routing before going live.
        </p>
      </div>

      {/* Primary tests — a live browser call and a real call/text to the number. */}
      {showPreview ? <PreviewCallSection onOutcome={onBrowserOutcome} /> : null}

      {showCallTest && labels.usesNumber ? (
        <div className="rounded-2xl border border-gray-200 bg-slate-50/50 p-5 sm:p-6" data-testid="business-setup-call-number">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className={SECTION_TITLE}>{labels.callTitle}</h3>
              <p className="mt-0.5 text-sm text-slate-500">{labels.callHint}</p>
              {assignedNumber ? (
                <p
                  className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
                  data-testid="business-setup-call-number-value"
                >
                  {assignedNumber}
                </p>
              ) : (
                <p
                  className="mt-3 text-sm font-semibold text-amber-700"
                  data-testid="business-setup-call-number-missing"
                >
                  No number yet — assign one in the Connect step.
                </p>
              )}
            </div>
            {assignedNumber && labels.cta ? (
              <a
                href={`${labels.cta.scheme}${assignedNumber.replace(/[^\d+]/g, "")}`}
                data-testid="business-setup-call-number-dial"
                className="btn shrink-0 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
              >
                {labels.cta.label}
              </a>
            ) : null}
          </div>
          {labels.isVoice && !deployedLive ? (
            <p
              className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800"
              data-testid="business-setup-test-predeploy-note"
            >
              Not live yet — deploy in the Go live step, then call to test end to end.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Test details — what this test run is wired to. Rows render only when
          the setup actually has the data; nothing here is a placeholder. */}
      <div className="rounded-2xl border border-gray-200 bg-slate-50/60 p-5" data-testid="business-test-details">
        <div className="flex items-center justify-between gap-3">
          <h3 className={SECTION_TITLE}>Test details</h3>
          <span
            className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700"
            data-testid="business-test-details-mode"
          >
            Test Mode
          </span>
        </div>

        <dl className="mt-3 space-y-2">
          {agentName.trim() ? (
            <div className="flex items-baseline justify-between gap-4 text-sm" data-testid="business-test-details-agent">
              <dt className="shrink-0 text-slate-500">Agent</dt>
              <dd className="min-w-0 truncate text-right font-semibold text-slate-800">{agentName.trim()}</dd>
            </div>
          ) : null}

          {timeZone.trim() ? (
            <div className="flex items-baseline justify-between gap-4 text-sm" data-testid="business-test-details-timezone">
              <dt className="shrink-0 text-slate-500">Business timezone</dt>
              <dd className="min-w-0 truncate text-right font-semibold text-slate-800">{timeZone.trim()}</dd>
            </div>
          ) : null}

          <div className="flex items-baseline justify-between gap-4 text-sm" data-testid="business-test-details-appt-source">
            <dt className="shrink-0 text-slate-500">Appointment Hours</dt>
            <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
              {apptUseBusinessHours ? "Follow Business Hours" : "Custom Appointment Hours"}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-4 text-sm" data-testid="business-test-details-ai-coverage">
            <dt className="shrink-0 text-slate-500">AI Call Coverage</dt>
            <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
              {coverageKind === "always"
                ? "Answers 24/7"
                : coverageKind === "business_hours"
                  ? "During Business Hours"
                  : "Custom answering schedule"}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-4 text-sm" data-testid="business-test-details-address">
            <dt className="shrink-0 text-slate-500">Business address</dt>
            {businessFacts?.addressFormatted ? (
              <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
                {businessFacts.addressFormatted}
              </dd>
            ) : (
              <dd className="min-w-0 truncate text-right text-slate-400">
                Not configured — edit in Configure
              </dd>
            )}
          </div>

          {showCalendarTest && calendarId.trim() ? (
            <div className="flex items-baseline justify-between gap-4 text-sm" data-testid="business-test-details-calendar">
              <dt className="shrink-0 text-slate-500">Calendar</dt>
              <dd className="min-w-0 truncate text-right font-mono text-xs font-semibold text-slate-800">{calendarId.trim()}</dd>
            </div>
          ) : null}

          {serviceName.trim() ? (
            <div className="flex items-baseline justify-between gap-4 text-sm" data-testid="business-test-details-service">
              <dt className="shrink-0 text-slate-500">Service</dt>
              <dd className="min-w-0 truncate text-right font-semibold text-slate-800">{serviceName.trim()}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-3 text-sm" data-testid="business-test-knowledge-summary">
          {readyKnowledge.length > 0 ? (
            <>
              <div className="flex items-baseline justify-between gap-4">
                <span className="shrink-0 text-slate-500">Knowledge loaded</span>
                <span className="min-w-0 text-right font-semibold text-slate-800">
                  {readyKnowledge.length} document{readyKnowledge.length === 1 ? "" : "s"} ·{" "}
                  {knowledgeSectionCount} knowledge section{knowledgeSectionCount === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400 truncate" data-testid="business-test-knowledge-docs">
                {readyKnowledge.map((file) => file.filename).join(", ")}
              </p>
            </>
          ) : (
            <span className="text-slate-400">Knowledge loaded: none — add documents in Configure</span>
          )}
        </div>

        {showCallTest && labels.isVoice ? (
          <div className="mt-3 border-t border-slate-100 pt-3" data-testid="business-setup-test-hours">
            <BusinessHoursSummary testIdPrefix="business-setup-test-hours" />
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            Browser and chat tests run in Business Test mode.
          </p>
          {onEditConfigure ? (
            <button
              type="button"
              data-testid="business-test-edit-configure"
              onClick={() => onEditConfigure("hours-availability")}
              className="text-xs font-semibold text-amber-600 underline hover:text-amber-700"
            >
              Edit in Configure
            </button>
          ) : null}
        </div>
      </div>

      {showCalendarTest ? (
        <BusinessCalendarTestSection
          calendarConnected={calendarConnected}
          timeZone={timeZone}
          onResult={handleChatResult}
        />
      ) : null}

      {showCallTest && labels.isVoice ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="business-setup-test-routing">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className={SECTION_TITLE}>Call routing check</h3>
              <p className="mt-0.5 text-sm text-slate-500">
                Confirms calls to your Triven number reach this agent.
              </p>
            </div>

            <button
              type="button"
              data-testid="business-setup-test-routing-run"
              disabled={testing}
              onClick={onTestCallRouting}
              className="btn shrink-0 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-amber-300 bg-white"
            >
              {testing ? "Testing…" : "Run test"}
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
                  : "Not ready yet — resolve the failing checks, then re-test."}
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700">
                  View technical details
                </summary>
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
              </details>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Test summary — a running record of what this step verified. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="business-test-summary">
        <h3 className={SECTION_TITLE}>Test summary</h3>

        <dl className="mt-4 space-y-2.5">
          {showPreview ? (
            <div className="flex items-center justify-between gap-4 text-sm" data-testid="business-test-summary-browser">
              <dt className="text-slate-500">Browser test</dt>
              <dd className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${browserSummary.pill}`}>
                {browserSummary.label}
              </dd>
            </div>
          ) : null}

          {showCallTest && labels.isVoice ? (
            <div className="flex items-center justify-between gap-4 text-sm" data-testid="business-test-summary-routing">
              <dt className="text-slate-500">Phone routing</dt>
              <dd className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${routingSummary.pill}`}>
                {routingSummary.label}
              </dd>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4 text-sm" data-testid="business-test-summary-calendar">
            <dt className="text-slate-500">Calendar booking</dt>
            <dd className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${calendarSummary.pill}`}>
              {calendarSummary.label}
            </dd>
          </div>

          <div
            className="flex items-center justify-between gap-4 border-t border-slate-100 pt-2.5 text-sm"
            data-testid="business-test-summary-side-effects"
          >
            <dt className="text-slate-500">Customer messages</dt>
            <dd className="font-semibold text-slate-800">Disabled in test mode</dd>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm" data-testid="business-test-summary-calendar-effects">
            <dt className="text-slate-500">Calendar</dt>
            <dd className="font-semibold text-slate-800">Test events may be created</dd>
          </div>
        </dl>

        <details className="mt-3 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700">
            View technical details
          </summary>
          <dl className="mt-3 space-y-2.5">
            <div className="flex items-center justify-between gap-4 text-sm" data-testid="business-test-summary-mode">
              <dt className="text-slate-500">Execution mode</dt>
              <dd className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                Business test
              </dd>
            </div>

            {chatSummary?.testSessionId ? (
              <div className="flex items-center justify-between gap-4 text-sm" data-testid="business-test-summary-session">
                <dt className="text-slate-500">Test session</dt>
                <dd className="min-w-0 truncate text-right font-mono text-xs font-semibold text-slate-700">
                  {chatSummary.testSessionId}
                </dd>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-4 text-sm" data-testid="business-test-summary-nodes">
              <dt className="text-slate-500">Workflow nodes</dt>
              <dd className="text-right font-semibold text-slate-800">
                {summaryNodes.length > 0 ? (
                  <>
                    <span className="text-green-700">{nodeCounts.completed} completed</span>
                    <span className="text-slate-400"> · </span>
                    <span className="text-slate-600">{nodeCounts.skipped} skipped</span>
                    <span className="text-slate-400"> · </span>
                    <span className={nodeCounts.failed > 0 ? "text-rose-600" : "text-slate-600"}>
                      {nodeCounts.failed} failed
                    </span>
                  </>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-500">Not run</span>
                )}
              </dd>
            </div>
          </dl>
        </details>
      </div>

    </div>
  );
}

/* ------------------------------ Go live step ------------------------------ */

/** Where each readiness item is fixed: the Connect step or a Configure section. */
const CHECKLIST_TARGETS: Record<string, { kind: "connect" } | { kind: "configure"; section: string }> = {
  business_profile: { kind: "configure", section: "business-profile" },
  agent_setup: { kind: "configure", section: "agent-behavior" },
  voice: { kind: "configure", section: "agent-identity" },
  booking_rules: { kind: "configure", section: "hours-availability" },
  business_hours: { kind: "configure", section: "hours-availability" },
  google_calendar: { kind: "connect" },
  gmail: { kind: "connect" },
  phone_routing: { kind: "connect" },
  sms_sender: { kind: "connect" },
  mail_setup: { kind: "connect" }
};

function StepGoLive({
  checklist,
  readyToDeploy,
  assignedNumber,
  apptNeedsConfirmation,
  apptUseBusinessHours = true,
  coverageKind = "always",
  timeZone = "",
  calendarConnected = false,
  calendarRequired = false,
  browserTestOutcome = null,
  routingReady = null,
  businessName = "",
  businessType = "",
  assistantName = "",
  voiceLabel = "",
  tone = "",
  answeringModeLabel = "",
  apptFields,
  onEditConfigure,
  onEditConnect
}: {
  checklist: ChecklistRow[];
  readyToDeploy: boolean;
  assignedNumber: string | null;
  /** True when appointment hours are still unconfirmed — non-blocking nudge. */
  apptNeedsConfirmation: boolean;
  apptUseBusinessHours?: boolean;
  coverageKind?: string;
  timeZone?: string;
  calendarConnected?: boolean;
  calendarRequired?: boolean;
  browserTestOutcome?: "passed" | "failed" | null;
  routingReady?: boolean | null;
  businessName?: string;
  businessType?: string;
  assistantName?: string;
  voiceLabel?: string;
  tone?: string;
  answeringModeLabel?: string;
  apptFields?: Record<ApptNumberField, number>;
  onEditConfigure?: (sectionId: string) => void;
  onEditConnect?: () => void;
}) {
  // Read-only review data — same sources the Test step shows.
  const [facts, setFacts] = useState<BusinessFactsData | null>(null);
  const [readyDocs, setReadyDocs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getBusinessFacts().then((res) => {
      if (!cancelled && res.success && res.data) setFacts(res.data);
    });
    void getBusinessKnowledgeFiles().then((res) => {
      if (!cancelled && res.success && res.data) {
        setReadyDocs(res.data.files.filter((file) => file.ready).length);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const testRun = browserTestOutcome !== null || routingReady !== null;
  const testPassed = browserTestOutcome === "passed" || routingReady === true;

  function editTarget(key: string) {
    const target = CHECKLIST_TARGETS[key];
    if (!target) return undefined;
    if (target.kind === "connect") return onEditConnect;
    return onEditConfigure ? () => onEditConfigure(target.section) : undefined;
  }

  const summaryRow = "flex items-baseline justify-between gap-4 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Go live</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Your agent will begin handling calls and messages using this configuration.
        </p>
      </div>

      {/* Readiness checklist — every failed requirement links to its fix. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="business-setup-golive-checklist">
        {readyToDeploy ? (
          <div
            className="rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-sm font-semibold text-green-800"
            data-testid="business-setup-ready"
          >
            All set — you can go live.
          </div>
        ) : (
          <div
            className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm font-semibold text-amber-800"
            data-testid="business-setup-blockers"
          >
            Complete the required items below before going live.
          </div>
        )}

        <ul className="mt-3 divide-y divide-gray-100">
          {checklist.map((row) => {
            const edit = editTarget(row.key);
            return (
              <li
                key={row.key}
                className="flex items-start gap-3 py-2.5"
                data-testid={`business-setup-golive-check-${row.key}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                    row.complete
                      ? "bg-green-100 text-green-600"
                      : row.required
                        ? "bg-amber-100 text-amber-600"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {row.complete ? "✓" : "•"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-800">{row.label}</span>
                    <span className={`text-xs font-semibold ${row.complete ? "text-green-600" : row.required ? "text-amber-600" : "text-slate-400"}`}>
                      {row.complete ? "Ready" : row.required ? "Required" : "Recommended"}
                    </span>
                  </span>
                  {!row.complete && row.blocker ? (
                    <span className="mt-0.5 block text-xs text-slate-500" data-testid="business-setup-blocker">
                      {row.blocker}
                    </span>
                  ) : null}
                </span>
                {!row.complete && edit ? (
                  <button
                    type="button"
                    onClick={edit}
                    aria-label={`Edit ${row.label}`}
                    data-testid={`business-setup-golive-fix-${row.key}`}
                    className="shrink-0 text-xs font-semibold text-amber-600 underline hover:text-amber-700"
                  >
                    Edit
                  </button>
                ) : null}
              </li>
            );
          })}

          {/* Testing is recommended, never blocking. */}
          <li className="flex items-start gap-3 py-2.5" data-testid="business-setup-golive-check-test">
            <span
              aria-hidden="true"
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                testPassed ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-400"
              }`}
            >
              {testPassed ? "✓" : "•"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-slate-800">Test completed</span>
                <span className={`text-xs font-semibold ${testPassed ? "text-green-600" : "text-slate-400"}`}>
                  {testPassed ? "Ready" : testRun ? "Run again" : "Recommended"}
                </span>
              </span>
            </span>
          </li>
        </ul>

        {apptNeedsConfirmation ? (
          <p
            className="mt-2 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-700"
            data-testid="business-setup-appt-golive-note"
          >
            Review and confirm your booking rules in Configure so callers are offered the right times.
          </p>
        ) : null}
      </div>

      {/* Final summary — the exact configuration the live agent will use.
          Read-only on purpose: the Edit link returns to Configure. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="business-setup-golive-review">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Configuration review</p>
          {onEditConfigure ? (
            <button
              type="button"
              data-testid="business-setup-golive-edit"
              onClick={() => onEditConfigure("hours-availability")}
              className="text-xs font-semibold text-amber-600 underline hover:text-amber-700"
            >
              Edit in Configure
            </button>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4" data-testid="business-setup-golive-card-phone">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Phone &amp; routing</p>
            <dl className="mt-2 space-y-1.5">
              <div className={summaryRow}>
                <dt className="shrink-0 text-slate-500">Number</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
                  {assignedNumber ?? "Not assigned"}
                </dd>
              </div>
              {answeringModeLabel ? (
                <div className={summaryRow}>
                  <dt className="shrink-0 text-slate-500">Routing</dt>
                  <dd className="min-w-0 truncate text-right font-semibold text-slate-800">{answeringModeLabel}</dd>
                </div>
              ) : null}
              <div className={summaryRow} data-testid="business-setup-golive-ai-coverage">
                <dt className="shrink-0 text-slate-500">AI Call Coverage</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
                  {coverageKind === "always"
                    ? "Answers 24/7"
                    : coverageKind === "business_hours"
                      ? "During Business Hours"
                      : "Custom answering schedule"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4" data-testid="business-setup-golive-card-identity">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Agent identity</p>
            <dl className="mt-2 space-y-1.5">
              <div className={summaryRow}>
                <dt className="shrink-0 text-slate-500">Name</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-slate-800">{assistantName || "—"}</dd>
              </div>
              <div className={summaryRow}>
                <dt className="shrink-0 text-slate-500">Voice</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-slate-800">{voiceLabel || "—"}</dd>
              </div>
              <div className={summaryRow}>
                <dt className="shrink-0 text-slate-500">Tone</dt>
                <dd className="min-w-0 truncate text-right font-semibold capitalize text-slate-800">{tone || "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4" data-testid="business-setup-golive-card-business">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Business &amp; timezone</p>
            <dl className="mt-2 space-y-1.5">
              <div className={summaryRow}>
                <dt className="shrink-0 text-slate-500">Business</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
                  {businessName ? `${businessName}${businessType ? ` · ${businessType}` : ""}` : "—"}
                </dd>
              </div>
              {timeZone.trim() ? (
                <div className={summaryRow} data-testid="business-setup-golive-timezone">
                  <dt className="shrink-0 text-slate-500">Timezone</dt>
                  <dd className="min-w-0 truncate text-right font-semibold text-slate-800">{timeZone.trim()}</dd>
                </div>
              ) : null}
              <div className={summaryRow} data-testid="business-setup-golive-address">
                <dt className="shrink-0 text-slate-500">Address</dt>
                {facts?.addressFormatted ? (
                  <dd className="min-w-0 truncate text-right font-semibold text-slate-800">{facts.addressFormatted}</dd>
                ) : (
                  <dd className="min-w-0 truncate text-right text-slate-400">Not configured</dd>
                )}
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4" data-testid="business-setup-golive-card-hours">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Hours &amp; booking rules</p>
            <div className="mt-2">
              <BusinessHoursSummary testIdPrefix="business-setup-golive-hours" />
            </div>
            <dl className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
              <div className={summaryRow} data-testid="business-setup-golive-appt-source">
                <dt className="shrink-0 text-slate-500">Appointment Hours</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
                  {apptUseBusinessHours ? "Follow Business Hours" : "Custom Appointment Hours"}
                </dd>
              </div>
              {apptFields ? (
                <div className={summaryRow} data-testid="business-setup-golive-booking-rules">
                  <dt className="shrink-0 text-slate-500">Booking rules</dt>
                  {Number.isFinite(apptFields.defaultDurationMinutes) &&
                  Number.isFinite(apptFields.bufferMinutes) &&
                  Number.isFinite(apptFields.slotIntervalMinutes) ? (
                    <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
                      {apptFields.defaultDurationMinutes} min + {apptFields.bufferMinutes} min buffer · every{" "}
                      {apptFields.slotIntervalMinutes} min
                    </dd>
                  ) : (
                    <dd className="min-w-0 truncate text-right font-semibold text-amber-700">Needs attention</dd>
                  )}
                </div>
              ) : null}
            </dl>
          </div>

          <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4" data-testid="business-setup-golive-card-calendar">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Calendar</p>
            <dl className="mt-2 space-y-1.5">
              <div className={summaryRow} data-testid="business-setup-golive-calendar">
                <dt className="shrink-0 text-slate-500">Google Calendar</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
                  {calendarConnected ? "Connected" : calendarRequired ? "Not connected" : "Not connected (optional)"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4" data-testid="business-setup-golive-card-knowledge">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Knowledge</p>
            <dl className="mt-2 space-y-1.5">
              <div className={summaryRow} data-testid="business-setup-golive-knowledge">
                <dt className="shrink-0 text-slate-500">Documents</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
                  {readyDocs === null
                    ? "—"
                    : readyDocs > 0
                      ? `${readyDocs} document${readyDocs === 1 ? "" : "s"} ready`
                      : "No documents (FAQs still apply)"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
/* ------------------------------------------------------------------ */
/* Business calendar booking test — real agent logic; bookings create  */
/* clearly-marked [TRIVEN BUSINESS TEST] events on the connected       */
/* business calendar. Never counts as production activity.             */
/* ------------------------------------------------------------------ */

/** Visual meta for the per-turn node execution timeline. */
const NODE_STATUS_META: Record<BusinessTestExecutedNode["status"], { label: string; pill: string; dot: string }> = {
  success: { label: "Completed", pill: "bg-green-100 text-green-700", dot: "bg-green-500" },
  waiting: { label: "Waiting", pill: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  error: { label: "Failed", pill: "bg-rose-100 text-rose-700", dot: "bg-rose-500" },
  skipped: { label: "Skipped", pill: "bg-slate-100 text-slate-600", dot: "bg-slate-300" }
};

/** Visual meta for tool activity entries in the chat test. */
const TOOL_CALL_STATUS_META: Record<BusinessChatTestToolCall["status"], { label: string; pill: string }> = {
  simulated: { label: "Simulated", pill: "bg-amber-100 text-amber-700" },
  skipped: { label: "Skipped", pill: "bg-slate-100 text-slate-600" },
  error: { label: "Failed", pill: "bg-rose-100 text-rose-700" }
};

/** Short clock label ("3:42 PM") for a transcript timestamp; empty when invalid. */
function chatTimeLabel(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function BusinessCalendarTestSection({
  calendarConnected,
  timeZone,
  onResult
}: {
  calendarConnected: boolean;
  timeZone: string;
  /** Reports each turn's full result to the step-level test summary. */
  onResult?: (result: BusinessChatTestResult) => void;
}) {
  const [messages, setMessages] = useState<BusinessChatTestMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [configError, setConfigError] = useState<{ code: string; message: string; remediation: string } | null>(null);
  const [calendarError, setCalendarError] = useState<{ code: string; message: string; remediation: string } | null>(null);
  const [calendarEvent, setCalendarEvent] = useState<BusinessTestCalendarEvent | null>(null);
  const [toolCalls, setToolCalls] = useState<BusinessChatTestToolCall[]>([]);
  const [executedNodes, setExecutedNodes] = useState<BusinessTestExecutedNode[]>([]);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const testSessionIdRef = useRef<string>(`bts_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`);

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;

    setSending(true);
    setChatError("");
    setInput("");
    const pending = [...messages, { role: "user" as const, content: message, createdAt: new Date().toISOString() }];
    setMessages(pending);

    const res = await runBusinessSetupChatTest({
      message,
      history: messages,
      testSessionId: testSessionIdRef.current
    });

    setSending(false);

    if (res.success && res.data) {
      // Keep client-side timestamps for entries the server echoes back without one.
      const receivedAt = new Date().toISOString();
      setMessages(
        res.data.transcript.map((entry, index) => ({
          ...entry,
          createdAt: entry.createdAt ?? pending[index]?.createdAt ?? receivedAt
        }))
      );
      setToolCalls(res.data.toolCalls ?? []);
      // Latest turn's node timeline replaces the previous one — including
      // failed/skipped nodes, which must stay visible.
      setExecutedNodes(res.data.executedNodes ?? []);
      if (res.data.calendarEvent) setCalendarEvent(res.data.calendarEvent);
      setCalendarError(res.data.calendarError ?? null);
      setConfigError(res.data.configError ?? null);
      onResult?.(res.data);
    } else {
      setMessages(pending);
      setChatError(res.error ?? "Could not run the test conversation.");
    }
  };

  const deleteEvent = async () => {
    if (!calendarEvent?.testEventId || deletingEvent) return;
    setDeletingEvent(true);
    const res = await deleteBusinessTestEvent(calendarEvent.testEventId);
    setDeletingEvent(false);

    if (res.success) {
      setCalendarEvent(null);
    } else {
      setChatError(res.error ?? "Could not delete the test event.");
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="business-setup-calendar-test">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={SECTION_TITLE}>Test appointment booking</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Chat with your agent to book a clearly-marked test event on your calendar.
          </p>
        </div>
        <span
          className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700"
          data-testid="business-setup-calendar-test-badge"
        >
          BUSINESS TEST
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-500" data-testid="business-setup-calendar-test-timezone">
        Business timezone: <span className="font-semibold text-slate-700">{timeZone || "not set"}</span>
        {calendarConnected ? " · Google Calendar connected" : " · Google Calendar not connected — bookings will fail safely"}
      </p>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white">
        <div className="max-h-64 space-y-2 overflow-y-auto p-4" data-testid="business-setup-calendar-test-transcript">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">
              Try: &ldquo;I&rsquo;d like to book a Test Appointment tomorrow at 3 PM. My name is Alex, my number is +1 555 010 0000.&rdquo;
            </p>
          ) : (
            messages.map((entry, index) => {
              const timeLabel = chatTimeLabel(entry.createdAt);

              return (
                <div
                  key={`${entry.role}-${index}`}
                  className={`rounded-lg px-3 py-2 text-sm ${entry.role === "user" ? "bg-amber-50 text-slate-800" : "bg-slate-50 text-slate-700"}`}
                  data-testid={`business-setup-calendar-test-message-${entry.role}`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{entry.role === "user" ? "You" : "Agent"}</span>
                    {timeLabel ? (
                      <span className="shrink-0 font-mono text-[10px] text-slate-400" data-testid="business-test-chat-timestamp">
                        {timeLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block">{entry.content}</span>
                </div>
              );
            })
          )}
        </div>
        {toolCalls.length > 0 ? (
          <div className="border-t border-gray-100 px-4 py-3" data-testid="business-test-chat-tool-activity">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tool activity — latest turn</p>
            <ul className="mt-2 space-y-1.5">
              {toolCalls.map((call, index) => {
                const meta = TOOL_CALL_STATUS_META[call.status] ?? TOOL_CALL_STATUS_META.skipped;

                return (
                  <li
                    key={`${call.name}-${index}`}
                    className="flex items-start gap-2"
                    data-testid="business-test-chat-tool-call"
                  >
                    <span className={`mt-px shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.pill}`}>
                      {meta.label}
                    </span>
                    <span className="min-w-0 text-xs">
                      <span className="font-mono font-semibold text-slate-700">{call.name}</span>
                      {call.message ? <span className="block text-slate-500">{call.message}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="flex gap-2 border-t border-gray-100 p-3">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void send();
            }}
            placeholder="Message your agent…"
            data-testid="business-setup-calendar-test-input"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            data-testid="business-setup-calendar-test-send"
            className="btn shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      {configError ? (
        <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3" data-testid="business-setup-calendar-test-config-error">
          <p className="text-sm font-semibold text-rose-700">{configError.message}</p>
          <p className="mt-0.5 text-xs text-rose-600">{configError.remediation}</p>
        </div>
      ) : null}

      {chatError ? (
        <p className="mt-3 text-sm font-semibold text-rose-600" data-testid="business-setup-calendar-test-error">{chatError}</p>
      ) : null}

      {/* Node execution timeline — every node the graph runner touched this
          turn, in order. Failed and skipped nodes stay visible on purpose. */}
      {executedNodes.length > 0 ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4" data-testid="business-test-node-timeline">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Node execution — latest turn</p>
          <ol className="mt-3">
            {executedNodes.map((node, index) => {
              const meta = NODE_STATUS_META[node.status] ?? NODE_STATUS_META.skipped;
              const isLast = index === executedNodes.length - 1;

              return (
                <li key={`${node.nodeId}-${index}`} className={`flex gap-3 ${isLast ? "" : "pb-4"}`} data-testid="business-test-node-row">
                  <span aria-hidden className="flex flex-col items-center">
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                    {isLast ? null : <span className="mt-1 w-px flex-1 bg-slate-200" />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{node.label}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.pill}`}
                        data-testid="business-test-node-status"
                      >
                        {meta.label}
                      </span>
                    </span>
                    {node.message ? <span className="mt-0.5 block text-xs text-slate-500">{node.message}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {/* Google Calendar result — a "Created" state only ever renders when a
          real test event exists; failures render as a separate rose card. */}
      {calendarEvent ? (
        <div className="mt-4" data-testid="business-test-calendar-result">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4" data-testid="business-setup-calendar-test-event">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Google Calendar result</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-800" data-testid="business-setup-calendar-test-event-title">{calendarEvent.title}</p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${calendarEvent.status === "CREATED" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}
                data-testid="business-setup-calendar-test-event-status"
              >
                {calendarEvent.status === "CREATED" ? "Created on your calendar" : "Simulated"}
              </span>
            </div>
            {calendarEvent.serviceName ? (
              <p className="mt-1 text-xs text-slate-500" data-testid="business-test-calendar-service">
                Service: <span className="font-semibold text-slate-700">{calendarEvent.serviceName}</span>
              </p>
            ) : null}
            <p className="mt-1 text-xs text-slate-500" data-testid="business-setup-calendar-test-event-start">
              Starts: {new Date(calendarEvent.startAt).toLocaleString("en-US", { timeZone: calendarEvent.timeZone })} ({calendarEvent.timeZone})
            </p>
            <p className="mt-1 text-xs text-slate-500" data-testid="business-setup-calendar-test-event-end">
              Ends: {new Date(calendarEvent.endAt).toLocaleString("en-US", { timeZone: calendarEvent.timeZone })}
            </p>
            <div className="mt-3 flex items-center gap-2">
              {calendarEvent.status === "CREATED" && calendarEvent.htmlLink ? (
                <span className="contents" data-testid="business-test-calendar-open-link">
                  <a
                    href={calendarEvent.htmlLink}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="business-setup-calendar-test-event-link"
                    className="btn rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-gray-50"
                  >
                    Open in Google Calendar
                  </a>
                </span>
              ) : null}
              {calendarEvent.testEventId ? (
                <button
                  type="button"
                  onClick={() => void deleteEvent()}
                  disabled={deletingEvent}
                  data-testid="business-setup-calendar-test-event-delete"
                  className="btn rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                >
                  {deletingEvent ? "Deleting…" : "Delete test event"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {calendarError ? (
        <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3" data-testid="business-test-calendar-error">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">Failed</span>
            <span className="font-mono text-[11px] font-semibold text-rose-500">{calendarError.code}</span>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-rose-700">{calendarError.message}</p>
          <p className="mt-0.5 text-xs text-rose-600">{calendarError.remediation}</p>
        </div>
      ) : null}
    </div>
  );
}
