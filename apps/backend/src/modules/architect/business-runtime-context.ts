import { env } from "../../config/env";
import { formatKnowledgeEntries } from "../business/agent-knowledge";

/**
 * THE BUSINESS, AS THE RUNTIME SEES IT.
 *
 * This used to live inside twilio-business-routing, which meant only the
 * phone path could build it. Every other way into a business's agent — a
 * held conversation waking days later, a scheduled run — had to hand-build a
 * shrunken version, and the shrunken versions were missing things. One of
 * them carried the business name and nothing else, so a follow-up email had
 * no business to send from and was dropped in silence.
 *
 * It lives on its own now so there is one answer to "who is this business",
 * and everything that starts a run reads it from here.
 */

export type BusinessRuntimeContext = {
  businessId?: string;
  ownerId?: string;
  installedAgentId?: string;
  listingId?: string;
  businessName: string;
  businessType?: string;
  businessPhoneNumber?: string;
  bookingUrl?: string;
  teamPhone?: string;
  calendarId?: string;
  timeZone?: string;
  vapiAssistantId?: string;
  vapiPhoneNumberId?: string;
  services: string[];
  faqs: string[];
  tone?: string;
  escalationRules?: string;
  knowledge: string[];
  hours?: unknown;
  /** LIVE by default; architect sandbox agents run as ARCHITECT_DRY_RUN so
   * their bookings are marked as tests and excluded from production data. */
  executionMode?: "ARCHITECT_DRY_RUN" | "BUSINESS_TEST" | "LIVE";
};

function jsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  return [];
}

function faqStrings(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          const question = typeof record.question === "string" ? record.question : "";
          const answer = typeof record.answer === "string" ? record.answer : "";
          return [question, answer].filter(Boolean).join(" - ");
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).filter((item): item is string => typeof item === "string");
  }

  return [];
}

function cleanAgentId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Per-agent business context saved by the buyer setup wizard. */
function readAgentBusinessDetails(configJson: unknown): Record<string, unknown> {
  const config =
    configJson && typeof configJson === "object" && !Array.isArray(configJson)
      ? (configJson as Record<string, unknown>)
      : {};
  const details = config.businessDetails;

  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};
}

function agentDetailString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const AGENT_BUSINESS_CONTEXT_VERSION = 2;

function ownsFullBusinessContext(details: Record<string, unknown>): boolean {
  return details.contextVersion === AGENT_BUSINESS_CONTEXT_VERSION;
}

export function buildBusinessContext(
  business: any,
  phoneNumber?: string | null,
  installedAgent?: { id?: string; listingId?: string | null; configJson?: unknown } | null
): BusinessRuntimeContext {
  const profile = business?.profile;
  const knowledgeBases = Array.isArray(business?.knowledgeBases) ? business.knowledgeBases : [];
  const agentConfig =
    installedAgent?.configJson && typeof installedAgent.configJson === "object" && !Array.isArray(installedAgent.configJson)
      ? (installedAgent.configJson as Record<string, unknown>)
      : {};
  const agentDetails = readAgentBusinessDetails(installedAgent?.configJson);
  const ownsAgentContext = ownsFullBusinessContext(agentDetails);
  // An agent that owns its context never inherits a sibling's contact points.
  const profileBookingUrl: string | undefined = ownsAgentContext
    ? undefined
    : agentDetailString(profile?.bookingUrl);
  const profileTeamPhone: string | undefined = ownsAgentContext
    ? undefined
    : agentDetailString(profile?.teamPhone);
  const executionMode: BusinessRuntimeContext["executionMode"] =
    agentConfig.executionMode === "ARCHITECT_DRY_RUN" || agentConfig.executionMode === "BUSINESS_TEST"
      ? agentConfig.executionMode
      : agentConfig.testMode === true
        ? "ARCHITECT_DRY_RUN"
        : "LIVE";

  return {
    businessId: business?.id,
    ownerId: business?.ownerId,
    installedAgentId: installedAgent?.id,
    listingId: installedAgent?.listingId ?? undefined,
    executionMode,
    businessName:
      agentDetailString(agentDetails.businessName) ??
      business?.name ??
      env.TWILIO_DEFAULT_BUSINESS_NAME ??
      "the business",
    businessType: agentDetailString(agentDetails.businessType) ?? business?.type ?? undefined,
    businessPhoneNumber: phoneNumber ?? undefined,
    bookingUrl:
      agentDetailString(agentDetails.bookingUrl) ??
      profileBookingUrl ??
      env.TWILIO_DEFAULT_BOOKING_URL ??
      undefined,
    teamPhone:
      agentDetailString(agentDetails.teamPhone) ??
      profileTeamPhone ??
      env.TWILIO_DEFAULT_TEAM_PHONE ??
      undefined,
    calendarId: profile?.calendarId ?? env.GOOGLE_CALENDAR_ID ?? "primary",
    timeZone: profile?.timeZone ?? env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
    vapiAssistantId: installedAgent
      ? cleanAgentId(agentConfig.vapiAssistantId)
      : cleanAgentId(agentConfig.vapiAssistantId) || profile?.vapiAssistantId || undefined,
    vapiPhoneNumberId: installedAgent
      ? cleanAgentId(agentConfig.vapiPhoneNumberId)
      : cleanAgentId(agentConfig.vapiPhoneNumberId) || profile?.vapiPhoneNumberId || undefined,
    services: ownsAgentContext
      ? jsonStringArray(agentDetails.services)
      : jsonStringArray(agentDetails.services ?? profile?.services),
    faqs: ownsAgentContext
      ? faqStrings(agentDetails.faqs)
      : faqStrings(agentDetails.faqs ?? profile?.faqsJson),
    tone: ownsAgentContext
      ? agentDetailString(agentDetails.tone) ?? "friendly"
      : agentDetailString(agentDetails.tone) ?? profile?.tone ?? "friendly",
    escalationRules: ownsAgentContext
      ? agentDetailString(agentDetails.escalationRules)
      : agentDetailString(agentDetails.escalationRules) ?? profile?.escalationRules ?? undefined,
    hours: ownsAgentContext
      ? (agentDetails.hours as unknown) ?? undefined
      : agentDetails.hours ?? profile?.hoursJson ?? undefined,
    knowledge: formatKnowledgeEntries(knowledgeBases)
  };
}

