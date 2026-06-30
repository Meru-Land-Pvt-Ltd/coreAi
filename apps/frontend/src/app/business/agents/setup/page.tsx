"use client";

import type { Route } from "next";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { VOICE_PRESETS } from "@coreai/shared";
import { DashboardShell } from "@/components/common/dashboard-shell";
import { VoicePicker } from "@/components/common/voice-picker";
import {
  disconnectBusinessCalendar,
  getBusinessCalendarOAuthUrl,
  getBusinessSetup,
  getMarketplaceListing,
  saveBusinessSetup,
  type BusinessFaq,
  type BusinessHoursItem,
  type BusinessKnowledgeItem
} from "@/components/business/features/api";

const DASHBOARD_ROUTE = "/business/dashboard" as Route;

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

function defaultHours(): BusinessHoursItem[] {
  return DAYS.map((day) => {
    const weekend = day === "Saturday" || day === "Sunday";
    return {
      day,
      open: weekend ? "" : "09:00",
      close: weekend ? "" : "17:00",
      closed: weekend
    };
  });
}

function normalizeHours(stored: BusinessHoursItem[]): BusinessHoursItem[] {
  const byDay = new Map(stored.map((item) => [item.day, item]));
  return DAYS.map((day) => byDay.get(day) ?? { day, open: "", close: "", closed: true });
}

function parseLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const inputClass =
  "mt-1 w-full rounded-xl border border-orange-200 bg-white px-4 py-3 text-sm text-orange-950 placeholder-orange-300 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100";
const labelClass = "text-sm font-semibold text-orange-900";
const cardClass = "rounded-3xl soft-card p-6";
const sectionTitleClass = "text-lg font-bold text-orange-950";
const addButtonClass =
  "rounded-full border border-orange-300 px-4 py-2 text-sm font-semibold text-orange-800 transition hover:border-orange-400";
const removeButtonClass =
  "rounded-full border border-orange-200 px-3 py-1 text-xs font-semibold text-orange-700 transition hover:border-orange-400";

const INTRO_COPY =
  "Architects design the agent. Your business connects the accounts, phone routing, calendar, Gmail, and voice settings used when the agent runs live.";

const ANSWERING_MODES: { value: string; label: string }[] = [
  { value: "AI_FIRST", label: "AI answers all calls" },
  { value: "NO_ANSWER", label: "AI answers missed / no-answer calls" },
  { value: "BUSY", label: "AI answers when the line is busy" },
  { value: "AFTER_HOURS", label: "AI answers after business hours" },
  { value: "UNREACHABLE", label: "AI answers when the phone is unreachable" }
];

/** Preset voice ids (sarah/james/priya) — anything else is "default" or "custom". */
const PRESET_VOICE_IDS = new Set(VOICE_PRESETS.map((preset) => preset.id));

type ChecklistRow = {
  key: string;
  label: string;
  required: boolean;
  complete: boolean;
  blocker?: string;
};

export default function BusinessAgentSetupPage() {
  return (
    <DashboardShell
      role="BUSINESS"
      title="Set up your AI Receptionist"
      subtitle="Configure your Missed Call Text-Back agent. We assign your CoreAI phone number automatically — no Twilio keys needed."
    >
      <SetupWizard />
    </DashboardShell>
  );
}

function SetupWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listingId = searchParams.get("listingId") ?? "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ phoneNumber: string } | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [forwardToPhone, setForwardToPhone] = useState("");
  const [teamPhone, setTeamPhone] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [tone, setTone] = useState("friendly");
  const [escalationRules, setEscalationRules] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [faqs, setFaqs] = useState<BusinessFaq[]>([]);
  const [hours, setHours] = useState<BusinessHoursItem[]>(defaultHours());
  const [knowledge, setKnowledge] = useState<BusinessKnowledgeItem[]>([]);
  const [vapiAssistantId, setVapiAssistantId] = useState("");
  const [vapiPhoneNumberId, setVapiPhoneNumberId] = useState("");
  const [calendarId, setCalendarId] = useState("primary");

  const [assignedNumber, setAssignedNumber] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<{ connected: boolean; email: string | null }>({
    connected: false,
    email: null
  });
  const [calendarBusy, setCalendarBusy] = useState(false);

  // Connector keys the installed agent requires (from /business/setup, unioned
  // with the listing pre-install) + the buyer's voice/answering-mode choices.
  const [requiredKeys, setRequiredKeys] = useState<string[]>([]);
  const [voiceChoice, setVoiceChoice] = useState("default");
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [answeringMode, setAnsweringMode] = useState("NO_ANSWER");
  const [deployed, setDeployed] = useState(false);

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
        setTimeZone(data.profile.timeZone ?? "America/New_York");
        setTone(data.profile.tone ?? "friendly");
        setEscalationRules(data.profile.escalationRules ?? "");
        setServicesText((data.profile.services ?? []).join("\n"));
        setVapiAssistantId(data.profile.vapiAssistantId ?? "");
        setVapiPhoneNumberId(data.profile.vapiPhoneNumberId ?? "");
        setCalendarId(data.profile.calendarId ?? "primary");

        if (Array.isArray(data.profile.faqs) && data.profile.faqs.length > 0) {
          setFaqs(data.profile.faqs);
        }
        if (Array.isArray(data.profile.hours) && data.profile.hours.length > 0) {
          setHours(normalizeHours(data.profile.hours));
        }
      }

      if (Array.isArray(data.knowledge) && data.knowledge.length > 0) {
        setKnowledge(data.knowledge);
      }

      if (data.phoneNumber) {
        setForwardToPhone(data.phoneNumber.forwardToPhone ?? "");
        setAssignedNumber(data.phoneNumber.phoneNumber ?? null);
      }

      setCalendar(data.calendar ?? { connected: false, email: null });
      setAnsweringMode(data.answeringMode || "NO_ANSWER");

      const selection = data.voiceSelection ?? null;
      if (selection?.voiceId) {
        setVoiceChoice("custom");
        setCustomVoiceId(selection.voiceId);
      } else if (selection?.name && PRESET_VOICE_IDS.has(selection.name)) {
        setVoiceChoice(selection.name);
      }

      // Connectors the agent needs: from the installed workflow, or — before the
      // first save resolves it — from the marketplace listing being installed.
      let keys = (data.requiredConnectors ?? []).map((req) => req.connector);
      if (listingId && !data.installedAgent) {
        const listingRes = await getMarketplaceListing(listingId);
        if (listingRes.success && listingRes.data?.listing) {
          keys = Array.from(new Set([...keys, ...listingRes.data.listing.requiredConnectors]));
        }
      }
      setRequiredKeys(keys);
    }

    setLoading(false);
  }, [listingId]);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  function updateHours(index: number, patch: Partial<BusinessHoursItem>) {
    setHours((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
  }

  // Map the voice picker to the fields /business/setup persists. "default" leaves
  // all blank → backend uses the agent default / env fallback voice.
  function buildVoiceFields(): { voice: string; voiceProvider: string; voiceId: string } {
    if (voiceChoice === "custom") {
      return { voice: "", voiceProvider: "11labs", voiceId: customVoiceId.trim() };
    }
    if (PRESET_VOICE_IDS.has(voiceChoice)) {
      return { voice: voiceChoice, voiceProvider: "11labs", voiceId: "" };
    }
    return { voice: "", voiceProvider: "", voiceId: "" };
  }

  // Single save path used by both "Deploy live agent" and save-before-connect.
  async function persistSetup(): Promise<{ ok: boolean; number: string }> {
    const voiceFields = buildVoiceFields();
    const res = await saveBusinessSetup({
      businessName: businessName.trim(),
      businessType: businessType.trim(),
      forwardToPhone: forwardToPhone.trim(),
      bookingUrl: bookingUrl.trim(),
      teamPhone: teamPhone.trim(),
      timeZone: timeZone.trim() || "America/New_York",
      tone,
      escalationRules: escalationRules.trim(),
      services: parseLines(servicesText),
      faqs: faqs
        .filter((faq) => faq.question.trim() && faq.answer.trim())
        .map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() })),
      hours,
      knowledge: knowledge
        .filter((item) => item.title.trim() && item.content.trim())
        .map((item) => ({ title: item.title.trim(), content: item.content.trim() })),
      vapiAssistantId: vapiAssistantId.trim(),
      vapiPhoneNumberId: vapiPhoneNumberId.trim(),
      voice: voiceFields.voice,
      voiceProvider: voiceFields.voiceProvider,
      voiceId: voiceFields.voiceId,
      answeringMode,
      calendarId: calendarId.trim() || "primary",
      ...(listingId ? { listingId } : {})
    });

    if (!res.success || !res.data) {
      setError(res.error ?? "Could not save your setup. Please try again.");
      return { ok: false, number: "" };
    }

    const number = res.data.assignedPhoneNumber ?? res.data.phoneNumber?.phoneNumber ?? assignedNumber ?? "";
    if (number) setAssignedNumber(number);
    if (res.data.requiredConnectors) {
      setRequiredKeys(res.data.requiredConnectors.map((req) => req.connector));
    }
    setCalendar(res.data.calendar ?? calendar);
    return { ok: true, number };
  }

  async function handleConnectCalendar() {
    setError("");
    setCalendarBusy(true);

    // Persist first so the buyer's form input survives the OAuth redirect — only
    // when the required basics are present (the save would otherwise 422).
    if (
      businessName.trim().length >= 2 &&
      businessType.trim().length >= 2 &&
      forwardToPhone.trim().length >= 5
    ) {
      const saved = await persistSetup();
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (businessName.trim().length < 2) {
      setError("Please enter your business name.");
      return;
    }
    if (businessType.trim().length < 2) {
      setError("Please enter your business type / industry.");
      return;
    }
    if (forwardToPhone.trim().length < 5) {
      setError("Please enter the phone number to forward calls to.");
      return;
    }

    setSaving(true);
    const result = await persistSetup();
    setSaving(false);

    if (!result.ok) return;

    setDeployed(true);
    setSuccess({ phoneNumber: result.number });

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // Buyer install readiness (client-side, live as the buyer fills the form /
  // connects accounts). Mirrors the backend checklist; gates "Deploy live agent".
  const needs = new Set(requiredKeys);
  const businessComplete = businessName.trim().length >= 2 && businessType.trim().length >= 2;
  const phoneComplete = forwardToPhone.trim().length >= 5;
  const voiceComplete = voiceChoice !== "custom" || customVoiceId.trim().length > 0;
  const needsGmail = needs.has("gmail");
  const needsCalendar = needs.has("google_calendar");
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
            label: "Phone routing / number",
            required: true,
            complete: phoneComplete,
            blocker: phoneComplete ? undefined : "Phone routing is required before live calls."
          }
        ]
      : []),
    ...(needsSms
      ? [
          {
            key: "sms_sender",
            label: "SMS sender",
            required: true,
            complete: phoneComplete,
            blocker: phoneComplete
              ? undefined
              : "An SMS sender (assigned number) is required before notifications."
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
      : []),
    {
      key: "live_deployment",
      label: "Live deployment",
      required: false,
      complete: deployed,
      blocker: undefined
    }
  ];

  const readyToDeploy = checklist.every((row) => !row.required || row.complete);
  const blockers = checklist
    .filter((row) => row.required && !row.complete && row.blocker)
    .map((row) => row.blocker as string);

  if (loading) {
    return (
      <div data-testid="business-setup-loading" className="rounded-3xl soft-card p-8 text-sm text-orange-800">
        Loading your setup…
      </div>
    );
  }

  if (success) {
    return (
      <div data-testid="business-setup-success" className="rounded-3xl soft-card p-8">
        <span
          data-testid="business-setup-success-badge"
          className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700"
        >
          ✓ Agent installed
        </span>

        <h2 data-testid="business-setup-success-title" className="mt-4 text-2xl font-bold text-orange-950">
          Your AI Receptionist is ready
        </h2>

        <p data-testid="business-setup-success-subtitle" className="mt-2 text-sm text-orange-800/80">
          Forward your missed calls to CoreAI and we&apos;ll text your callers back automatically.
        </p>

        <div
          data-testid="business-setup-assigned-number"
          className="mt-6 rounded-2xl bg-orange-50 p-5"
        >
          <p data-testid="business-setup-assigned-number-label" className="text-sm text-orange-700">
            Your CoreAI phone number
          </p>
          <p
            data-testid="business-setup-assigned-number-value"
            className="mt-1 text-3xl font-bold tracking-tight text-orange-950"
          >
            {success.phoneNumber || assignedNumber || "Pending assignment"}
          </p>
        </div>

        <div data-testid="business-setup-success-actions" className="mt-6 flex flex-wrap gap-3">
          <button
            data-testid="business-setup-go-dashboard"
            type="button"
            onClick={() => router.push(DASHBOARD_ROUTE)}
            className="rounded-full bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-600"
          >
            Go to Dashboard
          </button>
          <button
            data-testid="business-setup-edit-again"
            type="button"
            onClick={() => setSuccess(null)}
            className="rounded-full border border-orange-300 px-5 py-3 text-sm font-semibold text-orange-800 transition hover:border-orange-400"
          >
            Edit setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <form data-testid="business-setup-form" onSubmit={handleSubmit} className="space-y-5">
      <div data-testid="business-setup-intro" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-intro-heading">Connect your business</h2>
        <p data-testid="business-setup-intro-copy" className="mt-2 text-sm text-orange-800/80">
          {INTRO_COPY}
        </p>
        <p
          data-testid="business-setup-ownership-note"
          className="mt-3 rounded-2xl bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900"
        >
          Your business owns this live setup. Architects only designed the agent template.
        </p>
      </div>

      <div data-testid="business-setup-checklist" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-checklist-heading">
          Required setup for this agent
        </h2>
        <ul className="mt-4 space-y-2">
          {checklist.map((row) => (
            <li
              key={row.key}
              data-testid={`business-setup-checklist-${row.key}`}
              className="flex items-start gap-3 rounded-2xl bg-orange-50 p-3"
            >
              <span
                data-testid={`business-setup-checklist-${row.key}-status`}
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  row.complete ? "bg-green-100 text-green-700" : "bg-orange-200 text-orange-800"
                }`}
              >
                {row.complete ? "✓" : "•"}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-orange-950">
                  {row.label}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      row.required ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {row.required ? "Required" : "Optional"}
                  </span>
                  <span
                    className={`ml-2 text-xs font-semibold ${row.complete ? "text-green-700" : "text-orange-700"}`}
                  >
                    {row.complete ? "Complete" : "Not complete"}
                  </span>
                </p>
                {!row.complete && row.blocker ? (
                  <p
                    data-testid={`business-setup-checklist-${row.key}-blocker`}
                    className="mt-1 text-xs text-orange-700/80"
                  >
                    {row.blocker}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div data-testid="business-setup-number-notice" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-core-ai-phone-number-heading">CoreAI phone number</h2>
        <p data-testid="business-setup-number-notice-text" className="mt-2 text-sm text-orange-800/80">
          {assignedNumber
            ? "Your CoreAI phone number is assigned and ready."
            : "Your CoreAI phone number will be assigned automatically. You don't need a Twilio account or API keys."}
        </p>
        {assignedNumber ? (
          <p data-testid="business-setup-current-number" className="mt-3 text-lg font-bold text-orange-950">
            {assignedNumber}
          </p>
        ) : null}
      </div>

      <div data-testid="business-setup-basics" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-business-details-heading">Business details</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label data-testid="business-setup-label-name" htmlFor="business-name" className={labelClass}>
              Business name
            </label>
            <input
              data-testid="business-setup-input-name"
              id="business-name"
              type="text"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              placeholder="Bright Smile Dental"
              className={inputClass}
            />
          </div>
          <div>
            <label data-testid="business-setup-label-type" htmlFor="business-type" className={labelClass}>
              Business type / industry
            </label>
            <input
              data-testid="business-setup-input-type"
              id="business-type"
              type="text"
              value={businessType}
              onChange={(event) => setBusinessType(event.target.value)}
              placeholder="Dental practice, HVAC, salon, law firm…"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div data-testid="business-setup-call-handling" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-call-handling-heading">Call handling</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label data-testid="business-setup-label-forward" htmlFor="forward-phone" className={labelClass}>
              Forwarding phone number
            </label>
            <input
              data-testid="business-setup-input-forward"
              id="forward-phone"
              type="tel"
              value={forwardToPhone}
              onChange={(event) => setForwardToPhone(event.target.value)}
              placeholder="+1 555 123 4567"
              className={inputClass}
            />
            <p data-testid="business-setup-forward-hint" className="mt-1 text-xs text-orange-700/70">
              Calls to your CoreAI number ring here first. If unanswered, we text the caller back.
            </p>
          </div>
          <div>
            <label data-testid="business-setup-label-team" htmlFor="team-phone" className={labelClass}>
              Team phone (optional)
            </label>
            <input
              data-testid="business-setup-input-team"
              id="team-phone"
              type="tel"
              value={teamPhone}
              onChange={(event) => setTeamPhone(event.target.value)}
              placeholder="+1 555 765 4321"
              className={inputClass}
            />
          </div>
        </div>

        {needsPhone || needsSms ? (
          <div data-testid="business-setup-phone-routing" className="mt-4 space-y-4">
            <div className="rounded-2xl bg-orange-50 p-4">
              <p
                data-testid="business-setup-assigned-forwarding-label"
                className="text-sm font-semibold text-orange-900"
              >
                Assigned CoreAI forwarding number
              </p>
              <p data-testid="business-setup-assigned-forwarding" className="mt-1 text-lg font-bold text-orange-950">
                {assignedNumber ?? "Assigned automatically when you deploy"}
              </p>
              <p data-testid="business-setup-phone-routing-note" className="mt-2 text-xs text-orange-700/80">
                The agent template only defines that a phone number is required — your business configures the
                actual number and routing here. Publish this CoreAI number directly, or forward your existing
                business number to it. Numbers come from the CoreAI platform pool for now; bring-your-own Twilio
                can be added later.
              </p>
            </div>
            <div>
              <label data-testid="business-setup-label-answering-mode" htmlFor="answering-mode" className={labelClass}>
                Answering mode
              </label>
              <select
                data-testid="business-setup-input-answering-mode"
                id="answering-mode"
                value={answeringMode}
                onChange={(event) => setAnsweringMode(event.target.value)}
                className={inputClass}
              >
                {ANSWERING_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      <div data-testid="business-setup-services" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-services-heading">Services</h2>
        <label data-testid="business-setup-label-services" htmlFor="services" className="sr-only">
          Services
        </label>
        <textarea
          data-testid="business-setup-input-services"
          id="services"
          value={servicesText}
          onChange={(event) => setServicesText(event.target.value)}
          rows={4}
          placeholder="One service per line, e.g.&#10;Teeth cleaning&#10;Emergency visits&#10;Whitening"
          className={inputClass}
        />
      </div>

      <div data-testid="business-setup-faqs" className={cardClass}>
        <div className="flex items-center justify-between">
          <h2 className={sectionTitleClass} data-testid="business-agents-setup-faqs-heading">FAQs</h2>
          <button
            data-testid="business-setup-faq-add"
            type="button"
            onClick={() => setFaqs((current) => [...current, { question: "", answer: "" }])}
            className={addButtonClass}
          >
            + Add FAQ
          </button>
        </div>

        {faqs.length === 0 ? (
          <p data-testid="business-setup-faq-empty" className="mt-3 text-sm text-orange-700/70">
            Add common questions and answers so the agent can reply accurately.
          </p>
        ) : null}

        <div className="mt-4 space-y-4">
          {faqs.map((faq, index) => (
            <div data-testid="business-setup-faq-row" key={index} className="rounded-2xl bg-orange-50 p-4">
              <input
                data-testid="business-setup-faq-question"
                type="text"
                value={faq.question}
                onChange={(event) =>
                  setFaqs((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, question: event.target.value } : item
                    )
                  )
                }
                placeholder="Question"
                className={inputClass}
              />
              <textarea
                data-testid="business-setup-faq-answer"
                value={faq.answer}
                onChange={(event) =>
                  setFaqs((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, answer: event.target.value } : item
                    )
                  )
                }
                rows={2}
                placeholder="Answer"
                className={inputClass}
              />
              <div className="mt-2 flex justify-end">
                <button
                  data-testid="business-setup-faq-remove"
                  type="button"
                  onClick={() => setFaqs((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  className={removeButtonClass}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div data-testid="business-setup-hours" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-business-hours-heading">Business hours</h2>
        <div className="mt-4 space-y-2">
          {hours.map((entry, index) => (
            <div
              data-testid="business-setup-hours-row"
              key={entry.day}
              className="flex flex-wrap items-center gap-3 rounded-2xl bg-orange-50 p-3"
            >
              <span data-testid="business-setup-hours-day" className="w-24 text-sm font-semibold text-orange-900">
                {entry.day}
              </span>
              <input
                data-testid="business-setup-hours-open"
                type="time"
                value={entry.open ?? ""}
                disabled={entry.closed}
                onChange={(event) => updateHours(index, { open: event.target.value })}
                className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm text-orange-950 disabled:opacity-50"
              />
              <span className="text-sm text-orange-700" data-testid="business-agents-setup-to-text">to</span>
              <input
                data-testid="business-setup-hours-close"
                type="time"
                value={entry.close ?? ""}
                disabled={entry.closed}
                onChange={(event) => updateHours(index, { close: event.target.value })}
                className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm text-orange-950 disabled:opacity-50"
              />
              <label data-testid="business-setup-hours-closed-label" className="ml-auto flex items-center gap-2 text-sm text-orange-800">
                <input
                  data-testid="business-setup-hours-closed"
                  type="checkbox"
                  checked={entry.closed}
                  onChange={(event) => updateHours(index, { closed: event.target.checked })}
                />
                Closed
              </label>
            </div>
          ))}
        </div>
      </div>

      <div data-testid="business-setup-booking" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-booking-and-tone-heading">Booking &amp; tone</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label data-testid="business-setup-label-booking" htmlFor="booking-url" className={labelClass}>
              Booking URL (optional)
            </label>
            <input
              data-testid="business-setup-input-booking"
              id="booking-url"
              type="url"
              value={bookingUrl}
              onChange={(event) => setBookingUrl(event.target.value)}
              placeholder="https://calendly.com/your-business"
              className={inputClass}
            />
          </div>
          <div>
            <label data-testid="business-setup-label-tone" htmlFor="tone" className={labelClass}>
              Tone
            </label>
            <select
              data-testid="business-setup-input-tone"
              id="tone"
              value={tone}
              onChange={(event) => setTone(event.target.value)}
              className={inputClass}
            >
              <option value="friendly">Friendly</option>
              <option value="professional">Professional</option>
              <option value="warm">Warm</option>
              <option value="formal">Formal</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label data-testid="business-setup-label-escalation" htmlFor="escalation" className={labelClass}>
            Escalation rules (optional)
          </label>
          <textarea
            data-testid="business-setup-input-escalation"
            id="escalation"
            value={escalationRules}
            onChange={(event) => setEscalationRules(event.target.value)}
            rows={3}
            placeholder="When should the agent hand off to a human? e.g. emergencies, billing disputes."
            className={inputClass}
          />
        </div>
      </div>

      <div data-testid="business-setup-knowledge" className={cardClass}>
        <div className="flex items-center justify-between">
          <h2 className={sectionTitleClass} data-testid="business-agents-setup-knowledge-base-heading">Knowledge base</h2>
          <button
            data-testid="business-setup-knowledge-add"
            type="button"
            onClick={() => setKnowledge((current) => [...current, { title: "", content: "" }])}
            className={addButtonClass}
          >
            + Add entry
          </button>
        </div>

        {knowledge.length === 0 ? (
          <p data-testid="business-setup-knowledge-empty" className="mt-3 text-sm text-orange-700/70">
            Add extra context (policies, pricing, directions) the agent can use.
          </p>
        ) : null}

        <div className="mt-4 space-y-4">
          {knowledge.map((item, index) => (
            <div data-testid="business-setup-knowledge-row" key={index} className="rounded-2xl bg-orange-50 p-4">
              <input
                data-testid="business-setup-knowledge-title"
                type="text"
                value={item.title}
                onChange={(event) =>
                  setKnowledge((current) =>
                    current.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, title: event.target.value } : entry
                    )
                  )
                }
                placeholder="Title"
                className={inputClass}
              />
              <textarea
                data-testid="business-setup-knowledge-content"
                value={item.content}
                onChange={(event) =>
                  setKnowledge((current) =>
                    current.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, content: event.target.value } : entry
                    )
                  )
                }
                rows={3}
                placeholder="Content"
                className={inputClass}
              />
              <div className="mt-2 flex justify-end">
                <button
                  data-testid="business-setup-knowledge-remove"
                  type="button"
                  onClick={() =>
                    setKnowledge((current) => current.filter((_, entryIndex) => entryIndex !== index))
                  }
                  className={removeButtonClass}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div data-testid="business-setup-integrations" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-integrations-heading">Integrations</h2>

        <div data-testid="business-setup-calendar" className="mt-4 rounded-2xl bg-orange-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p data-testid="business-setup-calendar-title" className="text-sm font-semibold text-orange-900">
                Google Calendar
              </p>
              <p data-testid="business-setup-calendar-status" className="mt-1 text-sm text-orange-800/80">
                {calendar.connected
                  ? `Connected${calendar.email ? ` as ${calendar.email}` : ""}`
                  : "Not connected. Connect to let the agent book appointments."}
              </p>
            </div>
            {calendar.connected ? (
              <button
                data-testid="business-setup-calendar-disconnect"
                type="button"
                disabled={calendarBusy}
                onClick={handleDisconnectCalendar}
                className={removeButtonClass}
              >
                Disconnect
              </button>
            ) : (
              <button
                data-testid="business-setup-calendar-connect"
                type="button"
                disabled={calendarBusy}
                onClick={handleConnectCalendar}
                className="rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
              >
                {calendarBusy ? "Connecting…" : "Connect Google Calendar"}
              </button>
            )}
          </div>
        </div>

        {needsGmail ? (
          <div data-testid="business-setup-gmail" className="mt-4 rounded-2xl bg-orange-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p data-testid="business-setup-gmail-title" className="text-sm font-semibold text-orange-900">
                  Gmail
                </p>
                <p data-testid="business-setup-gmail-status" className="mt-1 text-sm text-orange-800/80">
                  {calendar.connected
                    ? `Connected${calendar.email ? ` as ${calendar.email}` : ""}`
                    : "Not connected. Connect your Google account so the agent can send email."}
                </p>
              </div>
              {calendar.connected ? (
                <span
                  data-testid="business-setup-gmail-connected"
                  className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700"
                >
                  Connected
                </span>
              ) : (
                <button
                  data-testid="business-setup-gmail-connect"
                  type="button"
                  disabled={calendarBusy}
                  onClick={handleConnectCalendar}
                  className="rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
                >
                  {calendarBusy ? "Connecting…" : "Connect Gmail"}
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-orange-700/70" data-testid="business-setup-gmail-note">
              Gmail and Google Calendar share one Google connection.
            </p>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label data-testid="business-setup-label-calendar-id" htmlFor="calendar-id" className={labelClass}>
              Calendar ID
            </label>
            <input
              data-testid="business-setup-input-calendar-id"
              id="calendar-id"
              type="text"
              value={calendarId}
              onChange={(event) => setCalendarId(event.target.value)}
              placeholder="primary"
              className={inputClass}
            />
          </div>
          <div>
            <label data-testid="business-setup-label-timezone" htmlFor="timezone" className={labelClass}>
              Time zone
            </label>
            <input
              data-testid="business-setup-input-timezone"
              id="timezone"
              type="text"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              placeholder="America/New_York"
              className={inputClass}
            />
          </div>
          <div>
            <label data-testid="business-setup-label-vapi-assistant" htmlFor="vapi-assistant" className={labelClass}>
              Vapi assistant ID (optional)
            </label>
            <input
              data-testid="business-setup-input-vapi-assistant"
              id="vapi-assistant"
              type="text"
              value={vapiAssistantId}
              onChange={(event) => setVapiAssistantId(event.target.value)}
              placeholder="Leave blank to use the CoreAI default"
              className={inputClass}
            />
          </div>
          <div>
            <label data-testid="business-setup-label-vapi-phone" htmlFor="vapi-phone" className={labelClass}>
              Vapi phone number ID (optional)
            </label>
            <input
              data-testid="business-setup-input-vapi-phone"
              id="vapi-phone"
              type="text"
              value={vapiPhoneNumberId}
              onChange={(event) => setVapiPhoneNumberId(event.target.value)}
              placeholder="Leave blank to use the CoreAI default"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div data-testid="business-setup-voice" className={cardClass}>
        <h2 className={sectionTitleClass} data-testid="business-agents-setup-voice-heading">Voice</h2>
        <div className="mt-3">
          <VoicePicker
            accent="orange"
            selectedVoice={voiceChoice}
            customVoiceId={customVoiceId}
            testIdPrefix="business-voice-picker"
            subtitle="Architect suggested this voice. Your business can use it or choose another voice before deployment."
            onSelectDefault={() => {
              setVoiceChoice("default");
              setCustomVoiceId("");
            }}
            onSelectPreset={(preset) => {
              setVoiceChoice(preset.id);
              setCustomVoiceId("");
            }}
            onCustomVoiceIdChange={(value) => {
              setVoiceChoice("custom");
              setCustomVoiceId(value);
            }}
          />
        </div>
        <p data-testid="business-setup-voice-note" className="mt-2 text-xs text-orange-700/70">
          If you don&apos;t enter a custom ID, CoreAI uses the agent default (ElevenLabs via Vapi) or the platform fallback voice.
        </p>
      </div>

      {error ? (
        <p data-testid="business-setup-error" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {blockers.length > 0 ? (
        <div data-testid="business-setup-blockers" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold" data-testid="business-setup-blockers-title">
            Complete these before you can deploy live:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {blockers.map((blocker) => (
              <li key={blocker} data-testid="business-setup-blocker">
                {blocker}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div data-testid="business-setup-actions" className="flex justify-end">
        <button
          data-testid="business-setup-submit"
          type="submit"
          disabled={saving || !readyToDeploy}
          className="rounded-full bg-orange-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
        >
          {saving ? "Deploying…" : "Deploy live agent"}
        </button>
      </div>
    </form>
  );
}
