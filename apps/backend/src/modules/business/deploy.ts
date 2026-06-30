import {
  DEFAULT_CALENDAR_BOOKING_RULES,
  RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE,
  VOICE_NODE_TYPES,
  buildSilencePolicy
} from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { deployVapiAssistant, isVapiConfigured } from "../architect/vapi-connector";

type NodeLike = { id?: string; data?: Record<string, unknown> };

function nodesOf(workflowJson: unknown): NodeLike[] {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? (nodes as NodeLike[]) : [];
}

/** The AI Voice Conversation node's config, or null when the agent has no voice node. */
function voiceNodeData(workflowJson: unknown): Record<string, unknown> | null {
  const node = nodesOf(workflowJson).find(
    (n) => (n.data?.type as string) === VOICE_NODE_TYPES.voiceConversation
  );
  return node?.data ? (node.data as Record<string, unknown>) : null;
}

function str(data: Record<string, unknown>, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

/** Substitute {{token}} placeholders, leaving unknown tokens (e.g. {{currentDateTime}}) for Vapi runtime. */
function fillTokens(template: string, map: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in map ? map[key] : match
  );
}

type VoiceOverride = { provider?: string; voiceId?: string; voice?: string };

/** The buyer's voice choice persisted on InstalledAgent.configJson.voice (if any). */
function readVoiceOverride(configJson: unknown): VoiceOverride {
  const voice = (configJson as Record<string, unknown> | null)?.voice;
  if (typeof voice !== "object" || voice === null) return {};
  const record = voice as Record<string, unknown>;
  return {
    provider: typeof record.provider === "string" ? record.provider : undefined,
    voiceId: typeof record.voiceId === "string" ? record.voiceId : undefined,
    voice: typeof record.name === "string" ? record.name : undefined
  };
}

type BuyerConfig = {
  contactName?: string;
  customInstructions?: string;
  silence?: { repromptCount?: number; reprompt1?: string; reprompt2?: string; goodbye?: string };
};

/** The buyer's contact / custom-instructions / silence config from InstalledAgent.configJson. */
function readBuyerConfig(configJson: unknown): BuyerConfig {
  const c = (configJson as Record<string, unknown> | null) ?? {};
  const silenceRaw = typeof c.silence === "object" && c.silence !== null ? (c.silence as Record<string, unknown>) : {};
  return {
    contactName: typeof c.contactName === "string" ? c.contactName : undefined,
    customInstructions: typeof c.customInstructions === "string" ? c.customInstructions : undefined,
    silence: {
      repromptCount: typeof silenceRaw.repromptCount === "number" ? silenceRaw.repromptCount : undefined,
      reprompt1: typeof silenceRaw.reprompt1 === "string" ? silenceRaw.reprompt1 : undefined,
      reprompt2: typeof silenceRaw.reprompt2 === "string" ? silenceRaw.reprompt2 : undefined,
      goodbye: typeof silenceRaw.goodbye === "string" ? silenceRaw.goodbye : undefined
    }
  };
}

/** Compact human-readable business hours from the buyer setup hours array. */
function formatHours(hoursJson: unknown, fallback: string): string {
  if (!Array.isArray(hoursJson) || hoursJson.length === 0) return fallback;
  const parts = hoursJson
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const record = item as Record<string, unknown>;
      const day = typeof record.day === "string" ? record.day.slice(0, 3) : "";
      if (!day) return "";
      if (record.closed === true) return `${day} closed`;
      const open = typeof record.open === "string" ? record.open : "";
      const close = typeof record.close === "string" ? record.close : "";
      return open && close ? `${day} ${open}-${close}` : "";
    })
    .filter(Boolean);
  return parts.length ? parts.join(", ") : fallback;
}

export async function deployInstalledAgentVoiceAssistant(
  businessId: string
): Promise<{ assistantId: string; created: boolean } | null> {
  if (!isVapiConfigured()) return null;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      profile: true,
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

  const ai = voiceNodeData(installedAgent.workflow.workflowJson);
  if (!ai) return null; // SMS-only agent — no voice assistant to build.

  const businessName = business.name || "the business";
  const assistantName = str(ai, "assistantName", "Sarah");
  const model = str(ai, "model", "gpt-4o");

  const buyer = readBuyerConfig(installedAgent.configJson);
  const contactName = buyer.contactName || str(ai, "doctorName", businessName) || businessName;
  const customInstructions = (
    buyer.customInstructions || str(ai, "customInstructions", business.profile?.escalationRules ?? "")
  ).trim();
  const businessHours = formatHours(business.profile?.hoursJson, str(ai, "practiceHours", ""));

  const tokens: Record<string, string> = {
    assistantName,
    business_name: businessName,
    contact_name: contactName,
    business_type: business.type || "business",
    business_hours: businessHours,
    services_list: str(ai, "services", (business.profile?.services ?? []).join(", ")),
    fallback_response: str(
      ai,
      "fallbackResponse",
      "Let me take a message and have the team call you back shortly."
    ),
    calendar_booking_rules: DEFAULT_CALENDAR_BOOKING_RULES,
    custom_instructions: customInstructions || "(none)",
    silence_policy: buildSilencePolicy(buyer.silence)
  };

  const promptTemplate = str(ai, "systemPrompt", RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE);
  const systemPrompt = fillTokens(promptTemplate, tokens);
  const firstMessage = fillTokens(
    str(ai, "firstMessage", `Thanks for calling ${businessName}. This is ${assistantName}, how can I help you?`),
    tokens
  );

  const override = readVoiceOverride(installedAgent.configJson);
  const webhookUrl = `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/vapi/webhook`;

  // Only update a prior per-business assistant; never PATCH the shared default.
  const prior = business.profile?.vapiAssistantId;
  const existingAssistantId = prior && prior !== env.VAPI_DEFAULT_ASSISTANT_ID ? prior : undefined;

  const assistant = await deployVapiAssistant({
    name: `CoreAI Receptionist — ${businessName}`,
    firstMessage,
    systemPrompt,
    model,
    voice: override.voice ?? str(ai, "voice", "sarah"),
    voiceProvider: override.provider ?? str(ai, "voiceProvider", ""),
    voiceId: override.voiceId ?? str(ai, "voiceId", ""),
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
