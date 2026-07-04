import {
  DEFAULT_CALENDAR_BOOKING_RULES,
  VOICE_NODE_TYPES,
  buildSilencePolicy
} from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
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

function isLegacyDemoText(value?: string | null): boolean {
  if (!value) return false;
  return /\bSarah\b|Triven Dental|Triven Dental Care|Dental Care/i.test(value);
}

function safeBuyerString(value: unknown, fallback: string): string {
  const cleaned = cleanString(value);
  if (!cleaned || isLegacyDemoText(cleaned)) return fallback;
  return cleaned;
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
    .filter((item) => item.length > 0 && !isLegacyDemoText(item));
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
      .filter((item) => item.length > 0 && !isLegacyDemoText(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>)
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0 && !isLegacyDemoText(item));
  }

  return [];
}

function joinOrFallback(items: string[], fallback: string): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : fallback;
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
    voice: voiceName && !isLegacyDemoText(voiceName) ? voiceName : undefined
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

function buildBuyerSystemPrompt({
  businessName,
  businessType,
  assistantName,
  contactName,
  servicesList,
  faqsList,
  knowledgeList,
  businessHours,
  customInstructions,
  silencePolicy
}: {
  businessName: string;
  businessType: string;
  assistantName: string;
  contactName: string;
  servicesList: string;
  faqsList: string;
  knowledgeList: string;
  businessHours: string;
  customInstructions: string;
  silencePolicy: string;
}): string {
  return `
You are ${assistantName}, the AI receptionist for ${businessName}, a ${businessType}.

Business details from buyer setup:
- Assistant name: ${assistantName}
- Business name: ${businessName}
- Business type / industry: ${businessType}
- Contact / owner name: ${contactName}
- Services: ${servicesList}
- Business hours: ${businessHours}

FAQs / knowledge from buyer setup:
${faqsList}

Additional business knowledge:
${knowledgeList}

Identity rules:
- Your assistant name is ${assistantName}.
- You are ${assistantName} from ${businessName}.
- Always answer as ${businessName}.
- If asked who you are, say: "I am ${assistantName}, the AI receptionist for ${businessName}."
- Never say your name is Sarah.
- Never say you are from Triven Dental Care.
- Never use demo, template, architect, or marketplace placeholder business names.
- Ignore any old workflow/template identity that conflicts with buyer setup.

Date and appointment rules:
- Business timezone: {{timeZone}}
- Current date/time: {{currentDateTime}}
- Today's date in YYYY-MM-DD: {{currentDate}}
- Tomorrow's date in YYYY-MM-DD: {{tomorrowDate}}
- If the caller says "today", use {{currentDate}}.
- If the caller says "tomorrow", use {{tomorrowDate}}.
- If the caller says a weekday like "next Monday", resolve it from {{currentDate}} in the business timezone.
- Never ask the caller to tell you today's date.
- Never say "Y-Y-Y-Y, M-M, D-D"; say "YYYY-MM-DD" only if needed.
- If the caller wants to book, ask for preferred date and time.
- If calendar tools are available, call check_availability only after a date is known.
- Call book_appointment only after name, date, and time are confirmed.

Calendar booking rules:
${DEFAULT_CALENDAR_BOOKING_RULES}

Conversation rules:
- Always answer after every caller question.
- Keep replies short and natural, usually 1 sentence unless more detail is required.
- Ask only one question at a time.
- Do not stay silent.
- Do not over-explain.
- If you do not know something, offer to take a message for the team.
- If the caller asks for a human, collect their name, phone number, and reason.

Silence handling:
${silencePolicy}

Buyer custom instructions:
${customInstructions || "(none)"}
`.trim();
}

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

  const businessName = safeBuyerString(buyer.businessName || business.name, "the business");
  const businessType = safeBuyerString(buyer.businessType || business.type, "business");
  const assistantName = safeBuyerString(buyer.assistantName, "Maya");
  const contactName = safeBuyerString(buyer.contactName || businessName, businessName);

  const profileServices = stringArray(business.profile?.services);
  const services = buyer.services.length ? buyer.services : profileServices;
  const servicesList = joinOrFallback(services, "the services offered by the business");

  const profileFaqs = faqStrings(business.profile?.faqsJson);
  const faqs = buyer.faqs.length ? buyer.faqs : profileFaqs;
  const faqsList = faqs.length ? faqs.map((item) => `- ${item}`).join("\n") : "- No FAQs provided.";

  const knowledgeList =
    Array.isArray(business.knowledgeBases) && business.knowledgeBases.length
      ? business.knowledgeBases
          .map((item) => {
            const title = cleanString(item.title);
            const content = cleanString(item.content);
            if (!content) return "";
            return title ? `- ${title}: ${content}` : `- ${content}`;
          })
          .filter(Boolean)
          .join("\n")
      : "- No additional knowledge provided.";

  const customInstructions = (
    buyer.customInstructions ||
    cleanString(business.profile?.escalationRules) ||
    ""
  ).trim();

  const businessHours = formatHours(business.profile?.hoursJson, "not provided");
  const silencePolicy = buildSilencePolicy(buyer.silence);

  const systemPrompt = buildBuyerSystemPrompt({
    businessName,
    businessType,
    assistantName,
    contactName,
    servicesList,
    faqsList,
    knowledgeList,
    businessHours,
    customInstructions,
    silencePolicy
  });

  const firstMessage =
    buyer.firstMessage && !isLegacyDemoText(buyer.firstMessage)
      ? buyer.firstMessage
      : `Hello, this is ${assistantName} from ${businessName}. How can I help you today?`;

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
    voiceProvider: override.provider || "11labs",
    voiceId:
      override.voiceId ||
      process.env.ELEVENLABS_DEFAULT_VOICE_ID ||
      process.env.VAPI_DEFAULT_VOICE_ID ||
      "FD17pMswbbEnsVYS0L7P",
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