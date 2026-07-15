import {
  DEFAULT_CALENDAR_BOOKING_RULES,
  RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE,
  VOICE_NODE_TYPES,
  buildSilencePolicy,
  formatBuyerAnswerValue
} from "@coreai/shared";
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
import { workflowCapabilities } from "../agent-runtime/graph-runner";
import { deployVapiAssistant, isVapiConfigured } from "../architect/vapi-connector";

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

/** End Flow node's "Call recording" toggle — recording stays on unless explicitly disabled. */
function endFlowRecordingEnabled(workflowJson: unknown): boolean {
  const node = nodesOf(workflowJson).find((n) => (n.data?.type as string) === VOICE_NODE_TYPES.endFlow);
  const value = (node?.data as Record<string, unknown> | undefined)?.callRecording;

  return !(value === false || String(value ?? "").trim().toLowerCase() === "false");
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

/**
 * Only unmistakable template demo content is stale. Buyer values are never
 * rejected for containing common names (a buyer's "Sarah" or "Bright Dental
 * Care" is real configuration, not a leftover demo).
 */
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

/**
 * Architect-defined setup fields the buyer filled in during install
 * (configJson.customFields — label/value pairs from the listing's
 * requiredBuyerSetup schema).
 */
function readCustomFields(configJson: unknown): Array<{ label: string; value: string }> {
  const raw = recordOf(configJson).customFields;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const record = recordOf(item);
      return {
        label: cleanString(record.label) ?? cleanString(record.key) ?? "",
        // Answers may be text, string arrays (multiselect), booleans, or
        // numbers — rendered human-readable ("a, b", "Yes"/"No") for the prompt.
        value: formatBuyerAnswerValue(record.value)
      };
    })
    .filter((field) => field.label && field.value);
}

/**
 * What a booking is called for this business — from scheduling config, or an
 * architect-defined "Booking label" buyer setup field.
 */
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

export async function deployInstalledAgentVoiceAssistant(
  businessId: string
): Promise<{ assistantId: string; created: boolean } | null> {
  if (!isVapiConfigured()) return null;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      profile: true,
      knowledgeBases: true,
      installedAgents: {
        where: { status: "ACTIVE" },
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

  const knowledge =
    Array.isArray(business.knowledgeBases) && business.knowledgeBases.length
      ? business.knowledgeBases
          .map((item) => {
            const title = cleanString(item.title);
            const content = cleanString(item.content);
            if (!content) return "";
            return title ? `${title}: ${content}` : content;
          })
          .filter(Boolean)
      : [];

  const customInstructions = (
    buyer.customInstructions ||
    cleanString(business.profile?.escalationRules) ||
    ""
  ).trim();

  const businessHours = formatHours(business.profile?.hoursJson, "not provided");
  const silencePolicy = buildSilencePolicy(buyer.silence);
  const capabilities = workflowCapabilities(installedAgent.workflow.workflowJson);

  // Architect template instructions run before buyer custom instructions in
  // the prompt, so buyer-specific config always has the last word.
  const nodeInstructions = architectNodeInstructions(voiceNode);
  const customFields = readCustomFields(installedAgent.configJson);
  const bookingLabel = readBookingLabel(installedAgent.configJson);

  // Architect-written {{variables}} (any spelling — {{business.name}},
  // {{Business Name}}, {{business_name}}…): fill what is known at deploy
  // time, rewrite live runtime variables to Vapi's exact names, and strip the
  // rest so unknown Liquid can never blank text or break a live call.
  const deployTokenValues: Record<string, string> = {
    assistantName,
    businessName,
    businessType,
    contactName,
    services: services.join(", "),
    servicesList: services.join(", "),
    businessHours,
    bookingLabel: bookingLabel ?? "appointment",
    calendarId: cleanString(business.profile?.calendarId) || "primary",
    teamPhone: cleanString(business.profile?.teamPhone) ?? "",
    bookingUrl: cleanString(business.profile?.bookingUrl) ?? ""
  };
  const fillDeployTemplate = (text: string): string =>
    fillPromptTemplateTokens(text, deployTokenValues, {
      runtimeVariables: LIVE_VAPI_RUNTIME_VARIABLES,
      stripUnresolved: true
    });

  const systemPrompt = buildAgentSystemPrompt({
    assistantName,
    businessName,
    businessType,
    contactName,
    services,
    faqs: faqs.length ? faqs : [],
    knowledge,
    address: cleanString(business.profile?.serviceArea),
    businessHours,
    // Vapi substitutes these {{...}} variables with live values at call time.
    timezoneText: "{{timeZone}}",
    currentDateTimeText: "{{currentDateTime}}",
    currentDateText: "{{currentDate}}",
    tomorrowDateText: "{{tomorrowDate}}",
    customInstructions,
    silencePolicy,
    calendarRules: DEFAULT_CALENDAR_BOOKING_RULES,
    capabilities: {
      canCheckAvailability: capabilities.canCheckAvailability,
      canBook: capabilities.canBook,
      canText: capabilities.canText,
      canEmail: capabilities.canEmail
    },
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
    extraSections: [LIVE_TOOL_NOTES]
  });

  const firstMessage = buildAgentFirstMessage({
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

  console.log("[deploy] resolved agent identity", {
    businessId,
    assistantName,
    businessName,
    firstMessage,
    capabilities
  });

  const override = readVoiceOverride(installedAgent.configJson);
  const webhookUrl = `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/vapi/webhook`;

  const prior = business.profile?.vapiAssistantId;
  const existingAssistantId = prior && prior !== env.VAPI_DEFAULT_ASSISTANT_ID ? prior : undefined;

  const assistant = await deployVapiAssistant({
    name: `${businessName} - ${assistantName}`,
    firstMessage,
    systemPrompt,
    model: "gpt-4o-mini",
    voice: override.voice || "triven-default",
    voiceProvider: override.provider,
    voiceId: override.voiceId,
    language: cleanString(voiceNode.language),
    speakingSpeed: cleanString(voiceNode.speakingSpeed),
    serverUrl: webhookUrl,
    existingAssistantId,
    recordingEnabled: endFlowRecordingEnabled(installedAgent.workflow.workflowJson)
  });

  if (business.profile) {
    await prisma.businessProfile.update({
      where: { businessId: business.id },
      data: { vapiAssistantId: assistant.id }
    });
  } else {
    await prisma.businessProfile.create({
      data: { businessId: business.id, vapiAssistantId: assistant.id }
    });
  }

  return { assistantId: assistant.id, created: assistant.created };
}