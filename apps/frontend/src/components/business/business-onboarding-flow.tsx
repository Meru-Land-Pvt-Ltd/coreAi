"use client";

import Image from "next/image";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import {
  BUSINESS_MARKETPLACE_PATH,
  businessAgentPath
} from "@/lib/routes";

const TRIVEN_LOGO_SRC = encodeURI("/triven.ai word logo transparent bg.PNG");

const TEAM_SIZES = ["Just me", "2-5", "6-15", "16-50", "50+"];
const MONTHLY_VOLUMES = ["Under 100", "100-300", "300-500", "500-1000", "1000+"];
const SOFTWARE_OPTIONS = [
  "Dentrix",
  "Eaglesoft",
  "Open Dental",
  "Curve Dental",
  "PracticeWorks",
  "Other PMS",
  "None / Paper-based"
];

const BUSINESS_TYPES = [
  { value: "solo", label: "Solo dental practice" },
  { value: "group", label: "Group dental practice (2–5 dentists)" },
  { value: "dso", label: "Dental Service Organization (DSO)" },
  { value: "ortho", label: "Orthodontics practice" },
  { value: "pedo", label: "Pediatric dentistry" },
  { value: "oral", label: "Oral surgery / Specialty" },
  { value: "health", label: "Other healthcare" },
  { value: "non-dental", label: "Non-dental business" }
];

const PAIN_POINTS = [
  ["missed-calls", "📞", "Missed calls & follow-ups", "Patients call after hours and never call back"],
  ["scheduling", "📅", "Appointment scheduling", "Too much time spent on phone scheduling"],
  ["communication", "💬", "Patient communication", "Reminders, confirmations, and follow-ups"],
  ["reviews", "⭐", "Online reviews", "Need more Google/Yelp reviews from happy patients"],
  ["billing", "💰", "Billing & collections", "Outstanding balances and payment follow-ups"],
  ["intake", "📋", "New patient intake", "Paper forms, manual data entry"],
  ["analytics", "📊", "Practice analytics", "No visibility into practice performance"],
  ["recall", "🔄", "Patient recall", "Patients overdue for hygiene/checkups"],
  ["frontdesk", "🤖", "Front desk automation", "Staff overwhelmed with repetitive tasks"]
] as const;

const PAIN_LABELS = Object.fromEntries(
  PAIN_POINTS.map(([id, , label]) => [id, label])
) as Record<string, string>;

const STEP_TITLES = ["", "Welcome", "Business profile", "Your challenges", "How Triven works", "Recommended for you"];

type OnboardingData = {
  businessName: string;
  businessType: string;
  teamSize: string;
  monthlyVolume: string;
  software: string[];
  industry: string;
  challenges: string[];
  lastStep: number;
  skippedFrom: number | null;
};

type RecommendedAgent = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  rating: number;
  installCount: number;
  matchedChallenges: string[];
  tags: string[];
};

type StepKey = 1 | 2 | 3 | 4 | 5 | "done";

const ONBOARDING_STYLES = `
.onboarding-root { font-family: 'Inter', system-ui, sans-serif; }
.onboarding-elev { box-shadow: 0 8px 34px rgba(15,23,42,.07); border: 1px solid #eef2f7; }
@keyframes onboardingInR { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: none; } }
@keyframes onboardingOutL { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(-26px); } }
@keyframes onboardingInL { from { opacity: 0; transform: translateX(-26px); } to { opacity: 1; transform: none; } }
@keyframes onboardingOutR { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(26px); } }
.onboarding-in-right { animation: onboardingInR .3s ease-out; }
.onboarding-out-left { animation: onboardingOutL .3s ease-out forwards; }
.onboarding-in-left { animation: onboardingInL .3s ease-out; }
.onboarding-out-right { animation: onboardingOutR .3s ease-out forwards; }
#onboarding-stage { transition: height .3s ease; }
@keyframes onboardingFloatY { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.onboarding-float { animation: onboardingFloatY 3s ease-in-out infinite; }
@keyframes onboardingTw { 0%, 100% { opacity: .25; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } }
.onboarding-sparkle { transform-box: fill-box; transform-origin: center; animation: onboardingTw 2s ease-in-out infinite; }
@keyframes onboardingPop { 0% { transform: scale(0); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
@keyframes onboardingUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.onboarding-fade-up { animation: onboardingUp .4s ease-out both; }
@keyframes onboardingShake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
.onboarding-shake { animation: onboardingShake .3s ease; }
.onboarding-pill { transition: background-color .15s, border-color .15s, color .15s; }
.onboarding-pill:not([aria-checked="true"]):hover { background: #f8fafc; }
.onboarding-pill[aria-checked="true"] { background: #f59e0b; border-color: #f59e0b; color: #fff; }
.onboarding-chip { transition: background-color .15s, border-color .15s, color .15s; }
.onboarding-chip .chk { display: none; }
.onboarding-chip:not([aria-checked="true"]):hover { background: #f8fafc; }
.onboarding-chip[aria-checked="true"] { background: #fffbeb; border-color: #f59e0b; color: #b45309; }
.onboarding-chip[aria-checked="true"] .chk { display: inline; color: #f59e0b; }
.onboarding-paincard { border: 1px solid #e2e8f0; transition: transform .15s, border-color .15s, background-color .15s, box-shadow .15s; }
.onboarding-paincard:not([aria-checked="true"]):hover { background: #f8fafc; box-shadow: 0 2px 12px rgba(15,23,42,.05); }
.onboarding-paincard:hover { transform: scale(1.02); }
.onboarding-paincard[aria-checked="true"] { border-color: #f59e0b; background: #fffbeb; }
.onboarding-pc-check { opacity: 0; transform: scale(0); }
.onboarding-paincard[aria-checked="true"] .onboarding-pc-check { opacity: 1; animation: onboardingPop .22s cubic-bezier(.34,1.56,.64,1) forwards; }
@media (prefers-reduced-motion: reduce) {
  .onboarding-root *, #onboarding-stage { animation: none !important; transition: none !important; }
  .onboarding-pc-check { opacity: 1; transform: none; }
  .onboarding-paincard:hover { transform: none; }
}
`;

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

function greetingName(displayName: string) {
  const first = displayName.trim().split(/\s+/)[0] ?? displayName;
  return first || "there";
}

export function BusinessOnboardingFlow() {
  const router = useRouter();
  const stageRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<StepKey>(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [displayName, setDisplayName] = useState("there");
  const [doneKind, setDoneKind] = useState<"done" | "skip">("done");
  const [toast, setToast] = useState("");
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [showPainHint, setShowPainHint] = useState(false);
  const [recommendations, setRecommendations] = useState<RecommendedAgent[]>([]);
  const [form, setForm] = useState<OnboardingData>({
    businessName: "",
    businessType: "",
    teamSize: "",
    monthlyVolume: "",
    software: [],
    industry: "",
    challenges: [],
    lastStep: 1,
    skippedFrom: null
  });

  const progress = step === "done" ? 100 : (Number(step) / 5) * 100;
  const firstName = greetingName(displayName);

  const orderedRecommendations = useMemo(() => {
    if (form.challenges.length === 0) return recommendations.slice(0, 3);
    const matched = recommendations.filter((agent) => agent.matchedChallenges.length > 0);
    const rest = recommendations.filter((agent) => agent.matchedChallenges.length === 0);
    return [...matched, ...rest].slice(0, 3);
  }, [form.challenges, recommendations]);

  const resizeStage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const active = stage.querySelector<HTMLElement>("[data-onboarding-active='true']");
    if (active) {
      stage.style.height = `${active.offsetHeight}px`;
    }
  }, []);

  useEffect(() => {
    resizeStage();
    window.addEventListener("resize", resizeStage);
    return () => window.removeEventListener("resize", resizeStage);
  }, [resizeStage, step, form, errors, showPainHint, orderedRecommendations.length]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await apiGet<{
          completed: boolean;
          skipped: boolean;
          displayName: string;
          data: OnboardingData;
          recommendations: RecommendedAgent[];
        }>("/business/onboarding");

        if (cancelled) return;

        if (response.success && response.data) {
          const payload = response.data;
          if (payload.completed || payload.skipped) {
            router.replace(BUSINESS_MARKETPLACE_PATH);
            return;
          }

          setDisplayName(payload.displayName);
          setForm((current) => ({ ...current, ...payload.data }));
          setRecommendations(payload.recommendations ?? []);
          const resumeStep = Math.min(Math.max(payload.data.lastStep ?? 1, 1), 5) as StepKey;
          if (typeof resumeStep === "number") {
            setStep(resumeStep);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function persist(action: "save" | "complete" | "skip", patch?: Partial<OnboardingData>) {
    setSaving(true);
    try {
      const payload = { ...form, ...patch };
      const response = await apiPost<{
        completed: boolean;
        skipped: boolean;
        data: OnboardingData;
        recommendations: RecommendedAgent[];
      }>("/business/onboarding", {
        action,
        data: {
          businessName: payload.businessName,
          businessType: payload.businessType,
          teamSize: payload.teamSize,
          monthlyVolume: payload.monthlyVolume,
          software: payload.software,
          industry: payload.industry,
          challenges: payload.challenges,
          lastStep: typeof step === "number" ? step : payload.lastStep,
          skippedFrom: payload.skippedFrom ?? undefined
        }
      });

      if (response.success && response.data) {
        setForm((current) => ({ ...current, ...response.data!.data }));
        setRecommendations(response.data.recommendations ?? []);
      }

      return response.success;
    } finally {
      setSaving(false);
    }
  }

  function goTo(next: StepKey, dir: "forward" | "back" = "forward") {
    setDirection(dir);
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleContinueFromStep2() {
    const nextErrors: Record<string, boolean> = {};
    if (!form.businessName.trim()) nextErrors.name = true;
    if (!form.businessType) nextErrors.type = true;
    if (!form.teamSize) nextErrors.team = true;
    if (!form.monthlyVolume) nextErrors.volume = true;
    if (form.businessType === "non-dental" && !form.industry.trim()) nextErrors.industry = true;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const ok = await persist("save", { lastStep: 3 });
    if (ok) goTo(3);
  }

  async function handleContinueFromStep3() {
    if (form.challenges.length === 0) {
      setShowPainHint(true);
      return;
    }
    const ok = await persist("save", { lastStep: 4 });
    if (ok) goTo(4);
  }

  async function handleSkip() {
    const skippedFrom = typeof step === "number" ? step : 1;
    const ok = await persist("skip", { skippedFrom, lastStep: skippedFrom });
    if (!ok) {
      showToast("Could not skip setup. Please try again.");
      return;
    }
    setDoneKind("skip");
    goTo("done");
  }

  async function handleComplete() {
    const ok = await persist("complete", { lastStep: 5 });
    if (!ok) {
      showToast("Could not complete setup. Please try again.");
      return;
    }
    setDoneKind("done");
    showToast("Setup complete! Welcome to Triven 🎉");
    goTo("done");
  }

  async function finishAndNavigate(
    action: "complete" | "skip",
    destination: Route
  ) {
    const currentStep = typeof step === "number" ? step : 5;
    const ok = await persist(
      action,
      action === "skip"
        ? { skippedFrom: currentStep, lastStep: currentStep }
        : { lastStep: 5 }
    );

    if (!ok) {
      showToast("Could not save onboarding. Please try again.");
      return;
    }

    router.replace(destination);
  }

  function toggleArrayValue(key: "software" | "challenges", value: string) {
    setForm((current) => {
      const list = current[key];
      const exists = list.includes(value);
      return {
        ...current,
        [key]: exists ? list.filter((item) => item !== value) : [...list, value]
      };
    });
    if (key === "challenges") setShowPainHint(false);
  }

  function toggleSingleValue(key: "teamSize" | "monthlyVolume", value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key === "teamSize" ? "team" : "volume"]: false }));
  }

  if (loading) {
    return <div className="min-h-screen bg-white" data-testid="business-onboarding-loading" />;
  }

  const primaryBtn =
    "w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:opacity-50";
  const primaryBigBtn =
    "w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-base font-semibold shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:opacity-50";
  const backBtn =
    "w-full sm:w-auto px-4 py-3 sm:py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300";
  const skipBtn =
    "text-xs text-slate-400 hover:text-slate-600 hover:underline underline-offset-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded px-1";

  return (
    <div className="onboarding-root bg-white text-slate-900 antialiased">
      <style dangerouslySetInnerHTML={{ __html: ONBOARDING_STYLES }} />

      <div className="fixed top-0 inset-x-0 z-40">
        <div
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={step === "done" ? 5 : Number(step)}
          className="h-1 w-full bg-slate-200"
          data-testid="business-onboarding-progress"
        >
          <div className="h-1 rounded-full bg-amber-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <main className="grid min-h-screen place-items-center px-4 pt-12 pb-28">
        <div className="w-full max-w-[640px]">
          <p className="mb-5 text-center" aria-label="Onboarding navigation">
            <span className="hidden text-xs font-medium text-slate-500 sm:inline" data-testid="business-onboarding-step-label">
              {step === "done" ? "Setup complete" : `Step ${step} of 5 — ${STEP_TITLES[Number(step)]}`}
            </span>
            <span className="text-xs font-medium text-slate-500 sm:hidden" data-testid="business-onboarding-step-short">
              {step === "done" ? "✓" : `${step}/5`}
            </span>
          </p>

          <div id="onboarding-stage" ref={stageRef} className="relative">
            {step === 1 ? (
              <section data-onboarding-active="true" className={`mx-auto max-w-[520px] rounded-2xl bg-white p-6 text-center onboarding-elev sm:p-8 ${direction === "back" ? "onboarding-in-left" : "onboarding-in-right"}`}>
                <div className="mb-6 flex items-center justify-center gap-2">
                  <Image src={TRIVEN_LOGO_SRC} alt="Triven" width={130} height={38} priority className="h-9 w-auto object-contain" />
                  <span className="text-lg font-bold tracking-tight text-slate-900">Triven</span>
                </div>
                <div className="mb-6 flex justify-center">
                  <svg className="onboarding-float" width="180" height="130" viewBox="0 0 180 130" fill="none" aria-hidden="true">
                    <circle cx="74" cy="66" r="33" stroke="#94a3b8" strokeWidth="6" opacity=".75" />
                    <circle cx="106" cy="66" r="33" stroke="#f59e0b" strokeWidth="6" />
                    <circle cx="90" cy="66" r="9" fill="#f59e0b" />
                    <circle cx="90" cy="66" r="9" fill="none" stroke="#fff" strokeWidth="2.5" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-slate-900" data-testid="business-onboarding-welcome-title">
                  Welcome to Triven, {firstName}! 👋
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  You&apos;re about to discover AI agents that will transform how your business operates.
                </p>
                <p className="mt-3 text-sm text-slate-500">
                  This quick setup takes about 2 minutes and helps us recommend the perfect agents for your business.
                </p>
                <ul className="mx-auto mt-6 max-w-xs space-y-2.5 text-left">
                  {[
                    "Personalized agent recommendations",
                    "Dashboard configured for your business",
                    "Instant access to the marketplace"
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-50 text-xs text-amber-600">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <button type="button" disabled={saving} onClick={() => goTo(2)} className={primaryBigBtn} data-testid="business-onboarding-start">
                    Let&apos;s get started
                  </button>
                  <div className="mt-4 text-center">
                    <button type="button" onClick={() => void handleSkip()} className={skipBtn} data-testid="business-onboarding-skip">
                      Skip setup and explore on my own →
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {step === 2 ? (
              <section data-onboarding-active="true" className="onboarding-elev mx-auto max-w-[520px] rounded-2xl bg-white p-6 sm:p-8">
                <h2 className="text-xl font-bold text-slate-900" data-testid="business-onboarding-business-title">Tell us about your business</h2>
                <p className="mt-1.5 text-sm text-slate-600">This helps us recommend agents that actually fit your practice.</p>
                <div className="mt-6 space-y-5">
                  <div>
                    <label htmlFor="bizName" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Business name <span className="text-amber-500">*</span>
                    </label>
                    <input
                      id="bizName"
                      type="text"
                      value={form.businessName}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, businessName: event.target.value }));
                        if (event.target.value.trim()) setErrors((current) => ({ ...current, name: false }));
                      }}
                      autoComplete="organization"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      data-testid="business-onboarding-business-name"
                    />
                    {errors.name ? <p className="mt-1 text-xs text-red-600">Add your business name so we can personalize your setup.</p> : null}
                  </div>

                  <div>
                    <label htmlFor="bizType" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Business type <span className="text-amber-500">*</span>
                    </label>
                    <select
                      id="bizType"
                      value={form.businessType}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, businessType: event.target.value }));
                        setErrors((current) => ({ ...current, type: false }));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      data-testid="business-onboarding-business-type"
                    >
                      <option value="" disabled>Select your practice type…</option>
                      {BUSINESS_TYPES.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                    {errors.type ? <p className="mt-1 text-xs text-red-600">Choose the option that best describes your business.</p> : null}
                    {form.businessType === "non-dental" ? (
                      <div className="mt-3">
                        <label htmlFor="bizIndustry" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Your industry <span className="text-amber-500">*</span>
                        </label>
                        <input
                          id="bizIndustry"
                          type="text"
                          value={form.industry}
                          onChange={(event) => {
                            setForm((current) => ({ ...current, industry: event.target.value }));
                            if (event.target.value.trim()) setErrors((current) => ({ ...current, industry: false }));
                          }}
                          placeholder="e.g. Veterinary, med spa, law firm"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                          data-testid="business-onboarding-industry"
                        />
                        {errors.industry ? <p className="mt-1 text-xs text-red-600">Tell us your industry so we can tailor recommendations.</p> : null}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-slate-700">Team size <span className="text-amber-500">*</span></span>
                    <div role="radiogroup" aria-label="Team size" className="flex flex-wrap gap-2">
                      {TEAM_SIZES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={form.teamSize === value}
                          onClick={() => toggleSingleValue("teamSize", value)}
                          className="onboarding-pill rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                          data-testid={`business-onboarding-team-${value.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    {errors.team ? <p className="mt-1 text-xs text-red-600">Pick your team size.</p> : null}
                  </div>

                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-slate-700">Monthly patient volume <span className="text-amber-500">*</span></span>
                    <div role="radiogroup" aria-label="Monthly patient volume" className="flex flex-wrap gap-2">
                      {MONTHLY_VOLUMES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={form.monthlyVolume === value}
                          onClick={() => toggleSingleValue("monthlyVolume", value)}
                          className="onboarding-pill rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                          data-testid={`business-onboarding-volume-${value.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    {errors.volume ? <p className="mt-1 text-xs text-red-600">Pick your typical monthly volume.</p> : null}
                  </div>

                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-slate-700">
                      Current software <span className="text-xs font-normal text-slate-400">(optional — helps with integrations)</span>
                    </span>
                    <div role="group" aria-label="Current software" className="flex flex-wrap gap-2">
                      {SOFTWARE_OPTIONS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="checkbox"
                          aria-checked={form.software.includes(value)}
                          onClick={() => toggleArrayValue("software", value)}
                          className="onboarding-chip inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-700"
                          data-testid={`business-onboarding-software-${value.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                        >
                          <span className="chk text-xs">✓</span>
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-8">
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" onClick={() => goTo(1, "back")} className={backBtn} data-testid="business-onboarding-back">← Back</button>
                    <button type="button" disabled={saving} onClick={() => void handleContinueFromStep2()} className={primaryBtn} data-testid="business-onboarding-continue-step2">
                      Continue
                    </button>
                  </div>
                  <div className="mt-4 text-center">
                    <button type="button" onClick={() => void handleSkip()} className={skipBtn} data-testid="business-onboarding-skip-step2">Skip for now →</button>
                  </div>
                </div>
              </section>
            ) : null}

            {step === 3 ? (
              <section data-onboarding-active="true" className="onboarding-elev mx-auto max-w-[520px] rounded-2xl bg-white p-6 sm:p-8">
                <h2 className="text-xl font-bold text-slate-900" data-testid="business-onboarding-challenges-title">What challenges can we help with?</h2>
                <p className="mt-1.5 text-sm text-slate-600">Select all that apply. This personalizes your marketplace experience.</p>
                <div
                  role="group"
                  aria-label="Practice challenges"
                  className={`mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${showPainHint ? "onboarding-shake" : ""}`}
                >
                  {PAIN_POINTS.map(([id, emoji, title, subtitle]) => (
                    <button
                      key={id}
                      type="button"
                      role="checkbox"
                      aria-checked={form.challenges.includes(id)}
                      onClick={() => toggleArrayValue("challenges", id)}
                      className="onboarding-paincard relative rounded-xl bg-white p-4 text-left"
                      data-testid={`business-onboarding-challenge-${id}`}
                    >
                      <span className="onboarding-pc-check absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-amber-500 text-[11px] leading-none text-white">✓</span>
                      <div className="mb-2 text-2xl">{emoji}</div>
                      <div className="text-sm font-medium text-slate-800">{title}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>
                    </button>
                  ))}
                </div>
                {showPainHint ? <p className="mt-3 text-sm text-amber-600">Select at least one to get personalized recommendations.</p> : null}
                <div className="mt-8">
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" onClick={() => goTo(2, "back")} className={backBtn} data-testid="business-onboarding-back-step3">← Back</button>
                    <button type="button" disabled={saving} onClick={() => void handleContinueFromStep3()} className={primaryBtn} data-testid="business-onboarding-continue-step3">
                      Continue
                    </button>
                  </div>
                  <div className="mt-4 text-center">
                    <button type="button" onClick={() => void handleSkip()} className={skipBtn} data-testid="business-onboarding-skip-step3">Skip for now →</button>
                  </div>
                </div>
              </section>
            ) : null}

            {step === 4 ? (
              <section data-onboarding-active="true" className="onboarding-elev mx-auto max-w-[520px] rounded-2xl bg-white p-6 sm:p-8">
                <h2 className="text-xl font-bold text-slate-900" data-testid="business-onboarding-how-title">Here&apos;s how Triven works</h2>
                <p className="mt-1.5 text-sm text-slate-600">3 simple steps to automate your practice.</p>
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                  {[
                    ["1", "Browse & choose", "Explore AI agents built for service businesses. Filter by need, read reviews, compare options."],
                    ["2", "Subscribe & set up", "Subscribe and follow the guided setup wizard. Connect your tools and set preferences in 5 minutes."],
                    ["3", "Sit back & grow", "Your agent works 24/7. Monitor performance from your dashboard. Cancel anytime if it is not delivering."]
                  ].map(([num, title, copy]) => (
                    <div key={num} className="relative rounded-xl border border-slate-200 bg-white p-5">
                      <span className="absolute left-4 top-2 font-mono text-3xl font-extrabold text-amber-500/25">{num}</span>
                      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{copy}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 space-y-2.5">
                  {[
                    "Enterprise-grade security — your data is encrypted and never shared",
                    "Cancel anytime — no contracts, no commitments",
                    "Only verified, reviewed agents on the marketplace"
                  ].map((item) => (
                    <p key={item} className="flex items-start gap-2 text-xs text-slate-600">
                      <span className="mt-px shrink-0 text-amber-500">✓</span>
                      <span>{item}</span>
                    </p>
                  ))}
                </div>
                <div className="mt-8">
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" onClick={() => goTo(3, "back")} className={backBtn} data-testid="business-onboarding-back-step4">← Back</button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        const ok = await persist("save", { lastStep: 5 });
                        if (ok) goTo(5);
                      }}
                      className={primaryBtn}
                      data-testid="business-onboarding-continue-step4"
                    >
                      Continue
                    </button>
                  </div>
                  <div className="mt-4 text-center">
                    <button type="button" onClick={() => void handleSkip()} className={skipBtn} data-testid="business-onboarding-skip-step4">Skip for now →</button>
                  </div>
                </div>
              </section>
            ) : null}

            {step === 5 ? (
              <section data-onboarding-active="true" className="onboarding-elev mx-auto max-w-[640px] rounded-2xl bg-white p-6 sm:p-8">
                <h2 className="text-xl font-bold text-slate-900" data-testid="business-onboarding-recommendations-title">Agents recommended for you</h2>
                <p className="mt-1.5 text-sm text-slate-600">
                  {form.challenges.length > 0
                    ? "Based on your practice profile and goals, here are your top matches:"
                    : "Popular agents for your business — your matches sharpen as you pick goals:"}
                </p>
                <div role="list" className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {orderedRecommendations.length === 0 ? (
                    <p className="col-span-full text-sm text-slate-500">Browse the marketplace to discover available agents.</p>
                  ) : (
                    orderedRecommendations.map((agent, index) => {
                      const isMatch = agent.matchedChallenges.length > 0;
                      const top = isMatch && index === 0;
                      const reason = isMatch
                        ? `Matches: ${agent.matchedChallenges.map((id) => PAIN_LABELS[id] ?? id).join(", ")}`
                        : "Popular with businesses like yours";

                      return (
                        <div
                          key={agent.id}
                          role="listitem"
                          className={`onboarding-fade-up rounded-xl bg-white p-4 ${top ? "border border-amber-500 ring-2 ring-amber-500" : "border border-slate-200"}`}
                          style={{ animationDelay: `${index * 100}ms` }}
                          data-testid={`business-onboarding-recommendation-${agent.id}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600">🤖</div>
                            {top ? (
                              <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white">TOP MATCH</span>
                            ) : isMatch ? (
                              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Match</span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Popular</span>
                            )}
                          </div>
                          <h3 className="mt-3 text-base font-semibold text-slate-900">{agent.name}</h3>
                          <p className={`mt-1 text-xs ${isMatch ? "text-amber-700" : "text-slate-400"}`}>{reason}</p>
                          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                            <span className="text-amber-500">★</span>
                            <span className="font-medium text-slate-700">{agent.rating.toFixed(1)}</span>
                            <span>({agent.installCount} installs)</span>
                            <span className="ml-auto font-mono text-lg font-bold text-slate-900">
                              {formatPrice(agent.priceCents)}
                              <span className="text-xs font-normal text-slate-400">/mo</span>
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-3 text-sm text-slate-600">{agent.description}</p>
                          <button
                            type="button"
                            onClick={() => void finishAndNavigate("complete", businessAgentPath(agent.id))}
                            className={index === 0 ? primaryBtn.replace("sm:w-auto", "") + " mt-3 w-full" : "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"}
                            data-testid={`business-onboarding-view-agent-${agent.id}`}
                          >
                            View agent →
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="mt-6 space-y-1.5 text-center">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void finishAndNavigate("complete", BUSINESS_MARKETPLACE_PATH)}
                    className="rounded px-1 text-sm font-medium text-amber-600 transition-colors hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    data-testid="business-onboarding-browse-all"
                  >
                    Browse all agents →
                  </button>
                  <p className="text-xs text-slate-400">These recommendations improve as you use the platform.</p>
                </div>
                <div className="mt-8">
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" onClick={() => goTo(4, "back")} className={backBtn} data-testid="business-onboarding-back-step5">← Back</button>
                    <button type="button" disabled={saving} onClick={() => void handleComplete()} className={primaryBigBtn.replace("w-full", "w-full sm:w-auto")} data-testid="business-onboarding-finish">
                      Continue
                    </button>
                  </div>
                  <div className="mt-4 text-center">
                    <button type="button" disabled={saving} onClick={() => void finishAndNavigate("skip", BUSINESS_MARKETPLACE_PATH)} className={skipBtn} data-testid="business-onboarding-marketplace-first">
                      Browse marketplace first →
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {step === "done" ? (
              <section data-onboarding-active="true" className="onboarding-elev mx-auto max-w-[520px] rounded-2xl bg-white p-6 text-center sm:p-8">
                <div className={`mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full ${doneKind === "done" ? "bg-amber-50 text-amber-500" : "bg-slate-100 text-slate-500"}`}>
                  {doneKind === "done" ? "✓" : "→"}
                </div>
                <h2 className="text-xl font-bold text-slate-900" data-testid="business-onboarding-done-title">
                  {doneKind === "done" ? `You're all set, ${firstName} 🎉` : "No problem — you're in 👍"}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {doneKind === "done"
                    ? "Your dashboard is ready. Here's where to begin."
                    : "You can finish setup anytime — we'll keep what you've entered."}
                </p>
                <div className={`mt-6 flex items-start gap-3 rounded-xl p-4 text-left ${doneKind === "done" ? "border border-amber-200 bg-amber-50" : "border border-slate-200 bg-slate-50"}`}>
                  <span className="mt-0.5 text-xl leading-none">{doneKind === "done" ? "✨" : "🛒"}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">
                      {doneKind === "done" ? "Explore Marketplace" : "Browse Marketplace"}
                    </p>
                    <button
                      type="button"
                      onClick={() => router.replace(BUSINESS_MARKETPLACE_PATH)}
                      className="mt-1 rounded px-1 text-sm font-medium text-amber-600 transition-colors hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      data-testid="business-onboarding-explore-marketplace"
                    >
                      {doneKind === "done" ? "Explore Marketplace →" : "Browse Marketplace →"}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>

      {toast ? (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg" role="status" data-testid="business-onboarding-toast">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
