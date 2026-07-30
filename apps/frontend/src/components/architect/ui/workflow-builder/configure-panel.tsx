"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AGENT_CATEGORIES,
  AGENT_INDUSTRIES,
  AGENT_TEMPLATE_TYPES,
  REQUIRED_INTEGRATION_DEFS,
  SETUP_TIME_OPTIONS,
  defaultAgentConfigure,
  deriveRequiredIntegrationsFromWorkflow,
  generateIncludedFeaturesFromWorkflow,
  normalizeBuyerSetupKey,
  RECEPTIONIST_DEFAULT_FULL_DESCRIPTION,
  RECEPTIONIST_DEFAULT_SHORT_DESCRIPTION,
  RECEPTIONIST_DEFAULT_TAGLINE,
  validateBuyerSetupFields,
  validateConfigureForSubmit,
  validateConfigureForTemplateGallery,
  workflowUsesSms,
  workflowUsesWhatsApp,
  workflowJsonForTemplate,
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
  updateArchitectWorkflow,
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
import { defaultAgentDescription, defaultAgentName } from "./node-defaults";

// Step order: 1 Details · 2 Description · 3 Pricing · 4 Requirements & Compliance · 5 Review.
// Compliance is edited in Step 4 ONLY; Step 5 is a read-only review.
const STEP_LABELS = ["Details", "Description", "Pricing", "Requirements", "Review"];

type Toast = { id: number; message: string; type: "success" | "error" };

/** Buyer setup field types the architect can pick, with buyer-friendly labels. */
const BUYER_FIELD_TYPE_OPTIONS: { value: BuyerSetupField["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "select", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" }
];

/** Generic reusable field definitions the presets and suggestions draw from. Never industry-specific. */
const PRESET_FIELDS = {
  businessOverview: { label: "Business overview", type: "textarea", required: true, placeholder: "Location, specialties, anything callers usually ask about" },
  targetCustomers: { label: "Target customers", type: "text", required: false, placeholder: "Who this business mainly serves" },
  servicesOffered: { label: "Services offered", type: "textarea", required: true, placeholder: "One service per line or comma-separated" },
  servicePricingNotes: { label: "Service pricing notes", type: "textarea", required: false, placeholder: "Starting prices, ranges, or “quote on request”" },
  workingHours: { label: "Working hours", type: "text", required: true, placeholder: "Mon-Fri 9am-6pm, Sat 10am-2pm" },
  holidayHours: { label: "Holiday hours", type: "text", required: false, placeholder: "Closed on public holidays, reduced weekend hours…" },
  bookingRules: { label: "Booking rules", type: "textarea", required: true, placeholder: "How and when customers can book or reschedule" },
  cancellationPolicy: { label: "Cancellation policy", type: "textarea", required: false, placeholder: "Notice period, fees, no-show handling" },
  escalationPhone: { label: "Escalation phone", type: "phone", required: true, placeholder: "+1 555 123 4567", helper: "Who the AI should hand urgent callers to." },
  escalationInstructions: { label: "Escalation instructions", type: "textarea", required: false, placeholder: "When to escalate and what to tell the caller" },
  businessPolicies: { label: "Business policies", type: "textarea", required: false, placeholder: "Payment, refund, or privacy policies" },
  frequentQuestions: { label: "Frequent questions", type: "textarea", required: false, placeholder: "Common questions and the answers callers should hear" }
} satisfies Record<string, Omit<BuyerSetupField, "key">>;

type PresetFieldKey = keyof typeof PRESET_FIELDS;

function presetField(key: PresetFieldKey, overrides?: Partial<BuyerSetupField>): BuyerSetupField {
  return { key, ...PRESET_FIELDS[key], ...overrides };
}

/** Quick-add presets — each adds a small required/optional pair, not a wall of required fields. */
const BUYER_SETUP_PRESETS: { id: string; label: string; fields: BuyerSetupField[] }[] = [
  { id: "business-details", label: "Business details", fields: [presetField("businessOverview"), presetField("targetCustomers")] },
  { id: "services", label: "Services", fields: [presetField("servicesOffered"), presetField("servicePricingNotes")] },
  { id: "working-hours", label: "Working hours", fields: [presetField("workingHours"), presetField("holidayHours")] },
  { id: "booking-rules", label: "Booking rules", fields: [presetField("bookingRules"), presetField("cancellationPolicy")] },
  { id: "escalation-contact", label: "Escalation contact", fields: [presetField("escalationPhone"), presetField("escalationInstructions")] },
  { id: "policies", label: "Policies", fields: [presetField("businessPolicies")] },
  { id: "faqs", label: "FAQs", fields: [presetField("frequentQuestions")] }
];

/** One-click starter bundles shown while the field list is still empty. */
const BUYER_SETUP_SUGGESTIONS: { id: string; label: string; fields: BuyerSetupField[] }[] = [
  {
    id: "receptionist",
    label: "Add recommended receptionist setup fields",
    fields: [
      presetField("servicesOffered"),
      presetField("workingHours"),
      presetField("bookingRules"),
      presetField("escalationPhone"),
      presetField("businessOverview", { required: false }),
      presetField("businessPolicies"),
      presetField("frequentQuestions")
    ]
  },
  {
    id: "booking",
    label: "Add booking-focused fields",
    fields: [
      presetField("servicesOffered"),
      presetField("workingHours"),
      presetField("bookingRules"),
      presetField("cancellationPolicy")
    ]
  },
  {
    id: "support",
    label: "Add support-focused fields",
    fields: [
      presetField("frequentQuestions", { required: true }),
      presetField("escalationPhone"),
      presetField("escalationInstructions"),
      presetField("businessPolicies")
    ]
  }
];

/** Compact label for the collapsed field-card header. */
function buyerFieldTypeLabel(type: BuyerSetupField["type"]): string {
  return BUYER_FIELD_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plainTextLength(html: string): number {
  return plainText(html).length;
}

const GENERIC_AGENT_NAMES = new Set(
  ["", "untitled agent", "new agent", defaultAgentName.trim().toLowerCase()].filter(Boolean)
);

function isGenericAgentName(value: string): boolean {
  return GENERIC_AGENT_NAMES.has(value.trim().toLowerCase());
}

function isGenericTagline(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v === defaultAgentDescription.trim()) return true;
  if (v === RECEPTIONIST_DEFAULT_TAGLINE.trim()) return true;
  if (v.includes("→")) return true;
  return false;
}

function isGenericShortDescription(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v === defaultAgentDescription.trim()) return true;
  if (v === RECEPTIONIST_DEFAULT_SHORT_DESCRIPTION.trim()) return true;
  if (v.includes("→")) return true;
  return false;
}

function sanitizeStep1Basics(basics: AgentConfigureBasics): AgentConfigureBasics {
  const agentName = isGenericAgentName(basics.agentName) ? "" : basics.agentName;
  const tagline = isGenericTagline(basics.tagline) ? "" : basics.tagline;
  const shortDescription = isGenericShortDescription(basics.shortDescription) ? "" : basics.shortDescription;
  const looksUntouched =
    !agentName.trim() &&
    !tagline.trim() &&
    !shortDescription.trim() &&
    basics.industryTags.length === 0;

  return {
    ...basics,
    agentName,
    tagline,
    shortDescription,
    category: looksUntouched && basics.category === "Communication" ? "" : basics.category
  };
}

function sanitizeConfigureStep1(config: AgentConfigureData): AgentConfigureData {
  return {
    ...config,
    basics: sanitizeStep1Basics(config.basics)
  };
}

function isGenericFullDescription(value: string): boolean {
  const v = plainText(value).trim();
  if (!v) return true;
  if (v === defaultAgentDescription.trim()) return true;
  if (v === RECEPTIONIST_DEFAULT_SHORT_DESCRIPTION.trim()) return true;
  if (v === plainText(RECEPTIONIST_DEFAULT_FULL_DESCRIPTION).trim()) return true;
  if (v.includes("→")) return true;
  return false;
}

function sanitizeStep2Media(media: AgentConfigureMedia): AgentConfigureMedia {
  return {
    ...media,
    fullDescription: isGenericFullDescription(media.fullDescription) ? "" : media.fullDescription
  };
}

function sanitizeConfigureSteps(config: AgentConfigureData): AgentConfigureData {
  return sanitizeConfigureStep2(sanitizeConfigureStep1(config));
}

function sanitizeConfigureStep2(config: AgentConfigureData): AgentConfigureData {
  return {
    ...config,
    media: sanitizeStep2Media(config.media)
  };
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
  onSave,
  onGoPublish,
  onGoBuild
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
  /** Last-step Review CTA: leave Configure and open the Publish tab. */
  onGoPublish?: () => void;
  /** Switch to Build tab when template save needs workflow nodes. */
  onGoBuild?: () => void;
}) {
  const [configure, setConfigure] = useState<AgentConfigureData>(() =>
    sanitizeConfigureSteps(
    defaultAgentConfigure({
      name: agentName,
      tagline,
      priceDollars: Number(price) || null,
      workflowJson: workflowFlow
    })
    )
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
  const [templateSaveModalOpen, setTemplateSaveModalOpen] = useState(false);
  const [templateModalErrors, setTemplateModalErrors] = useState<Record<string, string>>({});
  const [templateModalWorkflowError, setTemplateModalWorkflowError] = useState("");
  const [savingAsTemplate, setSavingAsTemplate] = useState(false);
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

        // Step 1 & 2: no template/marketing prefills — empty fields + placeholders only.
        Object.assign(loaded.basics, sanitizeStep1Basics(loaded.basics));
        loaded.media = sanitizeStep2Media(loaded.media);

        // Single source of truth for industries: Step 1 "Industry tags".
        // Older drafts that only filled Step 4's supportedIndustries migrate up.
        if (loaded.basics.industryTags.length === 0 && loaded.template.supportedIndustries.length > 0) {
          loaded.basics.industryTags = [...loaded.template.supportedIndustries];
        }
        loaded.template.supportedIndustries = [...loaded.basics.industryTags];

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

        // Auto-seed required integrations from the workflow graph on first load
        // — only when all integration flags are still at their defaults (all false).
        // This way manually-saved choices are never overwritten.
        const allUnset = !Object.values(loaded.template.requiredIntegrations).some((flag) => flag);
        if (allUnset) {
          const derived = deriveRequiredIntegrationsFromWorkflow(workflowFlowRef.current);
          loaded.template.requiredIntegrations = derived;
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
    async (options: { toast?: boolean; quietMissingWorkflow?: boolean } = {}): Promise<boolean> => {
      if (isLocked) return false;

      const id = workflowId || (await ensureWorkflowId());
      if (!id) {
        if (!options.quietMissingWorkflow) {
        pushToast("Add a node in Build so the draft can be saved first.", "error");
        }
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

  /* ---- Step validation ---- */
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
        if (!configure.basics.category.trim()) {
          errors.category = "Select a category for your agent.";
        }
      }

      if (target === 2) {
        const descriptionLength = plainTextLength(configure.media.fullDescription);
        if (descriptionLength < 100) {
          errors.fullDescription = "Describe your agent in at least 100 characters.";
        } else if (descriptionLength > 2000) {
          errors.fullDescription = "Keep the description under 2000 characters.";
        }
      }

      if (target === 3 && configure.pricing.pricingModel !== "free" && configure.pricing.price <= 0) {
        errors.price = "Set a price greater than $0, or switch to Free.";
      }

      if (target === 4) {
        const checks = configure.compliance.complianceChecks;
        if (!checks.guidelines || !checks.tested || !checks.accurate || !checks.terms) {
          errors.complianceChecks = "Complete all four “Before you publish” checks to continue.";
        }
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

  /** Review step CTA — validate + save draft, then hand off to the Publish tab. */
  const handleGoPublish = useCallback(async () => {
    if (isLocked) return;

    const issues = validateConfigureForSubmit(configure);
    if (issues.length > 0) {
      const first = issues[0];
      pushToast(first?.message ?? "Complete the required fields first.", "error");
      if (first) goToStep(first.step);
      return;
    }

    if (!complianceComplete) {
      pushToast("Complete all compliance checks in Step 4 first.", "error");
      goToStep(4);
      return;
    }

    const id = workflowId || (await ensureWorkflowId());
    if (!id) {
      pushToast("Add a node in Build so the agent can be saved first.", "error");
      return;
    }

    setSubmitting(true);
    await persistDraft();
    setSubmitting(false);
    onGoPublish?.();
  }, [
    complianceComplete,
    configure,
    ensureWorkflowId,
    goToStep,
    isLocked,
    onGoPublish,
    persistDraft,
    pushToast,
    workflowId
  ]);

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
    // Lock immediately client-side, but DON'T notify the parent yet — its
    // workflow reload would remount/lock this panel and kill the success
    // modal before the architect ever sees it. onSubmitted fires when the
    // modal is dismissed ("Stay in builder") or on navigation ("View My Agents").
    setServerLocked(true);
    setServerLockedMessage("This agent is under review. Configuration is locked until the review completes.");
    pushToast("Submitted for review — we'll email you within 24–48 hours.");
  }, [configure, ensureWorkflowId, goToStep, isLocked, pushToast, submitting, workflowId]);

  const buildTemplateModalErrors = useCallback(
    (data: AgentConfigureData) => {
      const nodeCount = workflowFlowRef.current?.nodes?.length ?? 0;
      const issues = validateConfigureForTemplateGallery(data, { nodeCount });
      const errors: Record<string, string> = {};
      for (const issue of issues) {
        if (issue.field !== "workflowNodes") {
          errors[issue.field] = issue.message;
        }
      }
      const workflowError = issues.find((issue) => issue.field === "workflowNodes")?.message ?? "";
      return { errors, workflowError };
    },
    []
  );

  const openTemplateSaveModal = useCallback(() => {
    if (isLocked) return;
    const { errors, workflowError } = buildTemplateModalErrors(configure);
    setTemplateModalErrors(errors);
    setTemplateModalWorkflowError(workflowError);
    setTemplateSaveModalOpen(true);
  }, [buildTemplateModalErrors, configure, isLocked]);

  const closeTemplateSaveModal = useCallback(() => {
    if (savingAsTemplate) return;
    setTemplateSaveModalOpen(false);
    setTemplateModalErrors({});
    setTemplateModalWorkflowError("");
  }, [savingAsTemplate]);

  const clearTemplateModalFieldError = useCallback((field: string) => {
    setTemplateModalErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const handleConfirmTemplateSave = useCallback(async () => {
    if (isLocked || savingAsTemplate) return;

    const { errors, workflowError } = buildTemplateModalErrors(configureRef.current);
    setTemplateModalErrors(errors);
    setTemplateModalWorkflowError(workflowError);

    if (Object.keys(errors).length > 0 || workflowError) {
      return;
    }

    setSavingAsTemplate(true);
    const id = workflowId || (await ensureWorkflowId());
    if (!id) {
      setTemplateModalWorkflowError(
        "Add at least one node in the Build tab first, then save again."
      );
      setSavingAsTemplate(false);
      return;
    }

    const draftSaved = await persistDraft({ toast: false, quietMissingWorkflow: true });
    if (!draftSaved) {
      setTemplateModalWorkflowError(
        "Could not save the draft. Add a node in Build, then try again."
      );
      setSavingAsTemplate(false);
      return;
    }

    const flow = workflowFlowRef.current;
    const current = configureRef.current;
    const templateFlow = flow ? workflowJsonForTemplate(flow) : undefined;
    try {
      await updateArchitectWorkflow(id, {
        isTemplate: true,
        name: current.basics.agentName.trim(),
        description: current.basics.tagline.trim() || current.basics.shortDescription.trim(),
        ...(templateFlow ? { workflowJson: templateFlow } : {})
      });
      onSave?.();
      setTemplateSaveModalOpen(false);
      setTemplateModalErrors({});
      setTemplateModalWorkflowError("");
      pushToast("Template saved successfully.");
    } catch {
      pushToast("Could not save as template. Try again.", "error");
    } finally {
      setSavingAsTemplate(false);
    }
  }, [
    buildTemplateModalErrors,
    ensureWorkflowId,
    isLocked,
    onSave,
    persistDraft,
    pushToast,
    savingAsTemplate,
    workflowId
  ]);

  /* ---- Buyer setup field helpers (step 4) ---- */
  // Compact cards: fields render collapsed; only one editor is open at a time.
  const [expandedFieldIndex, setExpandedFieldIndex] = useState<number | null>(null);

  const addBuyerSetupField = useCallback(() => {
    const next = configure.template.requiredBuyerSetup.length;
    updateTemplate({
      requiredBuyerSetup: [
        ...configure.template.requiredBuyerSetup,
        { key: `field${next + 1}`, label: "", type: "text", required: true }
      ]
    });
    setExpandedFieldIndex(next);
  }, [configure.template.requiredBuyerSetup, updateTemplate]);

  /** Add a preset/suggestion bundle, skipping fields whose key already exists. */
  const addBuyerSetupBundle = useCallback(
    (fields: BuyerSetupField[]) => {
      const existing = new Set(configure.template.requiredBuyerSetup.map((field) => field.key));
      const fresh = fields.filter((field) => !existing.has(field.key));
      if (fresh.length === 0) return;
      updateTemplate({ requiredBuyerSetup: [...configure.template.requiredBuyerSetup, ...fresh] });
      setExpandedFieldIndex(null);
      pushToast(`${fresh.length} setup field${fresh.length === 1 ? "" : "s"} added`);
    },
    [configure.template.requiredBuyerSetup, pushToast, updateTemplate]
  );

  const updateBuyerSetupField = useCallback(
    (index: number, patch: Partial<BuyerSetupField>) => {
      updateTemplate({
        requiredBuyerSetup: configure.template.requiredBuyerSetup.map((field, i) =>
          i === index
            ? {
                ...field,
                ...patch,
                ...(typeof patch.label === "string"
                  ? { key: normalizeBuyerSetupKey(patch.label) || field.key }
                  : {}),
                // Switching to a choice type needs somewhere to hold options.
                ...(patch.type && (patch.type === "select" || patch.type === "multiselect") && !field.options
                  ? { options: [] }
                  : {})
              }
            : field
        )
      });
    },
    [configure.template.requiredBuyerSetup, updateTemplate]
  );

  const updateBuyerSetupValidation = useCallback(
    (index: number, patch: Record<string, number | undefined>) => {
      const field = configure.template.requiredBuyerSetup[index];
      if (!field) return;
      const validation = { ...(field.validation ?? {}), ...patch };
      const hasRules = Object.values(validation).some((rule) => rule !== undefined);
      updateBuyerSetupField(index, { validation: hasRules ? validation : undefined });
    },
    [configure.template.requiredBuyerSetup, updateBuyerSetupField]
  );

  const moveBuyerSetupField = useCallback(
    (index: number, delta: -1 | 1) => {
      const fields = [...configure.template.requiredBuyerSetup];
      const target = index + delta;
      if (target < 0 || target >= fields.length) return;
      const [moved] = fields.splice(index, 1);
      fields.splice(target, 0, moved);
      updateTemplate({ requiredBuyerSetup: fields });
      setExpandedFieldIndex((current) =>
        current === index ? target : current === target ? index : current
      );
    },
    [configure.template.requiredBuyerSetup, updateTemplate]
  );

  const removeBuyerSetupField = useCallback(
    (index: number) => {
      updateTemplate({
        requiredBuyerSetup: configure.template.requiredBuyerSetup.filter((_, i) => i !== index)
      });
      setExpandedFieldIndex((current) =>
        current === null ? null : current === index ? null : current > index ? current - 1 : current
      );
    },
    [configure.template.requiredBuyerSetup, updateTemplate]
  );

  /* Live schema issues (duplicate keys, missing labels, empty dropdowns). */
  const buyerSetupIssuesByIndex = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const issue of validateBuyerSetupFields(configure.template.requiredBuyerSetup)) {
      map.set(issue.index, [...(map.get(issue.index) ?? []), issue.message]);
    }
    return map;
  }, [configure.template.requiredBuyerSetup]);

  const [showBuyerPreview, setShowBuyerPreview] = useState(false);
  const [showBuyerInstructions, setShowBuyerInstructions] = useState(false);

  const existingFieldKeys = useMemo(
    () => new Set(configure.template.requiredBuyerSetup.map((field) => field.key)),
    [configure.template.requiredBuyerSetup]
  );

  const workflowHasSms = workflowUsesSms(workflowFlow);
  const workflowHasWhatsApp = workflowUsesWhatsApp(workflowFlow);
  void workflowHasWhatsApp; // WhatsApp UI temporarily paused

  /** Integrations the current workflow nodes actually require — used for auto-seed and sync. */
  const workflowDerivedIntegrations = useMemo(
    () => deriveRequiredIntegrationsFromWorkflow(workflowFlow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(workflowFlow)]
  );

  /**
   * Re-apply the derived integrations from the live workflow graph.
   * Only ADDS derived flags — never removes manually-enabled ones.
   */
  const syncIntegrationsFromWorkflow = useCallback(() => {
    if (isLocked) return;
    updateTemplate({
      requiredIntegrations: {
        ...configure.template.requiredIntegrations,
        ...workflowDerivedIntegrations
      }
    });
    pushToast("Required integrations synced from your workflow.");
  }, [configure.template.requiredIntegrations, isLocked, pushToast, updateTemplate, workflowDerivedIntegrations]);

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
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    setPortalReady(true);
  }, []);

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
        <div className="mx-auto w-full max-w-6xl px-6 py-16 text-center">
          <p className="text-sm font-semibold text-slate-400" data-testid="configure-loading">
            Loading configuration...
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
        {/* Intro + draft controls */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              className="text-[28px] font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-[34px]"
              data-testid="architect-ui-workflow-builder-configure-panel-configure-agent-heading"
            >
              Submit <span className="text-amber-500">{displayName}</span> to the Marketplace
            </h2>
            <p
              className="mt-2.5 max-w-2xl text-[15px] text-slate-600"
              data-testid="architect-ui-workflow-builder-configure-panel-these-details-shape-how-your-agent-appears-text"
            >
              Five quick steps and your agent is ready for review. Most architects finish in under 10 minutes. We've pre-filled everything we could from your build.
            </p>
          </div>
          <div className="flex flex-none items-center gap-2.5">
            <span
              className="hidden items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-3 py-1.5 text-[12px] font-semibold text-amber-700 sm:inline-flex"
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
              className="btn-ghost inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 disabled:opacity-60"
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

        <StepProgress
          labels={STEP_LABELS}
          current={step}
          maxVisited={maxVisited}
          onGoto={(target) => {
            if (target > step && !validateStep(step)) return;
            goToStep(target);
          }}
        />

        {/* ============ STEP 1: DETAILS ============ */}
        {step === 1 ? (
          <div className="configure-step-enter shadow-soft overflow-hidden rounded-2xl border border-gray-100 bg-white" data-testid="configure-step-1">
            <StepHeader index={1} kicker="Details" title="Basics" subtitle="The essentials that show up first in search and on your listing." />
            <div className="space-y-7 px-6 py-7 sm:px-8">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="configure-agent-name" className="text-[13.5px] font-semibold text-slate-700">
                    Agent name <span className="text-amber-500">*</span>
                  </label>
                  <span className="text-[12px] font-medium text-slate-400">{configure.basics.agentName.length} / 50</span>
                </div>
                <input
                  id="configure-agent-name"
                  data-testid="configure-agent-name-input"
                  type="text"
                  maxLength={50}
                  value={configure.basics.agentName}
                  disabled={isLocked}
                  placeholder="e.g. After-Hours AI Receptionist"
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
                  <span className="text-[12px] font-medium text-slate-400">{configure.basics.tagline.length} / 100</span>
                </div>
                <input
                  id="configure-tagline"
                  data-testid="configure-tagline-input"
                  type="text"
                  maxLength={100}
                  value={configure.basics.tagline}
                  disabled={isLocked}
                  placeholder="e.g. Answer missed calls and book appointments automatically"
                  onChange={(event) => updateBasics({ tagline: event.target.value })}
                  className={fieldClass(Boolean(fieldErrors.tagline))}
                />
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
                      className="fld w-full cursor-pointer appearance-none rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 pr-10 text-[15px] font-medium text-slate-800 disabled:opacity-60"
                    >
                      <option value="" disabled>
                        Select a category
                      </option>
                      {AGENT_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                      <BuilderIcon name="chevron" className="h-4 w-4" />
                    </span>
                  </div>
                  <FieldError message={fieldErrors.category} testId="configure-error-category" />
                </div>

                <div>
                  <span className="mb-2 block text-[13.5px] font-semibold text-slate-700">Visibility</span>
                  <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3" data-testid="configure-visibility">
                    <BuilderIcon name="eye" className="h-[18px] w-[18px] text-amber-500" />
                    <span className="text-[14px] font-medium text-slate-700">Public · Triven Marketplace</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-[13.5px] font-semibold text-slate-700">
                  Industry tags <span className="text-amber-500">*</span>
                </span>
                <p className="mb-3 text-[12.5px] text-slate-400">Pick every industry your agent serves well - buyers filter by these.</p>
                <IndustryPills
                  options={AGENT_INDUSTRIES}
                  selected={configure.basics.industryTags}
                  disabled={isLocked}
                  onToggle={(industry) => {
                    const industryTags = configure.basics.industryTags.includes(industry)
                      ? configure.basics.industryTags.filter((tag) => tag !== industry)
                      : [...configure.basics.industryTags, industry];
                    updateBasics({ industryTags });
                    // Step 4's "Supported industries" mirrors this list — one source of truth.
                    updateTemplate({ supportedIndustries: industryTags });
                  }}
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
                    <div className="shadow-amber-sm flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-amber-500">
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
                  placeholder="Brief summary shown on your marketplace listing card"
                  onChange={(event) => updateBasics({ shortDescription: event.target.value })}
                  className="fld h-[74px] w-full resize-none rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-[14.5px] text-slate-800 placeholder:text-slate-400 disabled:opacity-60"
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* ============ STEP 2: DESCRIPTION & MEDIA ============ */}
        {step === 2 ? (
          <div className="configure-step-enter shadow-soft overflow-hidden rounded-2xl border border-gray-100 bg-white" data-testid="configure-step-2">
            <StepHeader index={2} kicker="Description" title="Show it off" subtitle="A clear description and a few screenshots turn browsers into buyers." />
            <div className="space-y-8 px-6 py-7 sm:px-8">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13.5px] font-semibold text-slate-700">
                    Full description <span className="text-amber-500">*</span>
                  </span>
                  <span
                    className={`text-xs font-medium ${plainTextLength(configure.media.fullDescription) > 2000 ? "text-red-500" : "text-slate-400"}`}
                    data-testid="configure-description-counter"
                  >
                    {plainTextLength(configure.media.fullDescription)} / 2000
                  </span>
                </div>
                <RichDescriptionEditor
                  value={configure.media.fullDescription}
                  disabled={isLocked}
                  placeholder="Describe what your agent does, who it's for, and what buyers get after they install it…"
                  onChange={(fullDescription) => {
                    const nextLength = plainTextLength(fullDescription);
                    const currentLength = plainTextLength(configure.media.fullDescription);
                    if (nextLength <= 2000 || nextLength < currentLength) {
                      updateMedia({ fullDescription });
                    }
                  }}
                />
                <div className="mt-1.5 flex items-center justify-between">
                  <p className="text-[12.5px] text-slate-400">Minimum 100 characters · maximum 2,000.</p>
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
                        placeholder="e.g. 24/7 customer response"
                        onChange={(event) => {
                          const nextFeatures = [...configure.media.includedFeatures];
                          while (nextFeatures.length < 4) nextFeatures.push("");
                          nextFeatures[index] = event.target.value;
                          updateMedia({ includedFeatures: nextFeatures });
                        }}
                        className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 py-2.5 pl-10 pr-4 text-[13.5px] placeholder:text-slate-400 disabled:opacity-60"
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
                    className="fld w-full rounded-xl border border-gray-100 bg-gray-50/40 py-3 pl-11 pr-4 text-[14.5px] placeholder:text-slate-400 disabled:opacity-60"
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
                  <MarketplacePreviewCard configure={configure} architectName={architectName} showPrice={false} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ============ STEP 3: PRICING ============ */}
        {step === 3 ? (
          <div className="configure-step-enter shadow-soft overflow-hidden rounded-2xl border border-gray-100 bg-white" data-testid="configure-step-3">
            <StepHeader
              index={3}
              kicker="Pricing"
              title="Set your price"
              subtitle="Pick a model, name a number, and watch what you'd earn."
            />
            <div className="space-y-8 px-6 py-7 sm:px-8">
              <PricingSelector pricing={configure.pricing} disabled={isLocked} onChange={updatePricing} />
              <FieldError message={fieldErrors.price} testId="configure-error-price" />
            </div>
          </div>
        ) : null}

        {/* ============ STEP 4: REQUIREMENTS & COMPLIANCE ============ */}
        {step === 4 ? (
          <div className="configure-step-enter shadow-soft overflow-hidden rounded-2xl border border-gray-100 bg-white" data-testid="configure-step-4">
            <StepHeader
              index={4}
              kicker="Requirements"
              title="Requirements & compliance"
              subtitle="What buyers need to connect, and the checks that keep the Marketplace trusted."
            />
            <div className="space-y-8 px-6 py-7 sm:px-8">
              {/* 1 · Template gallery */}
              <div
                className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50/40"
                data-testid="configure-template-gallery-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 bg-white px-5 py-4 sm:px-6">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-100 bg-white text-amber-500 shadow-soft">
                        <BuilderIcon name="layout-template" className="h-4 w-4" />
                      </span>
                      <h4 className="text-[15px] font-bold text-slate-900">Template gallery</h4>
                    </div>
                    <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-slate-600">
                      Save this workflow as a reusable template other architects can discover and fork.
                    </p>
                  </div>
                  {!isLocked ? (
                    <button
                      type="button"
                      data-testid="configure-save-as-template"
                      onClick={openTemplateSaveModal}
                      disabled={savingAsTemplate}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 py-2.5 text-[13px] font-bold text-white shadow-md transition hover:-translate-y-px hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                    >
                      <BuilderIcon name="layout-template" className="h-4 w-4" />
                      {savingAsTemplate ? "Saving..." : "Save as template"}
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-7 px-5 py-5 sm:grid-cols-2 sm:px-6 sm:py-6">
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
                        className="fld w-full cursor-pointer appearance-none rounded-xl border border-gray-100 bg-gray-50/40 py-3 pl-11 pr-10 text-[15px] font-medium text-slate-800 disabled:opacity-60"
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
              </div>


              {/* 2 · Required integrations */}
              <div className="border-t border-gray-100 pt-7">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13.5px] font-semibold text-slate-700">Required integrations</span>
                  {!isLocked ? (
                    <button
                      type="button"
                      data-testid="configure-sync-integrations"
                      onClick={syncIntegrationsFromWorkflow}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:text-amber-700"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                        <path d="M21 3v5h-5" />
                        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        <path d="M3 21v-5h5" />
                      </svg>
                      Sync from workflow
                    </button>
                  ) : null}
                </div>
                <p className="mb-3 text-[12.5px] text-slate-400">Turn on what the buyer must connect for your agent to work.</p>

                <RequiredIntegrationsSelector
                  value={configure.template.requiredIntegrations}
                  onToggle={toggleIntegration}
                  disabled={isLocked}
                  hiddenKeys={[
                    ...(workflowHasSms || configure.template.requiredIntegrations.sms ? [] : (["sms"] as RequiredIntegrationKey[])),
                    // Temporarily hide WhatsApp from required integrations
                    "whatsapp" as RequiredIntegrationKey
                    // ...(workflowHasWhatsApp || configure.template.requiredIntegrations.whatsapp
                    //   ? []
                    //   : (["whatsapp"] as RequiredIntegrationKey[]))
                  ]}
                />
                {workflowHasSms ? (
                  <p
                    className="mt-3 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-[12.5px] text-amber-900/90"
                    data-testid="configure-sms-warning"
                  >
                    <BuilderIcon name="info" className="mt-0.5 h-4 w-4 flex-none text-amber-500" />
                    This workflow currently includes SMS. Replace it with Email follow-up if you want to avoid A2P/SMS setup.
                  </p>
                ) : null}
                {/* Temporarily hidden — WhatsApp feature paused
                {workflowHasWhatsApp ? (
                  <p
                    className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-[12.5px] text-emerald-900/90"
                    data-testid="configure-whatsapp-notice"
                  >
                    <BuilderIcon name="whatsapp" className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                    This workflow uses WhatsApp. Connect a Meta Cloud API number under Architect → WhatsApp before testing.
                  </p>
                ) : null}
                */}
              </div>

              {/* 3 · Buyer setup requirements */}
              <div className="border-t border-gray-100 pt-7">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13.5px] font-semibold text-slate-700">Buyer setup requirements</span>
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


                {!isLocked && configure.template.requiredBuyerSetup.length === 0 ? (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="configure-buyer-setup-suggestions">
                    {BUYER_SETUP_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        data-testid={`configure-buyer-setup-suggest-${suggestion.id}`}
                        onClick={() => addBuyerSetupBundle(suggestion.fields)}
                        className="rounded-full border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-[12px] font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-50"
                      >
                        ✨ {suggestion.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {!isLocked ? (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="configure-buyer-setup-presets">
                    <span className="text-[11.5px] font-semibold text-slate-400">Quick add:</span>
                    {BUYER_SETUP_PRESETS.map((preset) => {
                      const exhausted = preset.fields.every((field) => existingFieldKeys.has(field.key));
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          data-testid={`configure-buyer-setup-preset-${preset.id}`}
                          disabled={exhausted}
                          onClick={() => addBuyerSetupBundle(preset.fields)}
                          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-slate-500 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-slate-500"
                        >
                          + {preset.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {configure.template.requiredBuyerSetup.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-3 text-[12.5px] text-slate-400" data-testid="configure-buyer-setup-empty">
                    No extra fields - buyers only connect the integrations above.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {configure.template.requiredBuyerSetup.map((field, index) => {
                      const expanded = expandedFieldIndex === index;
                      const issues = buyerSetupIssuesByIndex.get(index) ?? [];

                      return (
                        <div
                          key={index}
                          className={`rounded-xl border bg-gray-50/40 px-3 py-2 ${issues.length ? "border-red-200" : "border-gray-100"}`}
                          data-testid={`configure-buyer-setup-row-${index}`}
                        >
                          {/* Collapsed card header — always visible */}
                          <div className="flex items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-[13px] text-slate-700">
                              <span className="font-semibold">{field.label.trim() || "Untitled field"}</span>
                              <span className="text-slate-400"> · {buyerFieldTypeLabel(field.type)} · </span>
                              <span className={field.required ? "font-semibold text-amber-600" : "text-slate-400"}>
                                {field.required ? "Required" : "Optional"}
                              </span>
                            </p>
                            {!isLocked ? (
                              <>
                                <button
                                  type="button"
                                  data-testid={`configure-buyer-setup-edit-${index}`}
                                  onClick={() => setExpandedFieldIndex(expanded ? null : index)}
                                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11.5px] font-bold text-slate-600 transition hover:border-amber-300 hover:text-amber-700"
                                >
                                  {expanded ? "Done" : "Edit"}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`configure-buyer-setup-up-${index}`}
                                  aria-label="Move field up"
                                  disabled={index === 0}
                                  onClick={() => moveBuyerSetupField(index, -1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-gray-100 hover:text-slate-600 disabled:opacity-30"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  data-testid={`configure-buyer-setup-down-${index}`}
                                  aria-label="Move field down"
                                  disabled={index === configure.template.requiredBuyerSetup.length - 1}
                                  onClick={() => moveBuyerSetupField(index, 1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-gray-100 hover:text-slate-600 disabled:opacity-30"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  data-testid={`configure-buyer-setup-remove-${index}`}
                                  aria-label="Remove field"
                                  onClick={() => removeBuyerSetupField(index)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                                >
                                  <BuilderIcon name="x" className="h-4 w-4" />
                                </button>
                              </>
                            ) : null}
                          </div>

                          {/* Expanded editor — one field at a time */}
                          {expanded ? (
                            <div className="mt-2.5 space-y-2.5 border-t border-gray-100 pt-2.5">
                              <div className="flex flex-wrap items-center gap-2.5">
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
                                  {BUYER_FIELD_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
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
                              </div>

                              <p className="text-[11.5px] text-slate-400" data-testid={`configure-buyer-setup-key-${index}`}>
                                Key: <span className="font-mono text-slate-500">{field.key}</span> — how the answer is stored; derived from the label.
                              </p>

                              <div className="flex flex-wrap gap-2.5">
                                <input
                                  type="text"
                                  data-testid={`configure-buyer-setup-placeholder-${index}`}
                                  value={field.placeholder ?? ""}
                                  disabled={isLocked}
                                  placeholder="Placeholder buyers see, e.g. Mon-Fri 9am-6pm"
                                  onChange={(event) => updateBuyerSetupField(index, { placeholder: event.target.value })}
                                  className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                                />
                                <input
                                  type="text"
                                  data-testid={`configure-buyer-setup-helper-${index}`}
                                  value={field.helper ?? ""}
                                  disabled={isLocked}
                                  placeholder="Help text shown under the field (optional)"
                                  onChange={(event) => updateBuyerSetupField(index, { helper: event.target.value })}
                                  className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                                />
                              </div>

                              {field.type === "select" || field.type === "multiselect" ? (
                                <input
                                  type="text"
                                  data-testid={`configure-buyer-setup-options-${index}`}
                                  value={(field.options ?? []).join(", ")}
                                  disabled={isLocked}
                                  placeholder="Options, comma-separated — e.g. Morning, Afternoon, Evening"
                                  onChange={(event) =>
                                    updateBuyerSetupField(index, {
                                      options: event.target.value.split(",").map((option) => option.trim())
                                    })
                                  }
                                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:opacity-60"
                                />
                              ) : null}

                              {field.type === "number" ? (
                                <div className="flex flex-wrap items-center gap-2.5 text-[12px] font-semibold text-slate-500">
                                  Validation:
                                  <input
                                    type="number"
                                    data-testid={`configure-buyer-setup-validation-min-${index}`}
                                    value={field.validation?.min ?? ""}
                                    disabled={isLocked}
                                    placeholder="Min"
                                    onChange={(event) =>
                                      updateBuyerSetupValidation(index, {
                                        min: event.target.value === "" ? undefined : Number(event.target.value)
                                      })
                                    }
                                    className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] font-normal outline-none transition focus:border-amber-300 disabled:opacity-60"
                                  />
                                  <input
                                    type="number"
                                    data-testid={`configure-buyer-setup-validation-max-${index}`}
                                    value={field.validation?.max ?? ""}
                                    disabled={isLocked}
                                    placeholder="Max"
                                    onChange={(event) =>
                                      updateBuyerSetupValidation(index, {
                                        max: event.target.value === "" ? undefined : Number(event.target.value)
                                      })
                                    }
                                    className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] font-normal outline-none transition focus:border-amber-300 disabled:opacity-60"
                                  />
                                </div>
                              ) : ["text", "textarea", "phone", "email", "url"].includes(field.type) ? (
                                <div className="flex flex-wrap items-center gap-2.5 text-[12px] font-semibold text-slate-500">
                                  Validation:
                                  <input
                                    type="number"
                                    data-testid={`configure-buyer-setup-validation-maxlength-${index}`}
                                    value={field.validation?.maxLength ?? ""}
                                    disabled={isLocked}
                                    placeholder="Max length"
                                    onChange={(event) =>
                                      updateBuyerSetupValidation(index, {
                                        maxLength: event.target.value === "" ? undefined : Number(event.target.value)
                                      })
                                    }
                                    className="w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] font-normal outline-none transition focus:border-amber-300 disabled:opacity-60"
                                  />
                                  <span className="font-normal text-slate-400">characters (optional)</span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {issues.map((message) => (
                            <p key={message} className="mt-1.5 text-[12px] font-semibold text-red-500" data-testid={`configure-buyer-setup-issue-${index}`}>
                              {message}
                            </p>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}

                {configure.template.requiredBuyerSetup.length > 0 ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      data-testid="configure-buyer-setup-preview-toggle"
                      onClick={() => setShowBuyerPreview((current) => !current)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-amber-300 hover:text-amber-700"
                    >
                      {showBuyerPreview ? "Hide buyer preview" : "Preview buyer form"}
                    </button>

                    {showBuyerPreview ? (
                      <div className="mt-2.5 rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm" data-testid="configure-buyer-setup-preview">
                        <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          How buyers see this during setup
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {configure.template.requiredBuyerSetup.map((field, index) => (
                            <div key={index} className={field.type === "textarea" || field.type === "multiselect" ? "sm:col-span-2" : undefined}>
                              <span className="mb-1 block text-[12.5px] font-semibold text-slate-700">
                                {field.label.trim() || `Field ${index + 1}`}{" "}
                                {field.required ? "" : <span className="font-normal text-slate-400">optional</span>}
                              </span>
                              {field.type === "textarea" ? (
                                <textarea disabled rows={2} placeholder={field.placeholder} className="w-full rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-[12.5px]" />
                              ) : field.type === "select" ? (
                                <select disabled className="w-full rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-[12.5px] text-slate-400">
                                  <option>{field.placeholder || "Select an option…"}</option>
                                  {(field.options ?? []).filter((option) => option.trim()).map((option) => (
                                    <option key={option}>{option}</option>
                                  ))}
                                </select>
                              ) : field.type === "multiselect" ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {(field.options ?? []).filter((option) => option.trim()).length > 0 ? (
                                    (field.options ?? []).filter((option) => option.trim()).map((option) => (
                                      <span key={option} className="rounded-full border border-gray-200 bg-gray-50/60 px-2.5 py-1 text-[11.5px] text-slate-500">
                                        {option}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[12px] text-slate-400">Add options above</span>
                                  )}
                                </div>
                              ) : field.type === "boolean" ? (
                                <label className="flex items-center gap-2 text-[12.5px] text-slate-500">
                                  <input type="checkbox" disabled className="h-3.5 w-3.5" /> Yes
                                </label>
                              ) : (
                                <input
                                  disabled
                                  type={field.type === "phone" ? "tel" : field.type}
                                  placeholder={field.placeholder}
                                  className="w-full rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-[12.5px]"
                                />
                              )}
                              {field.helper ? <p className="mt-1 text-[11.5px] text-slate-400">{field.helper}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* 4 · Buyer-facing instructions (collapsed by default) */}
              <div className="border-t border-gray-100 pt-7">
                <button
                  type="button"
                  data-testid="configure-buyer-instructions-toggle"
                  onClick={() => setShowBuyerInstructions((current) => !current)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span>
                    <span className="block text-[13.5px] font-semibold text-slate-700">
                      Buyer-facing instructions
                      {(configure.template.buyerSetupInstructions.trim() || configure.template.installInstructions.trim()) && !showBuyerInstructions ? (
                        <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-600">has notes</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] font-normal text-slate-400">
                      These notes explain what the buyer should prepare before going live.
                    </span>
                  </span>
                  <BuilderIcon name="chevron" className={`h-4 w-4 flex-none text-slate-400 transition-transform ${showBuyerInstructions ? "rotate-180" : ""}`} />
                </button>

                {showBuyerInstructions ? (
                  <div className="mt-4 grid gap-7 sm:grid-cols-2">
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
                ) : null}
              </div>

              {/* Compliance lives HERE (Step 4) — data handling + required publish checks. */}
              <div className="border-t border-gray-100 pt-7">
                <ComplianceChecklist compliance={configure.compliance} disabled={isLocked} onChange={updateCompliance} />
                <FieldError message={fieldErrors.complianceChecks} testId="configure-error-compliance" />
              </div>
            </div>
          </div>
        ) : null}

        {/* ============ STEP 5: REVIEW & SUBMIT (read-only, reference layout) ============ */}
        {step === 5 ? (
          <div className="configure-step-enter shadow-soft overflow-hidden rounded-2xl border border-gray-100 bg-white" data-testid="configure-step-5">
            <StepHeader
              index={5}
              kicker="Review"
              title="Review & submit"
              subtitle="One last look. Edit anything, then continue to Publish to submit for review."
            />
            <div className="px-6 py-7 sm:px-8">
              <div className="flex flex-col items-stretch gap-7 md:flex-row md:items-start">
                {/* Summary — left */}
                <div className="min-w-0 flex-1 space-y-4" data-testid="configure-review-summary">
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
                      ...(configure.pricing.pricingModel !== "free" ? [
                        { label: "Execution fee", value: `$${configure.pricing.executionFee.toFixed(2)} / execution` },
                        {
                          label: "Free trial",
                          value: configure.pricing.freeTrialEnabled ? `${configure.pricing.trialDays}-day trial` : "Off"
                        }
                      ] : [])
                    ]}
                  />
                  <ReviewSection
                    title="Requirements"
                    editTestId="configure-review-edit-requirements"
                    onEdit={() => goToStep(4)}
                    rows={[
                      { label: "Integrations", value: enabledIntegrationLabels.join(", ") || undefined },
                      {
                        label: "Buyer setup fields",
                        value: configure.template.requiredBuyerSetup.length
                          ? configure.template.requiredBuyerSetup
                              .map((field) => field.label.trim())
                              .filter(Boolean)
                              .join(", ") || `${configure.template.requiredBuyerSetup.length} field(s)`
                          : undefined
                      },
                      { label: "Setup time", value: configure.template.setupTimeEstimate },
                      { label: "Processes personal data", value: configure.compliance.processesPersonalData ? "Yes" : "No" },
                      { label: "Stores history", value: configure.compliance.storesConversationHistory ? "Yes" : "No" },
                      { label: "Compliance checks", value: `${complianceCheckedCount} of 4 complete` }
                    ]}
                  />
                </div>

                {/* Marketplace preview — right */}
                <aside className="w-full shrink-0 space-y-5 md:w-[300px]">
                  <div>
                    <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-slate-400">How buyers will see it</p>
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
                </aside>
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
            className="btn-ghost inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-[14px] font-semibold text-slate-700 disabled:pointer-events-none disabled:opacity-0"
          >
            <BuilderIcon name="chevron" className="h-4 w-4 rotate-90" />
            Back
          </button>

          <div className="flex items-center gap-3">
            {step < STEP_LABELS.length ? (
              <button
                type="button"
                data-testid="configure-continue"
                onClick={() => void handleContinue()}
                disabled={step === 4 && !complianceComplete}
                className="btn-primary shadow-amber inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-3 text-[14px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0"
              >
                Continue
                <BuilderIcon name="chevron" className="h-4 w-4 -rotate-90" />
              </button>
            ) : (
              <button
                type="button"
                data-testid="configure-submit-review"
                onClick={() => void (onGoPublish ? handleGoPublish() : handleSubmit())}
                disabled={submitting || isLocked || !complianceComplete}
                className="btn-primary shadow-amber inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-7 py-3 text-[14.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0"
              >
                <BuilderIcon name="send" className="h-5 w-5" />
                {submitting
                  ? "Saving..."
                  : isLocked && !submitted
                    ? "Publishing locked"
                    : onGoPublish
                      ? "Continue to Publish"
                      : "Submit for review"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Success modal + toasts — portaled to body so fixed isn't trapped by .builder-view */}
      {portalReady
        ? createPortal(
            <>
              {submitted ? (
                <div
                  className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
                  data-testid="configure-success-modal"
                >
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
                        onClick={() => {
                          setSubmitted(false);
                          onSubmitted?.();
                        }}
                        className="flex-1 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-gray-50"
                      >
                        Stay in builder
                      </button>
                      <Link
                        href={"/architect/agents" as Route}
                        data-testid="configure-success-view-agents"
                        onClick={() => onSubmitted?.()}
                        className="flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:shadow-lg"
                      >
                        View My Agents
                      </Link>
                    </div>
                  </div>
                </div>
              ) : null}

              {templateSaveModalOpen ? (
                <div
                  className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
                  data-testid="configure-template-save-modal"
                  onClick={closeTemplateSaveModal}
                >
                  <div
                    className="flex max-h-[min(92vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="border-b border-gray-100 px-6 py-5 sm:px-8">
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                          <BuilderIcon name="layout-template" className="h-6 w-6" />
                        </div>
                        <div>
                          <h3 className="text-xl font-extrabold tracking-tight text-slate-900">
                            Save to template gallery
                          </h3>
                          <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600">
                            Fill in the listing details below. Required fields are marked with *.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 sm:px-8" data-testid="configure-template-save-form">
                      {templateModalWorkflowError ? (
                        <div
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3"
                          data-testid="configure-template-save-workflow-error"
                        >
                          <p className="text-[13px] font-medium text-red-700">{templateModalWorkflowError}</p>
                          {onGoBuild ? (
                            <button
                              type="button"
                              data-testid="configure-template-save-go-build"
                              onClick={() => {
                                closeTemplateSaveModal();
                                onGoBuild();
                              }}
                              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 transition hover:bg-red-100/40"
                            >
                              Go to Build
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="grid gap-5 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label htmlFor="template-modal-agent-name" className="mb-2 block text-[13px] font-semibold text-slate-700">
                            Agent name <span className="text-amber-500">*</span>
                          </label>
                          <input
                            id="template-modal-agent-name"
                            data-testid="configure-template-modal-agent-name"
                            type="text"
                            maxLength={50}
                            value={configure.basics.agentName}
                            onChange={(event) => {
                              updateBasics({ agentName: event.target.value });
                              clearTemplateModalFieldError("agentName");
                            }}
                            placeholder="e.g. After-Hours AI Receptionist"
                            className={fieldClass(Boolean(templateModalErrors.agentName))}
                          />
                          <FieldError message={templateModalErrors.agentName} testId="configure-template-error-agent-name" />
                        </div>

                        <div className="sm:col-span-2">
                          <label htmlFor="template-modal-tagline" className="mb-2 block text-[13px] font-semibold text-slate-700">
                            Tagline <span className="text-amber-500">*</span>
                          </label>
                          <input
                            id="template-modal-tagline"
                            data-testid="configure-template-modal-tagline"
                            type="text"
                            maxLength={100}
                            value={configure.basics.tagline}
                            onChange={(event) => {
                              updateBasics({ tagline: event.target.value });
                              clearTemplateModalFieldError("tagline");
                            }}
                            placeholder="e.g. Answer missed calls and book appointments automatically"
                            className={fieldClass(Boolean(templateModalErrors.tagline))}
                          />
                          <FieldError message={templateModalErrors.tagline} testId="configure-template-error-tagline" />
                        </div>

                        <div className="sm:col-span-2">
                          <label htmlFor="template-modal-short-description" className="mb-2 block text-[13px] font-semibold text-slate-700">
                            Short description <span className="text-amber-500">*</span>
                          </label>
                          <textarea
                            id="template-modal-short-description"
                            data-testid="configure-template-modal-short-description"
                            value={configure.basics.shortDescription}
                            maxLength={200}
                            onChange={(event) => {
                              updateBasics({ shortDescription: event.target.value });
                              clearTemplateModalFieldError("shortDescription");
                            }}
                            placeholder="Brief summary shown on your template card"
                            className={`h-[74px] w-full resize-none rounded-xl border bg-gray-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:ring-2 disabled:opacity-60 ${
                              templateModalErrors.shortDescription
                                ? "border-red-300 focus:border-red-400 focus:ring-red-400/40"
                                : "border-gray-100 focus:border-amber-300 focus:ring-amber-400/50"
                            }`}
                          />
                          <FieldError message={templateModalErrors.shortDescription} testId="configure-template-error-short-description" />
                        </div>

                        <div>
                          <label htmlFor="template-modal-category" className="mb-2 block text-[13px] font-semibold text-slate-700">
                            Category <span className="text-amber-500">*</span>
                          </label>
                          <div className="relative">
                            <select
                              id="template-modal-category"
                              data-testid="configure-template-modal-category"
                              value={configure.basics.category}
                              onChange={(event) => {
                                updateBasics({ category: event.target.value });
                                clearTemplateModalFieldError("category");
                              }}
                              className={`w-full cursor-pointer appearance-none rounded-xl border bg-gray-50/40 px-4 py-3 pr-10 text-[14px] font-medium text-slate-800 outline-none transition focus:ring-2 ${
                                templateModalErrors.category
                                  ? "border-red-300 focus:border-red-400 focus:ring-red-400/40"
                                  : "border-gray-100 focus:border-amber-300 focus:ring-amber-400/50"
                              }`}
                            >
                              <option value="" disabled>
                                Select a category
                              </option>
                              {AGENT_CATEGORIES.map((category) => (
                                <option key={category} value={category}>
                                  {category}
                                </option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                              <BuilderIcon name="chevron" className="h-4 w-4" />
                            </span>
                          </div>
                          <FieldError message={templateModalErrors.category} testId="configure-template-error-category" />
                        </div>

                        <div>
                          <label htmlFor="template-modal-type" className="mb-2 block text-[13px] font-semibold text-slate-700">
                            Template type <span className="text-amber-500">*</span>
                          </label>
                          <div className="relative">
                            <select
                              id="template-modal-type"
                              data-testid="configure-template-modal-type"
                              value={configure.template.templateType}
                              onChange={(event) => {
                                updateTemplate({ templateType: event.target.value });
                                clearTemplateModalFieldError("templateType");
                              }}
                              className={`w-full cursor-pointer appearance-none rounded-xl border bg-gray-50/40 px-4 py-3 pr-10 text-[14px] font-medium text-slate-800 outline-none transition focus:ring-2 ${
                                templateModalErrors.templateType
                                  ? "border-red-300 focus:border-red-400 focus:ring-red-400/40"
                                  : "border-gray-100 focus:border-amber-300 focus:ring-amber-400/50"
                              }`}
                            >
                              {AGENT_TEMPLATE_TYPES.map((type) => (
                                <option key={type}>{type}</option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                              <BuilderIcon name="chevron" className="h-4 w-4" />
                            </span>
                          </div>
                          <FieldError message={templateModalErrors.templateType} testId="configure-template-error-template-type" />
                        </div>

                        <div className="sm:col-span-2">
                          <span className="mb-2 block text-[13px] font-semibold text-slate-700">
                            Industry tags <span className="text-amber-500">*</span>
                          </span>
                          <IndustryPills
                            options={AGENT_INDUSTRIES}
                            selected={configure.basics.industryTags}
                            onToggle={(industry) => {
                              const industryTags = configure.basics.industryTags.includes(industry)
                                ? configure.basics.industryTags.filter((tag) => tag !== industry)
                                : [...configure.basics.industryTags, industry];
                              updateBasics({ industryTags });
                              updateTemplate({ supportedIndustries: industryTags });
                              clearTemplateModalFieldError("industryTags");
                            }}
                          />
                          <FieldError message={templateModalErrors.industryTags} testId="configure-template-error-industry-tags" />
                        </div>

                        <div>
                          <label htmlFor="template-modal-setup-time" className="mb-2 block text-[13px] font-semibold text-slate-700">
                            Setup time <span className="text-amber-500">*</span>
                          </label>
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                              <BuilderIcon name="clock" className="h-4 w-4" />
                            </span>
                            <select
                              id="template-modal-setup-time"
                              data-testid="configure-template-modal-setup-time"
                              value={configure.template.setupTimeEstimate}
                              onChange={(event) => {
                                updateTemplate({ setupTimeEstimate: event.target.value });
                                clearTemplateModalFieldError("setupTimeEstimate");
                              }}
                              className={`w-full cursor-pointer appearance-none rounded-xl border bg-gray-50/40 py-3 pl-10 pr-10 text-[14px] font-medium text-slate-800 outline-none transition focus:ring-2 ${
                                templateModalErrors.setupTimeEstimate
                                  ? "border-red-300 focus:border-red-400 focus:ring-red-400/40"
                                  : "border-gray-100 focus:border-amber-300 focus:ring-amber-400/50"
                              }`}
                            >
                              {SETUP_TIME_OPTIONS.map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                              <BuilderIcon name="chevron" className="h-4 w-4" />
                            </span>
                          </div>
                          <FieldError message={templateModalErrors.setupTimeEstimate} testId="configure-template-error-setup-time" />
                        </div>

                        <div className="sm:col-span-2">
                          <label htmlFor="template-modal-full-description" className="mb-2 block text-[13px] font-semibold text-slate-700">
                            Full description <span className="text-amber-500">*</span>
                          </label>
                          <textarea
                            id="template-modal-full-description"
                            data-testid="configure-template-modal-full-description"
                            value={plainText(configure.media.fullDescription)}
                            maxLength={2000}
                            onChange={(event) => {
                              updateMedia({ fullDescription: event.target.value });
                              clearTemplateModalFieldError("fullDescription");
                            }}
                            placeholder="Describe what this template does, who it's for, and what's included (at least 100 characters)."
                            className={`h-32 w-full resize-y rounded-xl border bg-gray-50/40 px-4 py-3 text-sm text-slate-800 outline-none transition focus:ring-2 ${
                              templateModalErrors.fullDescription
                                ? "border-red-300 focus:border-red-400 focus:ring-red-400/40"
                                : "border-gray-100 focus:border-amber-300 focus:ring-amber-400/50"
                            }`}
                          />
                          <FieldError message={templateModalErrors.fullDescription} testId="configure-template-error-full-description" />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 sm:px-8">
                      <button
                        type="button"
                        data-testid="configure-template-save-dismiss"
                        onClick={closeTemplateSaveModal}
                        disabled={savingAsTemplate}
                        className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-gray-50 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        data-testid="configure-template-save-confirm"
                        onClick={() => void handleConfirmTemplateSave()}
                        disabled={savingAsTemplate}
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:-translate-y-px hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                      >
                        <BuilderIcon name="layout-template" className="h-4 w-4" />
                        {savingAsTemplate ? "Saving..." : "Save as template"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="pointer-events-none fixed bottom-5 right-6 z-[210] flex flex-col items-end gap-3">
                {toasts.map((toast) => (
                  <div
                    key={toast.id}
                    data-testid="configure-toast"
                    className={
                      toast.type === "error"
                        ? "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-red-100 bg-white px-4 py-3.5 text-[13.5px] font-medium text-slate-700 shadow-[0_16px_40px_rgba(15,23,42,0.12)]"
                        : "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-emerald-100 bg-white px-4 py-3.5 text-[13.5px] font-medium text-slate-700 shadow-[0_16px_40px_rgba(15,23,42,0.12)]"
                    }
                  >
                    {toast.type === "error" ? (
                      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-red-50 text-red-500">
                        <BuilderIcon name="info" className="h-5 w-5" />
                      </span>
                    ) : (
                      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500">
                        <BuilderIcon name="check" className="h-5 w-5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p
                        className={
                          toast.type === "error"
                            ? "text-[12px] font-bold uppercase tracking-[0.14em] text-red-500"
                            : "text-[12px] font-bold uppercase tracking-[0.14em] text-emerald-500"
                        }
                      >
                        {toast.type === "error" ? "Error" : "Success"}
                      </p>
                      <p className="mt-1 leading-relaxed text-slate-700">{toast.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>,
            document.body
          )
        : null}
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
      <div className="mb-1.5 flex items-center gap-2.5 text-[12px] font-bold uppercase tracking-wider text-amber-600">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-amber-500">{index}</span>
        {kicker}
      </div>
      <h3 className="text-[22px] font-extrabold tracking-tight text-slate-900">{title}</h3>
      <p className="mt-1 text-[14px] text-slate-500">{subtitle}</p>
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
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold text-amber-600 transition hover:text-amber-700"
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
    ? "fld w-full rounded-xl border border-red-300 bg-red-50/30 px-4 py-3 text-[15px] font-medium text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60"
    : "fld w-full rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 text-[15px] font-medium text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60";
}
