import {
  DEFAULT_CALENDAR_BOOKING_RULES,
  VOICE_NODE_TYPES,
  buildSilencePolicy
} from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import {
  buildAgentFirstMessage,
  buildAgentSystemPrompt,
  resolveAssistantName,
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

/**
 * Workflow is used only to check if this installed agent has a voice node.
 * Buyer setup is the source of truth for live business identity.
 */
function voiceNodeData(workflowJson: unknown): Record<string, unknown> | null {
  const node = nodesOf(workflowJson).find(
    (n) => (n.data?.type as string) === VOICE_NODE_TYPES.voiceConversation
  );
  return node?.data ? (node.data as Record<string, unknown>) : null;
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
      canText: capabilities.canText
    },
    extraSections: [LIVE_TOOL_NOTES]
  });

  const firstMessage = buildAgentFirstMessage({
    assistantName,
    businessName,
    customFirstMessage: buyer.firstMessage
      ? sanitizeLegacyFallbacks(buyer.firstMessage, { assistantName, businessName })
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
    // Provider/voice fallbacks are handled by the force-safe resolver in the
    // Vapi connector — never hardcode a provider or mix voice ID types here.
    voice: override.voice || "triven-default",
    voiceProvider: override.provider,
    voiceId: override.voiceId,
    serverUrl: webhookUrl,
    existingAssistantId
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