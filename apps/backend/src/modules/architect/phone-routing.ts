import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

/**
 * Generic per-business phone routing. NOT dental-specific — the same routing
 * works for any vertical (HVAC, legal, medical, salon, …).
 *
 * Model: reuses existing tables.
 *  - BusinessPhoneNumber.phoneNumber = the assigned CoreAI/Twilio forwarding number
 *    (the unique key the Twilio voice webhook routes by — never the caller number).
 *  - InstalledAgent.configJson.phoneRouting = { publicBusinessNumber, aiForwardingNumber,
 *    mode, isActive, setupStatus, updatedAt } — no schema migration required.
 */

export const ROUTING_MODES = ["AI_FIRST", "NO_ANSWER", "BUSY", "AFTER_HOURS", "UNREACHABLE"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

export function isRoutingMode(value: unknown): value is RoutingMode {
  return typeof value === "string" && (ROUTING_MODES as readonly string[]).includes(value);
}

type PhoneRoutingConfig = {
  publicBusinessNumber: string;
  aiForwardingNumber: string;
  mode: RoutingMode;
  isActive: boolean;
  setupStatus: string;
  updatedAt: string;
};

function normalizePhone(value?: string | null): string {
  return (value ?? "").replace(/[^+\d]/g, "").trim();
}

function readRouting(configJson: unknown): Partial<PhoneRoutingConfig> {
  const routing = (configJson as Record<string, unknown> | null)?.phoneRouting;
  return typeof routing === "object" && routing !== null ? (routing as Partial<PhoneRoutingConfig>) : {};
}

export type ForwardingInstructions = { headline: string; steps: string[]; note: string };

/** Mode-specific, carrier-agnostic forwarding instructions (no hardcoded USSD codes). */
export function forwardingInstructions(
  mode: RoutingMode,
  publicNumber: string | null,
  aiNumber: string | null
): ForwardingInstructions {
  const target = aiNumber || "your assigned CoreAI number";
  const from = publicNumber || "your existing business number";
  const note =
    "Carrier forwarding support depends on your phone provider (Airtel/Jio/Vi and others use different settings). For production, use a local telephony provider or number porting where available.";

  switch (mode) {
    case "AI_FIRST":
      return {
        headline: `Publish ${target} as your business number, or forward all calls from ${from} to it.`,
        steps: [`Share ${target} with customers directly, or enable "Forward all calls" on ${from} → ${target}.`],
        note
      };
    case "NO_ANSWER":
      return {
        headline: `Forward unanswered calls from ${from} to ${target}.`,
        steps: [`On ${from}, enable "Forward when unanswered / no answer" → ${target}.`],
        note
      };
    case "BUSY":
      return {
        headline: `Forward busy calls from ${from} to ${target}.`,
        steps: [`On ${from}, enable "Forward when busy" → ${target}.`],
        note
      };
    case "AFTER_HOURS":
      return {
        headline: `Forward after-hours calls from ${from} to ${target}.`,
        steps: [`On ${from}, schedule call forwarding to ${target} outside business hours (or use "forward when unanswered").`],
        note
      };
    case "UNREACHABLE":
      return {
        headline: `Forward calls to ${target} when ${from} is switched off / unreachable.`,
        steps: [`On ${from}, enable "Forward when unreachable" → ${target}.`],
        note
      };
    default:
      return { headline: "", steps: [], note };
  }
}

const businessInclude = {
  profile: true,
  phoneNumbers: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
  installedAgents: { orderBy: { createdAt: "desc" } }
} as const;

function findArchitectBusiness(architectUserId: string) {
  return prisma.business.findFirst({
    where: { ownerId: architectUserId },
    orderBy: { createdAt: "desc" },
    include: businessInclude
  });
}

/** Assign or reuse a unique CoreAI number for this business (no duplicate mappings). */
async function ensureForwardingNumber(
  business: NonNullable<Awaited<ReturnType<typeof findArchitectBusiness>>>,
  installedAgentId: string
): Promise<string> {
  const existing = business.phoneNumbers[0];
  if (existing) {
    await prisma.businessPhoneNumber.update({
      where: { id: existing.id },
      data: { installedAgentId, isActive: true }
    });
    return existing.phoneNumber;
  }

  const preferred = normalizePhone(env.TWILIO_PHONE_NUMBER);
  let claimed = preferred
    ? await prisma.platformPhoneNumber.findFirst({ where: { phoneNumber: preferred, status: "AVAILABLE", provider: "TWILIO" } })
    : null;
  if (!claimed) {
    claimed = await prisma.platformPhoneNumber.findFirst({
      where: { status: "AVAILABLE", provider: "TWILIO" },
      orderBy: { createdAt: "asc" }
    });
  }

  if (claimed) {
    const phone = await prisma.businessPhoneNumber.create({
      data: {
        businessId: business.id,
        installedAgentId,
        phoneNumber: normalizePhone(claimed.phoneNumber),
        twilioPhoneNumberSid: claimed.twilioSid ?? null,
        isActive: true
      }
    });
    await prisma.platformPhoneNumber.update({
      where: { id: claimed.id },
      data: { status: "ASSIGNED", businessId: business.id, assignedAt: new Date() }
    });
    return phone.phoneNumber;
  }

  if (preferred) {
    // No pool seeded — bind the configured Twilio number directly (upsert avoids duplicates).
    const phone = await prisma.businessPhoneNumber.upsert({
      where: { phoneNumber: preferred },
      update: { businessId: business.id, installedAgentId, isActive: true },
      create: { businessId: business.id, installedAgentId, phoneNumber: preferred, isActive: true }
    });
    return phone.phoneNumber;
  }

  throw new Error("No CoreAI phone number available. Seed PlatformPhoneNumber rows or set TWILIO_PHONE_NUMBER.");
}

export async function getPhoneRoutingStatus(architectUserId: string) {
  const business = await findArchitectBusiness(architectUserId);
  if (!business) {
    return {
      configured: false,
      businessId: null,
      publicBusinessNumber: null,
      assignedCoreAiNumber: null,
      mode: "NO_ANSWER" as RoutingMode,
      isActive: false,
      setupStatus: "NO_BUSINESS",
      forwardingInstructions: forwardingInstructions("NO_ANSWER", null, null),
      vapiAssistantId: null,
      vapiPhoneNumberId: null,
      workflowId: null,
      installedAgentId: null
    };
  }

  const installedAgent = business.installedAgents[0] ?? null;
  const phone = business.phoneNumbers[0] ?? null;
  const routing = readRouting(installedAgent?.configJson);
  const assignedCoreAiNumber = phone?.phoneNumber ?? routing.aiForwardingNumber ?? null;
  const mode = isRoutingMode(routing.mode) ? routing.mode : "NO_ANSWER";

  return {
    configured: Boolean(assignedCoreAiNumber),
    businessId: business.id,
    businessName: business.name,
    businessType: business.type,
    publicBusinessNumber: routing.publicBusinessNumber ?? null,
    assignedCoreAiNumber,
    mode,
    isActive: routing.isActive ?? Boolean(phone?.isActive),
    setupStatus: routing.setupStatus ?? (assignedCoreAiNumber ? "NUMBER_ASSIGNED" : "PENDING"),
    forwardingInstructions: forwardingInstructions(mode, routing.publicBusinessNumber ?? null, assignedCoreAiNumber),
    vapiAssistantId: business.profile?.vapiAssistantId ?? null,
    vapiPhoneNumberId: business.profile?.vapiPhoneNumberId ?? null,
    workflowId: installedAgent?.workflowId ?? null,
    installedAgentId: installedAgent?.id ?? null
  };
}

export async function setupPhoneRouting(
  architectUserId: string,
  input: { publicBusinessNumber?: unknown; mode?: unknown; workflowId?: unknown; installedAgentId?: unknown }
) {
  const business = await findArchitectBusiness(architectUserId);
  if (!business) throw new Error("Deploy an agent before configuring phone routing.");

  const installedAgent =
    (typeof input.installedAgentId === "string"
      ? business.installedAgents.find((agent) => agent.id === input.installedAgentId)
      : null) ??
    business.installedAgents[0] ??
    null;
  if (!installedAgent) throw new Error("Deploy an agent first — no installed agent found for this business.");

  const mode = isRoutingMode(input.mode) ? input.mode : "NO_ANSWER";
  const publicBusinessNumber = normalizePhone(typeof input.publicBusinessNumber === "string" ? input.publicBusinessNumber : "");
  const aiForwardingNumber = await ensureForwardingNumber(business, installedAgent.id);

  const routing: PhoneRoutingConfig = {
    publicBusinessNumber,
    aiForwardingNumber,
    mode,
    isActive: true,
    setupStatus: mode === "AI_FIRST" ? "ACTIVE" : "FORWARDING_PENDING",
    updatedAt: new Date().toISOString()
  };

  const existingConfig = (installedAgent.configJson as Record<string, unknown> | null) ?? {};
  await prisma.installedAgent.update({
    where: { id: installedAgent.id },
    data: {
      ...(typeof input.workflowId === "string" && input.workflowId ? { workflowId: input.workflowId } : {}),
      configJson: { ...existingConfig, phoneRouting: routing } as never
    }
  });

  return {
    businessId: business.id,
    installedAgentId: installedAgent.id,
    workflowId: (typeof input.workflowId === "string" && input.workflowId) || installedAgent.workflowId,
    publicBusinessNumber,
    assignedCoreAiNumber: aiForwardingNumber,
    mode,
    isActive: true,
    setupStatus: routing.setupStatus,
    forwardingInstructions: forwardingInstructions(mode, publicBusinessNumber, aiForwardingNumber),
    vapiAssistantId: business.profile?.vapiAssistantId ?? null
  };
}

export async function setPhoneRoutingMode(architectUserId: string, mode: unknown) {
  if (!isRoutingMode(mode)) throw new Error("Invalid mode. Use AI_FIRST, NO_ANSWER, BUSY, AFTER_HOURS, or UNREACHABLE.");
  const business = await findArchitectBusiness(architectUserId);
  const installedAgent = business?.installedAgents[0] ?? null;
  if (!business || !installedAgent) throw new Error("Deploy an agent first.");

  const existingConfig = (installedAgent.configJson as Record<string, unknown> | null) ?? {};
  const routing = readRouting(installedAgent.configJson);
  const assigned = business.phoneNumbers[0]?.phoneNumber ?? routing.aiForwardingNumber ?? "";

  const updated: PhoneRoutingConfig = {
    publicBusinessNumber: routing.publicBusinessNumber ?? "",
    aiForwardingNumber: assigned,
    mode,
    isActive: routing.isActive ?? true,
    setupStatus: mode === "AI_FIRST" ? "ACTIVE" : "FORWARDING_PENDING",
    updatedAt: new Date().toISOString()
  };

  await prisma.installedAgent.update({
    where: { id: installedAgent.id },
    data: { configJson: { ...existingConfig, phoneRouting: updated } as never }
  });

  return {
    businessId: business.id,
    mode,
    assignedCoreAiNumber: assigned,
    setupStatus: updated.setupStatus,
    forwardingInstructions: forwardingInstructions(mode, updated.publicBusinessNumber, assigned)
  };
}

/** Simulate the Twilio routing lookup (no real call). Resolves by the called number. */
export async function testPhoneRouting(input: { called?: unknown; from?: unknown }) {
  const called = normalizePhone(typeof input.called === "string" ? input.called : "");
  const callerNumber = normalizePhone(typeof input.from === "string" ? input.from : "");

  if (!called) {
    return { resolved: false, matchedNumber: null, callerNumber, message: "Provide a 'called' number (the assigned CoreAI number)." };
  }

  const phone = await prisma.businessPhoneNumber.findUnique({
    where: { phoneNumber: called },
    include: { business: { include: { profile: true } }, installedAgent: { include: { workflow: true } } }
  });

  if (!phone?.installedAgent) {
    return {
      resolved: false,
      matchedNumber: null,
      callerNumber,
      message: `No business is mapped to ${called}. Assign/deploy a CoreAI number first.`
    };
  }

  const routing = readRouting(phone.installedAgent.configJson);
  return {
    resolved: true,
    matchedNumber: called,
    callerNumber,
    businessId: phone.businessId,
    businessName: phone.business.name,
    businessType: phone.business.type,
    workflowId: phone.installedAgent.workflowId,
    installedAgentId: phone.installedAgent.id,
    vapiAssistantId: phone.business.profile?.vapiAssistantId ?? null,
    calendarId: phone.business.profile?.calendarId ?? "primary",
    timeZone: phone.business.profile?.timeZone ?? env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
    publicBusinessNumber: routing.publicBusinessNumber ?? null,
    mode: isRoutingMode(routing.mode) ? routing.mode : "NO_ANSWER",
    wouldAnswerWith: "vapi_connect_stream"
  };
}
