"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PhoneCall, CalendarSearch, Search, CalendarCheck, MessageSquare, Mail } from "lucide-react";
import { createPortal } from "react-dom";
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
import { TelegramSetupSection } from "@/components/business/setup/telegram-setup-section";
import { type ApptNumberField } from "@/components/business/setup/appointment-hours-editor";
import { validateBookingRules } from "@/components/business/setup/booking-rules-panel";
import {
  defaultAnsweringDays,
  type AiCoverageKind,
  type AnsweringDayRow
} from "@/components/business/setup/ai-call-coverage-editor";
import { businessSetupPath } from "@/lib/routes";
import { ExecutionPricingSummary, useBuyerExecutionPricing } from "@/components/business/execution-pricing-summary";
import { GoogleDisclosureModal } from "@/components/common/google-disclosure-modal";
import { InfoTooltip } from "@/components/business/setup/InfoTooltip";
import { GOOGLE_CALENDAR_DISCLOSURE, GOOGLE_DISCLOSURE_ACTION_AGREED } from "@coreai/shared";
import {
  getLatestBusinessTestEvent,
  checkMailAliasAvailability,
  deleteBusinessTestEvent,
  disconnectBusinessCalendar,
  getAppointmentSchedule,
  getBusinessCalendarOAuthUrl,
  getBusinessFacts,
  postBusinessCalendarDisclosureConsent,
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
  sendBusinessTestSms,
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

  const fromAgent = stringOrNull(installedAgent?.vapiAssistantId);
  if (fromAgent) return fromAgent;

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
  if (!root) return "";

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

  return "";
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
  const [redeploySuccess, setRedeploySuccess] = useState(false);
  const [successNumber, setSuccessNumber] = useState<string | null>(null);
  const [liveVapiAssistantId, setLiveVapiAssistantId] = useState<string | null>(null);
  const [liveInstalledAgentId, setLiveInstalledAgentId] = useState<string | null>(null);

  const isEditParam = searchParams.get("mode") === "edit";
  const isEditMode = isEditParam || deployed || Boolean(liveVapiAssistantId);

  useEffect(() => {
    if (isEditMode && !redeploySuccess && step === 4) {
      setStep(1);
    }
  }, [isEditMode, redeploySuccess, step]);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CallRoutingResult | null>(null);
  const [browserTestOutcome, setBrowserTestOutcome] = useState<"passed" | "failed" | null>(null);
  // Latest test booking, so the guided appointment step can open the actual event.
  const [lastTestEvent, setLastTestEvent] = useState<BusinessTestCalendarEvent | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [listing, setListing] = useState<any>(null);
  const [setupTimeEstimate, setSetupTimeEstimate] = useState<string | null>(null);
  const [isAddressValid, setIsAddressValid] = useState(false);
  const [businessType, setBusinessType] = useState("");
  const [connectStepValidated, setConnectStepValidated] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [contactName, setContactName] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [faqs, setFaqs] = useState<BusinessFaq[]>([]);
  const [bookingUrl, setBookingUrl] = useState("");
  const [tone, setTone] = useState("friendly");

  const [coverageKind, setCoverageKind] = useState<AiCoverageKind>("always");
  const [answeringDays, setAnsweringDays] = useState<AnsweringDayRow[]>(defaultAnsweringDays);

  const [businessHours, setBusinessHoursState] = useState<{
    configured: boolean;
    summary: string[] | null;
    timeZone: string;
    suggestion: boolean;
  }>({ configured: false, summary: null, timeZone: "", suggestion: false });

  // Document counts reported by the Knowledge section (collapsed-card summary).
  const [knowledgeSummary, setKnowledgeSummary] = useState({ files: 0, ready: 0 });

  const [knowledgeVersion, setKnowledgeVersion] = useState(0);
  const handleKnowledgeChanged = useCallback(() => setKnowledgeVersion((v) => v + 1), []);

  const [configDirty, setConfigDirty] = useState(false);
  const [bhDirty, setBhDirty] = useState(false);
  const [addressDirty, setAddressDirty] = useState(false);
  const bhApiRef = useRef<EmbeddedSectionApi | null>(null);
  const addressApiRef = useRef<EmbeddedSectionApi | null>(null);
  const savedTimeZoneRef = useRef("");

  const [apptLoaded, setApptLoaded] = useState(false);
  const [apptDays, setApptDays] = useState<Record<AppointmentWeekday, AppointmentDayHours>>(DEFAULT_APPT_DAYS);
  const [apptFields, setApptFields] = useState<Record<ApptNumberField, number>>({
    defaultDurationMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    maxAdvanceDays: 30
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
  const [calendarDisclosureOpen, setCalendarDisclosureOpen] = useState(false);
  const [calendarId, setCalendarId] = useState("primary");
  const [timeZone, setTimeZone] = useState(defaultTimeZone);

  const [tzEdited, setTzEdited] = useState(false);

  // The buyer's own business line — optional, forwarding target only. No OTP.
  const [existingPhoneNumber, setExistingPhoneNumber] = useState("");

  const [assistantName, setAssistantName] = useState("");
  const [voiceChoice, setVoiceChoice] = useState("");
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
      timeZone: data.timeZone,
      suggestion: Boolean(data.suggestion)
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

    try {
      const factsRes = await getBusinessFacts();
      if (factsRes.success && factsRes.data) {
        const address = factsRes.data.address;
        setIsAddressValid(Boolean(address?.line1?.trim() && address?.city?.trim()));
      }
    } catch (e) {
      console.error("Failed to load business facts:", e);
    }

    const res = await getBusinessSetup(listingId);

    if (res.success && res.data) {
      const data = res.data;

      if (data.setupTimeEstimate) {
        setSetupTimeEstimate(data.setupTimeEstimate);
      }

      const existingVapiAssistantId = readLiveVapiAssistantId(data);
      const existingInstalledAgentId = readInstalledAgentId(data);

      setLiveVapiAssistantId(existingVapiAssistantId);
      setLiveInstalledAgentId(existingInstalledAgentId);
      const isDeployed =
        (data.installedAgent && data.installedAgent.status === "ACTIVE") ||
        Boolean(existingVapiAssistantId);
      setDeployed(isDeployed);
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
        setVoiceChoice("");
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
          if (listingRes.data.listing.setupTimeEstimate) {
            setSetupTimeEstimate(listingRes.data.listing.setupTimeEstimate);
          }
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

      const isEditingSetup = isEditParam || Boolean(data.installedAgentId) || Boolean(data.profile?.vapiAssistantId);

      if (typeof window !== "undefined") {
        const savedStep = Number(window.sessionStorage.getItem(STEP_STORAGE_KEY) || "");

        if (isEditingSetup || isEditParam || isEditMode) {
          // Always start at Step 1 ("Connect") when opening setup or editing configuration
          setStep(1);
        } else if (savedStep >= 1 && savedStep < STEPS.length) {
          setStep(savedStep);
        } else {
          // Always start at Step 1 ("Connect") when opening setup
          setStep(1);
        }

        window.sessionStorage.removeItem(STEP_STORAGE_KEY);
      }
    }

    setLoading(false);
  }, [listingId]);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  useEffect(() => {
    let cancelled = false;

    void getAppointmentSchedule().then((res) => {
      if (cancelled || !res.success || !res.data) return;

      const { schedule, needsConfirmation } = res.data;

      setApptDays({ ...DEFAULT_APPT_DAYS, ...schedule.days });
      setApptFields({
        defaultDurationMinutes: schedule.defaultDurationMinutes,
        bufferMinutes: schedule.bufferMinutes,
        minNoticeMinutes: schedule.minNoticeMinutes,
        maxAdvanceDays: schedule.maxAdvanceDays
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
            timeZone: res.data!.timeZone,
            suggestion: Boolean(res.data!.suggestion)
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
  const bookingRulesBlocked = apptLoaded && !bookingRules.valid;

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
            minNoticeMinutes: apptFields.minNoticeMinutes,
            maxAdvanceDays: apptFields.maxAdvanceDays,
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

  /** Opens the mandatory pre-OAuth disclosure — OAuth starts only from its agree action. */
  function handleConnectCalendar() {
    setError("");
    setCalendarDisclosureOpen(true);
  }

  async function handleCalendarDisclosureAgreed() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STEP_STORAGE_KEY, String(step));
    }

    setCalendarBusy(true);

    try {
      if (canPersist) {
        const saved = await persistSetup(false);

        if (!saved.ok) {
          throw new Error("Could not save your setup before connecting.");
        }
      }

      const consent = await postBusinessCalendarDisclosureConsent({
        disclosureVersion: GOOGLE_CALENDAR_DISCLOSURE.version,
        action: GOOGLE_DISCLOSURE_ACTION_AGREED
      });
      if (!consent.success) {
        throw new Error(consent.error ?? "Could not record your agreement.");
      }

      const res = await getBusinessCalendarOAuthUrl(
        String(businessSetupPath(listingId || undefined))
      );

      if (res.success && res.data?.url) {
        window.location.href = res.data.url;
        return;
      }

      throw new Error(res.error ?? "Could not start Google Calendar connection.");
    } catch (connectError) {
      setCalendarBusy(false);
      throw connectError instanceof Error
        ? connectError
        : new Error("Could not start Google Calendar connection.");
    }
  }

  async function handleDisconnectCalendar() {
    setCalendarBusy(true);
    await disconnectBusinessCalendar();
    setCalendar({ connected: false, email: null });
    setCalendarBusy(false);
  }

  async function goNext() {
    setError("");

    if (step === 1) {
      if (!connectComplete) {
        setError("Complete the Connect step before continuing.");
        return;
      }
      setConnectStepValidated(true);
    }

    if (step === 2 && !configureComplete) {
      setError("Complete the Configure step before continuing.");
      return;
    }

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

  async function handleDeploy() {
    setError("");

    if (!connectReady) {
      setStep(1);
      setError("Complete the Connect step before going live.");
      return;
    }

    if (!configureComplete) {
      setStep(2);
      setError("Complete the Configure step before going live.");
      return;
    }

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
      setStep(3);
      setError("Your live voice assistant could not be created. Try again, or contact Triven support if it keeps failing.");
      return;
    }

    if (!result.installedAgentId || !(result.number || assignedNumber)) {
      setStep(3);
      setError("Deploy did not complete — the agent or phone number was not saved. Please try again.");
      return;
    }

    setDeployed(true);
    setRedeploySuccess(true);
    setSuccessNumber(result.number || assignedNumber || "");
    buildConfetti();
    setStep(4);

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
  const businessComplete = businessName.trim().length >= 2 && businessType.trim().length >= 2 && isAddressValid;

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    "business-profile": true
  });

  const openSection = useCallback((id: string) => {
    setOpenSections({ [id]: true });
  }, []);
  const toggleSection = useCallback(
    (id: string, open: boolean) => {
      if (open) {
        openSection(id);
        return;
      }
      setOpenSections({});
    },
    [openSection]
  );
  function jumpToConfigureSection(id: string) {
    setError("");
    setStep(2);
    openSection(id);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const target = window.document.getElementById(id);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
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
  const voiceChoiceComplete = voiceChoice !== "";
  const voiceComplete = assistantNameComplete && voiceChoiceComplete;

  const connectorsKnown = requiredKeys.length > 0 || (!loading && Boolean(listingId));
  const needsCalendar = needs.has("google_calendar");
  const needsGmail = needs.has("gmail");
  const needsPhone = needs.has("phone_provider") || needs.has("twilio") || needs.has("phone");
  const needsSms = needs.has("twilio") && triggerKind === "inbound_sms";
  const needsVoice = needs.has("vapi") || triggerKind === "voice";
  const needsMail = needs.has("triven_mail");
  const needsTelegram = needs.has("telegram");
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
  const showTelegram = needsTelegram;

  const connectTitle =
    showPhone && showCalendar ? "Connect your phone & calendar" : showPhone ? "Connect your phone" : "Connect your services";

  const connectComplete =
    (!showPhone || phoneSelected) &&
    (!showCallForwarding || forwardToPhone.trim().length >= 5 || answeringMode === "AI_FIRST") &&
    (!needsCalendar || calendar.connected) &&
    (!needsGmail || calendar.connected) &&
    (!needsMail || mailComplete) &&
    (!needsTelegram || telegramConnected);
  const connectReady = connectComplete;
  const configureComplete = businessComplete && buyerSetupComplete && (!showVoice || voiceComplete);
  const testPassed = browserTestOutcome === "passed" || Boolean(testResult?.readyForCall);
  const stepDone: Record<number, boolean> = {
    1: connectComplete,
    2: connectReady && configureComplete,
    3: connectReady && configureComplete && testPassed,
    4: isEditMode ? redeploySuccess : deployed
  };

  const canAccessStep = (targetStep: number) => {
    if (targetStep <= 1) return true;
    if (targetStep === 2) return connectReady;
    if (targetStep === 3) return connectReady && configureComplete;
    if (targetStep === 4) return isEditMode ? redeploySuccess : deployed;
    return false;
  };

  const getStepLockMessage = (targetStep: number) => {
    if (targetStep === 2) return "Complete the Connect step before opening Configure.";
    if (targetStep === 3) return "Complete Connect and Configure before opening Test.";
    if (targetStep === 4) {
      return isEditMode
        ? "Complete your configuration and click Redeploy to finish."
        : "Complete the setup flow and go live from the Test screen.";
    }
    return "Complete the previous steps before opening this one.";
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
    ...(needsTelegram
      ? [
        {
          key: "telegram",
          label: "Telegram bot",
          required: true,
          complete: telegramConnected,
          blocker: telegramConnected ? undefined : "Connect and verify this agent's dedicated Telegram bot."
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
              : "Choose a voice."
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

  return (
    <div className="setup-root bg-gray-50 min-h-screen pb-12" data-testid="business-setup-wizard">
      <style>{WIZARD_STYLES}</style>

      {step === 4 && <ConfettiCanvas />}

      <header className="bg-white border-b border-gray-200/80 py-6 px-4 sm:px-6 sticky top-0 z-30 shadow-xs">
        <div className="w-full max-w-7xl mx-auto grid grid-cols-3 items-center">
          {/* Left side: Agent Name */}
          <div className="flex items-center justify-start min-w-0 pr-2 sm:pr-4">
            <h1
              className="font-bold text-slate-900 text-sm sm:text-base truncate"
              data-testid="business-setup-agent-name"
            >
              {(typeof listing?.name === "string" && listing.name.trim()) || businessName.trim() || "Your AI agent"}
            </h1>
          </div>

          {/* Center: Step Indicator (always centered) */}
          <div className="flex items-center justify-center min-w-0">
            <nav className="progress" aria-label="Setup progress" data-testid="business-setup-progress-dots">
              {STEPS.map((entry, index) => {
                const active = entry.id === step;
                const done = stepDone[entry.id];
                const upcoming = step < entry.id && !done;
                const locked = entry.id > step && !canAccessStep(entry.id);
                const clickable = !locked;

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
                        if (locked) {
                          setError(getStepLockMessage(entry.id));
                          return;
                        }
                        setError("");
                        setStep(entry.id);
                      }}
                      aria-label={`Go to step ${entry.id}: ${entry.title}`}
                      aria-current={active ? "step" : undefined}
                      aria-disabled={locked ? "true" : undefined}
                      disabled={locked}
                      data-testid={`business-setup-dot-${entry.id}`}
                      className={`pstep group ${active ? "active" : ""} ${done ? "done" : ""} ${upcoming ? "upcoming" : ""} ${clickable ? "clickable" : ""} ${locked ? "opacity-60" : ""}`}
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
                      <span className="plabel">{entry.id === 4 && isEditMode ? "Redeploy" : entry.title}</span>
                    </button>
                  </div>
                );
              })}
            </nav>
          </div>

          {/* Right side: Estimated Setup Time */}
          <div className="flex items-center justify-end min-w-0 pl-2 sm:pl-4">
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                {setupTimeEstimate ? (
                  setupTimeEstimate.startsWith("~") ? `${setupTimeEstimate} setup` : `~${setupTimeEstimate} setup`
                ) : (
                  "~3 min setup"
                )}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 sm:px-2 py-6">
        <div className={CARD}>
          {isEditMode && (
            <div
              className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/90 bg-amber-50/80 px-4 py-2.5 text-xs font-semibold text-amber-900 shadow-2xs"
              data-testid="business-setup-edit-badge-banner"
            >
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span>Editing Agent Configuration</span>
              </div>
              <span className="text-[11px] font-medium text-amber-700">
                Your previous call history, bookings, and data remain safe
              </span>
            </div>
          )}
          {step === 1 ? (
            <StepConnect
              title={connectTitle}
              isEditMode={isEditMode}
              showPhone={showPhone}
              showCallForwarding={showCallForwarding}
              showAnsweringMode={showAnsweringMode}
              showCalendar={showCalendar}
              showSmsNote={showSmsNote}
              showMail={showMail}
              showTelegram={showTelegram}
              onTelegramConnectedChange={setTelegramConnected}
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
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  Agent Configuration
                </h2>
                <p className="mt-1 text-sm font-normal text-slate-500">
                  Configure your agent&apos;s identity, knowledge, availability, and instructions.
                </p>
              </div>

              <ConfigureSectionCard
                id="business-profile"
                title="Business Profile & Knowledge"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18" />
                    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                    <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
                    <path d="M10 6h4" />
                    <path d="M10 10h4" />
                    <path d="M10 14h4" />
                    <path d="M10 18h4" />
                  </svg>
                }
                status={businessComplete ? "complete" : "incomplete"}
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
                  onAddressValidChange={setIsAddressValid}
                  registerAddressApi={registerAddressApi}
                  addressRefreshToken={knowledgeVersion}
                  listingId={listingId}
                  installedAgentId={liveInstalledAgentId}
                  faqs={faqs}
                  onFaqs={dirtyWrap(setFaqs)}
                  onSummaryChange={setKnowledgeSummary}
                  onKnowledgeChanged={handleKnowledgeChanged}
                  hoursSuggestionReady={businessHours.suggestion}
                  onReviewHours={() => jumpToConfigureSection("hours-availability")}
                />
              </ConfigureSectionCard>

              {showVoice && (
                <ConfigureSectionCard
                  id="agent-identity"
                  title="Agent Identity & Voice"
                  icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <circle cx="12" cy="8" r="5" />
                      <path d="M20 21a8 8 0 0 0-16 0" />
                    </svg>
                  }
                  status={voiceComplete ? "complete" : "incomplete"}
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
              )}

              <ConfigureSectionCard
                id="hours-availability"
                title="Business Hours & Availability"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                    <line x1="16" x2="16" y1="2" y2="6" />
                    <line x1="8" x2="8" y1="2" y2="6" />
                    <line x1="3" x2="21" y1="10" y2="10" />
                    <path d="M8 14h.01" />
                    <path d="M12 14h.01" />
                    <path d="M16 14h.01" />
                    <path d="M8 18h.01" />
                    <path d="M12 18h.01" />
                    <path d="M16 18h.01" />
                  </svg>
                }
                warningCount={apptLoaded ? Object.keys(bookingRules.errors).length : 0}
                status={
                  bookingRulesBlocked
                    ? "attention"
                    : businessHours.configured
                      ? "complete"
                      : "attention"
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
                  businessHoursRefreshToken={knowledgeVersion}
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
                title="Agent Instructions & Behavior"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <rect width="16" height="16" x="4" y="4" rx="2" />
                    <rect width="6" height="6" x="9" y="9" rx="1" />
                    <path d="M9 1v3" />
                    <path d="M15 1v3" />
                    <path d="M9 20v3" />
                    <path d="M15 20v3" />
                    <path d="M20 9h3" />
                    <path d="M20 15h3" />
                    <path d="M1 9h3" />
                    <path d="M1 15h3" />
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
              lastTestEvent={lastTestEvent}
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
            <div data-testid="business-setup-success" className="mx-auto max-w-lg text-center py-6">
              {/* Pop-in Checkmark circle */}
              <div className="check-pop w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-amber-400 to-green-500 grid place-items-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10">
                  <polyline className="draw" points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>

              <div className="stagger">
                {/* Dynamic success copy based on edit mode and workflow trigger kind */}
                {isEditMode ? (
                  <div>
                    <h2 className="text-3xl font-black tracking-tight mt-6 text-slate-900" data-testid="business-setup-success-title">
                      Agent Configuration Updated & Redeployed!
                    </h2>
                    <p className="text-lg text-slate-600 mt-3">
                      Your changes have been saved and applied to your live AI agent. Previous call logs and data remain safe.
                    </p>
                  </div>
                ) : (
                  (() => {
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
                  })()
                )}

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
                    {isEditMode ? "Return to dashboard" : "Go to dashboard"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRedeploySuccess(false);
                      setStep(1);
                      if (typeof window !== "undefined") {
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }
                    }}
                    className="btn border border-gray-200 rounded-xl px-8 py-3.5 text-slate-600 font-semibold hover:border-amber-300 hover:text-slate-800 bg-white w-full max-w-xs"
                  >
                    {isEditMode ? "Edit configuration again" : "Edit setup"}
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
          ) : null}

          {error ? (
            <p data-testid="business-setup-error" role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          {step < 4 && (
            <div
              className="sticky bottom-0 z-20 mt-8 -mx-6 rounded-b-2xl border-t border-gray-100 bg-white/95 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur sm:-mx-8 sm:px-8"
              data-testid="business-setup-footer"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

                {/* Left Actions */}
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  {step < 3 && (
                    <button
                      type="button"
                      onClick={() =>
                        setStep((current) => Math.min(current + 1, STEPS.length))
                      }
                      disabled={saving || (step === 1 && !connectComplete) || (step === 2 && !configureComplete)}
                      data-testid="business-setup-skip"
                      className="text-sm font-medium text-slate-500 transition hover:text-slate-700 disabled:opacity-50"
                    >
                      Skip for now
                    </button>
                  )}
                </div>

                {/* Right Actions */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
                  {step < 3 ? (
                    <button
                      type="button"
                      onClick={goNext}
                      disabled={saving || (step === 1 && !connectComplete) || (step === 2 && (!configureComplete || bookingRulesBlocked))}
                      data-testid="business-setup-next"
                      className="btn w-full rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-50 sm:w-auto"
                    >
                      {step === 2 ? "Save & Continue" : "Continue"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDeploy}
                      disabled={saving || !connectComplete || !configureComplete}
                      data-testid="business-setup-submit"
                      className="btn w-full rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-50 sm:w-auto"
                    >
                      {saving ? (isEditMode ? "Redeploying…" : "Deploying…") : (isEditMode ? "Update & Redeploy" : "Go live")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
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

      <GoogleDisclosureModal
        open={calendarDisclosureOpen}
        onAgree={handleCalendarDisclosureAgreed}
        onCancel={() => setCalendarDisclosureOpen(false)}
      />
    </div>
  );
}

/* ------------------------------ Connect step ------------------------------ */

function StepConnect({
  title,
  isEditMode,
  showPhone,
  showCallForwarding,
  showAnsweringMode,
  showCalendar,
  showSmsNote,
  showMail,
  showTelegram,
  onTelegramConnectedChange,
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
  isEditMode?: boolean;
  showPhone: boolean;
  /** Show the call-forwarding number + answering-mode options. True for missed-call and voice workflows. */
  showCallForwarding: boolean;
  /** Show the answering-mode dropdown. True only for voice workflows. */
  showAnsweringMode: boolean;
  showCalendar: boolean;
  showSmsNote: boolean;
  showMail: boolean;
  showTelegram: boolean;
  onTelegramConnectedChange: (connected: boolean) => void;
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
  const [showStepsModal, setShowStepsModal] = useState(false);

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

      {showPhone && (
        <div className="py-2" data-testid="business-setup-number-card">
          {assignedNumber ? (
            <div className="flex items-start justify-between gap-3.5">
              <div className="flex items-start gap-3.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-green-600 shrink-0 mt-0.5">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-500 inline-flex items-center">
                      Your Triven AI number
                      <InfoTooltip content="Included with your Triven AI setup. To replace this number, contact Triven support." />
                    </p>
                    <span
                      className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-green-700"
                      data-testid="business-setup-assigned-number-status"
                    >
                      Active
                    </span>
                    {isEditMode && (
                      <span
                        className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600"
                        data-testid="business-setup-assigned-number-locked"
                      >
                        🔒 Non-editable
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-3xl font-bold text-slate-900 tracking-tight" data-testid="business-setup-assigned-number">{assignedNumber}</p>
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

      {showPhone && showCallForwarding && assignedNumber ? (
        <div className="border-t border-gray-200/60 pt-6" data-testid="business-setup-routing-card">
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
                  <span className="block text-sm font-bold text-slate-900 inline-flex items-center">
                    Use my Triven AI number directly
                    <InfoTooltip content={`Give ${assignedNumber} to customers. Calls go directly to your AI agent.`} />
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
                  <span className="block text-sm font-bold text-slate-900 inline-flex items-center">
                    Keep using my existing business number
                    <InfoTooltip content={`Forward calls from your existing number to ${assignedNumber}.`} />
                  </span>
                </span>
              </button>
            </div>
          ) : (
            /* Missed-call workflow: always uses forwarding, no mode selector needed */
            <div className="mt-4 text-sm text-slate-650">
              <span className="font-semibold text-slate-800">Forwarding is automatic.</span> Your provider sends missed-call notifications to your Triven AI number and the AI handles the rest.
            </div>
          )}

          {routingMode === "forward" || !showAnsweringMode ? (
            <div className="mt-6 border-t border-slate-200/80 pt-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-800">Call Forwarding Setup</span>
                <button
                  type="button"
                  onClick={() => setShowStepsModal(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 hover:underline focus:outline-none"
                  data-testid="business-setup-view-steps"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  View Steps
                </button>
              </div>

              <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-2 inline-flex items-center">
                Existing business phone number
                <InfoTooltip content="Used only as the forwarding target — no verification needed." />
              </label>

              <div className={`phone-wrap flex items-stretch border rounded-xl bg-white relative ${phoneValid ? "is-valid" : "border-gray-200"}`}>
                {/* Country code */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCountryMenuOpen(!countryMenuOpen)}
                    aria-haspopup="listbox"
                    aria-expanded={countryMenuOpen}
                    className="h-full flex items-center gap-1.5 bg-gray-50 border-r border-gray-200 px-4 py-4 text-base font-medium text-slate-700 hover:bg-gray-100 transition-colors rounded-l-xl"
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
                  className="field flex-1 px-5 py-4 text-lg font-mono placeholder:text-slate-300 outline-none border-0 rounded-r-xl"
                  placeholder="(555) 123-4567"
                />

                {/* Check icon */}
                <span className="phone-check absolute right-4 top-1/2 -translate-y-1/2 text-green-500" aria-hidden="true" style={{ opacity: phoneValid ? 1 : 0, transform: phoneValid ? "scale(1)" : "scale(0.6)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* SECTION 3 — Calendar Connection block */}
      {showCalendar ? (
        <div className="mt-6 border-t border-gray-100 pt-6">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Calendar</h3>

          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex items-center gap-3">
              {/* Google Calendar Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm-5-8h-4v4h4v-4z" />
                </svg>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-800 inline-flex items-center">
                  {calendar.connected ? "Google Calendar connected" : "Google Calendar"}
                  {!calendar.connected && (
                    <InfoTooltip content="Not connected. Connect so the agent can book appointments." />
                  )}
                </p>
                {calendar.connected && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    Connected as {calendar.email || "your account"}
                  </p>
                )}
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
                data-testid="business-setup-calendar-connect"
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
        <div className="py-2">
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
        </div>
      </div>

      {showSmsNote ? (
        <div className={SECTION} data-testid="business-setup-sms-note">
          <h3 className={SECTION_TITLE}>SMS</h3>
          <p className="mt-1 text-sm text-slate-500">Confirmation SMS will be sent to your customers from Triven.</p>
        </div>
      ) : null}

      {showMail ? <MailSetupSection businessName={businessName} onAliasChange={onMailAliasChange} /> : null}

      {showTelegram ? (
        <TelegramSetupSection
          installedAgentId={installedAgentIdForPhone}
          businessName={businessName}
          onConnectedChange={onTelegramConnectedChange}
        />
      ) : null}

      <ForwardingStepsModal
        isOpen={showStepsModal}
        onClose={() => setShowStepsModal(false)}
        assignedNumber={assignedNumber}
      />
    </div>
  );
}

interface ForwardingStepsModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignedNumber: string | null;
}

function ForwardingStepsModal({ isOpen, onClose, assignedNumber }: ForwardingStepsModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.body.style.overflow = prevOverflow;
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forwarding-modal-title"
      onClick={onClose}
      data-testid="business-setup-forwarding-steps-modal"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl transition-all scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="forwarding-modal-title" className="text-lg font-bold text-slate-900">
              Set up call forwarding to your Triven AI number
            </h3>
            <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
              Your carrier forwards calls it can&apos;t complete to{" "}
              <span className="font-mono font-bold text-slate-750">{assignedNumber || "your Triven AI number"}</span>. Do this once from the phone that uses your existing business number:
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ol className="mt-4 list-decimal space-y-3 pl-5 text-xs text-slate-600">
          <li>
            Dial the conditional-forwarding code for your carrier
            {assignedNumber ? (
              <>
                {" "}with your Triven number <span className="font-mono font-semibold">{assignedNumber.replace(/[^\d+]/g, "")}</span>:
              </>
            ) : (
              " with your Triven number (assigned in the step above):"
            )}
            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-slate-505">
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

        <p className="mt-4 text-[11px] text-slate-400 leading-relaxed border-t border-slate-100 pt-3">
          To turn forwarding off later: <span className="font-mono">##61#</span> / <span className="font-mono">##67#</span> / <span className="font-mono">##62#</span> (GSM) or <span className="font-mono">*73</span> (Verizon). Codes vary by carrier and country — if none work, ask your carrier to enable &ldquo;conditional call forwarding&rdquo; to your Triven number.
        </p>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
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
    <div className="mt-8 border-t border-gray-100 pt-8" data-testid="business-setup-mail">
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-sm font-bold text-slate-900 inline-flex items-center">
          Mail Setup
          <InfoTooltip content="Configure the sender name, email alias, and routing preferences for customer notifications and call summaries." />
        </h3>
        {savedAlias && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            Active
          </span>
        )}
      </div>

      <div className="space-y-6">
        {/* Core Settings Grid */}
        <div className="grid gap-5 sm:grid-cols-2">
          {/* Sender Name */}
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
              className="field w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            />
          </div>

          {/* Email Alias */}
          <div>
            <label className={LABEL} htmlFor="mail-alias">
              Email alias
            </label>
            <div className="flex rounded-xl border border-gray-200 bg-white focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-400 overflow-hidden">
              <input
                data-testid="business-setup-mail-alias"
                id="mail-alias"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value.toLowerCase())}
                placeholder="smile-dental"
                className="w-full bg-transparent px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
              />
              <span className="flex items-center bg-slate-50 border-l border-gray-200 px-4 text-sm font-semibold text-slate-500 select-none">
                @{domain}
              </span>
            </div>
            {availability && (
              <p
                data-testid="business-setup-mail-availability"
                className={`mt-1.5 text-xs font-semibold ${availability.available ? "text-green-600" : "text-red-500"}`}
              >
                {availability.available ? "✓ Alias is available" : `✗ ${availability.reason ?? "Alias is not available"}`}
              </p>
            )}
            {savedAlias && localPart !== savedAlias.localPart && (
              <p className="mt-1.5 text-xs font-semibold text-amber-600" data-testid="business-setup-mail-change-warning">
                ⚠ Changing alias updates the public address. History is kept.
              </p>
            )}
          </div>

          {/* Forward Replies */}
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
              className="field w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            />
          </div>

          {/* Reply Handling */}
          <div>
            <label className={LABEL} htmlFor="mail-reply-mode">
              Reply handling
            </label>
            <select
              data-testid="business-setup-mail-reply-mode"
              id="mail-reply-mode"
              value={replyMode}
              onChange={(e) => setReplyMode(e.target.value as BusinessEmailAliasData["replyHandlingMode"])}
              className="field w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            >
              {REPLY_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Toggles Grid */}
        <div className="grid gap-4 sm:grid-cols-2 pt-2">
          {/* Email Customers */}
          <label
            className="flex items-start gap-3 py-2 cursor-pointer transition-all"
            htmlFor="mail-toggle-customer"
          >
            <input
              data-testid="business-setup-mail-toggle-customer"
              id="mail-toggle-customer"
              type="checkbox"
              checked={customerEmailsEnabled}
              onChange={(e) => setCustomerEmailsEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 focus:ring-offset-0"
            />
            <div className="space-y-0.5">
              <span className="block text-sm font-semibold text-slate-800 inline-flex items-center">
                Email customers
                <InfoTooltip content="Send confirmations and follow-ups after calls." />
              </span>
            </div>
          </label>

          {/* Email Team */}
          <label
            className="flex items-start gap-3 py-2 cursor-pointer transition-all"
            htmlFor="mail-toggle-summary"
          >
            <input
              data-testid="business-setup-mail-toggle-summary"
              id="mail-toggle-summary"
              type="checkbox"
              checked={summaryEmailsEnabled}
              onChange={(e) => setSummaryEmailsEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 focus:ring-offset-0"
            />
            <div className="space-y-0.5">
              <span className="block text-sm font-semibold text-slate-800 inline-flex items-center">
                Email team summaries
                <InfoTooltip content="Send summaries and details to your forward address." />
              </span>
            </div>
          </label>
        </div>

        {/* Sender Preview Card */}
        <div
          className="rounded-xl border border-slate-100 p-4"
          data-testid="business-setup-mail-preview"
        >
          <div className="flex items-center gap-2 mb-2.5">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sender Preview</span>
          </div>

          <div className="bg-white border border-slate-100 rounded-lg p-3 space-y-1.5 text-xs">
            <div className="flex items-baseline gap-2 border-b border-slate-50 pb-1.5">
              <span className="text-slate-400 font-medium w-16">From:</span>
              <span className="text-slate-800 font-semibold">
                {previewName} <span className="text-slate-500 font-normal">&lt;{previewAddress}&gt;</span>
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-slate-400 font-medium w-16">Reply-To:</span>
              <span className="text-slate-650 font-medium">
                {previewAddress}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200/60">
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="business-setup-mail-save"
              onClick={() => void handleSave()}
              disabled={busy || !localPart.trim() || !displayName.trim()}
              className="btn rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {busy ? "Working…" : savedAlias ? "Update setup" : "Save setup"}
            </button>
            <button
              type="button"
              data-testid="business-setup-mail-test"
              onClick={() => void handleTestEmail()}
              disabled={busy || !savedAlias}
              className="btn rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-amber-350 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Send test email
            </button>
          </div>
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


type PreviewCallState = "idle" | "starting" | "live" | "ended";

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}


type WorkflowTestStepKind = "voice" | "appointment" | "sms" | "confirmation" | "generic";

type WorkflowTestStep = {
  id: string;
  title: string;
  detail: string;
  kind: WorkflowTestStepKind;
};

const WORKFLOW_STEP_COPY: Record<WorkflowTestStepKind, { title: string; detail: string }> = {
  voice: {
    title: "Talk to Your Agent",
    detail: "Press the mic button and have a real conversation with your AI agent."
  },
  appointment: {
    title: "View Booked Appointment",
    detail: "Your agent just booked a test appointment — open your calendar to confirm it."
  },
  sms: {
    title: "Receive Confirmation Text",
    detail: "Enter your phone number and your agent will send you a real text message."
  },
  confirmation: {
    title: "Confirmation Received",
    detail: "Confirm you received the text message to complete the test."
  },
  generic: {
    title: "Workflow Step",
    detail: "Complete this step, then continue to the next one."
  }
};

function workflowNodeData(node: any): Record<string, unknown> {
  return node && typeof node === "object" && node.data && typeof node.data === "object" ? node.data : {};
}

function workflowNodeLabel(node: any, kind: WorkflowTestStepKind, index: number): string {
  // Always use our clean, user-friendly copy for known step kinds.
  // This ensures no technical terms from the workflow JSON ever reach the UI.
  if (kind !== "generic") return WORKFLOW_STEP_COPY[kind].title;
  const data = workflowNodeData(node);
  const label = data.title ?? data.label ?? data.name;
  if (typeof label === "string" && label.trim()) return label.trim();
  return `Workflow step ${index + 1}`;
}

function workflowNodeDescription(_node: any, kind: WorkflowTestStepKind): string {
  // Always use our clean copy — never show raw node descriptions which may
  // contain internal tool names (Vapi, Twilio, ElevenLabs, etc.).
  return WORKFLOW_STEP_COPY[kind].detail;
}

function inferWorkflowStepKind(node: any): WorkflowTestStepKind | "skip" {
  const data = workflowNodeData(node);
  const haystack = [
    data.type,
    data.kind,
    data.nodeKind,
    data.connector,
    data.connectorAction,
    data.label,
    data.title,
    data.subtitle
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  if (!haystack.trim()) return "skip";
  if (includesAny(haystack, ["flow.end", "end flow", "confirmation received", "complete"])) return "confirmation";
  if (includesAny(haystack, ["send_sms", "send sms", "sms", "text message", "send_notification"])) return "sms";
  if (includesAny(haystack, ["book_appointment", "create_appointment", "calendar.book", "appointment booking", "google_calendar_create_appointment", "google_calendar", "googlecalendar", "calendar", "appointment", "schedule_appointment", "book appointment"])) return "appointment";
  if (includesAny(haystack, ["voice_conversation", "start_vapi_call", "vapi", "ai voice", "voice call"])) return "voice";
  if (String(data.nodeKind ?? "").toLowerCase() === "trigger") return "skip";
  return "generic";
}

function orderedWorkflowNodes(workflowJson: any): any[] {
  const nodes = Array.isArray(workflowJson?.nodes) ? workflowJson.nodes : [];
  const edges = Array.isArray(workflowJson?.edges) ? workflowJson.edges : [];
  if (nodes.length <= 1 || edges.length === 0) return nodes;

  const nodeById = new Map(nodes.map((node: any) => [String(node?.id ?? ""), node]));
  const targets = new Set(edges.map((edge: any) => String(edge?.target ?? "")).filter(Boolean));
  const starts = nodes.filter((node: any) => !targets.has(String(node?.id ?? "")));
  const ordered: any[] = [];
  const seen = new Set<string>();

  function visit(id: string) {
    if (!id || seen.has(id)) return;
    const node = nodeById.get(id);
    if (!node) return;
    seen.add(id);
    ordered.push(node);
    edges.filter((edge: any) => String(edge?.source ?? "") === id).forEach((edge: any) => visit(String(edge?.target ?? "")));
  }

  starts.forEach((node: any) => visit(String(node?.id ?? "")));
  nodes.forEach((node: any) => visit(String(node?.id ?? "")));
  return ordered;
}

function workflowJsonFromListing(listing?: any): any {
  return listing?.workflowJson || listing?.workflow?.workflowJson || null;
}

function buildWorkflowTestSteps({
  listing,
  showPreview,
  showCalendarTest,
  labels
}: {
  listing?: any;
  showPreview: boolean;
  showCalendarTest: boolean;
  labels: ReturnType<typeof getAnsweringLabels>;
}): WorkflowTestStep[] {
  const workflowJson = workflowJsonFromListing(listing);
  const nodes = orderedWorkflowNodes(workflowJson);
  const seenKinds = new Set<WorkflowTestStepKind>();
  const steps = nodes
    .map((node, index) => {
      const kind = inferWorkflowStepKind(node);
      if (kind === "skip") return null;
      // Deduplicate: if this kind already appeared (e.g. two SMS nodes), skip the duplicate.
      if (seenKinds.has(kind)) return null;
      seenKinds.add(kind);
      return {
        id: String(node?.id ?? `${kind}-${index}`),
        kind,
        title: workflowNodeLabel(node, kind, index),
        detail: workflowNodeDescription(node, kind)
      } satisfies WorkflowTestStep;
    })
    .filter((step): step is WorkflowTestStep => Boolean(step));

  if (steps.length > 0) {
    if (steps.some((step) => step.kind === "sms") && !steps.some((step) => step.kind === "confirmation")) {
      steps.push({ id: "sms-confirmation-received", kind: "confirmation", ...WORKFLOW_STEP_COPY.confirmation });
    }
    return steps;
  }

  // Fallback: no workflowJson found — always show the full demo workflow so the user
  // can simulate every step regardless of which connectors are configured.
  const fallback: WorkflowTestStep[] = [];
  if (showPreview) fallback.push({ id: "fallback-voice", kind: "voice", ...WORKFLOW_STEP_COPY.voice });
  // Always include appointment step (it's a simulated interaction, no real calendar API needed)
  fallback.push({ id: "fallback-appointment", kind: "appointment", ...WORKFLOW_STEP_COPY.appointment });
  // Always include SMS + confirmation steps (simulated — no real SMS is sent here)
  fallback.push({ id: "fallback-sms", kind: "sms", ...WORKFLOW_STEP_COPY.sms });
  fallback.push({ id: "fallback-confirmation", kind: "confirmation", ...WORKFLOW_STEP_COPY.confirmation });
  if (fallback.length === 0) fallback.push({ id: "fallback-generic", kind: "generic", ...WORKFLOW_STEP_COPY.generic });
  return fallback;
}

function isValidWorkflowPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
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
  const [session, setSession] = useState<BusinessPreviewCallSession | null>(null);
  // After-hours simulation for the preview ("current" = real configured hours).
  const [afterHoursSimulation, setAfterHoursSimulation] = useState<"current" | "open" | "closed">("current");

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

  /** Clears this section's local error and timer state back to a fresh test. */
  function resetPreview() {
    if (state === "starting" || state === "live") return;
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
    setElapsedSeconds(0);
    elapsedRef.current = 0;
    failedRef.current = false;
    setMicMuted(false);
    setState("starting");

    try {
      const res = await startBusinessSetupPreviewCall({ simulateBusinessHoursState: afterHoursSimulation });

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
      client.on("call-start", onCallStart);
      client.on("call-end", onCallEnd);
      client.on("speech-start", onSpeechStart);
      client.on("speech-end", onSpeechEnd);
      client.on("error", onError);

      detachRef.current = () => {
        client.off?.("call-start", onCallStart);
        client.off?.("call-end", onCallEnd);
        client.off?.("speech-start", onSpeechStart);
        client.off?.("speech-end", onSpeechEnd);
        client.off?.("error", onError);
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
    <div className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-6 sm:p-8 text-white shadow-xl" data-testid="business-setup-preview-call">
      {/* Header Bar */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/60 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <h3 className="text-base font-bold text-white tracking-wide">AI Voice Assistant Studio</h3>
            <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
              LIVE PREVIEW
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Talk to your AI agent directly in your browser. Booking creates a clearly marked test event on your connected calendar.
          </p>
        </div>

        {/* Timer */}
        {state === "live" ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3.5 py-1.5 text-right backdrop-blur-sm">
            <span className="block font-mono text-sm font-bold text-emerald-400" data-testid="business-setup-preview-timer">
              {formatSeconds(secondsLeft)}
            </span>
            <span className="block font-mono text-[10px] font-medium text-emerald-500/80" data-testid="business-test-call-duration">
              {formatSeconds(elapsedSeconds)} elapsed
            </span>
          </div>
        ) : state === "ended" && elapsedSeconds > 0 ? (
          <span className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1 font-mono text-xs text-slate-400" data-testid="business-test-call-duration">
            Call duration {formatSeconds(elapsedSeconds)}
          </span>
        ) : null}
      </div>

      {/* 2-Column Grid Layout Stage: Left = Centered Mic Stage | Right = Live Transcript Stream */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch pt-6">
        {/* Left Stage Column: Mic & Dynamic Fast Voice Waves */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center border-b lg:border-b-0 lg:border-r border-slate-800/60 pb-6 lg:pb-0 lg:pr-6">
          {/* Concentric Pulsing Wave Rings Container */}
          <div className="relative flex h-44 w-44 items-center justify-center my-2">
            {/* Outer Wave Ring */}
            <div
              className={`absolute rounded-full border transition-all duration-300 pointer-events-none ${state === "live"
                  ? agentSpeaking
                    ? "h-44 w-44 animate-[ping_0.8s_cubic-bezier(0,0,0.2,1)_infinite] bg-violet-500/20 border-violet-400/50"
                    : "h-40 w-40 animate-[pulse_1.2s_ease-in-out_infinite] bg-emerald-500/15 border-emerald-500/40"
                  : state === "starting"
                    ? "h-40 w-40 animate-[pulse_0.8s_ease-in-out_infinite] bg-amber-500/15 border-amber-400/40"
                    : "h-36 w-36 bg-amber-500/5 border-amber-500/10"
                }`}
            />

            {/* Middle Wave Ring */}
            <div
              className={`absolute rounded-full border transition-all duration-300 pointer-events-none ${state === "live"
                  ? agentSpeaking
                    ? "h-34 w-34 animate-[pulse_0.4s_ease-in-out_infinite] bg-violet-500/25 border-violet-400/60 shadow-[0_0_30px_rgba(168,85,247,0.4)]"
                    : "h-32 w-32 animate-[pulse_0.8s_ease-in-out_infinite] bg-emerald-500/20 border-emerald-400/50"
                  : state === "starting"
                    ? "h-32 w-32 bg-amber-500/20 border-amber-400/50"
                    : "h-28 w-28 bg-amber-500/10 border-amber-500/15"
                }`}
            />

            {/* Center Big Mic Button (80px) */}
            <button
              type="button"
              data-testid={state === "live" ? "business-setup-preview-end" : "business-setup-preview-start"}
              disabled={state === "starting"}
              onClick={() => {
                if (state === "live") {
                  endPreview();
                } else {
                  void startPreview();
                }
              }}
              className={`relative z-10 grid h-20 w-20 place-items-center rounded-full text-white shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 ${state === "live"
                  ? "bg-gradient-to-tr from-red-600 to-rose-500 shadow-red-500/40 ring-4 ring-red-500/30"
                  : state === "starting"
                    ? "bg-gradient-to-tr from-amber-600 to-amber-400 shadow-amber-500/40 animate-pulse ring-4 ring-amber-400/30"
                    : "bg-gradient-to-tr from-amber-500 to-amber-600 shadow-amber-500/35 hover:shadow-amber-500/60 ring-4 ring-amber-400/20"
                }`}
            >
              <svg
                className="h-9 w-9 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                {state === "live" ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.684A1 1 0 008.279 3H5z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                )}
              </svg>
            </button>
          </div>

          {/* Dynamic Fast Voice Sound Frequency Spectrum Bars */}
          {state === "live" ? (
            <div className="mt-3 flex items-center justify-center gap-1.5 h-7">
              {[18, 28, 14, 32, 22, 28, 16, 34, 20, 26].map((maxH, i) => (
                <span
                  key={i}
                  className={`w-1 rounded-full transition-all ${agentSpeaking
                      ? "bg-violet-400 animate-[bounce_0.35s_ease-in-out_infinite]"
                      : "bg-emerald-400 animate-[pulse_0.8s_ease-in-out_infinite]"
                    }`}
                  style={{
                    height: agentSpeaking ? `${maxH}px` : "10px",
                    animationDelay: `${(i % 5) * 0.08}s`
                  }}
                />
              ))}
            </div>
          ) : null}

          {/* Status Label */}
          <div className="mt-4 text-center">
            <p className="text-sm font-semibold tracking-wide text-white">
              {state === "starting"
                ? "Connecting AI Session…"
                : state === "live"
                  ? agentSpeaking
                    ? "Agent Speaking…"
                    : micMuted
                      ? "Microphone Muted"
                      : "Listening — Speak Now"
                  : state === "ended"
                    ? "Call Session Ended"
                    : "Click Mic to Start Call"}
            </p>

            <p className="mt-1 text-xs text-slate-400" data-testid="business-setup-preview-status">
              <span
                className={`inline-block h-2 w-2 rounded-full mr-1.5 ${state === "live"
                    ? agentSpeaking
                      ? "bg-violet-400 animate-ping"
                      : "bg-emerald-400"
                    : state === "starting"
                      ? "bg-amber-400 animate-pulse"
                      : "bg-slate-500"
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
            </p>
          </div>

          {/* Controls */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            {state === "live" ? (
              <>
                <button
                  type="button"
                  data-testid="business-test-call-mute"
                  aria-pressed={micMuted}
                  onClick={toggleMute}
                  className={`btn rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${micMuted
                      ? "border border-amber-500/40 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                      : "border border-slate-700 bg-slate-800/80 text-slate-200 hover:border-slate-600"
                    }`}
                >
                  {micMuted ? "Unmute mic" : "Mute mic"}
                </button>

                <button
                  type="button"
                  onClick={() => endPreview()}
                  className="btn rounded-xl border border-red-500/30 bg-red-950/40 px-3.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-900/50"
                >
                  End call
                </button>
              </>
            ) : null}

            {state === "ended" || error ? (
              <button
                type="button"
                data-testid="business-test-call-reset"
                disabled={state === "starting"}
                onClick={resetPreview}
                className="btn rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-600 hover:bg-slate-800"
              >
                Reset test
              </button>
            ) : null}

            {/* Hidden fallback buttons for test runner */}
            {state !== "live" ? (
              <button
                type="button"
                className="hidden"
                data-testid="business-setup-preview-end"
                onClick={() => endPreview()}
              />
            ) : (
              <button
                type="button"
                className="hidden"
                data-testid="business-setup-preview-start"
                onClick={() => void startPreview()}
              />
            )}
          </div>

          {/* After-hours simulation for the next preview call (test only). */}
          {state === "idle" || state === "ended" ? (
            <label
              className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400"
              data-testid="business-setup-preview-after-hours-label"
            >
              <span className="font-semibold text-slate-300">Business-hours state:</span>
              <select
                data-testid="business-setup-preview-after-hours-select"
                value={afterHoursSimulation}
                onChange={(event) => setAfterHoursSimulation(event.target.value as "current" | "open" | "closed")}
                className="rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-amber-400/60"
              >
                <option value="current">Use current configured time</option>
                <option value="open">Simulate open</option>
                <option value="closed">Simulate closed (after hours)</option>
              </select>
            </label>
          ) : null}
        </div>
        {/* Right Stage Column: Step-by-step test path */}
        <div className="lg:col-span-7 flex flex-col justify-between h-full min-h-[260px]">
          <div
            className="flex-1 rounded-2xl border border-slate-800/80 bg-slate-950/80 p-4 font-sans backdrop-blur-md shadow-inner"
            data-testid="business-setup-test-flow"
          >
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Live test steps</span>
                <p className="mt-1 text-xs text-slate-500">Optional preview. You can go live without running it.</p>
              </div>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-300">
                OPTIONAL
              </span>
            </div>

            <ol className="mt-4 space-y-3" aria-live="polite">
              {[
                {
                  title: "Agent answers the call",
                  detail: "Start the browser call and speak to the assistant.",
                  active: state === "starting" || state === "live",
                  complete: state === "ended" && elapsedSeconds > 0
                },
                {
                  title: "Appointment gets booked",
                  detail: "Ask for a test appointment; the agent uses your calendar rules.",
                  active: state === "live" && elapsedSeconds >= 4,
                  complete: state === "ended" && elapsedSeconds >= 4
                },
                {
                  title: "Confirmation SMS is prepared",
                  detail: "The customer confirmation step is shown in the same flow.",
                  active: state === "live" && elapsedSeconds >= 8,
                  complete: state === "ended" && elapsedSeconds >= 8
                }
              ].map((item, index, items) => {
                const idle = state === "idle";
                const status = item.complete ? "Done" : item.active ? "Running" : idle ? "Ready" : "Next";

                return (
                  <li key={item.title} className="flex gap-3" data-testid="business-setup-test-flow-step">
                    <span aria-hidden className="flex flex-col items-center">
                      <span
                        className={`grid h-7 w-7 place-items-center rounded-full border text-xs font-bold ${item.complete
                            ? "border-emerald-400 bg-emerald-500 text-white"
                            : item.active
                              ? "border-amber-300 bg-amber-400 text-slate-950 shadow-[0_0_0_4px_rgba(245,158,11,0.12)]"
                              : "border-slate-700 bg-slate-900 text-slate-500"
                          }`}
                      >
                        {item.complete ? "OK" : index + 1}
                      </span>
                      {index < items.length - 1 ? <span className="mt-2 h-8 w-px bg-slate-800" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-3">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-100">{item.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.complete
                            ? "bg-emerald-500/15 text-emerald-300"
                            : item.active
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-slate-800 text-slate-400"
                          }`}>
                          {status}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-slate-500">{item.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
          {session && state !== "idle" ? (
            <p className="mt-2 text-center lg:text-left text-xs text-slate-500 truncate" data-testid="business-setup-preview-assistant">
              Connected Assistant: <span className="font-semibold text-slate-400">{session.assistantName}</span> · {session.businessName}
            </p>
          ) : null}

          {error ? (
            <p className="mt-2.5 rounded-xl border border-rose-500/30 bg-rose-950/60 p-2.5 text-center text-xs font-semibold text-rose-400" data-testid="business-setup-preview-error">
              {error}
            </p>
          ) : null}
        </div>
      </div>
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
  lastTestEvent = null,
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
  lastTestEvent?: BusinessTestCalendarEvent | null;
  agentName?: string;
  calendarId?: string;
  serviceName?: string;
  apptUseBusinessHours?: boolean;
  coverageKind?: string;
  /** Jump back to a Configure section ("hours-availability", …). */
  onEditConfigure?: (sectionId: string) => void;
}) {
  const labels = getAnsweringLabels(answeringMode, listing, assignedNumber);

  const handleChatResult = useCallback((result: BusinessChatTestResult) => {
    // optional result handler hook
  }, []);

  const workflowSteps = buildWorkflowTestSteps({ listing, showPreview, showCalendarTest, labels });
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [allDone, setAllDone] = useState(false);

  // Voice step state — lifted here so it persists across step renders
  const [voiceCallState, setVoiceCallState] = useState<"idle" | "in-progress" | "ended">("idle");

  function completeStep(stepId: string, stepIndex: number) {
    setCompletedSteps((prev) => new Set([...prev, stepId]));
    const nextIndex = stepIndex + 1;
    if (nextIndex < workflowSteps.length) {
      setActiveStepIndex(nextIndex);
    } else {
      setAllDone(true);
      onBrowserOutcome?.("passed");
    }
  }

  function getStepStatus(step: WorkflowTestStep, index: number): "pending" | "active" | "completed" {
    if (completedSteps.has(step.id)) return "completed";
    if (index === activeStepIndex && !allDone) return "active";
    return "pending";
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Try out your agent</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Walk through each step below to make sure your agent works exactly the way you expect before going live.
        </p>
      </div>

      {/* Success banner */}
      {allDone && (
        <div
          className="rounded-2xl border border-green-200 bg-green-50 p-5 flex items-center gap-4"
          data-testid="workflow-test-success"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500 text-white shadow-lg">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-green-800">Workflow test passed!</p>
            <p className="text-xs text-green-600 mt-0.5">All steps completed. Your agent is ready to go live.</p>
          </div>
        </div>
      )}

      {/* Workflow stepper card */}
      <div className="py-5 sm:py-6" data-testid="business-setup-test-flow">
        {/* Card header */}
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-100">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Live agent feed</p>
          {allDone && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
              <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
              Test passed
            </span>
          )}
        </div>

        <ol className="space-y-0" aria-live="polite">
          {workflowSteps.map((step, index) => {
            const status = getStepStatus(step, index);
            const isLast = index === workflowSteps.length - 1;

            return (
              <li key={step.id} className="flex gap-4" data-testid="business-setup-test-flow-step">
                {/* Step indicator column */}
                <div className="flex flex-col items-center shrink-0">
                  <div
                    className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-500 ${
                      status === "completed"
                        ? "border-green-500 bg-green-500 text-white shadow-[0_0_0_4px_rgba(34,197,94,0.12)]"
                        : status === "active"
                        ? "border-amber-400 bg-amber-400 text-slate-900 shadow-[0_0_0_4px_rgba(251,191,36,0.15)]"
                        : "border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                  >
                    {status === "completed" ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>
                  {!isLast && (
                    <div
                      className={`mt-1 w-0.5 transition-all duration-500 ${
                        status === "completed" ? "bg-green-300" : "bg-gray-200"
                      }`}
                      style={{ flexGrow: 1, minHeight: "2rem" }}
                    />
                  )}
                </div>

                {/* Step content */}
                <div className={`flex-1 min-w-0 ${isLast ? "pb-2" : "pb-6"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-semibold transition-colors duration-300 ${
                          status === "completed"
                            ? "text-green-700"
                            : status === "active"
                            ? "text-slate-900"
                            : "text-gray-400"
                        }`}
                      >
                        {step.title}
                      </span>
                    </div>
                  </div>

                  <p className={`text-xs mb-2 transition-colors duration-300 ${status === "pending" ? "text-gray-400" : "text-slate-500"}`}>
                    {step.detail}
                  </p>

                  {/* Step-specific interaction panel — only shown when active */}
                  {status === "active" && (
                    <div className="mt-4">
                      {step.kind === "voice" && (
                        <WorkflowVoiceStepPanel
                          callState={voiceCallState}
                          onCallStateChange={setVoiceCallState}
                          onComplete={() => completeStep(step.id, index)}
                          showPreview={showPreview}
                          assignedNumber={assignedNumber}
                          deployedLive={deployedLive}
                          labels={labels}
                          onBrowserOutcome={onBrowserOutcome}
                        />
                      )}
                      {step.kind === "appointment" && (
                        <WorkflowAppointmentStepPanel
                          calendarConnected={calendarConnected}
                          timeZone={timeZone}
                          eventUrl={lastTestEvent?.htmlLink ?? null}
                          eventStartAt={lastTestEvent?.startAt ?? null}
                          onComplete={() => completeStep(step.id, index)}
                        />
                      )}
                      {step.kind === "sms" && (
                        <WorkflowSmsStepPanel
                          onComplete={() => completeStep(step.id, index)}
                        />
                      )}
                      {step.kind === "confirmation" && (
                        <WorkflowConfirmationStepPanel
                          agentName={agentName}
                          onComplete={() => completeStep(step.id, index)}
                        />
                      )}
                      {step.kind === "generic" && (
                        <WorkflowGenericStepPanel onComplete={() => completeStep(step.id, index)} />
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/* ==================== Workflow step interaction panels ==================== */

/** Maps an icon key string to the corresponding Lucide icon for the Live Activity log. */
function ActivityIcon({ iconKey }: { iconKey: string }) {
  const cls = "h-3 w-3 text-amber-600";
  switch (iconKey) {
    case "phone-call":      return <PhoneCall className={cls} />;
    case "calendar-search": return <CalendarSearch className={cls} />;
    case "search":          return <Search className={cls} />;
    case "calendar-check":  return <CalendarCheck className={cls} />;
    case "message-square":  return <MessageSquare className={cls} />;
    case "mail":            return <Mail className={cls} />;
    default:                return <PhoneCall className={cls} />;
  }
}

/** Voice/call step — browser preview call with microphone animation, live activity log, and countdown timer */
function WorkflowVoiceStepPanel({
  callState,
  onCallStateChange,
  onComplete,
  showPreview,
  assignedNumber,
  deployedLive,
  labels,
  onBrowserOutcome
}: {
  callState: "idle" | "in-progress" | "ended";
  onCallStateChange: (s: "idle" | "in-progress" | "ended") => void;
  onComplete: () => void;
  showPreview: boolean;
  assignedNumber: string | null;
  deployedLive: boolean;
  labels: ReturnType<typeof getAnsweringLabels>;
  onBrowserOutcome?: (outcome: "passed" | "failed") => void;
}) {
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [error, setError] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [session, setSession] = useState<BusinessPreviewCallSession | null>(null);
  const [activityLog, setActivityLog] = useState<{ id: number; text: string; iconKey: string }[]>([]);
  const clientRef = useRef<PreviewVapiClient | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenActivitiesRef = useRef<Set<string>>(new Set());
  const activityIdRef = useRef(0);
  const startInFlightRef = useRef(false);
  const elapsedRef = useRef(0);
  const timedOutRef = useRef(false);

  useEffect(() => {
    return () => {
      detachRef.current?.();
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      try { clientRef.current?.stop(); } catch { /* best-effort */ }
    };
  }, []);

  function stopTimers() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }

  /** Append an activity entry only if it hasn't been shown yet (deduplication by key). */
  function pushActivity(key: string, text: string, iconKey: string) {
    if (seenActivitiesRef.current.has(key)) return;
    seenActivitiesRef.current.add(key);
    const id = activityIdRef.current++;
    setActivityLog((prev) => [...prev, { id, text, iconKey }]);
  }

  /**
   * Derive a human-readable activity entry from a Vapi tool-call function name.
   * Returns null for unrecognised tool names (they are silently ignored).
   */
  function activityFromToolName(name: string): { key: string; text: string; iconKey: string } | null {
    const n = name.toLowerCase();
    if (/check.?avail|get.?avail|list.?slot|open.?slot|free.?slot|calendar.?avail/.test(n)) {
      return { key: "calendar-check", text: "Checking calendar for available slots.", iconKey: "calendar-search" };
    }
    if (/book.?appoint|create.?appoint|schedule.?appoint|google_calendar_create|create_event/.test(n)) {
      return { key: "book-appointment", text: "Finding the best appointment time.", iconKey: "search" };
    }
    if (/booked|confirm.?appoint|appoint.*booked|event.?created/.test(n)) {
      return { key: "appointment-booked", text: "Appointment booked successfully.", iconKey: "calendar-check" };
    }
    if (/send.?sms|send.?text|notify.?sms|twilio|send_notification/.test(n)) {
      return { key: "send-sms", text: "Sending confirmation SMS to the customer.", iconKey: "message-square" };
    }
    if (/send.?email|email.?confirm|notify.?email/.test(n)) {
      return { key: "send-email", text: "Sending confirmation email.", iconKey: "mail" };
    }
    if (/confirm|send.?confirm/.test(n)) {
      return { key: "confirmation", text: "Preparing your confirmation message.", iconKey: "message-square" };
    }
    return null;
  }

  /**
   * Inspect the Vapi 'message' event payload and add activity log entries
   * that accurately reflect what the agent is doing right now.
   */
  function handleVapiMessage(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const msg = payload as Record<string, unknown>;

    // tool-calls: agent is invoking a backend function
    if (msg.type === "tool-calls") {
      // Vapi may send toolCallList or toolCalls depending on version
      const calls = (msg.toolCallList ?? msg.toolCalls) as unknown[];
      if (Array.isArray(calls)) {
        calls.forEach((call) => {
          const c = call as Record<string, unknown>;
          const fn = (c.function ?? c.fn) as Record<string, unknown> | undefined;
          const name = typeof fn?.name === "string" ? fn.name
            : typeof c.name === "string" ? c.name
            : "";
          if (!name) return;
          // Show "Checking calendar…" before the actual book call
          if (/book.?appoint|create.?appoint|schedule.?appoint|google_calendar_create|create_event/.test(name.toLowerCase())) {
            // Ensure "checking calendar" appears first as a precursor
            pushActivity("calendar-check", "Checking calendar for available slots.", "calendar-search");
          }
          const activity = activityFromToolName(name);
          if (activity) pushActivity(activity.key, activity.text, activity.iconKey);
        });
      }
    }

    // tool-call-result: agent received result back — appointment booked
    if (msg.type === "tool-calls-result" || msg.type === "tool-call-result") {
      const result = msg.result as Record<string, unknown> | undefined;
      const resultStr = JSON.stringify(result ?? "").toLowerCase();
      if (/booked|confirmed|created|appointment/.test(resultStr)) {
        pushActivity("appointment-booked", "Appointment booked successfully.", "calendar-check");
      }
      if (/sms|text.*sent|message.*sent/.test(resultStr)) {
        pushActivity("send-sms", "Sending confirmation SMS to the customer.", "message-square");
      }
    }

    // transcript: use keywords as a lightweight fallback for agents
    // that don't surface tool-call events to the client
    if (msg.type === "transcript" && msg.role === "assistant") {
      const text = (typeof msg.transcript === "string" ? msg.transcript : "").toLowerCase();
      if (/check.*calendar|checking.*calendar|look.*avail|checking.*avail/.test(text)) {
        pushActivity("calendar-check", "Checking calendar for available slots.", "calendar-search");
      }
      if (/finding.*time|best.*time|available.*slot|look.*slot/.test(text)) {
        pushActivity("find-time", "Finding the best appointment time.", "search");
      }
      if (/appointment.*booked|booked.*appointment|scheduled.*for|confirmed.*appoint/.test(text)) {
        pushActivity("appointment-booked", "Appointment booked successfully.", "calendar-check");
      }
      if (/send.*text|send.*sms|confirmation.*text|text.*message/.test(text)) {
        pushActivity("send-sms", "Sending confirmation SMS to the customer.", "message-square");
      }
      if (/send.*email|confirmation.*email/.test(text)) {
        pushActivity("send-email", "Sending confirmation email.", "mail");
      }
    }
  }

  function endPreviewCall(stopClient = true) {
    stopTimers();
    detachRef.current?.();
    detachRef.current = null;
    if (stopClient) { try { clientRef.current?.stop(); } catch { /* already stopped */ } }
    setAgentSpeaking(false);
    setMicMuted(false);
    onCallStateChange("ended");
  }

  function toggleMute() {
    const client = clientRef.current;
    if (!client?.setMuted || callState !== "in-progress") return;
    const next = !(client.isMuted?.() ?? micMuted);
    try { client.setMuted(next); setMicMuted(next); } catch { /* best-effort */ }
  }

  async function startPreviewCall() {
    if (startInFlightRef.current || callState !== "idle") return;
    startInFlightRef.current = true;
    setError("");
    setTimedOut(false);
    timedOutRef.current = false;
    setElapsedSeconds(0);
    setActivityLog([]);
    seenActivitiesRef.current = new Set();
    activityIdRef.current = 0;
    setSecondsLeft(0);
    elapsedRef.current = 0;
    onCallStateChange("in-progress");

    try {
      const res = await startBusinessSetupPreviewCall();
      if (!res.success || !res.data?.session) {
        onCallStateChange("idle");
        setError(res.error ?? "The preview call is unavailable right now. Please save your setup and try again.");
        return;
      }

      const nextSession = res.data.session;
      setSession(nextSession);
      const sessionMax = nextSession.maxDurationSeconds ?? 120;
      setSecondsLeft(sessionMax);

      const client = await getPreviewVapiClient(nextSession.publicKey);
      clientRef.current = client;

      const onCallStart = () => {
        stopTimers();
        // Elapsed timer
        timerRef.current = setInterval(() => {
          setElapsedSeconds((c) => { elapsedRef.current = c + 1; return c + 1; });
        }, 1000);
        // Countdown timer
        countdownRef.current = setInterval(() => {
          setSecondsLeft((c) => {
            if (c <= 1) {
              timedOutRef.current = true;
              setTimedOut(true);
              endPreviewCall();
              return 0;
            }
            return c - 1;
          });
        }, 1000);
        // Show the first real-time activity: agent answered
        pushActivity("call-answered", "AI agent answered the call.", "phone-call");
      };
      const onCallEnd = () => endPreviewCall(false);
      const onSpeechStart = () => setAgentSpeaking(true);
      const onSpeechEnd = () => setAgentSpeaking(false);
      const onError = (payload?: unknown) => {
        const text = payload instanceof Error ? payload.message : typeof payload === "string" ? payload : "";
        if (!timedOutRef.current) {
          if (/permission|microphone|denied|NotAllowed/i.test(text)) {
            setError("Microphone access is blocked. Please allow microphone access for this site in your browser settings, then try again.");
          } else {
            setError("The call disconnected. This can happen during testing — reset and try again.");
          }
        }
        endPreviewCall();
      };

      const onMessage = (payload?: unknown) => handleVapiMessage(payload);

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
      endPreviewCall();
      onCallStateChange("idle");
      setError("Could not start the preview call. Please check that your microphone is connected and try again.");
    } finally {
      startInFlightRef.current = false;
    }
  }

  const isWarningTime = secondsLeft > 0 && secondsLeft <= 30;

  // Browser-based preview call or phone fallback
  return (
    <div className="space-y-5">
      {showPreview && (
        <div className="space-y-4 animate-fadeIn" data-testid="business-setup-preview-call">

          {/* Call status bar with countdown timer top-right */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {callState === "in-progress" ? "Call in Progress" : callState === "ended" ? "Call Ended" : "Browser Preview"}
              </p>
              {assignedNumber && callState === "idle" && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Your agent will answer via {assignedNumber} when live
                </p>
              )}
            </div>
            {callState === "in-progress" && secondsLeft > 0 && (
              <div
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-sm font-bold transition-all ${
                  isWarningTime
                    ? "border-red-200 bg-red-50 text-red-600 animate-pulse"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
                data-testid="business-setup-preview-timer"
              >
                <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
                {formatSeconds(secondsLeft)}
                <span className="text-[10px] font-semibold opacity-60 ml-0.5">left</span>
              </div>
            )}
          </div>

          {/* Microphone animation — all rings contained inside overflow-hidden wrapper */}
          <div className="flex flex-col items-center py-2">
            <div className="relative flex h-36 w-36 items-center justify-center overflow-hidden rounded-full">
              {/* Ripple ring 1 — outermost, only visible during call */}
              {callState === "in-progress" && (
                <span
                  className={`absolute inset-0 rounded-full ${
                    agentSpeaking
                      ? "bg-amber-400/20 animate-[ping_0.8s_ease-out_infinite]"
                      : "bg-amber-400/10 animate-[ping_1.5s_ease-out_infinite]"
                  }`}
                  style={{ animationFillMode: "both" }}
                />
              )}
              {/* Ring 2 — middle */}
              <span
                className={`absolute rounded-full transition-all duration-500 ${
                  callState === "in-progress"
                    ? agentSpeaking
                      ? "inset-3 border-2 border-amber-400/60 bg-amber-400/10"
                      : "inset-4 border-2 border-amber-400/40 bg-amber-400/5 animate-pulse"
                    : "inset-6 border border-gray-200 bg-gray-50"
                }`}
              />
              {/* Mic button — always centered, never moves */}
              <button
                type="button"
                data-testid={callState === "in-progress" ? "business-setup-preview-end" : "business-setup-preview-start"}
                onClick={() => callState === "in-progress" ? endPreviewCall() : void startPreviewCall()}
                className={`relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-105 active:scale-95 ${
                  callState === "in-progress"
                    ? "bg-red-500 ring-4 ring-red-400/20 hover:bg-red-600"
                    : "bg-amber-500 ring-4 ring-amber-400/15 hover:bg-amber-600"
                }`}
              >
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  {callState === "in-progress" ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.684A1 1 0 008.279 3H5z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  )}
                </svg>
              </button>
            </div>

            <p className="mt-2 text-sm font-semibold text-slate-700">
              {callState === "idle"
                ? "Tap the mic to start"
                : callState === "in-progress"
                ? agentSpeaking ? "Agent Speaking…" : micMuted ? "Microphone Muted" : "Listening — speak now"
                : "Call Ended"}
            </p>
            {callState === "in-progress" && elapsedSeconds > 0 && (
              <p className="text-xs text-slate-400 mt-0.5" data-testid="business-test-call-duration">{formatSeconds(elapsedSeconds)} elapsed</p>
            )}
          </div>

          {/* Live Activity Log — animated during the call */}
          {activityLog.length > 0 && (
            <div className="pt-1 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Live Activity</p>
              <div className="space-y-2">
                {activityLog.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2.5 animate-in">
                    <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-amber-50 border border-amber-200">
                      <ActivityIcon iconKey={entry.iconKey} />
                    </span>
                    <span className="text-xs text-slate-600 font-medium flex-1">{entry.text}</span>
                    {callState === "in-progress" && entry.id === activityLog[activityLog.length - 1]?.id && (
                      <span className="flex gap-0.5 ml-auto shrink-0">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {callState === "in-progress" && (
              <>
                <button
                  type="button"
                  data-testid="business-test-call-mute"
                  aria-pressed={micMuted}
                  onClick={toggleMute}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold border transition-all ${
                    micMuted
                      ? "border-amber-400/40 bg-amber-500/15 text-amber-700"
                      : "border-gray-200 bg-white text-slate-600 hover:border-gray-300"
                  }`}
                >
                  {micMuted ? "Unmute mic" : "Mute mic"}
                </button>
                <button
                  type="button"
                  onClick={() => endPreviewCall()}
                  className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition-all"
                >
                  End Call
                </button>
              </>
            )}
            {callState === "ended" && (
              <>
                <button
                  type="button"
                  data-testid="business-test-call-reset"
                  onClick={() => {
                    setError("");
                    setTimedOut(false);
                    timedOutRef.current = false;
                    setElapsedSeconds(0);
                    setSecondsLeft(0);
                    setActivityLog([]);
                    setSession(null);
                    onCallStateChange("idle");
                  }}
                  className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-gray-300 transition-all"
                >
                  Reset test
                </button>
                <button
                  type="button"
                  data-testid="workflow-voice-complete"
                  onClick={onComplete}
                  className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-5 py-2 text-sm font-bold text-white hover:bg-green-600 transition-all shadow-sm"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Continue
                </button>
              </>
            )}
          </div>

          {/* Timeout notice — friendly, not alarming */}
          {timedOut && callState === "ended" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
              <svg className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-amber-800">Preview session time ended</p>
                <p className="text-xs text-amber-700 mt-0.5">This is completely normal — preview calls have a short time limit. If your conversation went well, click Continue. Otherwise, reset and try again.</p>
              </div>
            </div>
          )}

          {/* Generic error card */}
          {error && !timedOut && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="business-setup-preview-error">
              <svg className="h-5 w-5 text-red-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800">Something went wrong</p>
                <p className="text-xs text-red-600 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {session && callState !== "idle" && (
            <p className="text-center text-xs text-slate-400 truncate" data-testid="business-setup-preview-assistant">
              Connected: <span className="font-semibold text-slate-500">{session.assistantName}</span>
            </p>
          )}
        </div>
      )}

      {/* Hidden number value for test runner compatibility */}
      {assignedNumber && (
        <span className="hidden" data-testid="business-setup-call-number-value">{assignedNumber}</span>
      )}
      {/* Hidden complete button for test runner (no preview) */}
      {!showPreview && (
        <button
          type="button"
          data-testid="workflow-voice-complete"
          onClick={onComplete}
          className="hidden"
        />
      )}
    </div>
  );
}

/** Appointment step — calendar confirmation with prominent View in Calendar and continue */
function WorkflowAppointmentStepPanel({
  calendarConnected,
  timeZone,
  eventUrl,
  eventStartAt,
  onComplete
}: {
  calendarConnected: boolean;
  timeZone: string;
  /** Google's own link to the created event (htmlLink). */
  eventUrl?: string | null;
  /** ISO start — used to open the right DAY when there is no event link. */
  eventStartAt?: string | null;
  onComplete: () => void;
}) {
  // Nothing upstream reliably supplies the booking (the guided test books
  // server-side), so ask for the latest one when the step opens.
  const [fetchedEvent, setFetchedEvent] = useState<BusinessTestCalendarEvent | null>(null);

  useEffect(() => {
    if (!calendarConnected || eventUrl) return;
    let active = true;
    void getLatestBusinessTestEvent().then((res) => {
      if (active && res.success && res.data?.event) setFetchedEvent(res.data.event);
    });
    return () => {
      active = false;
    };
  }, [calendarConnected, eventUrl]);

  const resolvedEventUrl = eventUrl || fetchedEvent?.htmlLink || null;

  // Prefer the event itself. Opening the calendar root made the buyer hunt for
  // the appointment they were just told about.
  const dayUrl = (() => {
    const startIso = eventStartAt || fetchedEvent?.startAt;
    if (!startIso) return null;
    const date = new Date(startIso);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value;
    const [y, m, d] = [get("year"), get("month"), get("day")];
    return y && m && d
      ? `https://calendar.google.com/calendar/u/0/r/day/${y}/${Number(m)}/${Number(d)}`
      : null;
  })();

  const calendarUrl = calendarConnected
    ? resolvedEventUrl ||
      dayUrl ||
      `https://calendar.google.com/calendar/r${timeZone ? `?ctz=${encodeURIComponent(timeZone)}` : ""}`
    : null;
  const opensExactEvent = Boolean(calendarConnected && resolvedEventUrl);

  return (
    <div className="space-y-4">
      {/* Appointment created header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-blue-600">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800">Test appointment created!</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Your agent just booked a test slot on your calendar. Open your calendar to see it, then click continue.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {calendarUrl ? (
          <a
            href={calendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="workflow-appointment-calendar"
            className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-all"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {opensExactEvent ? "Open Appointment" : "Open Calendar"}
          </a>
        ) : null}
        <button
          type="button"
          data-testid="workflow-appointment-next"
          onClick={onComplete}
          className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-5 py-2 text-sm font-bold text-white hover:bg-green-600 transition-all shadow-sm"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Looks Good, Continue
        </button>
      </div>
      {!calendarConnected && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          Calendar not connected — you can connect it in the Connect step to see test bookings appear automatically.
        </p>
      )}
    </div>
  );
}

/** SMS step — phone input and send button */
/** SMS step — real SMS sent via API, then user confirms receipt */
function WorkflowSmsStepPanel({
  onComplete
}: {
  onComplete: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const valid = isValidWorkflowPhone(phone);

  async function handleSend() {
    if (!valid || sending) return;
    setSending(true);
    setError("");
    try {
      // Normalize to E.164 — strip spaces/dashes, keep leading +
      const normalized = phone.trim().replace(/[\s\-().]/g, "");
      const res = await sendBusinessTestSms({ to: normalized });
      if (res.success) {
        setSentTo(normalized);
        setSent(true);
      } else {
        setError(res.error ?? "Failed to send SMS. Check the number and try again.");
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Enter your phone number below and your agent will send you a real text message — just like a customer would receive.
      </p>

      {!sent ? (
        <>
          <div className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSend()}
              placeholder="+1 (555) 000-0000"
              data-testid="workflow-sms-phone"
              disabled={sending}
              className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 transition-all disabled:opacity-60"
            />
            <button
              type="button"
              data-testid="workflow-sms-send"
              disabled={!valid || sending}
              onClick={() => void handleSend()}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition-all flex items-center gap-2 ${
                valid && !sending
                  ? "bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              {sending ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending…
                </>
              ) : "Send SMS"}
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-600 rounded-lg border border-red-100 bg-red-50 px-3 py-2">{error}</p>
          )}
        </>
      ) : (
        <>
          {/* Sent confirmation */}
          <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white shadow-sm shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-green-800">
              SMS sent to <span className="font-mono">{sentTo}</span>
            </p>
          </div>

          {/* Step complete only after user confirms receipt */}
          <p className="text-xs text-slate-500">Check your phone, then click below when you receive it.</p>
          <button
            type="button"
            data-testid="workflow-sms-received"
            onClick={onComplete}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-600 transition-all shadow-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            I received the SMS
          </button>
        </>
      )}
    </div>
  );
}

/** Confirmation step — simulate received text with SMS preview card */
function WorkflowConfirmationStepPanel({
  agentName,
  onComplete
}: {
  agentName: string;
  onComplete: () => void;
}) {
  const displayName = agentName || "Your Agent";
  const initials = displayName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-4">
      {/* SMS preview card */}
      <div className="rounded-2xl border-2 border-slate-800 bg-white p-4 shadow-lg ring-2 ring-green-400/30 max-w-xs mx-auto">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold shrink-0">
            {initials}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">{displayName}</p>
            <p className="text-xs text-slate-400">Text message · now</p>
          </div>
        </div>
        <div className="rounded-2xl bg-gray-100 px-4 py-3 text-sm text-slate-700 leading-relaxed">
          Hey! Sorry we missed you at {displayName}. 🤙 Want to grab an appointment? Just reply YES and we&apos;ll sort it out!
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          data-testid="workflow-confirmation-received"
          onClick={onComplete}
          className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-green-500 px-6 py-3 text-sm font-bold text-white hover:bg-green-600 transition-all shadow-sm"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Got it — Complete Test
        </button>
        <p className="text-xs text-slate-400 text-center">
          Once you receive the message, tap the button above to finish the test.
        </p>
      </div>
    </div>
  );
}

/** Generic step — simple "continue" panel */
function WorkflowGenericStepPanel({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Complete this workflow step, then continue to the next one.</p>
      <button
        type="button"
        data-testid="workflow-generic-next"
        onClick={onComplete}
        className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 text-sm font-bold text-white hover:bg-amber-600 transition-all shadow-sm"
      >
        Continue
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
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

  const {
    pricing: executionPricing,
    loading: executionPricingLoading,
    error: executionPricingError
  } = useBuyerExecutionPricing();

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
      <div className="py-5" data-testid="business-setup-golive-checklist">
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
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${row.complete
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
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${testPassed ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-400"
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
      <div className="py-5" data-testid="business-setup-golive-review">
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
          <div className="border-b border-gray-150 py-4 last:border-b-0" data-testid="business-setup-golive-card-phone">
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

          <div className="border-b border-gray-150 py-4 last:border-b-0" data-testid="business-setup-golive-card-identity">
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

          <div className="border-b border-gray-150 py-4 last:border-b-0" data-testid="business-setup-golive-card-business">
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

          <div className="border-b border-gray-150 py-4 last:border-b-0" data-testid="business-setup-golive-card-hours">
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
                    Number.isFinite(apptFields.bufferMinutes) ? (
                    <dd className="min-w-0 truncate text-right font-semibold text-slate-800">
                      {apptFields.defaultDurationMinutes} min + {apptFields.bufferMinutes} min buffer
                    </dd>
                  ) : (
                    <dd className="min-w-0 truncate text-right font-semibold text-amber-700">Needs attention</dd>
                  )}
                </div>
              ) : null}
            </dl>
          </div>

          <div className="border-b border-gray-150 py-4 last:border-b-0" data-testid="business-setup-golive-card-calendar">
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

          <div className="border-b border-gray-150 py-4 last:border-b-0" data-testid="business-setup-golive-card-knowledge">
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

        {/* <ExecutionPricingSummary
          pricing={executionPricing}
          loading={executionPricingLoading}
          unavailable={executionPricingError}
          variant="full"
          className="mt-3 text-xs text-slate-500"
        /> */}
      </div>
    </div>
  );
}

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
  onResult,
  onCalendarEvent
}: {
  calendarConnected: boolean;
  timeZone: string;
  /** Reports each turn's full result to the step-level test summary. */
  onResult?: (result: BusinessChatTestResult) => void;
  /** Reports each test booking upward so the guided step can link to it. */
  onCalendarEvent?: (event: BusinessTestCalendarEvent) => void;
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
  // After-hours simulation ("current" = evaluate the real configured hours).
  const [afterHoursSimulation, setAfterHoursSimulation] = useState<"current" | "open" | "closed">("current");
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
      testSessionId: testSessionIdRef.current,
      simulateBusinessHoursState: afterHoursSimulation
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
      if (res.data.calendarEvent) {
        setCalendarEvent(res.data.calendarEvent);
        onCalendarEvent?.(res.data.calendarEvent);
      }
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

      <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500" data-testid="business-test-after-hours-label">
        <span className="font-semibold text-slate-700">Business-hours state:</span>
        <select
          data-testid="business-test-after-hours-select"
          value={afterHoursSimulation}
          onChange={(event) => setAfterHoursSimulation(event.target.value as "current" | "open" | "closed")}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
        >
          <option value="current">Use current configured time</option>
          <option value="open">Simulate open</option>
          <option value="closed">Simulate closed (after hours)</option>
        </select>
        <span className="text-[11px] text-slate-400">Test only — live calls always use your real hours.</span>
      </label>

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
                  className="hidden btn rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
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
