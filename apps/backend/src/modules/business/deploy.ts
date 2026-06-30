import { RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE, VOICE_NODE_TYPES } from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { deployVapiAssistant, isVapiConfigured } from "../architect/vapi-connector";

/**
 * Buyer-side live deployment of the installed agent's voice assistant.
 *
 * The Vapi assistant is built per-BUSINESS (InstalledAgent), NOT for the
 * architect draft: it reads the installed WorkflowDefinition's AI Voice
 * Conversation node, merges the buyer's voice selection (configJson.voice), and
 * creates/updates the assistant for this business only. Generic — not
 * dental-specific. Calendar/Gmail tools resolve the BUSINESS OWNER's connected
 * credentials at call time (handled by the runtime), so this never touches
 * architect credentials.
 */

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

/**
 * Build/update this business's Vapi assistant from its installed voice workflow.
 * Returns null (so the caller can fall back to assigning the shared default
 * assistant) when Vapi isn't configured or the agent has no voice node.
 */
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

  const tokens: Record<string, string> = {
    assistantName,
    practice_name: businessName,
    doctor_name: str(ai, "doctorName", businessName),
    practice_hours: str(ai, "practiceHours", ""),
    services_list: str(ai, "services", (business.profile?.services ?? []).join(", ")),
    fallback_response: str(
      ai,
      "fallbackResponse",
      "Let me take a message and have the team call you back shortly."
    ),
    special_instructions: str(ai, "customInstructions", business.profile?.escalationRules ?? "") || "(none)"
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
