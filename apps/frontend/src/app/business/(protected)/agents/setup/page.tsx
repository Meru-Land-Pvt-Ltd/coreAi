"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { CUSTOM_INSTRUCTION_SUGGESTIONS, DEFAULT_SILENCE, normalizeTimeZone, VOICE_PRESETS } from "@coreai/shared";
import { VoicePicker } from "@/components/common/voice-picker";
import {
  disconnectBusinessCalendar,
  getBusinessCalendarOAuthUrl,
  getBusinessSetup,
  getMarketplaceListing,
  saveBusinessSetup,
  type BusinessFaq,
  type BusinessHoursItem,
  type BusinessKnowledgeItem,
  type PlatformPhoneOption
} from "@/components/business/features/api";

const DASHBOARD_ROUTE = "/business/dashboard" as Route;
const STEP_STORAGE_KEY = "biz-setup-step";

const STEPS = [
  { id: 1, title: "Business" },
  { id: 2, title: "Phone & Calendar" },
  { id: 3, title: "Voice & Instructions" },
  { id: 4, title: "Test & Go live" }
] as const;

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

const PRESET_VOICE_IDS = new Set(VOICE_PRESETS.map((preset) => preset.id));

// Uploaded wizard visual language: amber focus ring, lifting buttons, amber
// "pick" selection cards, and a soft slide-up panel animation. Scoped to
// `.setup-root` so it never leaks into the rest of the buyer app.
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

function defaultTimeZone(): string {
  try {
    // The browser may report a legacy alias (e.g. Asia/Calcutta) — canonicalize it.
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

type ChecklistRow = { key: string; label: string; required: boolean; complete: boolean; blocker?: string };

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

  // Step 1 — business (services/faqs editable; hours/knowledge/bookingUrl/tone preserved)
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [contactName, setContactName] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [faqs, setFaqs] = useState<BusinessFaq[]>([]);
  const [bookingUrl, setBookingUrl] = useState("");
  const [tone, setTone] = useState("friendly");
  const [hours, setHours] = useState<BusinessHoursItem[]>([]);
  const [knowledge, setKnowledge] = useState<BusinessKnowledgeItem[]>([]);

  // Step 2 — phone + calendar
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

  // Step 3 — voice + instructions + silence
  const [voiceChoice, setVoiceChoice] = useState("default");
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [silenceRepromptCount, setSilenceRepromptCount] = useState<number>(DEFAULT_SILENCE.repromptCount);
  const [silenceMessage1, setSilenceMessage1] = useState("");
  const [silenceMessage2, setSilenceMessage2] = useState("");
  const [goodbyeMessage, setGoodbyeMessage] = useState("");

  const [requiredKeys, setRequiredKeys] = useState<string[]>([]);

  const loadSetup = useCallback(async () => {
    setLoading(true);
    const res = await getBusinessSetup();

    if (res.success && res.data) {
      const data = res.data;
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
        if (Array.isArray(data.profile.faqs) && data.profile.faqs.length > 0) setFaqs(data.profile.faqs);
        if (Array.isArray(data.profile.hours)) setHours(data.profile.hours);
      }
      if (Array.isArray(data.knowledge)) setKnowledge(data.knowledge);

      setContactName(data.contactName ?? "");
      setCustomInstructions(data.customInstructions ?? "");
      if (data.silence) {
        if (typeof data.silence.repromptCount === "number") setSilenceRepromptCount(data.silence.repromptCount);
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
      if (selection?.voiceId) {
        setVoiceChoice("custom");
        setCustomVoiceId(selection.voiceId);
      } else if (selection?.name && PRESET_VOICE_IDS.has(selection.name)) {
        setVoiceChoice(selection.name);
      }

      let keys = (data.requiredConnectors ?? []).map((req) => req.connector);
      if (listingId && !data.installedAgent) {
        const listingRes = await getMarketplaceListing(listingId);
        if (listingRes.success && listingRes.data?.listing) {
          keys = Array.from(new Set([...keys, ...listingRes.data.listing.requiredConnectors]));
        }
      }
      setRequiredKeys(keys);
    }

    // Restore the step the buyer was on before a Google OAuth redirect.
    if (typeof window !== "undefined") {
      const savedStep = Number(window.sessionStorage.getItem(STEP_STORAGE_KEY) || "");
      if (savedStep >= 1 && savedStep <= STEPS.length) setStep(savedStep);
      window.sessionStorage.removeItem(STEP_STORAGE_KEY);
    }
    setLoading(false);
  }, [listingId]);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  function buildVoiceFields(): { voice: string; voiceProvider: string; voiceId: string } {
    if (voiceChoice === "custom") return { voice: "", voiceProvider: "11labs", voiceId: customVoiceId.trim() };
    if (PRESET_VOICE_IDS.has(voiceChoice)) return { voice: voiceChoice, voiceProvider: "11labs", voiceId: "" };
    return { voice: "", voiceProvider: "", voiceId: "" };
  }

  // Enough to persist progress incrementally (a CoreAI number + forwarding are
  // required only to DEPLOY, enforced by the checklist blockers below).
  const canPersist = businessName.trim().length >= 2 && businessType.trim().length >= 2;

  async function persistSetup(deploy: boolean): Promise<{ ok: boolean; number: string }> {
    const voiceFields = buildVoiceFields();
    const res = await saveBusinessSetup({
      deploy,
      businessName: businessName.trim(),
      businessType: businessType.trim(),
      forwardToPhone: forwardToPhone.trim(),
      bookingUrl: bookingUrl.trim(),
      teamPhone: teamPhone.trim(),
      timeZone: timeZone.trim() || defaultTimeZone(),
      tone,
      services: parseLines(servicesText),
      faqs: faqs
        .filter((faq) => faq.question.trim() && faq.answer.trim())
        .map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() })),
      hours,
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
      selectedPlatformPhoneNumberId: selectedPhoneId || undefined,
      calendarId: calendarId.trim() || "primary",
      ...(listingId ? { listingId } : {})
    });

    if (!res.success || !res.data) {
      setError(res.error ?? "Could not save your setup. Please try again.");
      return { ok: false, number: "" };
    }
    const data = res.data;
    const number = data.assignedPhoneNumber ?? data.phoneNumber?.phoneNumber ?? assignedNumber ?? "";
    if (number) setAssignedNumber(number);
    if (data.requiredConnectors) setRequiredKeys(data.requiredConnectors.map((req) => req.connector));
    if (data.availablePhoneNumbers) setPhoneNumbers(data.availablePhoneNumbers);
    if (typeof data.selectedPlatformPhoneNumberId === "string") setSelectedPhoneId(data.selectedPlatformPhoneNumberId);
    setCalendar(data.calendar ?? calendar);
    return { ok: true, number };
  }

  async function handleConnectCalendar() {
    setError("");
    if (typeof window !== "undefined") window.sessionStorage.setItem(STEP_STORAGE_KEY, String(step));
    setCalendarBusy(true);
    // Persist first so the buyer's input (incl. number selection) survives the redirect.
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
      if (saved.ok) setStatusMsg("Progress saved");
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
    if (saved.ok) setStatusMsg("Progress saved");
  }

  async function handleDeploy() {
    setError("");
    if (businessName.trim().length < 2 || businessType.trim().length < 2) {
      setStep(1);
      setError("Add your business name and type.");
      return;
    }
    if (!(selectedPhoneId || assignedNumber)) {
      setStep(2);
      setError("Select a CoreAI phone number.");
      return;
    }
    if (forwardToPhone.trim().length < 5) {
      setStep(2);
      setError("Add the phone number that should receive forwarded/live calls.");
      return;
    }
    setSaving(true);
    const result = await persistSetup(true);
    setSaving(false);
    if (!result.ok) return;
    setDeployed(true);
    setSuccessNumber(result.number || assignedNumber || "");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- client readiness (mirrors backend; drives the deploy gate) ----
  const needs = new Set(requiredKeys);
  const businessComplete = businessName.trim().length >= 2 && businessType.trim().length >= 2;
  const phoneSelected = Boolean(selectedPhoneId) || Boolean(assignedNumber);
  const phoneComplete = phoneSelected && forwardToPhone.trim().length >= 5;
  const voiceComplete = voiceChoice !== "custom" || customVoiceId.trim().length > 0;
  const needsCalendar = needs.has("google_calendar");
  const needsGmail = needs.has("gmail");
  const needsPhone = needs.has("phone_provider") || needs.has("twilio");
  const needsSms = needs.has("twilio");
  const needsVoice = needs.has("vapi");

  const checklist: ChecklistRow[] = [
    {
      key: "business_profile",
      label: "Business profile",
      required: true,
      complete: businessComplete,
      blocker: businessComplete ? undefined : "Add your business name and type."
    },
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
            label: "CoreAI number & routing",
            required: true,
            complete: phoneComplete,
            blocker: phoneComplete
              ? undefined
              : !phoneSelected
                ? "Select a CoreAI phone number."
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
            blocker: phoneSelected ? undefined : "Select a CoreAI phone number for SMS notifications."
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
            blocker: voiceComplete ? undefined : "Enter a custom ElevenLabs voice ID or choose a preset."
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
        <div className="mx-auto max-w-2xl px-4 py-8">
          <div data-testid="business-setup-success" className={CARD}>
            <div className="pop-in grid h-14 w-14 place-items-center rounded-full bg-green-100 text-2xl text-green-600">
              ✓
            </div>
            <span
              data-testid="business-setup-success-badge"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700"
            >
              Agent deployed
            </span>
            <h2 className="mt-3 text-2xl font-bold text-slate-900" data-testid="business-setup-success-title">
              Your AI agent is live
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Your business owns this live setup. Architects only designed the agent template.
            </p>
            <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-5" data-testid="business-setup-assigned-number">
              <p className="text-sm text-slate-500">Your CoreAI phone number</p>
              <p
                className="mt-1 font-mono text-3xl font-bold tracking-tight text-slate-900"
                data-testid="business-setup-assigned-number-value"
              >
                {successNumber || assignedNumber || "Pending"}
              </p>
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

      {/* Sticky progress header */}
      <div className="sticky top-0 z-20 border-b border-gray-100 bg-gray-50/90 px-4 py-3.5 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-500">
              Step {step} of {STEPS.length}
            </p>
            <h1 className="text-base font-black text-slate-900" data-testid="business-setup-step-title">
              {STEPS[step - 1].title}
            </h1>
          </div>
          <div className="flex items-center gap-1.5" data-testid="business-setup-progress-dots">
            {STEPS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setStep(entry.id)}
                aria-label={`Go to step ${entry.id}: ${entry.title}`}
                data-testid={`business-setup-dot-${entry.id}`}
                className={`h-2 rounded-full transition-all duration-300 ${
                  entry.id === step ? "w-8 bg-amber-500" : entry.id < step ? "w-2 bg-amber-400" : "w-2 bg-gray-200"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-8">
        {step === 1 ? (
          <StepBusiness
            businessName={businessName}
            businessType={businessType}
            contactName={contactName}
            servicesText={servicesText}
            faqs={faqs}
            checklist={checklist}
            onBusinessName={setBusinessName}
            onBusinessType={setBusinessType}
            onContactName={setContactName}
            onServices={setServicesText}
            onFaqs={setFaqs}
          />
        ) : null}

        {step === 2 ? (
          <StepPhoneCalendar
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

        {step === 3 ? (
          <StepVoice
            voiceChoice={voiceChoice}
            customVoiceId={customVoiceId}
            customInstructions={customInstructions}
            silenceRepromptCount={silenceRepromptCount}
            silenceMessage1={silenceMessage1}
            silenceMessage2={silenceMessage2}
            goodbyeMessage={goodbyeMessage}
            onVoiceChoice={setVoiceChoice}
            onCustomVoiceId={setCustomVoiceId}
            onCustomInstructions={setCustomInstructions}
            onSilenceCount={setSilenceRepromptCount}
            onSilence1={setSilenceMessage1}
            onSilence2={setSilenceMessage2}
            onGoodbye={setGoodbyeMessage}
          />
        ) : null}

        {step === 4 ? (
          <StepDeploy checklist={checklist} blockers={blockers} readyToDeploy={readyToDeploy} assignedNumber={assignedNumber} />
        ) : null}

        {error ? (
          <p data-testid="business-setup-error" role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        {/* Footer nav */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={step === 1 || saving}
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            data-testid="business-setup-back"
            className="btn rounded-full border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-600"
          >
            Back
          </button>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleSaveProgress}
              disabled={saving}
              data-testid="business-setup-save"
              className="text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:opacity-50"
            >
              {saving ? "Saving…" : statusMsg || "Save progress"}
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
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                row.complete ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
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

/* -------------------------------- Step 1 -------------------------------- */

function StepBusiness({
  businessName,
  businessType,
  contactName,
  servicesText,
  faqs,
  checklist,
  onBusinessName,
  onBusinessType,
  onContactName,
  onServices,
  onFaqs
}: {
  businessName: string;
  businessType: string;
  contactName: string;
  servicesText: string;
  faqs: BusinessFaq[];
  checklist: ChecklistRow[];
  onBusinessName: (v: string) => void;
  onBusinessType: (v: string) => void;
  onContactName: (v: string) => void;
  onServices: (v: string) => void;
  onFaqs: (v: BusinessFaq[]) => void;
}) {
  return (
    <div className={CARD}>
      <h2 className={H2}>Business</h2>
      <p className={SUB}>Tell us about your business so the agent answers and books accurately. You can change any of this later.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="business-name">Business name</label>
          <input data-testid="business-setup-input-name" id="business-name" value={businessName} onChange={(e) => onBusinessName(e.target.value)} placeholder="Bright Smile Dental" className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="business-type">Business type / industry</label>
          <input data-testid="business-setup-input-type" id="business-type" value={businessType} onChange={(e) => onBusinessType(e.target.value)} placeholder="Dental practice, HVAC, salon…" className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="contact-name">Contact / owner name (optional)</label>
          <input data-testid="business-setup-input-contact" id="contact-name" value={contactName} onChange={(e) => onContactName(e.target.value)} placeholder="Dr. Lee, Priya, the front desk…" className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="services">Services (one per line)</label>
          <textarea data-testid="business-setup-input-services" id="services" value={servicesText} onChange={(e) => onServices(e.target.value)} rows={3} placeholder={"Teeth cleaning\nEmergency visits\nWhitening"} className={FIELD} />
        </div>
      </div>

      <div className={SECTION} data-testid="business-setup-faqs">
        <div className="flex items-center justify-between">
          <h3 className={SECTION_TITLE}>FAQs / knowledge (optional)</h3>
          <button type="button" data-testid="business-setup-faq-add" onClick={() => onFaqs([...faqs, { question: "", answer: "" }])} className="btn rounded-full border border-gray-200 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:border-amber-300">
            + Add FAQ
          </button>
        </div>
        {faqs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Add common questions so the agent answers accurately.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {faqs.map((faq, index) => (
              <div key={index} className="rounded-xl border border-gray-100 bg-gray-50 p-3" data-testid="business-setup-faq-row">
                <input value={faq.question} onChange={(e) => onFaqs(faqs.map((f, i) => (i === index ? { ...f, question: e.target.value } : f)))} placeholder="Question" className={FIELD} />
                <textarea value={faq.answer} onChange={(e) => onFaqs(faqs.map((f, i) => (i === index ? { ...f, answer: e.target.value } : f)))} rows={2} placeholder="Answer" className={`${FIELD} mt-2`} />
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => onFaqs(faqs.filter((_, i) => i !== index))} className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-slate-500 hover:border-gray-300">
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

/* -------------------------------- Step 2 -------------------------------- */

function StepPhoneCalendar({
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
  onTimeZone
}: {
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
  return (
    <div className={CARD}>
      <h2 className={H2}>Phone &amp; Calendar</h2>
      <p className={SUB}>
        Architects design the agent. Your business connects the accounts, phone routing, calendar, and voice used when the agent runs live.
      </p>

      {/* Select your CoreAI number */}
      <div className="mt-6">
        <h3 className={SECTION_TITLE}>Select your CoreAI number</h3>
        <p className="mt-0.5 text-sm text-slate-500">Choose the number customers will call or forward missed calls to.</p>
        <div className="mt-3 space-y-2.5" data-testid="business-setup-phone-list">
          {phoneNumbers.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4 text-sm text-slate-600" data-testid="business-setup-phone-empty">
              <p className="font-semibold text-slate-700">No CoreAI numbers are available yet.</p>
              <p className="mt-0.5 text-slate-500">Add a platform number before deploying this agent.</p>
              {process.env.NODE_ENV !== "production" ? (
                <p className="mt-2 text-xs text-slate-500" data-testid="business-setup-phone-empty-dev-hint">
                  Run{" "}
                  <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-amber-700 ring-1 ring-gray-200">
                    npm run seed:platform-phone-numbers --workspace=@coreai/backend
                  </code>{" "}
                  to add the demo number.
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
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${
                      selected ? "border-amber-500 bg-amber-500 text-white" : "border-gray-300"
                    }`}
                  >
                    {selected ? "✓" : ""}
                  </span>
                  <span className="font-mono text-lg font-bold text-slate-900">{number.phoneNumber}</span>
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

      {/* Call handling */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Call handling</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="forward-phone">Forwarding / public business phone</label>
            <input data-testid="business-setup-input-forward" id="forward-phone" type="tel" value={forwardToPhone} onChange={(e) => onForward(e.target.value)} placeholder="+1 555 123 4567" className={FIELD} />
            <p className="mt-1 text-xs text-slate-400">Calls the AI can’t handle are forwarded here (or your team is reached here).</p>
          </div>
          <div>
            <label className={LABEL} htmlFor="team-phone">Team phone (optional)</label>
            <input data-testid="business-setup-input-team" id="team-phone" type="tel" value={teamPhone} onChange={(e) => onTeamPhone(e.target.value)} placeholder="+1 555 765 4321" className={FIELD} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="answering-mode">Answering mode</label>
            <select data-testid="business-setup-input-answering-mode" id="answering-mode" value={answeringMode} onChange={(e) => onAnsweringMode(e.target.value)} className={FIELD}>
              {ANSWERING_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </div>
          {assignedNumber ? (
            <p className="text-xs text-slate-400 sm:col-span-2" data-testid="business-setup-assigned-forwarding">
              Assigned CoreAI number: <span className="font-mono font-bold text-slate-600">{assignedNumber}</span>. Publish it directly or forward your existing number to it.
            </p>
          ) : null}
        </div>
      </div>

      {/* Google Calendar */}
      <div className={SECTION} data-testid="business-setup-calendar">
        <h3 className={SECTION_TITLE}>Google Calendar</h3>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-sm text-slate-600" data-testid="business-setup-calendar-status">
            {calendar.connected ? `Connected${calendar.email ? ` as ${calendar.email}` : ""}` : "Not connected. Connect so the agent can book appointments."}
          </p>
          {calendar.connected ? (
            <button type="button" data-testid="business-setup-calendar-disconnect" disabled={calendarBusy} onClick={onDisconnectCalendar} className="btn rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-gray-300">
              Disconnect
            </button>
          ) : (
            <button type="button" data-testid="business-setup-calendar-connect" disabled={calendarBusy} onClick={onConnectCalendar} className="btn rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
              {calendarBusy ? "Connecting…" : "Connect Google Calendar"}
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="calendar-id">Calendar ID</label>
            <input data-testid="business-setup-input-calendar-id" id="calendar-id" value={calendarId} onChange={(e) => onCalendarId(e.target.value)} placeholder="primary" className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="timezone">Calendar timezone</label>
            <select data-testid="business-setup-input-timezone" id="timezone" value={timeZone} onChange={(e) => onTimeZone(e.target.value)} className={FIELD}>
              {timezoneMissing ? <option value={timeZone}>{timeZone}</option> : null}
              {TIMEZONE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.zones.map((zone) => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">All availability, bookings, and “today/tomorrow” use this timezone.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Step 3 -------------------------------- */

function StepVoice({
  voiceChoice,
  customVoiceId,
  customInstructions,
  silenceRepromptCount,
  silenceMessage1,
  silenceMessage2,
  goodbyeMessage,
  onVoiceChoice,
  onCustomVoiceId,
  onCustomInstructions,
  onSilenceCount,
  onSilence1,
  onSilence2,
  onGoodbye
}: {
  voiceChoice: string;
  customVoiceId: string;
  customInstructions: string;
  silenceRepromptCount: number;
  silenceMessage1: string;
  silenceMessage2: string;
  goodbyeMessage: string;
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
      <h2 className={H2}>Voice &amp; Instructions</h2>
      <p className={SUB}>Choose how your agent sounds and how it should handle calls.</p>

      <div className="mt-6" data-testid="business-setup-voice">
        <h3 className={SECTION_TITLE}>Voice</h3>
        <div className="mt-3">
          <VoicePicker
            accent="orange"
            testIdPrefix="business-voice-picker"
            selectedVoice={voiceChoice}
            customVoiceId={customVoiceId}
            subtitle="Architect suggested this voice. Your business can use it or choose another voice before deployment."
            onSelectDefault={() => {
              onVoiceChoice("default");
              onCustomVoiceId("");
            }}
            onSelectPreset={(preset) => {
              onVoiceChoice(preset.id);
              onCustomVoiceId("");
            }}
            onCustomVoiceIdChange={(value) => {
              onVoiceChoice("custom");
              onCustomVoiceId(value);
            }}
          />
        </div>
      </div>

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
        <textarea data-testid="business-setup-input-instructions" value={customInstructions} onChange={(e) => onCustomInstructions(e.target.value)} rows={6} placeholder="e.g. Always greet by business name. Confirm date and time before booking." className={`${FIELD} mt-3`} />
      </div>

      <div className={SECTION} data-testid="business-setup-silence">
        <h3 className={SECTION_TITLE}>Silence &amp; no-answer handling</h3>
        <p className="mt-0.5 text-sm text-slate-500">If the caller goes quiet, the AI re-prompts warmly, then ends the call politely.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="silence-count">Re-prompt attempts</label>
            <select data-testid="business-setup-input-silence-count" id="silence-count" value={String(silenceRepromptCount)} onChange={(e) => onSilenceCount(Number(e.target.value))} className={FIELD}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label className={LABEL} htmlFor="silence-1">1st silence re-prompt</label>
          <input data-testid="business-setup-input-silence1" id="silence-1" value={silenceMessage1} onChange={(e) => onSilence1(e.target.value)} placeholder={DEFAULT_SILENCE.reprompt1} className={FIELD} />
        </div>
        <div className="mt-4">
          <label className={LABEL} htmlFor="silence-2">2nd silence re-prompt</label>
          <input data-testid="business-setup-input-silence2" id="silence-2" value={silenceMessage2} onChange={(e) => onSilence2(e.target.value)} placeholder={DEFAULT_SILENCE.reprompt2} className={FIELD} />
        </div>
        <div className="mt-4">
          <label className={LABEL} htmlFor="goodbye">Goodbye message</label>
          <input data-testid="business-setup-input-goodbye" id="goodbye" value={goodbyeMessage} onChange={(e) => onGoodbye(e.target.value)} placeholder={DEFAULT_SILENCE.goodbye} className={FIELD} />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Step 4 -------------------------------- */

function StepDeploy({
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
      <h2 className={H2}>Test &amp; go live</h2>
      <p className={SUB}>
        Deploy builds your live assistant with your voice, timezone, and instructions, and routes your CoreAI number
        {assignedNumber ? <span className="font-mono font-bold text-slate-700"> {assignedNumber}</span> : null} to it.
      </p>

      <div className="mt-6">
        <ChecklistSummary checklist={checklist} />
      </div>

      <div className={SECTION}>
        {blockers.length > 0 ? (
          <div data-testid="business-setup-blockers" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">Complete these before you can deploy live:</p>
            <ul className="mt-1 list-disc pl-5">
              {blockers.map((blocker) => (
                <li key={blocker} data-testid="business-setup-blocker">{blocker}</li>
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
            After deploy, call your CoreAI number to test the live agent. Calendar booking uses your connected Google Calendar and timezone.
          </p>
        ) : null}
      </div>
    </div>
  );
}
