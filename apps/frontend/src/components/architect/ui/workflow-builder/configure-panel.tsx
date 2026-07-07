"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AGENT_CATEGORIES,
  AGENT_INDUSTRIES,
  AGENT_TEMPLATE_TYPES,
  REQUIRED_INTEGRATION_DEFS,
  SETUP_TIME_OPTIONS,
  defaultAgentConfigure,
  generateIncludedFeaturesFromWorkflow,
  validateConfigureForSubmit,
  type AgentConfigureBasics,
  type AgentConfigureCompliance,
  type AgentConfigureData,
  type AgentConfigureMedia,
  type AgentConfigurePricing,
  type AgentConfigureTemplate,
  type BuyerSetupField,
  type RequiredIntegrationKey
} from "@coreai/shared";
import {
  getWorkflowConfigure,
  saveWorkflowConfigureDraft,
  submitWorkflowForReview,
  type WorkflowConfigureListingSummary
} from "@/components/architect/features/api";
import { BuilderIcon } from "./icons";
import { ComplianceChecklist } from "./configure/compliance-checklist";
import { IndustryPills } from "./configure/industry-pills";
import { IconUploader, ScreenshotUploader } from "./configure/media-uploader";
import { MarketplacePreviewCard } from "./configure/marketplace-preview-card";
import { PricingSelector } from "./configure/pricing-selector";
import { RequiredIntegrationsSelector } from "./configure/required-integrations-selector";
import { RichDescriptionEditor } from "./configure/rich-description-editor";
import { StepProgress } from "./configure/step-progress";

// Step order: 1 Details · 2 Description · 3 Pricing · 4 Requirements & Compliance · 5 Review.
// Compliance is edited in Step 4 ONLY; Step 5 is a read-only review.
const STEP_LABELS = ["Details", "Description", "Pricing", "Requirements", "Review"];

type Toast = { id: number; message: string; type: "success" | "error" };

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plainTextLength(html: string): number {
  return plainText(html).length;
}

export function ConfigurePanel({
  workflowId,
  architectName,
  agentName,
  tagline,
  price,
  workflowFlow,
  saving = false,
  statusMessage = "",
  locked = false,
  lockedMessage = "",
  onAgentNameChange,
  onTaglineChange,
  onPriceChange,
  ensureWorkflowId,
  onSubmitted,
  onSave
}: {
  workflowId: string;
  architectName: string;
  agentName: string;
  tagline: string;
  price: string;
  /** Live builder graph — "What's included" bullets are generated from its connected nodes. */
  workflowFlow?: { nodes: unknown[]; edges: unknown[] };
  saving?: boolean;
  statusMessage?: string;
  locked?: boolean;
  lockedMessage?: string;
  onAgentNameChange: (value: string) => void;
  onTaglineChange: (value: string) => void;
  onPriceChange: (value: string) => void;
  ensureWorkflowId: () => Promise<string | null>;
  onSubmitted?: () => void;
  onSave?: () => void;
}) {
  const [configure, setConfigure] = useState<AgentConfigureData>(() =>
    defaultAgentConfigure({
      name: agentName,
      tagline,
      priceDollars: Number(price) || null,
      workflowJson: workflowFlow
    })
  );
  const [loading, setLoading] = useState(Boolean(workflowId));
  const [step, setStep] = useState(1);
  const [maxVisited, setMaxVisited] = useState(1);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [serverLocked, setServerLocked] = useState(false);
  const [serverLockedMessage, setServerLockedMessage] = useState("");
  const [listing, setListing] = useState<WorkflowConfigureListingSummary | null>(null);
  const toastIdRef = useRef(0);
  const configureRef = useRef(configure);
  const workflowFlowRef = useRef(workflowFlow);

  useEffect(() => {
    configureRef.current = configure;
  }, [configure]);

  useEffect(() => {
    workflowFlowRef.current = workflowFlow;
  }, [workflowFlow]);

  const isLocked = locked || serverLocked || submitted;
  const lockBanner = lockedMessage || serverLockedMessage;

  const pushToast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = ++toastIdRef.current;
    setToasts((current) => [...current, { id, message, type }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }, []);

  /* ---- Load persisted configure state ---- */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!workflowId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const result = await getWorkflowConfigure(workflowId);

      if (cancelled) return;

      if (result.success && result.data) {
        const loaded = result.data.configure;

        // Prefer the live builder values for name/tagline when the stored
        // configure has none yet (older drafts).
        if (!loaded.basics.agentName.trim() && agentName.trim()) {
          loaded.basics.agentName = agentName;
        }
        if (!loaded.basics.tagline.trim() && tagline.trim()) {
          loaded.basics.tagline = tagline;
        }

        // "What's included" prefill: if the stored bullets are all blank,
        // generate from the LIVE builder graph (covers unsaved node edits the
        // server-side seed hasn't seen yet). Never overwrites typed bullets.
        if (!loaded.media.includedFeatures.some((feature) => feature.trim())) {
          const generated = generateIncludedFeaturesFromWorkflow(workflowFlowRef.current);
          if (generated.length > 0) {
            while (generated.length < 4) generated.push("");
            loaded.media.includedFeatures = generated;
          }
        }

        setConfigure(loaded);
        setServerLocked(result.data.locked);
        setServerLockedMessage(result.data.lockedMessage ?? "");
        setListing(result.data.listing);

        if (String(loaded.pricing.price) !== price) {
          onPriceChange(String(loaded.pricing.price));
        }
      }

      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per workflow
  }, [workflowId]);

  /* ---- Section updaters (also keep the builder header/publish tab in sync) ---- */
  const updateBasics = useCallback(
    (patch: Partial<AgentConfigureBasics>) => {
      setConfigure((current) => ({ ...current, basics: { ...current.basics, ...patch } }));
      if (typeof patch.agentName === "string") onAgentNameChange(patch.agentName);
      if (typeof patch.tagline === "string") onTaglineChange(patch.tagline);
      setFieldErrors((current) => {
        const next = { ...current };
        for (const key of Object.keys(patch)) delete next[key];
        return next;
      });
    },
    [onAgentNameChange, onTaglineChange]
  );

  const updateMedia = useCallback((patch: Partial<AgentConfigureMedia>) => {
    setConfigure((current) => ({ ...current, media: { ...current.media, ...patch } }));
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  }, []);

  const updateTemplate = useCallback((patch: Partial<AgentConfigureTemplate>) => {
    setConfigure((current) => ({ ...current, template: { ...current.template, ...patch } }));
  }, []);

  /** Regenerate "What's included" from the current builder graph (explicit overwrite). */
  const refreshIncludedFeatures = useCallback(() => {
    if (isLocked) return;

    const generated = generateIncludedFeaturesFromWorkflow(workflowFlowRef.current);
    if (generated.length === 0) {
      pushToast("No connected nodes found — connect your workflow nodes first.", "error");
      return;
    }

    while (generated.length < 4) generated.push("");
    setConfigure((current) => ({
      ...current,
      media: { ...current.media, includedFeatures: generated }
    }));
    pushToast("“What's included” refreshed from your workflow.");
  }, [isLocked, pushToast]);

  const updatePricing = useCallback(
    (patch: Partial<AgentConfigurePricing>) => {
      setConfigure((current) => ({ ...current, pricing: { ...current.pricing, ...patch } }));
      if (typeof patch.price === "number") onPriceChange(String(patch.price));
      if (typeof patch.price === "number") {
        setFieldErrors((current) => {
          const next = { ...current };
          delete next.price;
          return next;
        });
      }
    },
    [onPriceChange]
  );

  const updateCompliance = useCallback((patch: Partial<AgentConfigureCompliance>) => {
    setConfigure((current) => ({ ...current, compliance: { ...current.compliance, ...patch } }));
  }, []);

  /* ---- Persistence ---- */
  const persistDraft = useCallback(
    async (options: { toast?: boolean } = {}): Promise<boolean> => {
      if (isLocked) return false;

      const id = workflowId || (await ensureWorkflowId());
      if (!id) {
        pushToast("Add a node in Build so the draft can be saved first.", "error");
        return false;
      }

      setSavingDraft(true);
      const result = await saveWorkflowConfigureDraft(id, configureRef.current);
      setSavingDraft(false);

      if (!result.success) {
        pushToast(result.error ?? "Could not save the draft.", "error");
        return false;
      }

      if (options.toast) pushToast("Draft saved — pick up where you left off anytime.");
      return true;
    },
    [ensureWorkflowId, isLocked, pushToast, workflowId]
  );

  /* ---- Step validation (step 3 = Pricing & Compliance, step 4 = Requirements) ---- */
  const validateStep = useCallback(
    (target: number): boolean => {
      const errors: Record<string, string> = {};

      if (target === 1) {
        if (configure.basics.agentName.trim().length < 2) {
          errors.agentName = "Give your agent a name (at least 2 characters).";
        }
        if (configure.basics.tagline.trim().length < 10) {
          errors.tagline = "Write a tagline of at least 10 characters.";
        }
        if (configure.basics.industryTags.length === 0) {
          errors.industryTags = "Pick at least one industry.";
        }
      }

      if (target === 2 && plainTextLength(configure.media.fullDescription) < 100) {
        errors.fullDescription = "Describe your agent in at least 100 characters.";
      }

      if (target === 3 && configure.pricing.pricingModel !== "free" && configure.pricing.price <= 0) {
        errors.price = "Set a price greater than $0, or switch to Free.";
      }

      setFieldErrors(errors);

      if (Object.keys(errors).length > 0) {
        pushToast(Object.values(errors)[0] ?? "Fix the highlighted fields first.", "error");
        return false;
      }

      return true;
    },
    [configure, pushToast]
  );

  const goToStep = useCallback(
    (target: number) => {
      setStep(target);
      setMaxVisited((current) => Math.max(current, target));
    },
    []
  );

  const handleContinue = useCallback(async () => {
    if (!validateStep(step)) return;
    goToStep(Math.min(step + 1, STEP_LABELS.length));
    if (!isLocked) void persistDraft();
  }, [goToStep, isLocked, persistDraft, step, validateStep]);

  const handleBack = useCallback(() => {
    setStep((current) => Math.max(1, current - 1));
  }, []);

  /* ---- Submit for review ---- */
  const complianceComplete = useMemo(() => {
    const checks = configure.compliance.complianceChecks;
    return checks.guidelines && checks.tested && checks.accurate && checks.terms;
  }, [configure.compliance.complianceChecks]);

  const handleSubmit = useCallback(async () => {
    if (isLocked || submitting) return;

    const issues = validateConfigureForSubmit(configure);
    if (issues.length > 0) {
      const first = issues[0];
      pushToast(first?.message ?? "Complete the required fields first.", "error");
      if (first) goToStep(first.step);
      return;
    }

    const id = workflowId || (await ensureWorkflowId());
    if (!id) {
      pushToast("Add a node in Build so the agent can be saved first.", "error");
      return;
    }

    setSubmitting(true);
    const result = await submitWorkflowForReview(id, configureRef.current);
    setSubmitting(false);

    if (!result.success) {
      pushToast(result.error ?? "Could not submit for review.", "error");
      return;
    }

    setSubmitted(true);
    setListing(result.data?.listing ?? null);
    pushToast("Submitted for review — we'll email you within 24–48 hours.");
    onSubmitted?.();
  }, [configure, ensureWorkflowId, goToStep, isLocked, onSubmitted, pushToast, submitting, workflowId]);

  /* ---- Buyer setup field helpers (step 4) ---- */
  const addBuyerSetupField = useCallback(() => {
    updateTemplate({
      requiredBuyerSetup: [
        ...configure.template.requiredBuyerSetup,
        { key: `field-${configure.template.requiredBuyerSetup.length + 1}`, label: "", type: "text", required: true }
      ]
    });
  }, [configure.template.requiredBuyerSetup, updateTemplate]);

  const updateBuyerSetupField = useCallback(
    (index: number, patch: Partial<BuyerSetupField>) => {
      updateTemplate({
        requiredBuyerSetup: configure.template.requiredBuyerSetup.map((field, i) =>
          i === index
            ? {
                ...field,
                ...patch,
                ...(typeof patch.label === "string"
                  ? { key: patch.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || field.key }
                  : {})
              }
            : field
        )
      });
    },
    [configure.template.requiredBuyerSetup, updateTemplate]
  );

  const removeBuyerSetupField = useCallback(
    (index: number) => {
      updateTemplate({
        requiredBuyerSetup: configure.template.requiredBuyerSetup.filter((_, i) => i !== index)
      });
    },
    [configure.template.requiredBuyerSetup, updateTemplate]
  );

  const toggleIntegration = useCallback(
    (key: RequiredIntegrationKey) => {
      updateTemplate({
        requiredIntegrations: {
          ...configure.template.requiredIntegrations,
          [key]: !configure.template.requiredIntegrations[key]
        }
      });
    },
    [configure.template.requiredIntegrations, updateTemplate]
  );

  const displayName = configure.basics.agentName.trim() || agentName.trim() || "your agent";

  /* ---- Review summary values (step 5, read-only) ---- */
  const enabledIntegrationLabels = REQUIRED_INTEGRATION_DEFS.filter(
    (def) => configure.template.requiredIntegrations[def.key]
  ).map((def) => def.label);
  const includedFeatures = configure.media.includedFeatures.map((f) => f.trim()).filter(Boolean);
  const complianceCheckedCount = Object.values(configure.compliance.complianceChecks).filter(Boolean).length;
  const strippedDescription = plainText(configure.media.fullDescription);
  const priceModelLabel =
    configure.pricing.pricingModel === "free"
      ? "Free + fees"
      : configure.pricing.pricingModel === "subscription"
        ? `$${Math.round(configure.pricing.price).toLocaleString("en-US")} / month`
        : `$${Math.round(configure.pricing.price).toLocaleString("en-US")} one-time`;

  if (loading) {
    return (
      <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <p className="text-sm font-semibold text-slate-400" data-testid="configure-loading">
            Loading configuration...
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Intro + draft controls */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[30px]"
              data-testid="architect-ui-workflow-builder-configure-panel-configure-agent-heading"
            >
              Submit <span className="text-amber-500">{displayName}</span> to the Marketplace
            </h2>
            <p
              className="mt-2 max-w-2xl text-[15px] text-slate-600"
              data-testid="architect-ui-workflow-builder-configure-panel-these-details-shape-how-your-agent-appears-text"
            >
              Five quick steps and your agent is in review. Most architects finish in under ten
              minutes — we&apos;ve pre-filled what we could from your build.
            </p>
          </div>
          <div className="flex flex-none items-center gap-2.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700"
              data-testid="configure-draft-badge"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {listing?.status === "PENDING_REVIEW" || submitted
                ? "In review"
                : listing?.status === "APPROVED"
                  ? "Live"
                  : "Draft"}
            </span>
            <button
              data-testid="configure-save"
              type="button"
              disabled={savingDraft || saving || isLocked}
              onClick={() => void persistDraft({ toast: true })}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 transition hover:bg-gray-50 disabled:opacity-60"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                <path d="M17 21v-8H7v8M7 3v5h8" />
              </svg>
              {savingDraft ? "Saving..." : "Save draft"}
            </button>
          </div>
        </div>

        {lockBanner && isLocked ? (
          <div
            data-testid="configure-locked-banner"
            className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800"
          >
            <BuilderIcon name="info" className="h-5 w-5 flex-none text-amber-500" />
            {lockBanner}
          </div>
        ) : null}

        <StepProgress labels={STEP_LABELS} current={step} maxVisited={maxVisited} onGoto={goToStep} />

        {/* ============ STEP 1: DETAILS ============ */}
        {step === 1 ? (
          <div className="fade-enter overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm" data-testid="configure-step-1">
            <StepHeader index={1} kicker="Basics" title="Tell buyers what it is" subtitle="The essentials that show up first in search and on your listing." />
            <div className="space-y-7 px-6 py-7 sm:px-8">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="configure-agent-name" className="text-[13.5px] font-semibold text-slate-700">
                    Agent name <span className="text-amber-500">*</span>
                  </label>
                  <span className="text-xs font-medium text-slate-400">{configure.basics.agentName.length} / 50</span>
                </div>
                <input
                  id="configure-agent-name"
                  data-testid="configure-agent-name-input"
                  type="text"
                  maxLength={50}
                  value={configure.basics.agentName}
                  disabled={isLocked}
                  placeholder="e.g. Smart Receptionist Pro"
                  onChange={(event) => updateBasics({ agentName: event.target.value })}
                  className={fieldClass(Boolean(fieldErrors.agentName))}
                />
                <FieldError message={fieldErrors.agentName} testId="configure-error-agent-name" />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="configure-tagline" className="text-[13.5px] font-semibold text-slate-700">
                    Tagline <span className="text-amber-500">*</span>
                  </label>
                  <span className="text-xs font-medium text-slate-400">{configure.basics.tagline.length} / 100</span>
                </div>
                <input
                  id="configure-tagline"
                  data-testid="configure-tagline-input"
                  type="text"
                  maxLength={100}
                  value={configure.basics.tagline}
                  disabled={isLocked}
                  placeholder="One sentence that sells your agent"
                  onChange={(event) => updateBasics({ tagline: event.target.value })}
                  className={fieldClass(Boolean(fieldErrors.tagline))}
                />
                <p className="mt-1.5 text-[12.5px] text-slate-400">This is the hook buyers read first.</p>
                <FieldError message={fieldErrors.tagline} testId="configure-error-tagline" />
              </div>

              <div className="grid gap-7 sm:grid-cols-2">
                <div>
                  <label htmlFor="configure-category" className="mb-2 block text-[13.5px] font-semibold text-slate-700">
                    Category <span className="text-amber-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      id="configure-category"
                      data-testid="configure-category-select"
                      value={configure.basics.category}
                      disabled={isLocked}
                      onChange={(event) => updateBasics({ category: event.target.value })}
                      className="w-full cursor-pointer appearance-none rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 pr-10 text-[15px] font-medium text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
                    >
                      {AGENT_CATEGORIES.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                      <BuilderIcon name="chevron" className="h-4 w-4" />
                    </span>
                  </div>
                </div>

                <div>
                  <span className="mb-2 block text-[13.5px] font-semibold text-slate-700">Visibility</span>
                  <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3" data-testid="configure-visibility">
                    <BuilderIcon name="eye" className="h-[18px] w-[18px] text-amber-500" />
                    <span className="text-sm font-medium text-slate-700">Public · Triven Marketplace</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-[13.5px] font-semibold text-slate-700">
                  Industry tags <span className="text-amber-500">*</span>
                </span>
                <p className="mb-3 text-[12.5px] text-slate-400">Pick every industry your agent serves well — buyers filter by these.</p>
                <IndustryPills
                  options={AGENT_INDUSTRIES}
                  selected={configure.basics.industryTags}
                  disabled={isLocked}
                  onToggle={(industry) =>
                    updateBasics({
                      industryTags: configure.basics.industryTags.includes(industry)
                        ? configure.basics.industryTags.filter((tag) => tag !== industry)
                        : [...configure.basics.industryTags, industry]
                    })
                  }
                />
                <FieldError message={fieldErrors.industryTags} testId="configure-error-industry-tags" />
              </div>

              <div>
                <span className="mb-2 block text-[13.5px] font-semibold text-slate-700">Agent icon</span>
                <div className="grid items-stretch gap-4 sm:grid-cols-[auto,1fr]">
                  <IconUploader
                    iconUrl={configure.basics.iconUrl}
                    disabled={isLocked}
                    onIconChange={(iconUrl) => updateBasics({ iconUrl })}
                    onError={(message) => pushToast(message, "error")}
                  />
                  <div className="flex items-center gap-3 rounded-2xl border border-amber-100 bg-amber-50/70 px-5 py-4">
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-amber-500 shadow-sm">
                      <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18h6M10 22h4" />
                        <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[13.5px] font-bold text-amber-900">Agents with custom icons get 3× more installs</p>
                      <p className="mt-0.5 text-[12.5px] text-amber-700/80">A crisp, recognizable mark is the single biggest driver of listing taps.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="configure-short-description" className="mb-2 block text-[13.5px] font-semibold text-slate-700">
                  Short description
                </label>
                <textarea
                  id="configure-short-description"
                  data-testid="configure-short-description-input"
                  value={configure.basics.shortDescription}
                  disabled={isLocked}
                  maxLength={200}
                  placeholder="One or two sentences shown on the listing card."
                  onChange={(event) => updateBasics({ shortDescription: event.target.value })}
                  className="h-[74px] w-full resize-none rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* ============ STEP 2: DESCRIPTION & MEDIA ============ */}
        {step === 2 ? (
          <div className="fade-enter overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm" data-testid="configure-step-2">
            <StepHeader index={2} kicker="Story" title="Show it off" subtitle="A clear description and a few screenshots turn browsers into buyers." />
            <div className="space-y-8 px-6 py-7 sm:px-8">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13.5px] font-semibold text-slate-700">
                    Full description <span className="text-amber-500">*</span>
                  </span>
                  <span className="text-xs font-medium text-slate-400">
                    {plainTextLength(configure.media.fullDescription)} / 2000
                  </span>
                </div>
                <RichDescriptionEditor
                  value={configure.media.fullDescription}
                  disabled={isLocked}
                  onChange={(fullDescription) => updateMedia({ fullDescription })}
                />
                <div className="mt-1.5 flex items-center justify-between">
                  <p className="text-[12.5px] text-slate-400">Minimum 100 characters.</p>
                  <FieldError message={fieldErrors.fullDescription} testId="configure-error-full-description" />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-[13.5px] font-semibold text-slate-700">What&apos;s included</span>
                  <button
                    type="button"
                    data-testid="configure-refresh-features"
                    disabled={isLocked}
                    onClick={refreshIncludedFeatures}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:text-amber-700 disabled:opacity-50"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                      <path d="M3 21v-5h5" />
                    </svg>
                    Refresh from workflow
                  </button>
                </div>
                <p className="mb-3 text-[12.5px] text-slate-400">
                  Generated from your connected workflow nodes. You can edit these bullets before publishing.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: Math.max(4, configure.media.includedFeatures.length) }).map((_, index) => (
                    <div key={index} className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-amber-500">
                        <BuilderIcon name="check" className="h-4 w-4" />
                      </span>
                      <input
                        type="text"
                        data-testid={`configure-feature-input-${index}`}
                        value={configure.media.includedFeatures[index] ?? ""}
                        disabled={isLocked}
                        placeholder="e.g. 24/7 missed call detection"
                        onChange={(event) => {
                          const nextFeatures = [...configure.media.includedFeatures];
                          while (nextFeatures.length < 4) nextFeatures.push("");
                          nextFeatures[index] = event.target.value;
                          updateMedia({ includedFeatures: nextFeatures });
                        }}
                        className="w-full rounded-xl border border-gray-100 bg-gray-50/40 py-2.5 pl-10 pr-4 text-[13.5px] outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-1 block text-[13.5px] font-semibold text-slate-700">Screenshots</span>
                <p className="mb-3 text-[12.5px] text-slate-400">Up to four. The first one becomes your listing&apos;s cover.</p>
                <ScreenshotUploader
                  screenshotUrls={configure.media.screenshotUrls}
                  disabled={isLocked}
                  onChange={(screenshotUrls) => updateMedia({ screenshotUrls })}
                  onError={(message) => pushToast(message, "error")}
                />
              </div>

              <div>
                <label htmlFor="configure-demo-video" className="mb-2 block text-[13.5px] font-semibold text-slate-700">
                  Demo video <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <BuilderIcon name="play" className="h-[18px] w-[18px]" />
                  </span>
                  <input
                    id="configure-demo-video"
                    data-testid="configure-demo-video-input"
                    type="url"
                    value={configure.media.demoVideoUrl}
                    disabled={isLocked}
                    placeholder="Paste a YouTube or Loom link"
                    onChange={(event) => updateMedia({ demoVideoUrl: event.target.value })}
                    className="w-full rounded-xl border border-gray-100 bg-gray-50/40 py-3 pl-11 pr-4 text-[14.5px] outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <BuilderIcon name="eye" className="h-4 w-4 text-amber-500" />
                  <p className="text-[13px] font-semibold text-slate-700">Marketplace preview</p>
                  <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600">live</span>
                </div>
                <div className="max-w-xs">
                  <MarketplacePreviewCard configure={configure} architectName={architectName} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ============ STEP 3: PRICING ============ */}
        {step === 3 ? (
          <div className="fade-enter overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm" data-testid="configure-step-3">
            <StepHeader
              index={3}
              kicker="Pricing"
              title="Set your price"
              subtitle="Pick a model, name a number, and watch what you'd earn."
            />
            <div className="px-6 py-7 sm:px-8">
              <PricingSelector pricing={configure.pricing} disabled={isLocked} onChange={updatePricing} />
              <FieldError message={fieldErrors.price} testId="configure-error-price" />
            </div>
          </div>
        ) : null}

        {/* ============ STEP 4: REQUIREMENTS & COMPLIANCE ============ */}
        {step === 4 ? (
          <div className="fade-enter overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm" data-testid="configure-step-4">
            <StepHeader
              index={4}
              kicker="Requirements"
              title="Requirements & compliance"
              subtitle="What buyers need to connect, and the checks that keep the Marketplace trusted."
            />
            <div className="space-y-8 px-6 py-7 sm:px-8">
              <div className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50/70 px-5 py-4">
                <BuilderIcon name="info" className="mt-0.5 h-[18px] w-[18px] flex-none text-amber-500" />
                <p className="text-[12.5px] text-amber-900/90">
                  You never enter buyer secrets here. Triven collects the buyer&apos;s phone numbers, calendars, and
                  API connections during <span className="font-semibold">their</span> onboarding — this step only
                  tells them what to expect.
                </p>
              </div>

              <div className="grid gap-7 sm:grid-cols-2">
                <div>
                  <label htmlFor="configure-template-type" className="mb-2 block text-[13.5px] font-semibold text-slate-700">
                    Template type
                  </label>
                  <div className="relative">
                    <select
                      id="configure-template-type"
                      data-testid="configure-template-type-select"
                      value={configure.template.templateType}
                      disabled={isLocked}
                      onChange={(event) => updateTemplate({ templateType: event.target.value })}
                      className="w-full cursor-pointer appearance-none rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 pr-10 text-[15px] font-medium text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
                    >
                      {AGENT_TEMPLATE_TYPES.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                      <BuilderIcon name="chevron" className="h-4 w-4" />
                    </span>
                  </div>
                </div>

                <div>
                  <label htmlFor="configure-setup-time" className="mb-2 block text-[13.5px] font-semibold text-slate-700">
                    Setup time estimate
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                      <BuilderIcon name="clock" className="h-[18px] w-[18px]" />
                    </span>
                    <select
                      id="configure-setup-time"
                      data-testid="configure-setup-time-select"
                      value={configure.template.setupTimeEstimate}
                      disabled={isLocked}
                      onChange={(event) => updateTemplate({ setupTimeEstimate: event.target.value })}
                      className="w-full cursor-pointer appearance-none rounded-xl border border-gray-100 bg-gray-50/40 py-3 pl-11 pr-10 text-[15px] font-medium text-slate-800 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
                    >
                      {SETUP_TIME_OPTIONS.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                      <BuilderIcon name="chevron" className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-[13.5px] font-semibold text-slate-700">Supported industries</span>
                <p className="mb-3 text-[12.5px] text-slate-400">Where this template works out of the box.</p>
                <IndustryPills
                  options={AGENT_INDUSTRIES}
                  selected={configure.template.supportedIndustries}
                  disabled={isLocked}
                  testIdPrefix="configure-supported-industry"
                  onToggle={(industry) =>
                    updateTemplate({
                      supportedIndustries: configure.template.supportedIndustries.includes(industry)
                        ? configure.template.supportedIndustries.filter((tag) => tag !== industry)
                        : [...configure.template.supportedIndustries, industry]
                    })
                  }
                />
              </div>

              <div>
                <span className="mb-1 block text-[13.5px] font-semibold text-slate-700">Required integrations</span>
                <p className="mb-3 text-[12.5px] text-slate-400">Turn on what the buyer must connect for your agent to work.</p>
                <RequiredIntegrationsSelector
                  value={configure.template.requiredIntegrations}
                  onToggle={toggleIntegration}
                  disabled={isLocked}
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13.5px] font-semibold text-slate-700">Buyer setup fields</span>
                  {!isLocked ? (
                    <button
                      type="button"
                      data-testid="configure-buyer-setup-add"
                      onClick={addBuyerSetupField}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:text-amber-700"
                    >
                      + Add field
                    </button>
                  ) : null}
                </div>
                <p className="mb-3 text-[12.5px] text-slate-400">
                  Extra info buyers must provide during setup (e.g. forwarding phone, booking URL).
                </p>
                {configure.template.requiredBuyerSetup.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-3 text-[12.5px] text-slate-400" data-testid="configure-buyer-setup-empty">
                    No extra fields — buyers only connect the integrations above.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {configure.template.requiredBuyerSetup.map((field, index) => (
                      <div key={index} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50/40 px-3 py-2.5" data-testid={`configure-buyer-setup-row-${index}`}>
                        <input
                          type="text"
                          data-testid={`configure-buyer-setup-label-${index}`}
                          value={field.label}
                          disabled={isLocked}
                          placeholder="Field label, e.g. Forwarding phone"
                          onChange={(event) => updateBuyerSetupField(index, { label: event.target.value })}
                          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                        />
                        <select
                          data-testid={`configure-buyer-setup-type-${index}`}
                          value={field.type}
                          disabled={isLocked}
                          onChange={(event) => updateBuyerSetupField(index, { type: event.target.value as BuyerSetupField["type"] })}
                          className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[13px] font-medium text-slate-600 outline-none transition focus:border-amber-300 disabled:opacity-60"
                        >
                          <option value="text">Text</option>
                          <option value="phone">Phone</option>
                          <option value="url">URL</option>
                          <option value="select">Select</option>
                          <option value="textarea">Long text</option>
                        </select>
                        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                          <input
                            type="checkbox"
                            data-testid={`configure-buyer-setup-required-${index}`}
                            checked={field.required}
                            disabled={isLocked}
                            onChange={(event) => updateBuyerSetupField(index, { required: event.target.checked })}
                            className="h-3.5 w-3.5 accent-amber-500"
                          />
                          Required
                        </label>
                        {!isLocked ? (
                          <button
                            type="button"
                            data-testid={`configure-buyer-setup-remove-${index}`}
                            aria-label="Remove field"
                            onClick={() => removeBuyerSetupField(index)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                          >
                            <BuilderIcon name="x" className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-7 sm:grid-cols-2">
                <div>
                  <label htmlFor="configure-buyer-instructions" className="mb-2 block text-[13.5px] font-semibold text-slate-700">
                    Buyer setup instructions
                  </label>
                  <textarea
                    id="configure-buyer-instructions"
                    data-testid="configure-buyer-instructions-input"
                    value={configure.template.buyerSetupInstructions}
                    disabled={isLocked}
                    placeholder="Step-by-step notes buyers see during their onboarding."
                    onChange={(event) => updateTemplate({ buyerSetupInstructions: event.target.value })}
                    className="h-[110px] w-full resize-none rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
                  />
                </div>
                <div>
                  <label htmlFor="configure-install-instructions" className="mb-2 block text-[13.5px] font-semibold text-slate-700">
                    Install instructions
                  </label>
                  <textarea
                    id="configure-install-instructions"
                    data-testid="configure-install-instructions-input"
                    value={configure.template.installInstructions}
                    disabled={isLocked}
                    placeholder="Anything buyers should know right after installing."
                    onChange={(event) => updateTemplate({ installInstructions: event.target.value })}
                    className="h-[110px] w-full resize-none rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
                  />
                </div>
              </div>

              {/* Compliance lives HERE (Step 4) — data handling + required publish checks. */}
              <div className="border-t border-gray-100 pt-7">
                <ComplianceChecklist compliance={configure.compliance} disabled={isLocked} onChange={updateCompliance} />
              </div>
            </div>
          </div>
        ) : null}

        {/* ============ STEP 5: REVIEW & SUBMIT (read-only, reference layout) ============ */}
        {step === 5 ? (
          <div className="fade-enter overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm" data-testid="configure-step-5">
            <StepHeader
              index={5}
              kicker="Review"
              title="Review & submit"
              subtitle="One last look. Edit anything, then send it to our review team."
            />
            <div className="px-6 py-7 sm:px-8">
              <div className="grid gap-7 lg:grid-cols-[1fr,300px]">
                {/* Summary */}
                <div className="space-y-4" data-testid="configure-review-summary">
                  <ReviewSection
                    title="Basics"
                    editTestId="configure-review-edit-basics"
                    onEdit={() => goToStep(1)}
                    rows={[
                      { label: "Name", value: configure.basics.agentName.trim() || undefined },
                      { label: "Tagline", value: configure.basics.tagline.trim() || undefined },
                      { label: "Category", value: configure.basics.category },
                      { label: "Industries", value: configure.basics.industryTags.join(", ") || undefined }
                    ]}
                  />
                  <ReviewSection
                    title="Description & media"
                    editTestId="configure-review-edit-description"
                    onEdit={() => goToStep(2)}
                    rows={[
                      {
                        label: "Description",
                        value: strippedDescription
                          ? `${strippedDescription.slice(0, 90)}${strippedDescription.length > 90 ? "…" : ""}`
                          : undefined
                      },
                      {
                        label: "What's included",
                        value: includedFeatures.length ? (
                          <>
                            {includedFeatures.map((feature) => (
                              <span key={feature} className="block">
                                • {feature}
                              </span>
                            ))}
                          </>
                        ) : undefined
                      },
                      { label: "Screenshots", value: `${configure.media.screenshotUrls.length} of 4` },
                      { label: "Demo video", value: configure.media.demoVideoUrl.trim() || undefined }
                    ]}
                  />
                  <ReviewSection
                    title="Pricing & trial"
                    editTestId="configure-review-edit-pricing"
                    onEdit={() => goToStep(3)}
                    rows={[
                      { label: "Model", value: priceModelLabel },
                      { label: "Execution fee", value: `$${configure.pricing.executionFee.toFixed(2)} / run` },
                      {
                        label: "Free trial",
                        value: configure.pricing.freeTrialEnabled ? `${configure.pricing.trialDays}-day trial` : "Off"
                      }
                    ]}
                  />
                  <ReviewSection
                    title="Requirements"
                    editTestId="configure-review-edit-requirements"
                    onEdit={() => goToStep(4)}
                    rows={[
                      { label: "Integrations", value: enabledIntegrationLabels.join(", ") || undefined },
                      { label: "Setup time", value: configure.template.setupTimeEstimate },
                      { label: "Processes personal data", value: configure.compliance.processesPersonalData ? "Yes" : "No" },
                      { label: "Stores history", value: configure.compliance.storesConversationHistory ? "Yes" : "No" },
                      { label: "Compliance checks", value: `${complianceCheckedCount} of 4 complete` }
                    ]}
                  />
                </div>

                {/* Preview + submit info */}
                <div className="space-y-5">
                  <div>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">How buyers will see it</p>
                    <MarketplacePreviewCard configure={configure} architectName={architectName} />
                  </div>
                  <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <BuilderIcon name="clock" className="h-[18px] w-[18px] text-amber-500" />
                      <p className="text-[13.5px] font-bold text-amber-900">What happens next</p>
                    </div>
                    <ul className="space-y-2.5 text-[12.5px] text-amber-900/80">
                      {[
                        "Review typically takes 24–48 hours.",
                        "You'll get an email when it's approved or if changes are needed.",
                        "Once approved, your agent goes live immediately."
                      ].map((line) => (
                        <li key={line} className="flex gap-2">
                          <BuilderIcon name="check" className="mt-px h-4 w-4 flex-none text-amber-500" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Compliance gate notice */}
              {!complianceComplete && !isLocked ? (
                <div
                  data-testid="configure-compliance-gate"
                  className="mt-7 flex items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600"
                >
                  <BuilderIcon name="info" className="h-[18px] w-[18px] flex-none" />
                  <span>
                    Complete all compliance checks in{" "}
                    <button
                      type="button"
                      data-testid="configure-gate-goto-step-4"
                      onClick={() => goToStep(4)}
                      className="font-semibold underline hover:text-red-700"
                    >
                      Step 4
                    </button>{" "}
                    to enable submission.
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ===== NAV BUTTONS ===== */}
        <div className="mt-7 flex items-center justify-between gap-4 pb-8">
          <button
            type="button"
            data-testid="configure-back"
            onClick={handleBack}
            disabled={step === 1}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-0"
          >
            <BuilderIcon name="chevron" className="h-4 w-4 rotate-90" />
            Back
          </button>

          <div className="flex items-center gap-3">
            {statusMessage ? (
              <span data-testid="configure-status" className="hidden text-xs font-semibold text-slate-500 sm:inline">
                {savingDraft || saving ? "Saving..." : statusMessage}
              </span>
            ) : null}

            {step < STEP_LABELS.length ? (
              <button
                type="button"
                data-testid="configure-continue"
                onClick={() => void handleContinue()}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:-translate-y-px hover:shadow-lg"
              >
                Continue
                <BuilderIcon name="chevron" className="h-4 w-4 -rotate-90" />
              </button>
            ) : (
              <button
                type="button"
                data-testid="configure-submit-review"
                onClick={() => void handleSubmit()}
                disabled={submitting || isLocked || !complianceComplete}
                className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-7 py-3 text-[14.5px] font-bold text-white shadow-md transition hover:-translate-y-px hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0"
              >
                <BuilderIcon name="send" className="h-4 w-4" />
                {submitting ? "Submitting..." : isLocked && !submitted ? "Publishing locked" : "Submit for review"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Success modal */}
      {submitted ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" data-testid="configure-success-modal">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg">
              <BuilderIcon name="send" className="h-10 w-10 text-white" />
            </div>
            <h3 className="text-2xl font-extrabold tracking-tight text-slate-900">You&apos;re in review! 🎉</h3>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-slate-600">
              {displayName} has been submitted to the Triven Marketplace. We&apos;ll email you within 24–48 hours.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                data-testid="configure-success-stay"
                onClick={() => setSubmitted(false)}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-gray-50"
              >
                Stay in builder
              </button>
              <Link
                href={"/architect/agents" as Route}
                data-testid="configure-success-view-agents"
                className="flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:shadow-lg"
              >
                View My Agents
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-5 right-6 z-[90] flex flex-col items-end gap-2.5">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-testid="configure-toast"
            className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 text-[13.5px] font-medium text-slate-700 shadow-xl"
          >
            {toast.type === "error" ? (
              <BuilderIcon name="info" className="h-5 w-5 flex-none text-red-500" />
            ) : (
              <BuilderIcon name="check" className="h-5 w-5 flex-none text-green-500" />
            )}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- Small internal pieces ---- */

function StepHeader({
  index,
  kicker,
  title,
  subtitle
}: {
  index: number;
  kicker: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="border-b border-gray-50 px-6 pb-5 pt-7 sm:px-8">
      <div className="mb-1.5 flex items-center gap-2.5 text-xs font-bold uppercase tracking-wider text-amber-600">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-amber-500">{index}</span>
        {kicker}
      </div>
      <h3 className="text-[22px] font-extrabold tracking-tight text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function FieldError({ message, testId }: { message?: string; testId: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-[12.5px] font-medium text-red-500" data-testid={testId}>
      {message}
    </p>
  );
}

/** Read-only review card matching the reference Step 5 (header row + label/value rows). */
function ReviewSection({
  title,
  rows,
  onEdit,
  editTestId
}: {
  title: string;
  rows: { label: string; value?: ReactNode }[];
  onEdit: () => void;
  editTestId: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50/40">
      <div className="flex items-center justify-between border-b border-gray-100 bg-white px-5 py-3.5">
        <h4 className="text-[13.5px] font-bold text-slate-800">{title}</h4>
        <button
          type="button"
          data-testid={editTestId}
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-amber-600 transition hover:text-amber-700"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          Edit
        </button>
      </div>
      <div className="px-5 py-2">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 border-b border-gray-50 py-2 last:border-0">
            <span className="flex-none text-[12.5px] text-slate-400">{row.label}</span>
            <span className="text-right text-[13px] font-medium text-slate-700">
              {row.value ?? <span className="text-slate-300">—</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fieldClass(hasError: boolean): string {
  return hasError
    ? "w-full rounded-xl border border-red-300 bg-red-50/30 px-4 py-3 text-[15px] font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-300/50 disabled:opacity-60"
    : "w-full rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-[15px] font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60";
}
