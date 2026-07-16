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
.setup-root { --ease: cubic-bezier(.16, 1, .3, 1); }
.setup-root .field { transition: border-color .2s var(--ease), box-shadow .2s var(--ease), background-color .2s var(--ease); }
.setup-root .field:focus { border-color: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, .15); }
.setup-root .btn { transition: transform .15s ease, box-shadow .25s var(--ease), background-color .2s ease, border-color .2s ease, color .2s ease; }
.setup-root .btn:not(:disabled):hover { transform: translateY(-1px); }
.setup-root .btn:not(:disabled):active { transform: translateY(0) scale(.99); }
.setup-root .btn:disabled { opacity: .5; cursor: not-allowed; }
.setup-root .pick { transition: border-color .2s var(--ease), background-color .2s var(--ease), box-shadow .2s var(--ease); }
.setup-root .pick:hover { border-color: #fcd34d; }
.setup-root .pick.selected { border-color: #f59e0b; background: #fffbeb; box-shadow: 0 0 0 4px rgba(245, 158, 11, .12); }
.setup-root .animate-in { animation: setupIn .35s var(--ease); }
@keyframes setupIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.setup-root .pop-in { animation: setupPop .4s var(--ease); }
@keyframes setupPop { 0% { opacity: 0; transform: scale(.6); } 60% { transform: scale(1.08); } 100% { opacity: 1; transform: scale(1); } }
.setup-root .stagger > * { opacity: 0; transform: translateY(12px); animation: setupIn .55s var(--ease) forwards; }
.setup-root .stagger > *:nth-child(1) { animation-delay: .1s; }
.setup-root .stagger > *:nth-child(2) { animation-delay: .22s; }
.setup-root .stagger > *:nth-child(3) { animation-delay: .34s; }
.setup-root .confetti-piece { position: fixed; top: -12px; z-index: 60; border-radius: 2px; pointer-events: none; animation-name: setupConfetti; animation-timing-function: linear; animation-fill-mode: forwards; }
@keyframes setupConfetti { to { transform: translateY(105vh) rotate(540deg); opacity: .15; } }
.setup-root .toast-in { animation: setupToast .35s var(--ease); }
@keyframes setupToast { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
@media (prefers-reduced-motion: reduce) {
  .setup-root .animate-in, .setup-root .pop-in, .setup-root .stagger > *, .setup-root .confetti-piece, .setup-root .toast-in { animation: none; }
  .setup-root .stagger > * { opacity: 1; transform: none; }
}
`;

const FIELD =
  "field w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none";
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

  const loadSetup = useCallback(async () => {
    setLoading(true);

    // Mail Setup status feeds the checklist — non-blocking if it fails.
    void getBusinessMailSetup().then((mailRes) => {
      if (mailRes.success && mailRes.data) setMailAlias(mailRes.data.alias);
    });

    const res = await getBusinessSetup();

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

      // Schema snapshot saved with the installed agent — keeps the dynamic
      // fields rendering when the page is revisited without a listingId.
      if (Array.isArray(data.buyerSetupSchema) && data.buyerSetupSchema.length > 0) {
        setBuyerSetupFields(data.buyerSetupSchema.filter((field) => field && field.key && field.label));
      }

      let keys = (data.requiredConnectors ?? []).map((req) => req.connector);

      if (listingId) {
        const listingRes = await getMarketplaceListing(listingId);

        if (listingRes.success && listingRes.data?.listing) {
          if (!data.installedAgent) {
            keys = Array.from(new Set([...keys, ...listingRes.data.listing.requiredConnectors]));
          }

          const setupFields = normalizeBuyerSetupFields(listingRes.data.listing.requiredBuyerSetup).filter(
            (field) => field.key && field.label
          );
          setBuyerSetupFields(setupFields);
          setBuyerSetupInstructions((listingRes.data.listing.buyerSetupInstructions ?? "").trim());
        }
      }

      setRequiredKeys(keys);
    }

    if (typeof window !== "undefined") {
      const savedStep = Number(window.sessionStorage.getItem(STEP_STORAGE_KEY) || "");

      if (savedStep >= 1 && savedStep <= STEPS.length) {
        setStep(savedStep);
      }

      window.sessionStorage.removeItem(STEP_STORAGE_KEY);
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
      <div className="setup-root">
        <style>{WIZARD_STYLES}</style>

        {confetti.map((piece) => (
          <span
            key={piece.id}
            aria-hidden="true"
            className="confetti-piece"
            style={{
              left: piece.left,
              width: piece.size,
              height: piece.size * 0.6,
              background: piece.color,
              animationDelay: piece.delay,
              animationDuration: piece.duration
            }}
          />
        ))}

        <div className="mx-auto max-w-2xl px-4 py-8">
          <div data-testid="business-setup-success" className={CARD}>
            <div className="pop-in grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-green-500 text-2xl text-white shadow-lg shadow-amber-500/30">
              ✓
            </div>

            <div className="stagger">
            <span
              data-testid="business-setup-success-badge"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700"
            >
              Agent deployed
            </span>

            <h2 className="mt-3 text-2xl font-bold text-slate-900" data-testid="business-setup-success-title">
              Your AI agent is live 🎉
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Your business owns this live setup. Architects only designed the reusable template.
            </p>
            </div>

            {showPhone ? (
            <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-5" data-testid="business-setup-assigned-number">
              <p className="text-sm text-slate-500">Your Triven phone number</p>

              <p
                className="mt-1 font-mono text-3xl font-bold tracking-tight text-slate-900"
                data-testid="business-setup-assigned-number-value"
              >
                {successNumber || assignedNumber || "Pending"}
              </p>
            </div>
            ) : null}

            <div
              className="mt-6 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-5"
              data-testid="business-setup-success-capabilities"
            >
              <p className="text-sm font-semibold text-slate-700">Your agent is ready to:</p>

              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {showPhone ? (
                  <li className="flex items-center gap-2.5">
                    <span className="text-green-500">✓</span>
                    Answer calls on <strong className="font-mono">{successNumber || assignedNumber || "your Triven number"}</strong>
                  </li>
                ) : null}
                {needsSms ? (
                  <li className="flex items-center gap-2.5">
                    <span className="text-green-500">✓</span>
                    Text customers confirmation SMS from Triven
                  </li>
                ) : null}
                {needsCalendar ? (
                  <li className="flex items-center gap-2.5">
                    <span className="text-green-500">✓</span>
                    Book appointments in your Google Calendar
                  </li>
                ) : null}
                {needsMail ? (
                  <li className="flex items-center gap-2.5">
                    <span className="text-green-500">✓</span>
                    Email confirmations and call summaries
                  </li>
                ) : null}
                <li className="flex items-center gap-2.5">
                  <span className="text-green-500">✓</span>
                  Answer customer questions using your business details
                </li>
              </ul>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                data-testid="business-setup-go-dashboard"
                type="button"
                onClick={() => router.push(DASHBOARD_ROUTE)}
                className="btn rounded-full bg-amber-500 px-5 py-3 text-sm font-semibold text-white hover:bg-amber-600"
              >
                Go to Dashboard
              </button>

              <button
                type="button"
                onClick={() => setDeployed(false)}
                className="btn rounded-full border border-gray-200 px-5 py-3 text-sm font-semibold text-slate-600 hover:border-gray-300"
              >
                Edit setup
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-root" data-testid="business-setup-wizard">
      <style>{WIZARD_STYLES}</style>

      <div className="sticky top-0 z-20 border-b border-gray-100 bg-gray-50/90 px-4 py-3.5 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="shrink-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-500">
              Step {step} of {STEPS.length}
            </p>

            <h1 className="text-base font-black text-slate-900" data-testid="business-setup-step-title">
              {STEPS[step - 1].title}
            </h1>
          </div>

          <nav className="flex items-center" aria-label="Setup progress" data-testid="business-setup-progress-dots">
            {STEPS.map((entry, index) => {
              const active = entry.id === step;
              const done = stepDone[entry.id];

              return (
                <div key={entry.id} className="flex items-center">
                  {index > 0 ? (
                    <span
                      aria-hidden="true"
                      className={`mx-1.5 h-0.5 w-3 rounded-full transition-colors duration-300 sm:mx-2 sm:w-6 ${
                        stepDone[STEPS[index - 1].id] ? "bg-amber-500" : "bg-gray-200"
                      }`}
                    />
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setStep(entry.id)}
                    aria-label={`Go to step ${entry.id}: ${entry.title}`}
                    aria-current={active ? "step" : undefined}
                    data-testid={`business-setup-dot-${entry.id}`}
                    className="group flex items-center gap-1.5"
                  >
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold transition-all duration-300 group-hover:scale-105 ${
                        active
                          ? "scale-105 bg-amber-500 text-white shadow-md shadow-amber-500/40"
                          : done
                            ? "bg-amber-500 text-white"
                            : "bg-gray-100 text-slate-400"
                      }`}
                    >
                      {done ? "✓" : entry.id}
                    </span>

                    <span
                      className={`hidden text-xs font-semibold lg:block ${
                        active || done ? "text-amber-700" : "text-slate-400"
                      }`}
                    >
                      {entry.title}
                    </span>
                  </button>
                </div>
              );
            })}
          </nav>

          <a
            href="mailto:support@triven.ai"
            className="hidden shrink-0 text-xs font-semibold text-amber-600 hover:text-amber-700 sm:block"
            data-testid="business-setup-help"
          >
            Need help?
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-8">
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
          />
        ) : null}

        {step === 2 ? (
          <div className="space-y-6">
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
              onCustomInstructions={setCustomInstructions}
              onSilenceCount={setSilenceRepromptCount}
              onSilence1={setSilenceMessage1}
              onSilence2={setSilenceMessage2}
              onGoodbye={setGoodbyeMessage}
            />
          </div>
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

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={step === 1 || saving}
              onClick={() => setStep((current) => Math.max(1, current - 1))}
              data-testid="business-setup-back"
              className="btn rounded-full border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-600"
            >
              Back
            </button>

            {step < STEPS.length ? (
              <button
                type="button"
                onClick={() => setStep((current) => Math.min(current + 1, STEPS.length))}
                disabled={saving}
                data-testid="business-setup-skip"
                className="text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-50"
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
              className="text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save progress"}
            </button>

            {step < STEPS.length ? (
              <button
                type="button"
                onClick={goNext}
                disabled={saving}
                data-testid="business-setup-next"
                className="btn rounded-full bg-amber-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDeploy}
                disabled={saving || !readyToDeploy}
                data-testid="business-setup-submit"
                className="btn rounded-full bg-amber-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
              >
                {saving ? "Deploying…" : "Deploy live agent"}
              </button>
            )}
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
  onToggleDay
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
}) {
  return (
    <div className={CARD}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-600" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
          <path d="M5 3v4M19 17v4M3 5h4M17 19h4" />
        </svg>
      </div>

      <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">Configure your agent</h2>
      <p className={SUB}>Tell us about your business so the agent answers and books accurately. You can change any of this later.</p>

      <span className="mt-2 inline-flex items-center gap-1 text-xs text-slate-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        ~2 minutes
      </span>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="business-name">
            Business name
          </label>
          <input
            data-testid="business-setup-input-name"
            id="business-name"
            value={businessName}
            onChange={(e) => onBusinessName(e.target.value)}
            placeholder="Bright Smile Dental, Prime HVAC, Nova Salon…"
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="business-type">
            Business type / industry
          </label>
          <input
            data-testid="business-setup-input-type"
            id="business-type"
            value={businessType}
            onChange={(e) => onBusinessType(e.target.value)}
            placeholder="Dental practice, HVAC, salon…"
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="contact-name">
            Contact / owner name optional
          </label>
          <input
            data-testid="business-setup-input-contact"
            id="contact-name"
            value={contactName}
            onChange={(e) => onContactName(e.target.value)}
            placeholder="Dr. Lee, Priya, front desk…"
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="services">
            Services one per line
          </label>
          <textarea
            data-testid="business-setup-input-services"
            id="services"
            value={servicesText}
            onChange={(e) => onServices(e.target.value)}
            rows={3}
            placeholder={"Consultation\nEmergency service\nNew appointment"}
            className={FIELD}
          />
        </div>
      </div>

      <div className={SECTION} data-testid="business-setup-tone">
        <h3 className={SECTION_TITLE}>Message tone</h3>
        <p className="mt-1 text-sm text-slate-400">Sets how the agent sounds on calls, texts, and emails.</p>

        <div className="mt-3 grid grid-cols-3 gap-3" role="radiogroup" aria-label="Message tone">
          {TONES.map((option) => {
            const selected = tone === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`business-setup-tone-${option.value}`}
                onClick={() => onTone(option.value)}
                className={`pick rounded-xl border border-gray-200 p-4 text-center ${selected ? "selected" : ""}`}
              >
                <span className="block text-2xl" aria-hidden="true">
                  {option.emoji}
                </span>
                <span className="mt-1.5 block text-sm font-semibold text-slate-700">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={SECTION} data-testid="business-setup-hours">
        <h3 className={SECTION_TITLE}>When should the agent respond?</h3>

        <div className="mt-3 space-y-3">
          <button
            type="button"
            role="radio"
            aria-checked={hoursMode === "247"}
            data-testid="business-setup-hours-247"
            onClick={() => onHoursMode("247")}
            className={`pick flex w-full items-start gap-3 rounded-xl border border-gray-200 p-4 text-left ${hoursMode === "247" ? "selected" : ""}`}
          >
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${
                hoursMode === "247" ? "border-amber-500 bg-amber-500 text-white" : "border-gray-300"
              }`}
            >
              {hoursMode === "247" ? "✓" : ""}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">24/7 — always respond</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                  Recommended
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">Never miss a customer, even after hours or on weekends.</span>
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={hoursMode === "custom"}
            data-testid="business-setup-hours-custom"
            onClick={() => onHoursMode("custom")}
            className={`pick flex w-full items-start gap-3 rounded-xl border border-gray-200 p-4 text-left ${hoursMode === "custom" ? "selected" : ""}`}
          >
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${
                hoursMode === "custom" ? "border-amber-500 bg-amber-500 text-white" : "border-gray-300"
              }`}
            >
              {hoursMode === "custom" ? "✓" : ""}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">Business hours only</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Used with the after-hours answering mode so the AI takes over when you are closed.
              </span>
            </span>
          </button>

          {hoursMode === "custom" ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4" data-testid="business-setup-hours-editor">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="hours-start">
                    Start
                  </label>
                  <input
                    data-testid="business-setup-hours-start"
                    id="hours-start"
                    type="time"
                    value={hoursStart}
                    onChange={(e) => onHoursStart(e.target.value)}
                    className="field rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
                  />
                </div>

                <span className="pb-2 text-slate-400">→</span>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="hours-end">
                    End
                  </label>
                  <input
                    data-testid="business-setup-hours-end"
                    id="hours-end"
                    type="time"
                    value={hoursEnd}
                    onChange={(e) => onHoursEnd(e.target.value)}
                    className="field rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
                  />
                </div>
              </div>

              <div className="mt-4">
                <span className="mb-2 block text-xs font-medium text-slate-500">Active days</span>

                <div className="flex flex-wrap gap-1.5">
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
                        className={`grid h-10 w-10 place-items-center rounded-lg border text-sm font-semibold transition-colors ${
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

      {setupFields.length > 0 ? (
        <div className={SECTION} data-testid="business-setup-custom-fields">
          <h3 className={SECTION_TITLE}>Agent setup details</h3>
          <p className="mt-1 text-sm text-slate-400">
            This agent asks for a few extra details so it can answer callers accurately.
          </p>
          {setupInstructions ? (
            <p
              className="mt-2 rounded-xl border border-amber-100 bg-amber-50/60 px-3.5 py-2.5 text-sm text-amber-900/90"
              data-testid="business-setup-buyer-instructions"
            >
              {setupInstructions}
            </p>
          ) : null}

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
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

      <div className={SECTION} data-testid="business-setup-faqs">
        <div className="flex items-center justify-between">
          <h3 className={SECTION_TITLE}>FAQs / knowledge optional</h3>

          <button
            type="button"
            data-testid="business-setup-faq-add"
            onClick={() => onFaqs([...faqs, { question: "", answer: "" }])}
            className="btn rounded-full border border-gray-200 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:border-amber-300"
          >
            + Add FAQ
          </button>
        </div>

        {faqs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Add common questions so the agent answers accurately.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {faqs.map((faq, index) => (
              <div key={index} className="rounded-xl border border-gray-100 bg-gray-50 p-3" data-testid="business-setup-faq-row">
                <input
                  value={faq.question}
                  onChange={(e) => onFaqs(faqs.map((f, i) => (i === index ? { ...f, question: e.target.value } : f)))}
                  placeholder="Question"
                  className={FIELD}
                />

                <textarea
                  value={faq.answer}
                  onChange={(e) => onFaqs(faqs.map((f, i) => (i === index ? { ...f, answer: e.target.value } : f)))}
                  rows={2}
                  placeholder="Answer"
                  className={`${FIELD} mt-2`}
                />

                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onFaqs(faqs.filter((_, i) => i !== index))}
                    className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-slate-500 hover:border-gray-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={SECTION}>
        <ChecklistSummary checklist={checklist} />
      </div>
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
  onMailAliasChange
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
}) {
  const timezoneMissing = Boolean(timeZone) && !ALL_ZONES.includes(timeZone);
  const forwardRequired = answeringMode !== "AI_FIRST";
  // "Forward my existing number" covers every conditional answering mode;
  // "Use the Triven number directly" is AI_FIRST (the Triven number is the main line).
  const routingMode = answeringMode === "AI_FIRST" ? "direct" : "forward";

  return (
    <div className={CARD}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      </div>

      <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">{title}</h2>

      <p className={SUB}>
        Only the connections this agent actually uses appear here. Your business owns the live accounts — architects only designed the template.
      </p>

      <span className="mt-2 inline-flex items-center gap-1 text-xs text-slate-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        ~60 seconds
      </span>

      {showPhone ? (
      <div className="mt-6">
        <h3 className={SECTION_TITLE}>Select your Triven number</h3>
        <p className="mt-0.5 text-sm text-slate-500">Choose the number customers will call or forward missed calls to.</p>

        <div className="mt-3 space-y-2.5" data-testid="business-setup-phone-list">
          {phoneNumbers.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4 text-sm text-slate-600" data-testid="business-setup-phone-empty">
              <p className="font-semibold text-slate-700">No Triven numbers are available yet.</p>
              <p className="mt-0.5 text-slate-500">Add a platform phone number before deploying this agent.</p>

              {process.env.NODE_ENV !== "production" ? (
                <p className="mt-2 text-xs text-slate-500" data-testid="business-setup-phone-empty-dev-hint">
                  Run{" "}
                  <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-amber-700 ring-1 ring-gray-200">
                    npm run seed:platform-phone-numbers --workspace=@coreai/backend
                  </code>{" "}
                  to add a demo number.
                </p>
              ) : null}
            </div>
          ) : (
            phoneNumbers.map((number) => {
              const selected = selectedPhoneId === number.id;
              const statusLabel = number.assignedToThisBusiness ? "Assigned to you" : selected ? "Selected" : "Available";
              const statusClass = number.assignedToThisBusiness
                ? "bg-green-100 text-green-700"
                : selected
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-500";

              const location = [number.locality, number.region, number.country].filter(Boolean).join(", ");

              const capabilities = number.capabilities
                ? (["voice", "sms", "mms"] as const).filter((cap) => number.capabilities?.[cap])
                : [];

              return (
                <button
                  key={number.id}
                  type="button"
                  onClick={() => onSelectPhone(number.id)}
                  data-testid={`business-setup-phone-${number.id}`}
                  aria-pressed={selected}
                  className={`pick flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left ${selected ? "selected" : ""}`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${selected ? "border-amber-500 bg-amber-500 text-white" : "border-gray-300"
                      }`}
                  >
                    {selected ? "✓" : ""}
                  </span>

                  <span className="min-w-0">
                    <span className="block font-mono text-lg font-bold text-slate-900">{number.phoneNumber}</span>

                    {location || capabilities.length > 0 ? (
                      <span className="block text-xs text-slate-400" data-testid={`business-setup-phone-meta-${number.id}`}>
                        {location}
                        {location && capabilities.length > 0 ? " · " : ""}
                        {capabilities.map((cap) => cap.toUpperCase()).join(" / ")}
                      </span>
                    ) : null}
                  </span>

                  <span className={PROVIDER_BADGE}>{number.provider === "TWILIO" ? "Twilio" : number.provider}</span>

                  <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClass}`}>
                    {statusLabel}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
      ) : null}

      {showPhone ? (
      <div className={SECTION} data-testid="business-setup-routing-mode">
        <h3 className={SECTION_TITLE}>Number routing</h3>
        <p className="mt-0.5 text-sm text-slate-500">Choose how customers reach this agent.</p>

        <div className="mt-3 space-y-2.5">
          <button
            type="button"
            data-testid="business-setup-routing-forward"
            aria-pressed={routingMode === "forward"}
            onClick={() => {
              if (routingMode !== "forward") onAnsweringMode("NO_ANSWER");
            }}
            className={`pick flex w-full items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left ${routingMode === "forward" ? "selected" : ""}`}
          >
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${routingMode === "forward" ? "border-amber-500 bg-amber-500 text-white" : "border-gray-300"}`}
            >
              {routingMode === "forward" ? "✓" : ""}
            </span>

            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">Forward my existing number</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Keep your current number as the public one — it forwards to your Triven number and the AI answers based on your answering mode.
              </span>
            </span>
          </button>

          <button
            type="button"
            data-testid="business-setup-routing-direct"
            aria-pressed={routingMode === "direct"}
            onClick={() => onAnsweringMode("AI_FIRST")}
            className={`pick flex w-full items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left ${routingMode === "direct" ? "selected" : ""}`}
          >
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${routingMode === "direct" ? "border-amber-500 bg-amber-500 text-white" : "border-gray-300"}`}
            >
              {routingMode === "direct" ? "✓" : ""}
            </span>

            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">Use the Triven number directly</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Give out your Triven number as your main line — the AI answers calls to it directly.
              </span>
            </span>
          </button>
        </div>
      </div>
      ) : null}

      {showPhone ? (
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Call handling</h3>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="forward-phone">
              Forwarding / public business phone {forwardRequired ? "" : "optional"}
            </label>

            <input
              data-testid="business-setup-input-forward"
              id="forward-phone"
              type="tel"
              value={forwardToPhone}
              onChange={(e) => onForward(e.target.value)}
              placeholder="+1 555 123 4567"
              className={FIELD}
            />

            <p className="mt-1 text-xs text-slate-400">
              {forwardRequired
                ? "Required for this answering mode so missed or fallback calls can reach your team."
                : "Optional for AI-first mode. Add this only if calls the AI cannot handle should forward to your team."}
            </p>
          </div>

          <div>
            <label className={LABEL} htmlFor="team-phone">
              Team phone optional
            </label>

            <input
              data-testid="business-setup-input-team"
              id="team-phone"
              type="tel"
              value={teamPhone}
              onChange={(e) => onTeamPhone(e.target.value)}
              placeholder="+1 555 765 4321"
              className={FIELD}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="answering-mode">
              Answering mode
            </label>

            <select
              data-testid="business-setup-input-answering-mode"
              id="answering-mode"
              value={answeringMode}
              onChange={(e) => onAnsweringMode(e.target.value)}
              className={FIELD}
            >
              {ANSWERING_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>

          {assignedNumber ? (
            <p className="text-xs text-slate-400 sm:col-span-2" data-testid="business-setup-assigned-forwarding">
              Assigned Triven number: <span className="font-mono font-bold text-slate-600">{assignedNumber}</span>. Publish it directly or forward your existing number to it.
            </p>
          ) : null}
        </div>
      </div>
      ) : null}

      {showCalendar ? (
      <div className={SECTION} data-testid="business-setup-calendar">
        <h3 className={SECTION_TITLE}>Google Calendar</h3>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-sm text-slate-600" data-testid="business-setup-calendar-status">
            {calendar.connected ? `Connected${calendar.email ? ` as ${calendar.email}` : ""}` : "Not connected. Connect so the agent can book appointments."}
          </p>

          {calendar.connected ? (
            <button
              type="button"
              data-testid="business-setup-calendar-disconnect"
              disabled={calendarBusy}
              onClick={onDisconnectCalendar}
              className="btn rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-gray-300"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              data-testid="business-setup-calendar-connect"
              disabled={calendarBusy}
              onClick={onConnectCalendar}
              className="btn rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            >
              {calendarBusy ? "Connecting…" : "Connect Google Calendar"}
            </button>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="calendar-id">
              Calendar ID
            </label>

            <input
              data-testid="business-setup-input-calendar-id"
              id="calendar-id"
              value={calendarId}
              onChange={(e) => onCalendarId(e.target.value)}
              placeholder="primary"
              className={FIELD}
            />
          </div>

          <div>
            <label className={LABEL} htmlFor="timezone">
              Calendar timezone
            </label>

            <select
              data-testid="business-setup-input-timezone"
              id="timezone"
              value={timeZone}
              onChange={(e) => onTimeZone(e.target.value)}
              className={FIELD}
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

            <p className="mt-1 text-xs text-slate-400">All availability, bookings, and “today/tomorrow” use this timezone.</p>
          </div>
        </div>
      </div>
      ) : null}

      {showSmsNote ? (
      <div className={SECTION} data-testid="business-setup-sms-note">
        <h3 className={SECTION_TITLE}>SMS</h3>
        <p className="mt-0.5 text-sm text-slate-500">Confirmation SMS will be sent to your customers from Triven.</p>
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

const SIMULATION_STAGE_ORDER: SimulationStage[] = ["idle", "waiting", "detected", "generating", "sent"];

function MissedCallSimulationSection({ businessName, tone }: { businessName: string; tone: string }) {
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

    // The SMS is real — the request fires while the feed plays out, and the
    // "sent" row only shows once Twilio actually accepted the message.
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

  return (
    <div className={SECTION} data-testid="business-setup-simulate">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={SECTION_TITLE}>Simulate a missed call</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Watch the live feed handle a missed call — the text-back SMS at the end is real and arrives on your phone,
            sent from Triven.
          </p>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${badge.text}`}
          data-testid="business-setup-simulate-badge"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot} ${running ? "animate-pulse" : ""}`} />
          {badge.label}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+15551234567"
          data-testid="business-setup-simulate-phone"
          className="w-56 rounded-full border border-gray-200 px-4 py-2 text-sm text-slate-700 focus:border-amber-300 focus:outline-none"
        />

        <button
          type="button"
          data-testid="business-setup-simulate-run"
          disabled={running}
          onClick={() => void runSimulation()}
          className="btn shrink-0 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
        >
          {running ? "Simulating…" : stage === "sent" || stage === "failed" ? "Run again" : "Simulate a missed call"}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Use a phone you own and have consent to text. Country code required — E.164 format.
      </p>

      {stage !== "idle" ? (
        <div className="mt-4 divide-y divide-slate-50 rounded-xl border border-slate-100 bg-white" data-testid="business-setup-simulate-feed">
          <div className="flex items-center gap-3 p-4">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 ${stage === "waiting" ? "animate-ping" : ""}`} />
            <span className="text-sm text-slate-500">Waiting for a missed call…</span>
          </div>

          {stageReached("detected") ? (
            <div className="flex items-center gap-3 p-4" data-testid="business-setup-simulate-detected">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />
              <span className="flex-1 text-sm text-slate-700">
                Missed call detected from <strong className="font-mono">{phone.trim()}</strong>
              </span>
              <span className="font-mono text-xs text-slate-400">{detectedAt}</span>
            </div>
          ) : null}

          {stageReached("generating") ? (
            <div className="flex items-center gap-3 p-4" data-testid="business-setup-simulate-generating">
              {stage === "generating" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4 shrink-0 animate-spin text-violet-500">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" />
              )}
              <span className="flex-1 text-sm text-slate-700">
                {stage === "generating" ? "AI generating a personalized response…" : "Personalized response generated"}
              </span>
            </div>
          ) : null}

          {stage === "sent" ? (
            <div className="flex items-center gap-3 p-4" data-testid="business-setup-simulate-sent">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-green-500 text-[11px] font-bold text-white">✓</span>
              <span className="flex-1 text-sm font-semibold text-green-700">SMS sent successfully</span>
              <span className="font-mono text-xs text-slate-400">{sentAt}</span>
            </div>
          ) : null}

          {stage === "failed" ? (
            <div className="flex items-center gap-3 p-4" data-testid="business-setup-simulate-failed">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-500 text-[11px] font-bold text-white">✕</span>
              <span className="flex-1 text-sm font-semibold text-red-600">SMS could not be sent</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {stage === "sent" && result ? (
        <>
          <div className="mt-5 flex justify-center" data-testid="business-setup-simulate-preview">
            <div className="w-64 rounded-[2rem] border-8 border-slate-900 bg-slate-50 p-4 shadow-xl">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-500 text-xs font-bold text-white">
                  {businessInitials(businessName)}
                </span>
                <span className="leading-tight">
                  <span className="block text-xs font-semibold text-slate-800">{businessName.trim() || "Your business"}</span>
                  <span className="block text-[10px] text-slate-400">Text message · now</span>
                </span>
              </div>

              <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] leading-snug text-slate-700 shadow-sm">
                {message}
              </div>
            </div>
          </div>

          <p className="mt-3 text-center text-xs text-slate-500" data-testid="business-setup-simulate-result">
            {result.simulated
              ? "Simulated — no Twilio request was made; nothing was delivered."
              : result.testCredentials
                ? "Accepted with Twilio test credentials — nothing was delivered."
                : `Really sent — check ${result.to}.`}
            {result.from ? ` Sender: ${result.from}.` : ""}
          </p>
        </>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600" data-testid="business-setup-simulate-error">
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
  onTestCallRouting
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
}) {
  return (
    <div className={CARD}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-green-50 text-green-600" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className="ml-0.5 h-5 w-5">
          <polygon points="6 3 20 12 6 21 6 3" />
        </svg>
      </div>

      <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">Test your agent</h2>

      <p className={SUB}>
        Confirm everything is wired up before going live
        {assignedNumber ? (
          <>
            {" "}— your Triven number is <span className="font-mono font-bold text-slate-700">{assignedNumber}</span>
          </>
        ) : null}
        .
      </p>

      <span className="mt-2 inline-flex items-center gap-1 text-xs text-slate-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        ~60 seconds
      </span>

      {showCallTest ? <MissedCallSimulationSection businessName={businessName} tone={tone} /> : null}

      {showPreview ? <PreviewCallSection /> : null}

      {showCallTest ? (
        deployedLive ? (
          <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-5" data-testid="business-setup-test-instructions">
            <ol className="space-y-3">
              <li className="flex items-center gap-3 text-sm text-slate-700">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">1</span>
                <span>Run the routing check below — every row should pass.</span>
              </li>
              <li className="flex items-center gap-3 text-sm text-slate-700">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">2</span>
                <span>
                  Call{" "}
                  <strong className="font-mono font-semibold text-slate-900">{assignedNumber ?? "your Triven number"}</strong>{" "}
                  from your personal phone.
                </span>
              </li>
              <li className="flex items-center gap-3 text-sm text-slate-700">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">3</span>
                <span>The AI should answer — try asking it to book an appointment.</span>
              </li>
            </ol>
          </div>
        ) : (
          <div
            className="mt-6 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            data-testid="business-setup-test-predeploy-note"
          >
            Your agent is not live yet, so some checks below pass only after you deploy in the{" "}
            <span className="font-semibold">Go live</span> step. Run the check now to catch setup issues early, then
            re-test after deploying.
          </div>
        )
      ) : null}

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
            className="btn shrink-0 rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-amber-300"
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
    <div className={CARD}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">Go live</h2>

      <p className={SUB}>
        Deploy builds your live assistant with your voice, timezone, and instructions, and routes your Triven number
        {assignedNumber ? <span className="font-mono font-bold text-slate-700"> {assignedNumber}</span> : null} to it.
      </p>

      <span className="mt-2 inline-flex items-center gap-1 text-xs text-slate-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        ~30 seconds
      </span>

      <div className={SECTION}>
        <ChecklistSummary checklist={checklist} />
      </div>

      <div className={SECTION}>
        {blockers.length > 0 ? (
          <div data-testid="business-setup-blockers" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">Complete these before you can deploy live:</p>

            <ul className="mt-1 list-disc pl-5">
              {blockers.map((blocker) => (
                <li key={blocker} data-testid="business-setup-blocker">
                  {blocker}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-700" data-testid="business-setup-ready">
            All set — you can deploy your live agent.
          </div>
        )}

        {readyToDeploy ? (
          <p className="mt-3 text-xs text-slate-400">
            After deploy, call your Triven number to test the live agent. Calendar booking uses your connected Google Calendar and timezone.
          </p>
        ) : null}
      </div>
    </div>
  );
}