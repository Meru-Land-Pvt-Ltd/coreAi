import { VOICE_NODE_TYPES, extractPromptVariables, normalizeTimeZone } from "@coreai/shared";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { workflowCapabilities } from "../agent-runtime/graph-runner";
import {
  buildAgentFirstMessage,
  buildAgentSystemPrompt,
  fillPromptTemplateTokens,
  resolveAssistantName,
  resolveNodeTemplateVariables
} from "../agent-runtime/prompt-builder";
import {
  ARCHITECT_TEST_PURPOSE,
  TestDeploymentError,
  findSandboxAgent,
  findSandboxBusiness
} from "./test-deployment";
import { deployVapiAssistant, isRealId, isVapiConfigured } from "./vapi-connector";

export type VapiBrowserTestInput = {
  businessName?: string;
  businessType?: string;
  assistantName?: string;
  callerName?: string;
  callerPhone?: string;
  calendarId?: string;
  timeZone?: string;
  appointmentService?: string;
  services?: string[];
  faqs?: string[];
};

export type VapiBrowserTestSession = {
  publicKey: string;
  assistantId: string;
  businessId: string;
  assistantName: string;
  businessName: string;
  model: string;
  voiceName: string;
  voiceId: string | null;
  transcriber: string;
  dryRun: true;
  /** {{variables}} nothing could fill — stripped before the prompt reached Vapi. */
  unresolvedVariables: string[];
};

type NodeLike = { id?: string; data?: Record<string, unknown> };

function asNodes(workflowJson: unknown): NodeLike[] {
  const nodes = (workflowJson as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? (nodes as NodeLike[]) : [];
}

function nodeData(nodes: NodeLike[], type: string): Record<string, unknown> {
  const node = nodes.find((n) => (n.data?.type as string) === type);
  return (node?.data as Record<string, unknown>) ?? {};
}

function str(data: Record<string, unknown>, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(data: Record<string, unknown>, key: string, fallback: number): number {
  const parsed = Number(data[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function looksLikeElevenLabsVoiceId(value: string): boolean {
  return value.length >= 18 && !/\s/.test(value);
}

function dateInZone(date: Date, timeZone: string): string {
  try {
    return date.toLocaleDateString("en-CA", { timeZone });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function fillNodeTokens(text: string, tokens: Record<string, string>): string {
  return fillPromptTemplateTokens(text, tokens);
}

function stripLeftoverTokens(text: string): string {
  return fillPromptTemplateTokens(text, {}, { stripUnresolved: true });
}

export async function startArchitectVapiBrowserTest(
  architectUserId: string,
  workflowId: string,
  input: VapiBrowserTestInput = {}
): Promise<VapiBrowserTestSession> {
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
      "Add the AI Voice Conversation node before starting a browser call test.",
      422,
      "VOICE_NODE_REQUIRED"
    );
  }

  if (!isVapiConfigured()) {
    throw new TestDeploymentError(
      "Vapi is not configured on the server (VAPI_API_KEY missing).",
      503,
      "VAPI_NOT_CONFIGURED"
    );
  }

  if (!env.VAPI_PUBLIC_KEY) {
    throw new TestDeploymentError(
      "Vapi public key missing (VAPI_PUBLIC_KEY). Browser call falls back to local simulation.",
      503,
      "VAPI_PUBLIC_KEY_MISSING"
    );
  }

  // Vapi's cloud must be able to reach our webhook for tool calls — a
  // localhost BACKEND_URL silently breaks mid-call when the agent uses a tool.
  const webhookBase = env.BACKEND_URL.replace(/\/$/, "");
  const isPublicHttps =
    /^https:\/\//i.test(webhookBase) && !/localhost|127\.0\.0\.1|0\.0\.0\.0|\.local(:|\/|$)/i.test(webhookBase);

  if (!isPublicHttps) {
    throw new TestDeploymentError(
      "Vapi tools need a public HTTPS BACKEND_URL such as ngrok.",
      422,
      "BACKEND_URL_NOT_PUBLIC"
    );
  }

  // Never start with the wrong voice: an explicitly selected custom voice ID
  // must look valid, otherwise fail with an architect-facing error.
  const selectedVoice = str(ai, "voice");
  const selectedVoiceId = str(ai, "voiceId");
  const selectedVoiceName = str(ai, "voiceName", selectedVoice || "Default voice");

  if (selectedVoice === "custom" && !looksLikeElevenLabsVoiceId(selectedVoiceId)) {
    throw new TestDeploymentError(
      "The custom ElevenLabs voice ID on the AI Voice Conversation node looks invalid. Choose a valid voice before testing.",
      422,
      "INVALID_VOICE_ID"
    );
  }

  // ---- Test identity: AI node assistantName first, then test context ----
  const nodeAssistantName = str(ai, "assistantName");
  const contextAssistantName = input.assistantName?.trim() ?? "";
  const assistantName = resolveAssistantName(nodeAssistantName, contextAssistantName);

  const usable = (value: string) => Boolean(value.trim()) && !value.includes("{{");
  const identitySource = usable(nodeAssistantName)
    ? "ai-node"
    : usable(contextAssistantName)
      ? "test-context"
      : "fallback";

  const businessName = input.businessName?.trim() || "Sample Business";
  const businessType = input.businessType?.trim() || "service business";
  const calendarId = input.calendarId?.trim() || "primary";
  const timeZone = normalizeTimeZone(input.timeZone?.trim() || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE);
  const callerName = input.callerName?.trim() || "the caller";
  const callerPhone = input.callerPhone?.trim() || "";
  const appointmentService = input.appointmentService?.trim() || "General Consultation";
  const services =
    input.services?.length ? input.services : ["Consultation", "Appointment booking", "General inquiry"];
  const faqs = input.faqs?.length ? input.faqs : [];

  // ---- Sandbox business (shared with the live sandbox; reused per architect) ----
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

  const profileData = {
    services,
    faqsJson: faqs as never,
    calendarId,
    timeZone,
    tone: "friendly"
  };

  await prisma.businessProfile.upsert({
    where: { businessId: business.id },
    update: profileData,
    create: { businessId: business.id, ...profileData }
  });

  // ---- Prompt from the shared builder + the node's own instructions ----
  const capabilities = workflowCapabilities(workflow.workflowJson);
  const now = new Date();

const currentDate = dateInZone(now, timeZone);
  const tokens: Record<string, string> = {
    assistantName,
    businessName,
    businessType,
    contactName: businessName,
    businessHours: "not provided",
    services: services.join(", "),
    servicesList: services.join(", "),
    faqs: faqs.join("\n"),
    customerName: callerName,
    callerName,
    customerPhone: callerPhone,
    callerPhone,
    appointmentService,
    service: appointmentService,
    bookingLabel: "appointment",
    calendarId,
    fallbackResponse: "Let me take a message and have the team call you back shortly.",
    calendarBookingRules: "",
    customInstructions: str(ai, "customInstructions", "(none)"),
    silencePolicy: "",
    currentDateTime: now.toLocaleString("en-US", { timeZone }),
    currentDate,
    todayDate: currentDate,
    tomorrowDate: dateInZone(new Date(now.getTime() + 24 * 60 * 60 * 1000), timeZone),
    timeZone
  };

  const nodeInstructionsRaw = [str(ai, "systemPrompt"), str(ai, "customInstructions")]
    .filter(Boolean)
    .map((text) => fillNodeTokens(text, tokens))
    .join("\n\n");
  const nodeInstructionsResolved = resolveNodeTemplateVariables(nodeInstructionsRaw, workflow.workflowJson, {
    assistantName,
    businessName
  });
  const nodeInstructions = stripLeftoverTokens(nodeInstructionsResolved);

  const systemPrompt = buildAgentSystemPrompt({
    assistantName,
    businessName,
    businessType,
    services,
    faqs,
    timezoneText: timeZone,
    currentDateTimeText: tokens.currentDateTime ?? "",
    currentDateText: tokens.currentDate ?? "",
    tomorrowDateText: tokens.tomorrowDate ?? "",
    capabilities: {
      canCheckAvailability: capabilities.canCheckAvailability,
      canBook: capabilities.canBook,
      canText: capabilities.canText
    },
    nodeInstructions,
    extraSections: [
      `
Live call handling:
- If the caller wants to book, ask for their preferred date and time first.
- Call check_availability only after a date is known.
- Call book_appointment only after name, date, and time are confirmed.
`.trim()
    ]
  });

  // The architect's own First message is kept whenever it renders to anything
  // non-empty; the generic greeting is only the fallback for a blank result.
  const customFirstMessageRaw = fillNodeTokens(str(ai, "firstMessage"), tokens);
  const customFirstMessageResolved = resolveNodeTemplateVariables(customFirstMessageRaw, workflow.workflowJson, {
    assistantName,
    businessName
  });
  const customFirstMessage = stripLeftoverTokens(customFirstMessageResolved);

  const firstMessage = buildAgentFirstMessage({
    assistantName,
    businessName,
    customFirstMessage
  });

  // Whatever is still {{unresolved}} at this point was stripped — surface it
  // to the Test panel so a typo'd variable never disappears silently.
  const unresolvedVariables = Array.from(
    new Set([
      ...extractPromptVariables(nodeInstructionsResolved),
      ...extractPromptVariables(customFirstMessageResolved)
    ])
  );
  if (unresolvedVariables.length) {
    console.warn("[vapi-browser-test] unresolved prompt variables stripped", { workflowId, unresolvedVariables });
  }

  // ---- Create/update the per-workflow browser-test assistant (no phone) ----
  console.log("[vapi-browser-test] resolved identity", {
    assistantName,
    businessName,
    source: identitySource
  });

  const existingAgent = await findSandboxAgent(architectUserId, workflowId);
  const priorAssistantId =
    existingAgent && typeof (existingAgent.configJson as Record<string, unknown> | null)?.vapiAssistantId === "string"
      ? String((existingAgent.configJson as Record<string, unknown>).vapiAssistantId)
      : "";
  const existingAssistantId =
    priorAssistantId && isRealId(priorAssistantId) && priorAssistantId !== env.VAPI_DEFAULT_ASSISTANT_ID
      ? priorAssistantId
      : undefined;

  const assistant = await deployVapiAssistant({
    name: `Browser Test — ${workflow.name || businessName}`,
    firstMessage,
    systemPrompt,
    model: str(ai, "model", "gpt-4o-mini"),
    voice: selectedVoice,
    voiceProvider: str(ai, "voiceProvider"),
    voiceId: selectedVoiceId,
    language: str(ai, "language"),
    speakingSpeed: str(ai, "speakingSpeed"),
    serverUrl: `${webhookBase}/architect/connectors/vapi/webhook`,
    existingAssistantId,
    metadata: {
      businessId: business.id,
      workflowId,
      architectUserId,
      purpose: ARCHITECT_TEST_PURPOSE,
      browserTest: true
    },
    // Testers pause to read logs/think — don't hang up on them mid-test.
    silenceTimeoutSeconds: 90,
    // Only expose tools the connected graph actually has.
    includeTools: {
      checkAvailability: capabilities.canCheckAvailability,
      bookAppointment: capabilities.canBook,
      sendNotification: capabilities.canText
    }
  });

  await prisma.businessProfile.update({
    where: { businessId: business.id },
    data: { vapiAssistantId: assistant.id }
  });

  // ---- Sandbox agent config: dry-run tools + scheduling from node config ----
  const check = nodeData(nodes, VOICE_NODE_TYPES.calendarAvailability);
  const book = nodeData(nodes, VOICE_NODE_TYPES.bookAppointment);
  const sms = nodeData(nodes, VOICE_NODE_TYPES.sendSms);
  const end = nodeData(nodes, VOICE_NODE_TYPES.endFlow);

  const configJson = {
    purpose: ARCHITECT_TEST_PURPOSE,
    testMode: true,
    browserTest: true,
    // Booking + SMS are dry-runs in the browser test; availability reads stay real.
    testDryRun: true,
    architectUserId,
    workflowId,
    connectors: ["VAPI", "GOOGLE_CALENDAR"],
    vapiAssistantId: assistant.id,
    assistantName,
    calendar: { ownerUserId: architectUserId, calendarId, timeZone },
    scheduling: {
      bufferMinutes: num(check, "bufferMinutes", 10),
      maximumSlotsToShow: num(check, "maximumSlotsToShow", num(check, "slotsToOffer", 6)),
      openHour: num(check, "openHour", 9),
      closeHour: num(check, "closeHour", 17),
      serviceDurationMinutes: num(check, "serviceDurationMinutes", 30)
    },
    dentalConfig: {
      doctorName: businessName,
      sendToPatient: true,
      sendToDentist: false,
      patientTemplate: str(sms, "customerTemplate", str(sms, "patientTemplate", "Confirmed: [Service] on [Date] at [Time].")),
      confirmationMessage: str(book, "confirmationMessage", ""),
      closingMessage: str(end, "closingMessage", "You're all set. Have a great day.")
    }
  };

  const installedAgent = existingAgent
    ? await prisma.installedAgent.update({
        where: { id: existingAgent.id },
        data: { name: `Browser Test — ${workflow.name}`, status: "ACTIVE", configJson: configJson as never }
      })
    : await prisma.installedAgent.create({
        data: {
          businessId: business.id,
          workflowId,
          name: `Browser Test — ${workflow.name}`,
          status: "ACTIVE",
          configJson: configJson as never
        }
      });

  // One active test agent per architect so tool-config lookups hit this workflow.
  await prisma.installedAgent.updateMany({
    where: {
      businessId: business.id,
      id: { not: installedAgent.id },
      configJson: { path: ["purpose"], equals: ARCHITECT_TEST_PURPOSE }
    },
    data: { status: "STOPPED" }
  });

  console.log("[vapi-browser-test] session ready", {
    workflowId,
    assistantId: assistant.id,
    assistantName,
    businessName,
    model: str(ai, "model", "gpt-4o-mini"),
    voiceName: selectedVoiceName,
    capabilities,
    dryRun: true
  });

  return {
    publicKey: env.VAPI_PUBLIC_KEY,
    assistantId: assistant.id,
    businessId: business.id,
    assistantName,
    businessName,
    model: str(ai, "model", "gpt-4o-mini"),
    voiceName: selectedVoiceName,
    voiceId: selectedVoiceId || null,
    transcriber: `${env.VAPI_TRANSCRIBER_PROVIDER}/${env.VAPI_TRANSCRIBER_MODEL}`,
    dryRun: true,
    unresolvedVariables
  };
}
