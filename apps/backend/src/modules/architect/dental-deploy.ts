import { DENTAL_NODE_TYPES, DENTAL_SYSTEM_PROMPT_TEMPLATE } from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { deployVapiAssistant } from "./vapi-connector";

type NodeLike = { id?: string; data?: Record<string, unknown> };

export type DentalDeploymentResult = {
  businessId: string;
  workflowId: string;
  assignedNumber: string | null;
  assistantId: string;
  assistantCreated: boolean;
  webhookUrl: string;
  nodesDeployed: string[];
  missingNodes: string[];
};

function asNodes(workflowJson: unknown): NodeLike[] {
  const nodes = (workflowJson as { nodes?: unknown })?.nodes;
  return Array.isArray(nodes) ? (nodes as NodeLike[]) : [];
}

/** Find a node's config by its registry type slug (data.type, falling back to id). */
function nodeData(nodes: NodeLike[], type: string): Record<string, unknown> {
  const node = nodes.find((n) => (n.data?.type as string) === type || n.id === type);
  return (node?.data as Record<string, unknown>) ?? {};
}

function str(data: Record<string, unknown>, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : fallback;
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

function normalizePhone(value?: string | null): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

/** Substitute {{token}} placeholders from a value map, leaving unknown tokens intact. */
function fillTokens(template: string, map: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in map ? map[key] : match
  );
}

function servicesToArray(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function deployDentalWorkflow({
  architectUserId,
  workflowId
}: {
  architectUserId: string;
  workflowId: string;
}): Promise<DentalDeploymentResult> {
  const workflow = await prisma.workflowDefinition.findFirst({
    where: { id: workflowId, architectUserId }
  });
  if (!workflow) {
    throw new Error("Workflow not found for this account.");
  }

  const nodes = asNodes(workflow.workflowJson);
  const presentTypes = new Set(
    nodes.map((n) => (n.data?.type as string) ?? n.id ?? "").filter(Boolean)
  );
  const allTypes = Object.values(DENTAL_NODE_TYPES) as string[];
  const missingNodes = allTypes.filter((type) => !presentTypes.has(type));

  const ai = nodeData(nodes, DENTAL_NODE_TYPES.aiConversation);
  if (Object.keys(ai).length === 0) {
    throw new Error("Add and configure the AI Conversation node before deploying.");
  }

  const check = nodeData(nodes, DENTAL_NODE_TYPES.checkCalendar);
  const book = nodeData(nodes, DENTAL_NODE_TYPES.bookAppointment);
  const sms = nodeData(nodes, DENTAL_NODE_TYPES.sendSmsNotification);
  const end = nodeData(nodes, DENTAL_NODE_TYPES.endCall);

  // ---- Compose the assistant from the AI Conversation node ----
  const practiceName = str(ai, "practiceName", workflow.name || "the practice");
  const doctorName = str(ai, "doctorName", "the doctor");
  const practiceHours = str(ai, "practiceHours", "Mon-Fri 9am-5pm");
  const servicesText = str(ai, "services", "Cleaning, Filling, Crown, Emergency");
  const fallbackResponse = str(
    ai,
    "fallbackResponse",
    "Let me have the doctor's team call you back within 30 minutes."
  );
  const customInstructions = str(ai, "customInstructions", "");
  const assistantName = str(ai, "assistantName", "Sarah");
  const model = str(ai, "model", "gpt-4o");
  const voice = str(ai, "voice", "sarah");

  const promptTemplate = str(ai, "systemPrompt", DENTAL_SYSTEM_PROMPT_TEMPLATE);
  const tokens: Record<string, string> = {
    assistantName,
    practice_name: practiceName,
    doctor_name: doctorName,
    practice_hours: practiceHours,
    services_list: servicesText,
    fallback_response: fallbackResponse,
    special_instructions: customInstructions || "(none)"
  };
  const systemPrompt = fillTokens(promptTemplate, tokens);
  const firstMessage = fillTokens(
    str(ai, "firstMessage", `Thanks for calling ${practiceName}. This is ${assistantName}, how can I help you?`),
    tokens
  );

  // ---- Dental tool config persisted for the Vapi webhook ----
  const dentistPhone = normalizePhone(str(sms, "dentistPhone"));
  const dentalConfig = {
    bufferMinutes: num(check, "bufferMinutes", 10),
    slotsToOffer: num(check, "slotsToOffer", 3),
    maxAdvanceDays: num(check, "maxAdvanceDays", 30),
    openHour: num(check, "openHour", 9),
    closeHour: num(check, "closeHour", 17),
    defaultDurationMinutes: 30,
    doctorName,
    sendToPatient: bool(sms, "sendToPatient", true),
    sendToDentist: bool(sms, "sendToDentist", true),
    dentistPhone,
    patientTemplate: str(
      sms,
      "patientTemplate",
      "Confirmed: [Service] with [Doctor Name], [Date] at [Time]. Reply C to cancel."
    ),
    dentistTemplate: str(
      sms,
      "dentistTemplate",
      "New booking: [Patient Name], [Date] [Time], [Service]. Phone: [Patient Phone]"
    ),
    confirmationMessage: str(book, "confirmationMessage", ""),
    closingMessage: str(end, "closingMessage", "You're all set! Have a wonderful day."),
    afterCallAction: str(end, "afterCallAction", "hangup"),
    callRecording: bool(end, "callRecording", true)
  };

  // ---- Provision/link Business + Profile ----
  let business = await prisma.business.findFirst({
    where: { ownerId: architectUserId },
    orderBy: { createdAt: "desc" },
    include: {
      profile: true,
      phoneNumbers: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
      installedAgents: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!business) {
    const created = await prisma.business.create({
      data: { ownerId: architectUserId, name: practiceName, type: "Dental practice" }
    });
    business = await prisma.business.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        profile: true,
        phoneNumbers: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
        installedAgents: { orderBy: { createdAt: "desc" } }
      }
    });
  } else {
    await prisma.business.update({
      where: { id: business.id },
      data: { name: practiceName, type: "Dental practice" }
    });
  }

  const profileData = {
    services: servicesToArray(servicesText),
    hoursJson: { text: practiceHours } as never,
    calendarId: "primary",
    timeZone: env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
    tone: "friendly",
    teamPhone: dentistPhone || null,
    escalationRules: customInstructions || null
  };
  await prisma.businessProfile.upsert({
    where: { businessId: business.id },
    update: profileData,
    create: { businessId: business.id, ...profileData }
  });

  // ---- Deploy the Vapi assistant (create or update) ----
  // Only update a prior *per-business* assistant. If the profile still holds the
  // shared env default (from a generic install), create a fresh one instead of
  // PATCHing the shared template.
  const priorAssistantId = business.profile?.vapiAssistantId;
  const existingAssistantId =
    priorAssistantId && priorAssistantId !== env.VAPI_DEFAULT_ASSISTANT_ID
      ? priorAssistantId
      : undefined;

  const webhookUrl = `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/vapi/webhook`;
  const assistant = await deployVapiAssistant({
    name: `Triven Dental — ${practiceName}`,
    firstMessage,
    systemPrompt,
    model,
    voice,
    serverUrl: webhookUrl,
    existingAssistantId
  });

  await prisma.businessProfile.update({
    where: { businessId: business.id },
    data: { vapiAssistantId: assistant.id }
  });

  // ---- Create/update the InstalledAgent (links workflow + tool config) ----
  const configJson = {
    connectors: ["TWILIO", "VAPI", "GOOGLE_CALENDAR"],
    vapiAssistantId: assistant.id,
    calendarId: "primary",
    dentalConfig
  };
  const existingAgent = business.installedAgents[0] ?? null;
  const installedAgent = existingAgent
    ? await prisma.installedAgent.update({
        where: { id: existingAgent.id },
        data: {
          workflowId: workflow.id,
          name: `Dental AI Receptionist — ${practiceName}`,
          status: "ACTIVE",
          configJson: configJson as never
        }
      })
    : await prisma.installedAgent.create({
        data: {
          businessId: business.id,
          workflowId: workflow.id,
          name: `Dental AI Receptionist — ${practiceName}`,
          status: "ACTIVE",
          configJson: configJson as never
        }
      });

  // ---- Assign / bind a Twilio number ----
  const existingPhone = business.phoneNumbers[0] ?? null;
  let assignedNumber: string | null = existingPhone?.phoneNumber ?? null;

  if (existingPhone) {
    await prisma.businessPhoneNumber.update({
      where: { id: existingPhone.id },
      data: { installedAgentId: installedAgent.id, isActive: true, forwardToPhone: dentistPhone || existingPhone.forwardToPhone }
    });
  } else {
    const claimed = await prisma.platformPhoneNumber.findFirst({
      where: { status: "AVAILABLE", provider: "TWILIO" },
      orderBy: { createdAt: "asc" }
    });
    if (!claimed) {
      throw new Error(
        "No CoreAI phone numbers are available to assign. Seed PlatformPhoneNumber rows (npm run seed:numbers) and re-deploy."
      );
    }
    const phone = await prisma.businessPhoneNumber.create({
      data: {
        businessId: business.id,
        installedAgentId: installedAgent.id,
        phoneNumber: normalizePhone(claimed.phoneNumber),
        twilioPhoneNumberSid: claimed.twilioSid ?? null,
        forwardToPhone: dentistPhone || null,
        isActive: true
      }
    });
    await prisma.platformPhoneNumber.update({
      where: { id: claimed.id },
      data: { status: "ASSIGNED", businessId: business.id, assignedAt: new Date() }
    });
    assignedNumber = phone.phoneNumber;
  }

  return {
    businessId: business.id,
    workflowId: workflow.id,
    assignedNumber,
    assistantId: assistant.id,
    assistantCreated: assistant.created,
    webhookUrl,
    nodesDeployed: allTypes.filter((type) => presentTypes.has(type)),
    missingNodes
  };
}
