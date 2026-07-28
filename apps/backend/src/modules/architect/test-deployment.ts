import {
  DEFAULT_CALENDAR_BOOKING_RULES,
  RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE,
  VOICE_NODE_TYPES,
  buildSilencePolicy,
  normalizeTimeZone
} from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { getGmailConnectionStatus } from "./gmail-connector";
import { deployVapiAssistant, isRealId, isVapiConfigured } from "./vapi-connector";
import { resolveNodeTemplateVariables, sanitizeLegacyFallbacks } from "../agent-runtime/prompt-builder";
import { isKnownVoicePresetId } from "./voice-presets";

export const ARCHITECT_TEST_PURPOSE = "ARCHITECT_TEST";

const SANDBOX_STOPPED_STATUS = "STOPPED";

export type ArchitectTestDeploymentInput = {
  businessName?: string;
  businessType?: string;
  calendarId?: string;
  timeZone?: string;
  services?: string[];
  faqs?: string[];
  knowledge?: string[];
};

export type ArchitectTestDeploymentStatus = {
  workflowId: string;
  businessId: string | null;
  installedAgentId: string | null;
  assignedPhoneNumber: string | null;
  vapiAssistantId: string | null;
  calendarConnected: boolean;
  calendarEmail: string | null;
  webhookUrl: string;
  status: "NOT_STARTED" | "READY" | "ERROR";
};

/** Error with an HTTP status + stable code so the route can answer precisely. */
export class TestDeploymentError extends Error {
  status: 400 | 404 | 409 | 422 | 503;
  code: string;

  constructor(message: string, status: 400 | 404 | 409 | 422 | 503 = 400, code = "TEST_DEPLOYMENT_FAILED") {
    super(message);
    this.name = "TestDeploymentError";
    this.status = status;
    this.code = code;
  }
}

type NodeLike = { id?: string; data?: Record<string, unknown> };

function asNodes(workflowJson: unknown): NodeLike[] {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? (nodes as NodeLike[]) : [];
}

function nodeData(nodes: NodeLike[], type: string): Record<string, unknown> {
  const node = nodes.find((n) => (n.data?.type as string) === type || n.id === type);
  return (node?.data as Record<string, unknown>) ?? {};
}

function str(data: Record<string, unknown>, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function bool(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return fallback;
}

function num(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(data[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function fillTokens(template: string, map: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => (key in map ? map[key] : match));
}

function normalizePhone(value?: string | null): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function servicesToArray(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function webhookUrl(): string {
  return `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/twilio/voice`;
}

function configRecord(configJson: unknown): Record<string, unknown> {
  return typeof configJson === "object" && configJson !== null ? (configJson as Record<string, unknown>) : {};
}

function configString(configJson: unknown, key: string): string | null {
  const value = configRecord(configJson)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/** A number is voice-capable unless its capabilities explicitly say voice: false. */
function isVoiceCapable(capabilities: unknown): boolean {
  if (typeof capabilities !== "object" || capabilities === null) return true;
  return (capabilities as Record<string, unknown>).voice !== false;
}

/** The architect's sandbox InstalledAgent for this workflow (any status). */
export async function findSandboxAgent(architectUserId: string, workflowId: string) {
  return prisma.installedAgent.findFirst({
    where: {
      workflowId,
      business: { ownerId: architectUserId },
      configJson: { path: ["purpose"], equals: ARCHITECT_TEST_PURPOSE }
    },
    orderBy: { createdAt: "desc" },
    include: {
      business: { include: { profile: true } },
      phoneNumbers: { where: { isActive: true }, orderBy: { createdAt: "desc" } }
    }
  });
}

/** The architect's sandbox Business (from any prior test deployment), if one exists. */
export async function findSandboxBusiness(architectUserId: string) {
  const agent = await prisma.installedAgent.findFirst({
    where: {
      business: { ownerId: architectUserId },
      configJson: { path: ["purpose"], equals: ARCHITECT_TEST_PURPOSE }
    },
    orderBy: { createdAt: "desc" },
    select: { businessId: true }
  });
  if (!agent) return null;
  return prisma.business.findUnique({
    where: { id: agent.businessId },
    include: { profile: true }
  });
}

export async function getArchitectTestDeploymentStatus(
  architectUserId: string,
  workflowId: string
): Promise<ArchitectTestDeploymentStatus> {
  const google = await getGmailConnectionStatus(architectUserId);
  const agent = await findSandboxAgent(architectUserId, workflowId);

  if (!agent || agent.status !== "ACTIVE") {
    return {
      workflowId,
      businessId: agent?.businessId ?? null,
      installedAgentId: null,
      assignedPhoneNumber: null,
      vapiAssistantId: null,
      calendarConnected: google.calendarConnected,
      calendarEmail: google.email,
      webhookUrl: webhookUrl(),
      status: "NOT_STARTED"
    };
  }

  const assignedPhoneNumber = agent.phoneNumbers[0]?.phoneNumber ?? null;
  const vapiAssistantId = configString(agent.configJson, "vapiAssistantId");

  return {
    workflowId,
    businessId: agent.businessId,
    installedAgentId: agent.id,
    assignedPhoneNumber,
    vapiAssistantId,
    calendarConnected: google.calendarConnected,
    calendarEmail: google.email,
    webhookUrl: webhookUrl(),
    status: assignedPhoneNumber && isRealId(vapiAssistantId) ? "READY" : "ERROR"
  };
}

/**
 * Reserve an AVAILABLE, voice-capable platform number for the sandbox business.
 * Claims atomically (status guard in the UPDATE) so an ASSIGNED number can never
 * be hijacked, even under concurrent starts.
 */
async function claimAvailablePlatformNumber(businessId: string) {
  const candidates = await prisma.platformPhoneNumber.findMany({
    where: { status: "AVAILABLE", provider: "TWILIO" },
    orderBy: { createdAt: "asc" },
    take: 20
  });

  for (const candidate of candidates) {
    if (!isVoiceCapable(candidate.capabilities)) continue;
    const claimed = await prisma.platformPhoneNumber.updateMany({
      where: { id: candidate.id, status: "AVAILABLE" },
      data: { status: "ASSIGNED", businessId, assignedAt: new Date() }
    });
    if (claimed.count > 0) return candidate;
  }

  return null;
}

export async function startArchitectTestDeployment(
  architectUserId: string,
  workflowId: string,
  input: ArchitectTestDeploymentInput = {}
): Promise<ArchitectTestDeploymentStatus> {
  const workflow = await prisma.workflowDefinition.findFirst({
    where: { id: workflowId, architectUserId }
  });
  if (!workflow) {
    throw new TestDeploymentError("Workflow not found for this account.", 404, "WORKFLOW_NOT_FOUND");
  }

  const nodes = asNodes(workflow.workflowJson);
  const ai = nodeData(nodes, VOICE_NODE_TYPES.voiceConversation);
  if (Object.keys(ai).length === 0) {
    throw new TestDeploymentError(
      "Add the AI Voice Conversation node before starting a live sandbox test.",
      422,
      "VOICE_NODE_REQUIRED"
    );
  }

  if (!isVapiConfigured()) {
    throw new TestDeploymentError(
      "Vapi is not configured on the server. Add VAPI_API_KEY before live sandbox testing.",
      503,
      "VAPI_NOT_CONFIGURED"
    );
  }

  // The voice-booking flow books into the ARCHITECT's calendar during a sandbox
  // test — require the Google connection up front so live mode fails clearly
  // instead of silently returning demo slots.
  const presentTypes = new Set(nodes.map((n) => (n.data?.type as string) ?? "").filter(Boolean));
  const hasCalendarNodes =
    presentTypes.has(VOICE_NODE_TYPES.calendarAvailability) || presentTypes.has(VOICE_NODE_TYPES.bookAppointment);
  const google = await getGmailConnectionStatus(architectUserId);
  if (hasCalendarNodes && !google.connected) {
    throw new TestDeploymentError(
      "Connect your Google account in the Test tab before starting a live sandbox test.",
      422,
      "GOOGLE_NOT_CONNECTED"
    );
  }
  if (hasCalendarNodes && !google.calendarConnected) {
    throw new TestDeploymentError(
      "Reconnect Google to grant Calendar permission.",
      422,
      "CALENDAR_SCOPE_MISSING"
    );
  }

  // ---- Test business context (generic defaults; the node/test input can override) ----
  const businessName = (input.businessName ?? "").trim() || str(ai, "practiceName", "the business");
  const businessType = (input.businessType ?? "").trim() || "Service Business";
  const calendarId = (input.calendarId ?? "").trim() || "primary";
  const timeZone = normalizeTimeZone((input.timeZone ?? "").trim() || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE);
  const servicesText = str(ai, "services", "Consultation, Appointment booking, General inquiry");
  const services = input.services?.length ? input.services : servicesToArray(servicesText);

  // ---- Sandbox Business (create once per architect, reuse afterwards) ----
  let business = await findSandboxBusiness(architectUserId);
  if (business) {
    await prisma.business.update({
      where: { id: business.id },
      data: { name: businessName, type: businessType }
    });
  } else {
    const created = await prisma.business.create({
      data: { ownerId: architectUserId, name: businessName, type: businessType }
    });
    business = await prisma.business.findUniqueOrThrow({
      where: { id: created.id },
      include: { profile: true }
    });
  }

  const contactName = str(ai, "doctorName", businessName);
  const customInstructions = str(ai, "customInstructions", "");
  const businessHours = str(ai, "practiceHours", "Mon-Fri 9am-5pm");

  const profileData = {
    services,
    hoursJson: { text: businessHours } as never,
    faqsJson: (input.faqs ?? []) as never,
    calendarId,
    timeZone,
    tone: "friendly",
    escalationRules: customInstructions || null
  };
  await prisma.businessProfile.upsert({
    where: { businessId: business.id },
    update: profileData,
    create: { businessId: business.id, ...profileData }
  });

  // ---- Compose + deploy the per-workflow Vapi assistant ----
  const assistantName = str(ai, "assistantName", "AI receptionist");
  const tokens: Record<string, string> = {
    assistantName,
    business_name: businessName,
    contact_name: contactName,
    business_type: businessType,
    business_hours: businessHours,
    services_list: services.join(", "),
    fallback_response: str(ai, "fallbackResponse", "Let me take a message and have the team call you back shortly."),
    calendar_booking_rules: DEFAULT_CALENDAR_BOOKING_RULES,
    custom_instructions: customInstructions || "(none)",
    silence_policy: buildSilencePolicy()
  };
  const systemPrompt = resolveNodeTemplateVariables(
    fillTokens(str(ai, "systemPrompt", RECEPTIONIST_SYSTEM_PROMPT_TEMPLATE), tokens),
    workflow.workflowJson,
    { assistantName, businessName }
  );

  const rawGreeting = str(ai, "firstMessage");
  const firstMessage = rawGreeting
    ? sanitizeLegacyFallbacks(
        resolveNodeTemplateVariables(
          fillTokens(rawGreeting, tokens),
          workflow.workflowJson,
          { assistantName, businessName }
        ),
        { assistantName, businessName }
      )
    : `Hello! This is ${assistantName} from ${businessName}. How can I help you today?`;

  // Only PATCH a prior sandbox assistant for this workflow — never the shared env default.
  const existingAgent = await findSandboxAgent(architectUserId, workflowId);
  const priorAssistantId = configString(existingAgent?.configJson, "vapiAssistantId");
  const existingAssistantId =
    priorAssistantId && isRealId(priorAssistantId)
      ? priorAssistantId
      : undefined;

  const recordingEnabled = bool(nodeData(nodes, VOICE_NODE_TYPES.endFlow), "callRecording", true);

  const selectedVoice = str(ai, "voice", "");
  const selectedVoiceProvider = str(ai, "voiceProvider", "");
  const selectedVoiceId = str(ai, "voiceId", "");

  let assistant: { id: string; created: boolean };
  try {
    assistant = await deployVapiAssistant({
      name: `Sandbox Test — ${workflow.name || businessName}`,
      firstMessage,
      systemPrompt,
      model: str(ai, "model", "gpt-4o-mini"),
      voice: selectedVoice,
      voiceProvider: selectedVoiceProvider,
      voiceId: selectedVoiceId,
      language: str(ai, "language", ""),
      speakingSpeed: str(ai, "speakingSpeed", ""),
      serverUrl: `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/vapi/webhook`,
      existingAssistantId
    });
  } catch (error) {
    const isThirdPartyVoice =
      Boolean(selectedVoiceId) ||
      selectedVoice === "custom" ||
      isKnownVoicePresetId(selectedVoice || "");
    if (isThirdPartyVoice) {
      console.warn("[test-deployment] Third-party voice deployment failed. Falling back to the built-in Vapi voice.", error);
      assistant = await deployVapiAssistant({
    recordingEnabled,
        name: `Sandbox Test — ${workflow.name || businessName}`,
        firstMessage,
        systemPrompt,
        model: str(ai, "model", "gpt-4o-mini"),
        voice: "Savannah",
        voiceProvider: "vapi",
        voiceId: "",
        language: str(ai, "language", ""),
        speakingSpeed: str(ai, "speakingSpeed", ""),
        serverUrl: `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/vapi/webhook`,
        existingAssistantId
      });
    } else {
      throw error;
    }
  }

  // The webhook answers with the assistant stored on BusinessProfile.
  await prisma.businessProfile.update({
    where: { businessId: business.id },
    data: { vapiAssistantId: assistant.id }
  });

  // ---- Booking tool config from the generic nodes (used by Vapi tools).
  // Generic node keys (sendToCustomer/customerTemplate/teamTemplate/teamPhone)
  // are read first; the legacy dental key names remain as fallbacks. ----
  const check = nodeData(nodes, VOICE_NODE_TYPES.calendarAvailability);
  const book = nodeData(nodes, VOICE_NODE_TYPES.bookAppointment);
  const sms = nodeData(nodes, VOICE_NODE_TYPES.sendSms);
  const end = nodeData(nodes, VOICE_NODE_TYPES.endFlow);
  const dentalConfig = {
    bufferMinutes: num(check, "bufferMinutes", 10),
    slotsToOffer: num(check, "slotsToOffer", 3),
    maxAdvanceDays: num(check, "maxAdvanceDays", 30),
    openHour: num(check, "openHour", 9),
    closeHour: num(check, "closeHour", 17),
    defaultDurationMinutes: 30,
    doctorName: contactName,
    sendToPatient: bool(sms, "sendToCustomer", bool(sms, "sendToPatient", true)),
    sendToDentist: bool(sms, "sendToTeam", bool(sms, "sendToDentist", false)),
    dentistPhone: normalizePhone(str(sms, "teamPhone") || str(sms, "dentistPhone")),
    patientTemplate:
      str(sms, "customerTemplate") ||
      str(sms, "patientTemplate", "Confirmed: [Service] on [Date] at [Time] with [Business Name]."),
    dentistTemplate:
      str(sms, "teamTemplate") ||
      str(sms, "dentistTemplate", "New booking: [Customer Name], [Date] [Time], [Service]."),
    confirmationMessage: str(book, "confirmationMessage", ""),
    closingMessage: str(end, "closingMessage", "You're all set! Have a wonderful day."),
    afterCallAction: str(end, "afterCallAction", "hangup"),
    callRecording: bool(end, "callRecording", true)
  };

  // ---- Sandbox InstalledAgent for THIS workflow ----
  const configJson = {
    purpose: ARCHITECT_TEST_PURPOSE,
    testMode: true,
    executionMode: "ARCHITECT_DRY_RUN",
    architectUserId,
    workflowId,
    connectors: ["TWILIO", "VAPI", "GOOGLE_CALENDAR"],
    vapiAssistantId: assistant.id,
    calendar: { ownerUserId: architectUserId, calendarId, timeZone },
    phoneRouting: { mode: "AI_FIRST" },
    dentalConfig
  };

  const installedAgent = existingAgent
    ? await prisma.installedAgent.update({
        where: { id: existingAgent.id },
        data: { name: `Sandbox Test — ${workflow.name}`, status: "ACTIVE", configJson: configJson as never }
      })
    : await prisma.installedAgent.create({
        data: {
          businessId: business.id,
          workflowId,
          name: `Sandbox Test — ${workflow.name}`,
          status: "ACTIVE",
          configJson: configJson as never
        }
      });

  // One live sandbox at a time per architect: park other test agents so the
  // Vapi tool-config lookup (latest ACTIVE agent) always hits this workflow.
  await prisma.installedAgent.updateMany({
    where: {
      businessId: business.id,
      id: { not: installedAgent.id },
      configJson: { path: ["purpose"], equals: ARCHITECT_TEST_PURPOSE }
    },
    data: { status: SANDBOX_STOPPED_STATUS }
  });

  // ---- Phone number: reuse the sandbox's active number or claim an AVAILABLE one ----
  let assignedPhoneNumber: string | null = null;
  const existingPhone = await prisma.businessPhoneNumber.findFirst({
    where: { businessId: business.id, isActive: true },
    orderBy: { createdAt: "desc" }
  });

  if (existingPhone) {
    // Only reuse the mapping while the pool number still belongs to this sandbox
    // (or can be re-claimed while AVAILABLE). Never pull it back from another
    // business — that would hijack an ASSIGNED number.
    const platform = await prisma.platformPhoneNumber.findUnique({
      where: { phoneNumber: existingPhone.phoneNumber }
    });
    let stillOurs = !platform || (platform.status === "ASSIGNED" && platform.businessId === business.id);
    if (!stillOurs && platform && platform.status === "AVAILABLE") {
      const reclaim = await prisma.platformPhoneNumber.updateMany({
        where: { id: platform.id, status: "AVAILABLE" },
        data: { status: "ASSIGNED", businessId: business.id, assignedAt: new Date() }
      });
      stillOurs = reclaim.count > 0;
    }

    if (stillOurs) {
      await prisma.businessPhoneNumber.update({
        where: { id: existingPhone.id },
        data: {
          installedAgentId: installedAgent.id,
          forwardToPhone: null,
          configJson: { purpose: ARCHITECT_TEST_PURPOSE, architectUserId, workflowId } as never
        }
      });
      assignedPhoneNumber = existingPhone.phoneNumber;
    } else {
      await prisma.businessPhoneNumber.update({
        where: { id: existingPhone.id },
        data: { isActive: false }
      });
    }
  }

  if (!assignedPhoneNumber) {
    const claimed = await claimAvailablePlatformNumber(business.id);
    if (!claimed) {
      throw new TestDeploymentError(
        "No available platform test number. Ask admin to seed a Twilio number.",
        503,
        "NO_TEST_NUMBER_AVAILABLE"
      );
    }

    const phone = await prisma.businessPhoneNumber.upsert({
      where: { phoneNumber: normalizePhone(claimed.phoneNumber) },
      update: {
        businessId: business.id,
        installedAgentId: installedAgent.id,
        twilioPhoneNumberSid: claimed.twilioSid ?? null,
        forwardToPhone: null,
        isActive: true,
        configJson: { purpose: ARCHITECT_TEST_PURPOSE, architectUserId, workflowId } as never
      },
      create: {
        businessId: business.id,
        installedAgentId: installedAgent.id,
        phoneNumber: normalizePhone(claimed.phoneNumber),
        twilioPhoneNumberSid: claimed.twilioSid ?? null,
        forwardToPhone: null,
        isActive: true,
        configJson: { purpose: ARCHITECT_TEST_PURPOSE, architectUserId, workflowId } as never
      }
    });
    assignedPhoneNumber = phone.phoneNumber;
  }

  return {
    workflowId,
    businessId: business.id,
    installedAgentId: installedAgent.id,
    assignedPhoneNumber,
    vapiAssistantId: assistant.id,
    calendarConnected: google.calendarConnected,
    calendarEmail: google.email,
    webhookUrl: webhookUrl(),
    status: "READY"
  };
}

/**
 * Stop the architect's sandbox for this workflow and release its test number.
 * Audit-safe: rows are deactivated/released, never deleted. Only numbers that
 * belong to THIS architect's sandbox business are ever released — buyer installs
 * and buyer numbers are untouched.
 */
export async function stopArchitectTestDeployment(
  architectUserId: string,
  workflowId: string
): Promise<ArchitectTestDeploymentStatus> {
  const agent = await findSandboxAgent(architectUserId, workflowId);
  if (!agent) {
    return getArchitectTestDeploymentStatus(architectUserId, workflowId);
  }

  const phones = await prisma.businessPhoneNumber.findMany({
    where: { businessId: agent.businessId, isActive: true }
  });
  const sandboxPhones = phones.filter(
    (phone) =>
      phone.installedAgentId === agent.id ||
      configString(phone.configJson, "purpose") === ARCHITECT_TEST_PURPOSE
  );

  if (sandboxPhones.length > 0) {
    await prisma.businessPhoneNumber.updateMany({
      where: { id: { in: sandboxPhones.map((phone) => phone.id) } },
      data: { isActive: false }
    });
    // Release the platform numbers back to the pool — only those assigned to
    // this sandbox business (never a number assigned to any other business).
    await prisma.platformPhoneNumber.updateMany({
      where: {
        phoneNumber: { in: sandboxPhones.map((phone) => phone.phoneNumber) },
        businessId: agent.businessId
      },
      data: { status: "AVAILABLE", businessId: null, assignedAt: null }
    });
  }

  await prisma.installedAgent.update({
    where: { id: agent.id },
    data: { status: SANDBOX_STOPPED_STATUS }
  });

  return getArchitectTestDeploymentStatus(architectUserId, workflowId);
}
