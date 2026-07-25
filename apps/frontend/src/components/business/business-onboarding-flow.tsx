"use client";

import Image from "next/image";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { BusinessHoursSection } from "@/components/business/business-hours-section";
import { BUSINESS_MARKETPLACE_PATH, businessAgentDetailPath } from "@/lib/routes";
import { BriefcaseBusiness, Rocket, TrendingUp } from "lucide-react";
import {
  PhoneCall,
  CalendarDays,
  MessageSquare,
  Star,
  Wallet,
  ClipboardList,
  ChartColumn,
  RefreshCcw,
  Bot,
  BotIcon,
} from "lucide-react";

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
  "None / Paper-based",
];

const BUSINESS_TYPES = [
  { value: "solo", label: "Solo dental practice" },
  { value: "group", label: "Group dental practice (2–5 dentists)" },
  { value: "dso", label: "Dental Service Organization (DSO)" },
  { value: "ortho", label: "Orthodontics practice" },
  { value: "pedo", label: "Pediatric dentistry" },
  { value: "oral", label: "Oral surgery / Specialty" },
  { value: "health", label: "Other healthcare" },
  { value: "non-dental", label: "Non-dental business" },
];

const PAIN_POINTS = [
  [
    "missed-calls",
    PhoneCall,
    "Missed calls & follow-ups",
    "Patients call after hours and never call back",
  ],
  ["scheduling", CalendarDays, "Appointment scheduling", "Too much time spent on phone scheduling"],
  [
    "communication",
    MessageSquare,
    "Patient communication",
    "Reminders, confirmations, and follow-ups",
  ],
  ["reviews", Star, "Online reviews", "Need more Google/Yelp reviews from happy patients"],
  ["billing", Wallet, "Billing & collections", "Outstanding balances and payment follow-ups"],
  ["intake", ClipboardList, "New patient intake", "Paper forms, manual data entry"],
  ["analytics", ChartColumn, "Practice analytics", "No visibility into practice performance"],
  ["recall", RefreshCcw, "Patient recall", "Patients overdue for hygiene/checkups"],
  ["frontdesk", Bot, "Front desk automation", "Staff overwhelmed with repetitive tasks"],
] as const;

const PAIN_LABELS = Object.fromEntries(PAIN_POINTS.map(([id, , label]) => [id, label])) as Record<
  string,
  string
>;

const STEP_TITLES = [
  "",
  "Welcome",
  "Business profile",
  "Your challenges",
  "How Triven works",
  "Recommended for you",
];

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
  pricingModel: string;
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

function renderPriceTag(agent: RecommendedAgent) {
  const model = (agent.pricingModel ?? "subscription").toLowerCase();
  if (model === "free") {
    return (
      <span className="ml-auto text-right">
        <span className="font-mono text-sm font-bold text-green-600 block leading-tight">Free</span>
        <span className="block text-[9px] font-normal text-slate-400 leading-tight">
          Pay only for usage
        </span>
      </span>
    );
  }
  if (model === "one_time" || model === "one-time" || model === "onetime") {
    return (
      <span className="ml-auto text-right">
        <span className="font-mono text-sm font-bold text-slate-900 block leading-tight">
          {formatPrice(agent.priceCents)} one-time
        </span>
        <span className="block text-[9px] font-normal text-slate-400 leading-tight">
          Usage charges apply separately
        </span>
      </span>
    );
  }
  // default: subscription / monthly
  return (
    <span className="ml-auto text-right">
      <span className="font-mono text-sm font-bold text-slate-900 block leading-tight">
        {formatPrice(agent.priceCents)}/mo
      </span>
      <span className="block text-[9px] font-normal text-slate-400 leading-tight">
        Usage charges billed separately
      </span>
    </span>
  );
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
    skippedFrom: null,
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
          businessName: payload.businessName.trim() || undefined,
          businessType: payload.businessType.trim() || undefined,
          teamSize: payload.teamSize.trim() || undefined,
          monthlyVolume: payload.monthlyVolume.trim() || undefined,
          software: payload.software.length ? payload.software : undefined,
          industry: payload.industry.trim() || undefined,
          challenges: payload.challenges.length ? payload.challenges : undefined,
          lastStep: typeof step === "number" ? step : payload.lastStep,
          skippedFrom: payload.skippedFrom ?? undefined,
        },
      });

      if (response.success && response.data) {
        setForm((current) => ({ ...current, ...response.data!.data }));
        setRecommendations(response.data.recommendations ?? []);
      }
      console.log("persist result:", response);
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

    const ok = await persist("skip", {
      skippedFrom,
      lastStep: skippedFrom,
    });

    console.log("persist result:", ok);

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

  async function finishAndNavigate(action: "complete" | "skip", destination: Route) {
    const currentStep = typeof step === "number" ? step : 5;
    const ok = await persist(
      action,
      action === "skip" ? { skippedFrom: currentStep, lastStep: currentStep } : { lastStep: 5 },
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
        [key]: exists ? list.filter((item) => item !== value) : [...list, value],
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
          <div
            className="h-1 rounded-full bg-amber-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <main className="grid min-h-screen place-items-center px-4 pt-12 pb-28">
        <div className="w-full max-w-[640px]">
          <p className="mb-5 text-center" aria-label="Onboarding navigation">
            <span
              className="hidden text-xs font-medium text-slate-500 sm:inline"
              data-testid="business-onboarding-step-label"
            >
              {step === "done"
                ? "Setup complete"
                : `Step ${step} of 5 — ${STEP_TITLES[Number(step)]}`}
            </span>
            <span
              className="text-xs font-medium text-slate-500 sm:hidden"
              data-testid="business-onboarding-step-short"
            >
              {step === "done" ? "✓" : `${step}/5`}
            </span>
          </p>

          <div id="onboarding-stage" ref={stageRef} className="relative">
            {step === 1 ? (
              <section
                data-onboarding-active="true"
                className={`mx-auto w-full max-w-lg rounded-3xl bg-white px-5 py-8 shadow-xl sm:px-8 sm:py-10 lg:max-w-xl ${
                  direction === "back" ? "onboarding-in-left" : "onboarding-in-right"
                }`}
              >
                {/* Logo */}
                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-2">
                    <Image
                      src={TRIVEN_LOGO_SRC}
                      alt="Triven"
                      width={130}
                      height={38}
                      priority
                      className="h-9 w-auto object-contain sm:h-10"
                    />

                    <span className="text-xl font-bold tracking-tight text-slate-900">Triven</span>
                  </div>
                </div>

                {/* Illustration */}
                <div className="mt-8 flex justify-center">
                  <svg
                    className="onboarding-float h-auto w-40 sm:w-48"
                    viewBox="0 0 180 130"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle cx="74" cy="66" r="33" stroke="#94a3b8" strokeWidth="6" opacity=".75" />
                    <circle cx="106" cy="66" r="33" stroke="#f59e0b" strokeWidth="6" />
                    <circle cx="90" cy="66" r="9" fill="#f59e0b" />
                    <circle cx="90" cy="66" r="9" fill="none" stroke="#fff" strokeWidth="2.5" />
                  </svg>
                </div>

                {/* Heading */}
                <div className="mt-8 text-center">
                  <h2
                    className="text-2xl font-bold leading-tight text-slate-900 sm:text-3xl"
                    data-testid="business-onboarding-welcome-title"
                  >
                    Welcome to Triven,
                    <br className="sm:hidden" />
                    <span className="text-amber-600"> {firstName}! 👋</span>
                  </h2>

                  <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-slate-600 sm:text-base">
                    You're about to discover AI agents that transform how your business operates.
                  </p>

                  <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
                    This setup takes only <strong>2 minutes</strong> and helps us recommend the
                    perfect AI agents for your business.
                  </p>
                </div>

                {/* Features */}
                <div className="mt-8 rounded-2xl bg-slate-50 p-5">
                  <ul className="space-y-4">
                    {[
                      "Personalized AI agent recommendations",
                      "Business dashboard tailored for you",
                      "Instant marketplace access",
                    ].map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-3 text-sm text-slate-700 sm:text-base"
                      >
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-600">
                          ✓
                        </span>

                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Buttons */}
                <div className="mt-10 flex flex-col gap-4">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => goTo(2)}
                    className={`${primaryBigBtn} w-full`}
                    data-testid="business-onboarding-start"
                  >
                    Let's Get Started
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleSkip()}
                    className={`${skipBtn} w-full text-center`}
                    data-testid="business-onboarding-skip"
                  >
                    Skip setup and explore on my own →
                  </button>
                </div>
              </section>
            ) : null}

            {step === 2 ? (
              <section
                data-onboarding-active="true"
                className="onboarding-elev mx-auto w-full max-w-[520px] rounded-2xl bg-white px-5 py-6 sm:px-8 sm:py-8"
              >
                <h2
                  className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl"
                  data-testid="business-onboarding-business-title"
                >
                  Tell us about your business
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  This helps us recommend agents that actually fit your practice.
                </p>

                <div className="mt-6 space-y-6">
                  <div>
                    <label
                      htmlFor="bizName"
                      className="mb-1.5 block text-sm font-medium text-slate-700"
                    >
                      Business name <span className="text-amber-500">*</span>
                    </label>

                    <input
                      id="bizName"
                      type="text"
                      value={form.businessName}
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          businessName: event.target.value,
                        }));
                        if (event.target.value.trim())
                          setErrors((current) => ({ ...current, name: false }));
                      }}
                      autoComplete="organization"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      data-testid="business-onboarding-business-name"
                    />

                    {errors.name ? (
                      <p className="mt-1 text-xs text-red-600">
                        Add your business name so we can personalize your setup.
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label
                      htmlFor="bizType"
                      className="mb-1.5 block text-sm font-medium text-slate-700"
                    >
                      Business type <span className="text-amber-500">*</span>
                    </label>

                    <select
                      id="bizType"
                      value={form.businessType}
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          businessType: event.target.value,
                        }));
                        setErrors((current) => ({ ...current, type: false }));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      data-testid="business-onboarding-business-type"
                    >
                      <option value="" disabled>
                        Select your practice type…
                      </option>

                      {BUSINESS_TYPES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>

                    {errors.type ? (
                      <p className="mt-1 text-xs text-red-600">
                        Choose the option that best describes your business.
                      </p>
                    ) : null}

                    {form.businessType === "non-dental" ? (
                      <div className="mt-4">
                        <label
                          htmlFor="bizIndustry"
                          className="mb-1.5 block text-sm font-medium text-slate-700"
                        >
                          Your industry <span className="text-amber-500">*</span>
                        </label>

                        <input
                          id="bizIndustry"
                          type="text"
                          value={form.industry}
                          onChange={(event) => {
                            setForm((current) => ({
                              ...current,
                              industry: event.target.value,
                            }));

                            if (event.target.value.trim())
                              setErrors((current) => ({
                                ...current,
                                industry: false,
                              }));
                          }}
                          placeholder="e.g. Veterinary, med spa, law firm"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                          data-testid="business-onboarding-industry"
                        />

                        {errors.industry ? (
                          <p className="mt-1 text-xs text-red-600">
                            Tell us your industry so we can tailor recommendations.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Team size <span className="text-amber-500">*</span>
                    </span>

                    <div
                      role="radiogroup"
                      aria-label="Team size"
                      className="flex flex-wrap gap-2 sm:gap-3"
                    >
                      {TEAM_SIZES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={form.teamSize === value}
                          onClick={() => toggleSingleValue("teamSize", value)}
                          className="onboarding-pill min-h-[42px] rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                          data-testid={`business-onboarding-team-${value
                            .replace(/\s+/g, "-")
                            .toLowerCase()}`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>

                    {errors.team ? (
                      <p className="mt-1 text-xs text-red-600">Pick your team size.</p>
                    ) : null}
                  </div>

                  <div>
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Monthly patient volume <span className="text-amber-500">*</span>
                    </span>

                    <div
                      role="radiogroup"
                      aria-label="Monthly patient volume"
                      className="flex flex-wrap gap-2 sm:gap-3"
                    >
                      {MONTHLY_VOLUMES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={form.monthlyVolume === value}
                          onClick={() => toggleSingleValue("monthlyVolume", value)}
                          className="onboarding-pill min-h-[42px] rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                          data-testid={`business-onboarding-volume-${value
                            .replace(/\s+/g, "-")
                            .toLowerCase()}`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>

                    {errors.volume ? (
                      <p className="mt-1 text-xs text-red-600">Pick your typical monthly volume.</p>
                    ) : null}
                  </div>

                  <div>
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Current software{" "}
                      <span className="text-xs font-normal text-slate-400">
                        (optional — helps with integrations)
                      </span>
                    </span>

                    <div
                      role="group"
                      aria-label="Current software"
                      className="flex flex-wrap gap-2 sm:gap-3"
                    >
                      {SOFTWARE_OPTIONS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="checkbox"
                          aria-checked={form.software.includes(value)}
                          onClick={() => toggleArrayValue("software", value)}
                          className="onboarding-chip inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-700"
                          data-testid={`business-onboarding-software-${value
                            .replace(/[^a-z0-9]+/gi, "-")
                            .toLowerCase()}`}
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
                    <button
                      type="button"
                      onClick={() => goTo(1, "back")}
                      className={`${backBtn} w-full sm:w-auto`}
                      data-testid="business-onboarding-back"
                    >
                      ← Back
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleContinueFromStep2()}
                      className={`${primaryBtn} w-full sm:w-auto`}
                      data-testid="business-onboarding-continue-step2"
                    >
                      Continue
                    </button>
                  </div>

                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => void handleSkip()}
                      className={skipBtn}
                      data-testid="business-onboarding-skip-step2"
                    >
                      Skip for now →
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {step === 3 ? (
              <section
                data-onboarding-active="true"
                className="onboarding-elev mx-auto w-full max-w-[700px] rounded-2xl bg-white px-5 py-6 sm:px-8 sm:py-8"
              >
                <h2
                  className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl"
                  data-testid="business-onboarding-challenges-title"
                >
                  What challenges can we help with?
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Select all that apply. This personalizes your marketplace experience.
                </p>

                <div
                  role="group"
                  aria-label="Practice challenges"
                  className={`mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${
                    showPainHint ? "onboarding-shake" : ""
                  }`}
                >
                  {PAIN_POINTS.map(([id, Icon, title, subtitle]) => (
                    <button
                      key={id}
                      type="button"
                      role="checkbox"
                      aria-checked={form.challenges.includes(id)}
                      onClick={() => toggleArrayValue("challenges", id)}
                      className="onboarding-paincard relative flex min-h-[150px] flex-col rounded-xl bg-white p-5 text-left transition-all"
                      data-testid={`business-onboarding-challenge-${id}`}
                    >
                      <span className="onboarding-pc-check absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs text-white">
                        ✓
                      </span>

                      <div
                        className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl border ${
                          id === "missed-calls"
                            ? "border-blue-200 bg-blue-50 text-blue-600"
                            : id === "scheduling"
                              ? "border-violet-200 bg-violet-50 text-violet-600"
                              : id === "communication"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                                : id === "reviews"
                                  ? "border-yellow-200 bg-yellow-50 text-yellow-600"
                                  : id === "billing"
                                    ? "border-green-200 bg-green-50 text-green-600"
                                    : id === "intake"
                                      ? "border-orange-200 bg-orange-50 text-orange-600"
                                      : id === "analytics"
                                        ? "border-cyan-200 bg-cyan-50 text-cyan-600"
                                        : id === "recall"
                                          ? "border-indigo-200 bg-indigo-50 text-indigo-600"
                                          : "border-amber-200 bg-amber-50 text-amber-600"
                        }`}
                      >
                        <Icon className="h-6 w-6" strokeWidth={2} />
                      </div>

                      <div className="text-sm font-semibold text-slate-800">{title}</div>

                      <div className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</div>
                    </button>
                  ))}
                </div>

                {showPainHint ? (
                  <p className="mt-4 text-center text-sm text-amber-600">
                    Select at least one challenge to get personalized recommendations.
                  </p>
                ) : null}

                <div className="mt-8">
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => goTo(2, "back")}
                      className={`${backBtn} w-full sm:w-auto`}
                      data-testid="business-onboarding-back-step3"
                    >
                      ← Back
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleContinueFromStep3()}
                      className={`${primaryBtn} w-full sm:w-auto`}
                      data-testid="business-onboarding-continue-step3"
                    >
                      Continue
                    </button>
                  </div>

                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => void handleSkip()}
                      className={skipBtn}
                      data-testid="business-onboarding-skip-step3"
                    >
                      Skip for now →
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {step === 4 ? (
              <section
                data-onboarding-active="true"
                className="onboarding-elev mx-auto w-full max-w-6xl rounded-2xl bg-white px-5 py-6 sm:px-8 sm:py-8"
              >
                <h2
                  className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl"
                  data-testid="business-onboarding-how-title"
                >
                  Here's how Triven works
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  3 simple steps to automate your practice.
                </p>

                <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                  {[
                    {
                      icon: BriefcaseBusiness,
                      title: "Browse & choose",
                      copy: "Explore AI agents built for service businesses. Filter by need, read reviews, compare options.",
                    },
                    {
                      icon: Rocket,
                      title: "Subscribe & set up",
                      copy: "Subscribe and follow the guided setup wizard. Connect your tools and set preferences in 5 minutes.",
                    },
                    {
                      icon: TrendingUp,
                      title: "Sit back & grow",
                      copy: "Your agent works 24/7. Monitor performance from your dashboard. Cancel anytime if it isn't delivering.",
                    },
                  ].map(({ icon: Icon, title, copy }) => (
                    <div
                      key={title}
                      className="relative flex min-h-[180px] flex-col rounded-xl border border-slate-200 bg-white p-5"
                    >
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50">
                        <Icon className="h-6 w-6 text-amber-600" strokeWidth={2} />
                      </div>

                      <h3 className="text-base font-semibold text-slate-900">{title}</h3>

                      <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <div className="space-y-3">
                    {[
                      "Enterprise-grade security — your data is encrypted and never shared",
                      "Cancel anytime — no contracts, no commitments",
                      "Only verified, reviewed agents on the marketplace",
                    ].map((item) => (
                      <div key={item} className="flex items-start gap-3 text-sm text-slate-700">
                        <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-600">
                          ✓
                        </span>

                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-8">
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => goTo(3, "back")}
                      className={`${backBtn} w-full sm:w-auto`}
                      data-testid="business-onboarding-back-step4"
                    >
                      ← Back
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        const ok = await persist("save", { lastStep: 5 });
                        if (ok) goTo(5);
                      }}
                      className={`${primaryBtn} w-full sm:w-auto`}
                      data-testid="business-onboarding-continue-step4"
                    >
                      Continue
                    </button>
                  </div>

                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => void handleSkip()}
                      className={skipBtn}
                      data-testid="business-onboarding-skip-step4"
                    >
                      Skip for now →
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {step === 5 ? (
              <section
                data-onboarding-active="true"
                className="onboarding-elev mx-auto w-full max-w-7xl rounded-2xl bg-white px-5 py-6 sm:px-8 sm:py-8"
              >
                <h2
                  className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl"
                  data-testid="business-onboarding-recommendations-title"
                >
                  Agents recommended for you
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {form.challenges.length > 0
                    ? "Based on your practice profile and goals, here are your top matches:"
                    : "Popular agents for your business — your matches sharpen as you pick goals:"}
                </p>

                <div
                  role="list"
                  className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
                >
                  {orderedRecommendations.length === 0 ? (
                    <p className="col-span-full text-sm text-slate-500">
                      Browse the marketplace to discover available agents.
                    </p>
                  ) : (
                    orderedRecommendations.map((agent, index) => {
                      const isMatch = agent.matchedChallenges.length > 0;
                      const top = isMatch && index === 0;

                      const reason = isMatch
                        ? `Matches: ${agent.matchedChallenges
                            .map((id) => PAIN_LABELS[id] ?? id)
                            .join(", ")}`
                        : "Popular with businesses like yours";

                      return (
                        <div
                          key={agent.id}
                          role="listitem"
                          className={`onboarding-fade-up flex h-full flex-col rounded-xl bg-white p-5 transition-all hover:-translate-y-1 hover:shadow-lg ${
                            top
                              ? "border border-amber-500 ring-2 ring-amber-500"
                              : "border border-slate-200"
                          }`}
                          style={{ animationDelay: `${index * 100}ms` }}
                          data-testid={`business-onboarding-recommendation-${agent.id}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-xl text-amber-600">
                              <BotIcon
                                className="h-6 w-6 text-amber-500"
                              />
                            </div>

                            {top ? (
                              <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-1 text-[11px] font-semibold tracking-wide text-white">
                                TOP MATCH
                              </span>
                            ) : isMatch ? (
                              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700">
                                Match
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                                Popular
                              </span>
                            )}
                          </div>

                          <h3 className="mt-4 text-lg font-semibold text-slate-900">
                            {agent.name}
                          </h3>

                          <p
                            className={`mt-1 text-sm ${
                              isMatch ? "text-amber-700" : "text-slate-500"
                            }`}
                          >
                            {reason}
                          </p>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                            <span className="text-amber-500">★</span>

                            <span className="font-medium text-slate-700">
                              {agent.rating.toFixed(1)}
                            </span>

                            <span>({agent.installCount} installs)</span>

                            {renderPriceTag(agent)}
                          </div>

                          <p className="mt-3 flex-1 line-clamp-3 text-sm leading-6 text-slate-600">
                            {agent.description}
                          </p>

                          <button
                            type="button"
                            onClick={() =>
                              void finishAndNavigate("complete", businessAgentDetailPath(agent.id))
                            }
                            className={
                              index === 0
                                ? primaryBtn.replace("sm:w-auto", "") + " mt-5 w-full"
                                : "mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            }
                            data-testid={`business-onboarding-view-agent-${agent.id}`}
                          >
                            View agent →
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="mt-8 space-y-2 text-center">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void finishAndNavigate("complete", BUSINESS_MARKETPLACE_PATH)}
                    className="rounded px-1 text-sm font-medium text-amber-600 transition-colors hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    data-testid="business-onboarding-browse-all"
                  >
                    Browse all agents →
                  </button>

                  <p className="text-xs text-slate-400">
                    These recommendations improve as you use the platform.
                  </p>
                </div>

                <div className="mt-8">
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => goTo(4, "back")}
                      className={`${backBtn} w-full sm:w-auto`}
                      data-testid="business-onboarding-back-step5"
                    >
                      ← Back
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleComplete()}
                      className={`${primaryBigBtn.replace("w-full", "")} w-full sm:w-auto`}
                      data-testid="business-onboarding-finish"
                    >
                      Continue
                    </button>
                  </div>

                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void finishAndNavigate("skip", BUSINESS_MARKETPLACE_PATH)}
                      className={skipBtn}
                      data-testid="business-onboarding-marketplace-first"
                    >
                      Browse marketplace first →
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {step === "done" ? (
              <section
                data-onboarding-active="true"
                className="onboarding-elev mx-auto w-full max-w-2xl rounded-2xl bg-white px-5 py-8 text-center sm:px-8 sm:py-10"
              >
                <div
                  className={`mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full ${
                    doneKind === "done"
                      ? "bg-amber-50 text-amber-500"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <span className="text-4xl">{doneKind === "done" ? "✓" : "→"}</span>
                </div>

                <h2
                  className="text-2xl font-bold text-slate-900 sm:text-3xl"
                  data-testid="business-onboarding-done-title"
                >
                  {doneKind === "done"
                    ? `You're all set, ${firstName} 🎉`
                    : "No problem — you're in 👍"}
                </h2>

                <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600 sm:text-base">
                  {doneKind === "done"
                    ? "Your dashboard is ready. Start exploring AI agents built to automate and grow your business."
                    : "You can finish setup anytime. We've safely saved everything you've entered so far."}
                </p>

                <div
                  className={`mt-8 rounded-2xl border p-5 text-left ${
                    doneKind === "done"
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-2xl shadow-sm">
                      {doneKind === "done" ? "✨" : "🛒"}
                    </div>

                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-slate-900">
                        {doneKind === "done" ? "Explore Marketplace" : "Browse Marketplace"}
                      </h3>

                      <p className="mt-1 text-sm text-slate-600">
                        Discover AI agents tailored for your business and start automating your
                        daily operations.
                      </p>

                      <button
                        type="button"
                        onClick={() => router.replace(BUSINESS_MARKETPLACE_PATH)}
                        className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 sm:w-auto"
                        data-testid="business-onboarding-explore-marketplace"
                      >
                        {doneKind === "done" ? "Explore Marketplace" : "Browse Marketplace"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>

      {toast ? (
        <div
          className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
          role="status"
          data-testid="business-onboarding-toast"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
