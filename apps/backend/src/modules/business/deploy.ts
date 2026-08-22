import {
  DEFAULT_CALENDAR_BOOKING_RULES,
  RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE,
  VOICE_NODE_TYPES,
  buildAfterHoursPromptSection,
  buildSilencePolicy,
  formatBuyerAnswerValue,
  resolveAfterHoursGreeting,
  resolveSalesTuning,
  resolveSimulatedHoursState,
  salesBehaviourPromptFor,
  type AfterHoursPolicy,
  type AfterHoursSnapshot
} from "@coreai/shared";
import type { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import {
  LIVE_VAPI_RUNTIME_VARIABLES,
  buildAgentFirstMessage,
  buildAgentSystemPrompt,
  fillPromptTemplateTokens,
  resolveAssistantName,
  resolveNodeTemplateVariables,
  resolveBusinessName,
  sanitizeLegacyFallbacks
} from "../agent-runtime/prompt-builder";
import {
  withRecordingDisclosure,
  workflowCallRecordingEnabled,
  workflowCapabilities
} from "../agent-runtime/graph-runner";
import { loadBusinessAgentKnowledge } from "./agent-knowledge";
import { loadBusinessFacts } from "./business-facts";
import { buildHoursPromptLines, loadBusinessHoursState } from "./business-hours-state";
// [DISABLED:non-handoff]
// import { compileRulesPromptSection, getEffectiveRules } from "./rules/rules-service";
import {
  buildAfterHoursSnapshotForBusiness,
  logAfterHoursRouting,
  resolveAfterHoursPolicy
} from "./after-hours-state";
import { deployVapiAssistant, isVapiConfigured } from "../architect/vapi-connector";
import { ensureStaffGoogleCalendar } from "../architect/google-calendar-connector";
import { resolveBusinessProviders } from "./scheduling";

type NodeLike = { id?: string; data?: Record<string, unknown> };

type VoiceOverride = {
  provider?: string;
  voiceId?: string;
  voice?: string;
};

type BuyerConfig = {
  businessName?: string;
  businessType?: string;
  contactName?: string;
  customInstructions?: string;
  firstMessage?: string;
  assistantName?: string;
  services: string[];
  faqs: string[];
  silence?: {
    repromptCount?: number;
    reprompt1?: string;
    reprompt2?: string;
    goodbye?: string;
  };
};

function nodesOf(workflowJson: unknown): NodeLike[] {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? (nodes as NodeLike[]) : [];
}

function voiceNodeData(workflowJson: unknown): Record<string, unknown> | null {
  const node = nodesOf(workflowJson).find(
    (n) => (n.data?.type as string) === VOICE_NODE_TYPES.voiceConversation
  );
  return node?.data ? (node.data as Record<string, unknown>) : null;
}

function architectNodeInstructions(voiceNode: Record<string, unknown>): string {
  const parts: string[] = [];

  const systemPrompt = cleanString(voiceNode.systemPrompt);
  if (systemPrompt && systemPrompt !== RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE.trim()) {
    parts.push(systemPrompt);
  }

  const custom = firstString(voiceNode.customInstructions, voiceNode.instructions);
  if (custom) parts.push(custom);

  return parts.join("\n\n").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function isStaleDemoEntry(value?: string | null): boolean {
  if (!value) return false;
  return /Triven Dental/i.test(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();

      if (typeof item === "object" && item !== null) {
        const record = item as Record<string, unknown>;
        return (
          cleanString(record.name) ||
          cleanString(record.title) ||
          cleanString(record.service) ||
          cleanString(record.label) ||
          ""
        );
      }

      return "";
    })
    .filter((item) => item.length > 0 && !isStaleDemoEntry(item));
}

function faqStrings(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();

        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          const question = cleanString(record.question) ?? "";
          const answer = cleanString(record.answer) ?? "";
          return [question, answer].filter(Boolean).join(" - ");
        }

        return "";
      })
      .filter((item) => item.length > 0 && !isStaleDemoEntry(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>)
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0 && !isStaleDemoEntry(item));
  }

  return [];
}

/** Buyer voice choice from InstalledAgent.configJson.voice or top-level voice fields. */
function readVoiceOverride(configJson: unknown): VoiceOverride {
  const config = recordOf(configJson);
  const voice = recordOf(config.voice);

  const provider = firstString(voice.provider, config.voiceProvider);
  const voiceId = firstString(voice.voiceId, config.voiceId);
  const voiceName = firstString(voice.name, config.voice);

  return {
    provider,
    voiceId,
    voice: voiceName && !isStaleDemoEntry(voiceName) ? voiceName : undefined
  };
}

/** Buyer-provided setup from InstalledAgent.configJson. */
function readBuyerConfig(configJson: unknown): BuyerConfig {
  const config = recordOf(configJson);
  const details = recordOf(config.businessDetails);
  const silenceRaw = recordOf(config.silence);

  return {
    businessName: firstString(details.businessName, config.businessName),
    businessType: firstString(details.businessType, config.businessType),
    contactName: firstString(
      details.contactName,
      details.ownerName,
      details.contactPerson,
      config.contactName,
      config.ownerName
    ),
    customInstructions: firstString(details.customInstructions, config.customInstructions),
    firstMessage: firstString(config.firstMessage, details.firstMessage),
    assistantName: firstString(config.assistantName, details.assistantName),
    services: [...stringArray(details.services), ...stringArray(config.services)],
    faqs: [
      ...faqStrings(details.faqs),
      ...faqStrings(details.knowledge),
      ...faqStrings(config.faqs),
      ...faqStrings(config.knowledge)
    ],
    silence: {
      repromptCount: typeof silenceRaw.repromptCount === "number" ? silenceRaw.repromptCount : undefined,
      reprompt1: cleanString(silenceRaw.reprompt1),
      reprompt2: cleanString(silenceRaw.reprompt2),
      goodbye: cleanString(silenceRaw.goodbye)
    }
  };
}

function readCustomFields(configJson: unknown): Array<{ label: string; value: string }> {
  const raw = recordOf(configJson).customFields;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const record = recordOf(item);
      return {
        label: cleanString(record.label) ?? cleanString(record.key) ?? "",
        value: formatBuyerAnswerValue(record.value)
      };
    })
    .filter((field) => field.label && field.value);
}

function readBookingLabel(configJson: unknown): string | undefined {
  const config = recordOf(configJson);
  const scheduling = recordOf(config.scheduling);
  const customBookingLabel = readCustomFields(configJson).find(
    (field) => field.label.trim().toLowerCase() === "booking label" || field.label.trim().toLowerCase() === "booking type"
  )?.value;
  return firstString(scheduling.bookingLabel, scheduling.bookingType, config.bookingLabel, customBookingLabel);
}

/** Compact human-readable business hours from buyer setup. */
function formatHours(hoursJson: unknown, fallback = "not provided"): string {
  if (!Array.isArray(hoursJson) || hoursJson.length === 0) return fallback;

  const parts = hoursJson
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";

      const record = item as Record<string, unknown>;
      const day = cleanString(record.day)?.slice(0, 3) ?? "";
      if (!day) return "";

      if (record.closed === true) return `${day} closed`;

      const open = cleanString(record.open) ?? "";
      const close = cleanString(record.close) ?? "";

      return open && close ? `${day} ${open}-${close}` : "";
    })
    .filter(Boolean);

  return parts.length ? parts.join(", ") : fallback;
}

const LIVE_TOOL_NOTES = `
Live call handling:
- If the caller wants to book, ask for their preferred date and time first.
- Call check_availability only after a date is known.
- Call book_appointment only after name, date, and time are confirmed.
- Never say "Y-Y-Y-Y, M-M, D-D"; say dates in plain spoken language.
`.trim();

const PREVIEW_TOOL_NOTES = `
Preview call handling:
- This is a browser test call placed by the business owner, not a live customer call.
- Booking works exactly like the live agent when the workflow supports it: ask for a preferred date and time, call check_availability once a date is known, and call book_appointment only after name, date, and time are confirmed. The booking creates a clearly-marked TEST event on the business calendar — say so when confirming.
- The SMS consent flow also works exactly like the live agent: read the disclosure, wait for the answer, and call record_sms_consent. A decline means no text — complete the booking normally. Because this is a test call, NO real text or email is ever delivered; if the caller asks, say the confirmation would be sent on a real call.
- Never say "Y-Y-Y-Y, M-M, D-D"; say dates in plain spoken language.
`.trim();

type InstalledAgentAssistantPlan = {
  businessId: string;
  installedAgentId: string;
  configJson: unknown;
  workflowJson: unknown;
  profileExists: boolean;
  /** BusinessProfile.vapiAssistantId — the live assistant, if any. */
  priorAssistantId: string | undefined;
  voiceNode: Record<string, unknown>;
  systemPrompt: string;
  firstMessage: string;
  override: VoiceOverride;
  businessName: string;
  assistantName: string;
  /** Capabilities of the workflow graph — the only source of tool gating. */
  capabilities: ReturnType<typeof workflowCapabilities>;
  /** Effective after-hours policy (buyer configJson → architect node default). */
  afterHoursPolicy: AfterHoursPolicy | null;
  /** Resolved team phone (per-agent first, then business profile) — gates transfer_to_human. */
  teamPhone: string;
  /** Buyer's master transfer switch (configJson.businessDetails.transferEnabled). */
  transferEnabled: boolean;
};

async function buildInstalledAgentAssistantPlan(
  businessId: string,
  options?: {
    extraSections?: string[];
    installedAgentId?: string;
    afterHoursRender?: { kind: "liquid" } | { kind: "literal"; snapshot: AfterHoursSnapshot };
  }
): Promise<InstalledAgentAssistantPlan | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      profile: true,
      knowledgeBases: true,
      installedAgents: {
        where: options?.installedAgentId
          ? { id: options.installedAgentId }
          : { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { workflow: true }
      }
    }
  });

  const installedAgent = business?.installedAgents[0] ?? null;
  if (!business || !installedAgent?.workflow) return null;

  const voiceNode = voiceNodeData(installedAgent.workflow.workflowJson);
  if (!voiceNode) return null;

  const buyer = readBuyerConfig(installedAgent.configJson);

  // Identity source of truth: buyer setup first, generic fallback only when
  // truly missing. A buyer-entered "Sarah"/"Maya" is valid configuration.
  const businessName = resolveBusinessName(buyer.businessName, business.name);
  const businessType = firstString(buyer.businessType, business.type) ?? "business";
  const assistantName = resolveAssistantName(buyer.assistantName);
  const contactName = firstString(buyer.contactName) ?? businessName;

  const profileServices = stringArray(business.profile?.services);
  const services = buyer.services.length ? buyer.services : profileServices;

  const profileFaqs = faqStrings(business.profile?.faqsJson);
  const faqs = buyer.faqs.length ? buyer.faqs : profileFaqs;

  const { knowledge } = await loadBusinessAgentKnowledge({
    businessId: business.id,
    installedAgentId: installedAgent.id
  });

  const facts = await loadBusinessFacts(business.id, {
    installedAgentId: installedAgent.id
  });
  const factsSection =
    facts && facts.promptLines.length > 0
      ? `Verified business facts (answer these directly and exactly; NEVER invent a street, city, state, postal code, landmark, or link that is not listed):\n${facts.promptLines.map((line) => `- ${line}`).join("\n")}`
      : "";

  // [DISABLED:non-handoff] owner-rules prompt section.
  // const rulesSection = compileRulesPromptSection(
  //   await getEffectiveRules({ businessId: business.id, installedAgentId: installedAgent.id }).catch(
  //     () => []
  //   )
  // );
  const rulesSection = "";

  // Escalation rules are per-agent (configJson.businessDetails), falling back to
  // the shared BusinessProfile only for agents installed before that split.
  const agentDetails = recordOf(recordOf(installedAgent.configJson).businessDetails);
  const customInstructions = (
    buyer.customInstructions ||
    cleanString(agentDetails.escalationRules) ||
    cleanString(business.profile?.escalationRules) ||
    ""
  ).trim();

  const hoursState = await loadBusinessHoursState(businessId, installedAgent.id);
  const businessHours = hoursState.configured
    ? buildHoursPromptLines(hoursState).join("\n  ")
    : buildHoursPromptLines(hoursState)[0];
  const silencePolicy = buildSilencePolicy(buyer.silence);
  const capabilities = workflowCapabilities(installedAgent.workflow.workflowJson);

  const nodeInstructions = architectNodeInstructions(voiceNode);
  const customFields = readCustomFields(installedAgent.configJson);
  const bookingLabel = readBookingLabel(installedAgent.configJson);

  const afterHoursPolicy = resolveAfterHoursPolicy({
    configJson: installedAgent.configJson,
    workflowJson: installedAgent.workflow.workflowJson,
    businessType
  });
  const afterHoursSection = afterHoursPolicy?.enabled
    ? buildAfterHoursPromptSection({
        policy: afterHoursPolicy,
        businessName,
        bookingLabel,
        capabilities: {
          canCheckAvailability: capabilities.canCheckAvailability,
          canBook: capabilities.canBook,
          canNotifyStaff: capabilities.canText || capabilities.canEmail === true
        },
        render:
          options?.afterHoursRender?.kind === "literal"
            ? {
                kind: "literal",
                state: options.afterHoursRender.snapshot.state,
                statusLine: options.afterHoursRender.snapshot.statusLine,
                nextOpenText: options.afterHoursRender.snapshot.nextOpenText
              }
            : { kind: "liquid" }
      })
    : "";

  const deployTokenValues: Record<string, string> = {
    assistantName,
    businessName,
    businessType,
    contactName,
    services: services.join(", "),
    servicesList: services.join(", "),
    businessHours,
    bookingLabel: bookingLabel ?? "appointment",
    // Calendar stays business-level; the contact points are per-agent.
    calendarId: cleanString(business.profile?.calendarId) || "primary",
    teamPhone: cleanString(agentDetails.teamPhone) ?? cleanString(business.profile?.teamPhone) ?? "",
    bookingUrl: cleanString(agentDetails.bookingUrl) ?? cleanString(business.profile?.bookingUrl) ?? ""
  };
  const fillDeployTemplate = (text: string): string =>
    fillPromptTemplateTokens(text, deployTokenValues, {
      runtimeVariables: LIVE_VAPI_RUNTIME_VARIABLES,
      stripUnresolved: true
    });

  /* Built BEFORE the system prompt so the prompt can quote the exact opening
     line and forbid repeating it — otherwise the model greets a second time. */
  const baseFirstMessage = buildAgentFirstMessage({
    assistantName,
    businessName,
    customFirstMessage: buyer.firstMessage
      ? fillDeployTemplate(
          sanitizeLegacyFallbacks(
            resolveNodeTemplateVariables(buyer.firstMessage, installedAgent.workflow.workflowJson, { assistantName, businessName }),
            { assistantName, businessName }
          )
        )
      : undefined
  });
  /* Two-party-consent states require the caller to HEAR that the call may be
     recorded. Recording defaults on, so the greeting carries the notice
     whenever the End Flow toggle hasn't disabled it. */
  const firstMessage = workflowCallRecordingEnabled(installedAgent.workflow.workflowJson)
    ? withRecordingDisclosure(baseFirstMessage)
    : baseFirstMessage;

  const systemPrompt = buildAgentSystemPrompt({
    assistantName,
    businessName,
    businessType,
    contactName,
    openingLine: firstMessage,
    services,
    faqs: faqs.length ? faqs : [],
    knowledge,
    hasKnowledgeLookupTool: true,
    address: facts?.addressFormatted ?? cleanString(business.profile?.serviceArea),
    businessHours,
    // Vapi substitutes these {{...}} variables with live values at call time.
    timezoneText: "{{timeZone}}",
    currentDateTimeText: "{{currentDateTime}}",
    currentDateText: "{{currentDate}}",
    tomorrowDateText: "{{tomorrowDate}}",
    smsConsentStatusText: "{{smsConsentStatus}}",
    customInstructions,
    silencePolicy,
    calendarRules: DEFAULT_CALENDAR_BOOKING_RULES,
    capabilities: {
      canCheckAvailability: capabilities.canCheckAvailability,
      canBook: capabilities.canBook,
      canText: capabilities.canText,
      canEmail: capabilities.canEmail
      // [DISABLED] canTransfer: Boolean(deployTokenValues.teamPhone) && agentDetails.transferEnabled !== false
    },
    // [DISABLED] transferConditions: cleanString(agentDetails.transferConditions as string | undefined) || undefined,
    nodeInstructions: nodeInstructions
      ? fillDeployTemplate(
          sanitizeLegacyFallbacks(
            resolveNodeTemplateVariables(nodeInstructions, installedAgent.workflow.workflowJson, { assistantName, businessName }),
            { assistantName, businessName }
          )
        )
      : undefined,
    bookingLabel,
    customFields,
    extraSections: [
      ...(factsSection ? [factsSection] : []),
      ...(rulesSection ? [rulesSection] : []),
      ...(afterHoursSection ? [afterHoursSection] : []),
      ...(options?.extraSections ?? [LIVE_TOOL_NOTES])
    ]
  });

  console.log("[deploy] resolved agent identity", {
    businessId,
    assistantName,
    businessName,
    firstMessage,
    capabilities
  });

  return {
    businessId: business.id,
    installedAgentId: installedAgent.id,
    configJson: installedAgent.configJson,
    workflowJson: installedAgent.workflow.workflowJson,
    profileExists: Boolean(business.profile),
    priorAssistantId: cleanString(
      installedAgent.configJson &&
        typeof installedAgent.configJson === "object" &&
        !Array.isArray(installedAgent.configJson)
        ? ((installedAgent.configJson as Record<string, unknown>).vapiAssistantId as string | undefined)
        : undefined
    ),
    voiceNode,
    systemPrompt,
    firstMessage,
    override: readVoiceOverride(installedAgent.configJson),
    businessName,
    assistantName,
    capabilities,
    afterHoursPolicy,
    teamPhone: deployTokenValues.teamPhone,
    transferEnabled: agentDetails.transferEnabled !== false
  };
}

export async function deployInstalledAgentVoiceAssistant(
  businessId: string,
  installedAgentId?: string
): Promise<{ assistantId: string; created: boolean } | null> {
  if (!isVapiConfigured()) return null;

  const plan = await buildInstalledAgentAssistantPlan(businessId, { installedAgentId });
  if (!plan) return null;

  const webhookUrl = `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/vapi/webhook`;
  const existingAssistantId =
    plan.priorAssistantId
      ? plan.priorAssistantId
      : undefined;

  const assistant = await deployVapiAssistant({
    name: `${plan.businessName} - ${plan.assistantName}`,
    firstMessage: plan.firstMessage,
    // The behaviour dials the architect set on the node travel with the agent
    // to every buyer who installs it — a buyer inherits the tuned conduct, not
    // just the script. Untuned nodes resolve to the researched defaults.
    systemPrompt: `${plan.systemPrompt}\n\n${salesBehaviourPromptFor(resolveSalesTuning(plan.voiceNode))}`,
    tuning: plan.voiceNode,
    model: cleanString(plan.voiceNode.model) || "gpt-4o-mini",
    voice: plan.override.voice || "triven-default",
    voiceProvider: plan.override.provider,
    voiceId: plan.override.voiceId,
    language: cleanString(plan.voiceNode.language),
    speakingSpeed: cleanString(plan.voiceNode.speakingSpeed),
    serverUrl: webhookUrl,
    existingAssistantId,
    metadata: { businessId: plan.businessId, installedAgentId: plan.installedAgentId },
    recordingEnabled: workflowCallRecordingEnabled(plan.workflowJson),
    maxDurationSeconds: LIVE_MAX_CALL_DURATION_SECONDS,
    includeTools: {
      checkAvailability: plan.capabilities.canCheckAvailability,
      bookAppointment: plan.capabilities.canBook,
      sendNotification: plan.capabilities.canText || plan.capabilities.canEmail === true,
      recordSmsConsent: plan.capabilities.canText
      // [DISABLED] transferToHuman: Boolean(plan.teamPhone) && plan.transferEnabled
    }
  });

  if (plan.profileExists) {
    await prisma.businessProfile.update({
      where: { businessId: plan.businessId },
      data: { vapiAssistantId: assistant.id }
    });
  } else {
    await prisma.businessProfile.create({
      data: { businessId: plan.businessId, vapiAssistantId: assistant.id }
    });
  }
  // Provision & share Google Calendars for all staff members during Deploy button click
  const providers = resolveBusinessProviders(plan.configJson);
  let updatedProviders: Array<{ name: string; email: string | null; calendarId: string }> | undefined;

  const businessRow = await prisma.business.findUnique({
    where: { id: plan.businessId },
    select: { ownerId: true, name: true, profile: { select: { timeZone: true } } }
  });

  if (businessRow && businessRow.ownerId && providers.length > 0) {
    const timeZone = businessRow.profile?.timeZone || "America/New_York";
    updatedProviders = [];
    for (const p of providers) {
      try {
        const calId = await ensureStaffGoogleCalendar({
          userId: businessRow.ownerId,
          businessName: businessRow.name,
          providerName: p.name,
          providerEmail: p.email,
          timeZone
        });
        updatedProviders.push({ name: p.name, email: p.email, calendarId: calId });
      } catch (calErr) {
        console.warn(`[deploy] Failed to provision calendar for ${p.name}:`, calErr);
        updatedProviders.push({ name: p.name, email: p.email, calendarId: "primary" });
      }
    }
  }

  const agentRow = await prisma.installedAgent.findUnique({
    where: { id: plan.installedAgentId },
    select: { configJson: true }
  });
  const agentConfig = recordOf(agentRow?.configJson ?? plan.configJson);
  await prisma.installedAgent.update({
    where: { id: plan.installedAgentId },
    data: {
      configJson: {
        ...agentConfig,
        vapiAssistantId: assistant.id,
        voicePipeline: assistant.pipeline,
        ...(updatedProviders ? { providers: updatedProviders } : {})
      } as object
    }
  });

  return { assistantId: assistant.id, created: assistant.created };
}

/* ----------------------- Setup chat simulation ----------------------- */

export type InstalledAgentChatTestSetup = {
  workflowId: string;
  installedAgentId: string;
  context: {
    businessName?: string;
    businessType?: string;
    assistantName?: string;
    calendarId?: string;
    timeZone?: string;
    appointmentService?: string;
    services?: string[];
    faqs?: string[];
    knowledge?: string[];
    address?: string;
    factsLines?: string[];
    businessHours?: string;
  };
  workflowJson: unknown;
  /** Effective after-hours policy for this install (null when not configured). */
  afterHoursPolicy: AfterHoursPolicy | null;
};

export async function buildInstalledAgentChatTestSetup(
  businessId: string
): Promise<InstalledAgentChatTestSetup | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      profile: true,
      installedAgents: {
        where: { status: { in: ["ACTIVE", "PROVISIONING"] } },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 1,
        include: { workflow: true }
      }
    }
  });

  const installedAgent = business?.installedAgents[0] ?? null;
  if (!business || !installedAgent?.workflow) return null;

  const buyer = readBuyerConfig(installedAgent.configJson);
  const services = buyer.services.length ? buyer.services : stringArray(business.profile?.services);
  const faqs = buyer.faqs.length ? buyer.faqs : faqStrings(business.profile?.faqsJson);
  const { knowledge } = await loadBusinessAgentKnowledge({
    businessId: business.id,
    installedAgentId: installedAgent.id
  });
  const chatFacts = await loadBusinessFacts(business.id, {
    installedAgentId: installedAgent.id
  });
  // Same structured Business Hours block the live assistant gets — the text
  // demo and voice tests must answer hour questions identically to live calls.
  const chatHoursState = await loadBusinessHoursState(business.id, installedAgent.id);
  const chatBusinessHours = chatHoursState.configured
    ? buildHoursPromptLines(chatHoursState).join("\n  ")
    : buildHoursPromptLines(chatHoursState)[0];

  return {
    workflowId: installedAgent.workflowId,
    installedAgentId: installedAgent.id,
    workflowJson: installedAgent.workflow.workflowJson,
    afterHoursPolicy: resolveAfterHoursPolicy({
      configJson: installedAgent.configJson,
      workflowJson: installedAgent.workflow.workflowJson,
      businessType: firstString(buyer.businessType, business.type) ?? null
    }),
    context: {
      businessName: resolveBusinessName(buyer.businessName, business.name),
      businessType: firstString(buyer.businessType, business.type) ?? "business",
      assistantName: resolveAssistantName(buyer.assistantName),
      calendarId: cleanString(business.profile?.calendarId) || "primary",
      timeZone: cleanString(business.profile?.timeZone),
      appointmentService: readBookingLabel(installedAgent.configJson),
      services,
      faqs,
      knowledge,
      address: chatFacts?.addressFormatted ?? undefined,
      factsLines: chatFacts?.promptLines ?? [],
      businessHours: chatBusinessHours
    }
  };
}

/* ------------------------- Setup preview call ------------------------- */

const PREVIEW_MAX_DURATION_SECONDS = 300;

export const LIVE_MAX_CALL_DURATION_SECONDS = 43200;
const SETUP_PREVIEW_PURPOSE = "BUYER_SETUP_PREVIEW";

export class SetupPreviewCallError extends Error {
  constructor(
    message: string,
    public status: 404 | 422 | 503,
    public code: string
  ) {
    super(message);
    this.name = "SetupPreviewCallError";
  }
}

export type SetupPreviewCallSession = {
  publicKey: string;
  assistantId: string;
  assistantName: string;
  businessName: string;
  maxDurationSeconds: number;
  preview: true;
};

async function findLatestTestableInstalledAgent(
  businessId: string,
  listingId?: string | null
): Promise<{ id: string } | null> {
  if (listingId) {
    const scoped = await prisma.installedAgent.findFirst({
      where: { businessId, listingId },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    return scoped;
  }

  const active = await prisma.installedAgent.findFirst({
    where: { businessId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (active) return active;
  return prisma.installedAgent.findFirst({
    where: { businessId, status: "PROVISIONING" },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
}

export type LiveKnowledgeSyncResult = {
  attempted: boolean;
  ok: boolean;
  assistantId: string | null;
  error: string | null;
};

export async function refreshLiveAssistantKnowledge(businessId: string): Promise<LiveKnowledgeSyncResult> {
  try {
    if (!isVapiConfigured()) {
      return { attempted: false, ok: true, assistantId: null, error: null };
    }
    const profile = await prisma.businessProfile.findUnique({
      where: { businessId },
      select: { vapiAssistantId: true }
    });
    if (!profile?.vapiAssistantId) {
      return { attempted: false, ok: true, assistantId: null, error: null };
    }

    const result = await deployInstalledAgentVoiceAssistant(businessId);
    if (!result?.assistantId) {
      return {
        attempted: true,
        ok: false,
        assistantId: null,
        error: "The live assistant could not be updated. Retry the sync, or redeploy from the Go live step."
      };
    }
    console.log("[knowledge] live assistant prompt refreshed", { businessId, assistantId: result.assistantId });
    return { attempted: true, ok: true, assistantId: result.assistantId, error: null };
  } catch (error) {
    console.error("[knowledge] live assistant refresh failed", {
      businessId,
      error: error instanceof Error ? error.message : error
    });
    return {
      attempted: true,
      ok: false,
      assistantId: null,
      error: "The live assistant could not be updated. Retry the sync, or redeploy from the Go live step."
    };
  }
}

export async function startInstalledAgentPreviewCall(
  businessId: string,
  options?: {
    simulateBusinessHoursState?: "open" | "closed" | null;
    /** The agent the buyer is configuring — scopes the preview to it. */
    listingId?: string | null;
  }
): Promise<SetupPreviewCallSession> {
  if (!isVapiConfigured() || !env.VAPI_PUBLIC_KEY) {
    throw new SetupPreviewCallError("Voice preview is not configured on this server.", 503, "PREVIEW_NOT_CONFIGURED");
  }

  const previewAgent = await findLatestTestableInstalledAgent(businessId, options?.listingId);

  if (options?.listingId && !previewAgent) {
    throw new SetupPreviewCallError(
      "This agent is not installed for your business yet, so there is nothing to preview.",
      404,
      "PREVIEW_AGENT_NOT_FOUND"
    );
  }

  const simulateHours = resolveSimulatedHoursState("BUSINESS_TEST", options?.simulateBusinessHoursState);
  const previewSnapshot = await buildAfterHoursSnapshotForBusiness(businessId, {
    simulate: simulateHours,
    installedAgentId: previewAgent?.id ?? null
  });

  const plan = await buildInstalledAgentAssistantPlan(businessId, {
    ...(previewAgent ? { installedAgentId: previewAgent.id } : {}),
    extraSections: [PREVIEW_TOOL_NOTES],
    afterHoursRender: { kind: "literal", snapshot: previewSnapshot }
  });

  if (!plan) {
    throw new SetupPreviewCallError(
      "Save your setup first — the preview needs an installed agent with an AI Voice Conversation node.",
      422,
      "PREVIEW_NOT_AVAILABLE"
    );
  }

  const previewFirstMessage =
    plan.afterHoursPolicy?.enabled && previewSnapshot.state === "CLOSED"
      ? resolveAfterHoursGreeting({ policy: plan.afterHoursPolicy, businessName: plan.businessName })
      : plan.firstMessage;

  if (plan.afterHoursPolicy?.enabled) {
    logAfterHoursRouting({
      event: "preview_call_hours_decision",
      businessId,
      installedAgentId: plan.installedAgentId,
      timeZone: previewSnapshot.timeZone,
      hoursState: previewSnapshot.state,
      executionMode: "BUSINESS_TEST",
      ...(previewSnapshot.simulated ? { outcome: `simulated_${previewSnapshot.simulated}` } : {})
    });
  }

  const config = recordOf(plan.configJson);
  const priorPreview = cleanString(config.previewAssistantId);
  // Reuse the preview assistant across runs, but never overwrite the live one.
  const existingAssistantId =
    priorPreview && priorPreview !== plan.priorAssistantId
      ? priorPreview
      : undefined;

  const webhookUrl = `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/vapi/webhook`;

  const assistant = await deployVapiAssistant({
    name: `Setup Preview — ${plan.businessName}`,
    firstMessage: previewFirstMessage,
    systemPrompt: plan.systemPrompt,
    model: cleanString(plan.voiceNode.model) || "gpt-4o-mini",
    voice: plan.override.voice || "triven-default",
    voiceProvider: plan.override.provider,
    voiceId: plan.override.voiceId,
    language: cleanString(plan.voiceNode.language),
    speakingSpeed: cleanString(plan.voiceNode.speakingSpeed),
    serverUrl: webhookUrl,
    existingAssistantId,
    metadata: { purpose: SETUP_PREVIEW_PURPOSE, businessId: plan.businessId, installedAgentId: plan.installedAgentId },
    includeTools: {
      checkAvailability: plan.capabilities.canCheckAvailability,
      bookAppointment: plan.capabilities.canBook,
      sendNotification: plan.capabilities.canText || plan.capabilities.canEmail === true,
      recordSmsConsent: plan.capabilities.canText
      // [DISABLED] transferToHuman: Boolean(plan.teamPhone) && plan.transferEnabled
    },
    silenceTimeoutSeconds: 60,
    maxDurationSeconds: PREVIEW_MAX_DURATION_SECONDS,
    recordingEnabled: false
  });

  if (assistant.id !== priorPreview) {
    await prisma.installedAgent.update({
      where: { id: plan.installedAgentId },
      data: { configJson: { ...config, previewAssistantId: assistant.id } as Prisma.InputJsonValue }
    });
  }

  return {
    publicKey: env.VAPI_PUBLIC_KEY,
    assistantId: assistant.id,
    assistantName: plan.assistantName,
    businessName: plan.businessName,
    maxDurationSeconds: PREVIEW_MAX_DURATION_SECONDS,
    preview: true
  };
}
