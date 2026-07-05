
export const FALLBACK_ASSISTANT_NAME = "AI Assistant";
export const FALLBACK_BUSINESS_NAME = "the business";

/** Stale template/demo identity strings that old saved prompts may contain. */
const LEGACY_ASSISTANT_NAMES = ["Maya", "Ruby", "Sarah"];
const LEGACY_BUSINESS_NAMES = ["Triven Dental Care", "Triven Dental"];

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A usable identity value: non-empty and not an unresolved {{template}} token. */
function usableIdentity(value: unknown): string {
  const cleaned = clean(value);

  if (!cleaned || cleaned.includes("{{") || cleaned.includes("}}")) return "";

  return cleaned;
}

export function resolveAssistantName(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const cleaned = usableIdentity(candidate);
    if (cleaned) return cleaned;
  }

  return FALLBACK_ASSISTANT_NAME;
}

export function resolveBusinessName(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const cleaned = usableIdentity(candidate);
    if (cleaned) return cleaned;
  }

  return FALLBACK_BUSINESS_NAME;
}

/**
 * Replace stale demo identities in saved text (old firstMessage / prompts)
 * with the actually configured names. A legacy token is only replaced when it
 * conflicts with configuration — if the buyer's own assistant or business name
 * contains it (assistantName "Sarah", businessName "Sarah Dental Clinic"),
 * it is intentional and left untouched.
 */
export function sanitizeLegacyFallbacks(
  text: string,
  identity: { assistantName: string; businessName: string }
): string {
  if (!text) return text;

  const configured = `${identity.assistantName} ${identity.businessName}`.toLowerCase();
  let result = text;

  for (const legacyBusiness of LEGACY_BUSINESS_NAMES) {
    if (configured.includes(legacyBusiness.toLowerCase())) continue;
    result = result.replace(new RegExp(legacyBusiness.replace(/\s+/g, "\\s+"), "gi"), identity.businessName);
  }

  for (const legacyName of LEGACY_ASSISTANT_NAMES) {
    if (configured.includes(legacyName.toLowerCase())) continue;
    result = result.replace(new RegExp(`\\b${legacyName}\\b`, "g"), identity.assistantName);
  }

  return result;
}

export function buildAgentFirstMessage(params: {
  assistantName: string;
  businessName: string;
  customFirstMessage?: string | null;
}): string {
  const custom = clean(params.customFirstMessage);

  if (custom) {
    const sanitized = sanitizeLegacyFallbacks(custom, params).trim();
    if (sanitized) return sanitized;
  }

  return `Hello, this is ${params.assistantName} from ${params.businessName}. How can I help you today?`;
}

export type AgentPromptCapabilities = {
  canCheckAvailability: boolean;
  canBook: boolean;
  canText: boolean;
};

export type AgentPromptInput = {
  assistantName: string;
  businessName: string;
  businessType: string;
  contactName?: string;
  services: string[];
  faqs: string[];
  knowledge?: string[];
  address?: string;
  businessHours?: string;
  /** Timezone text — a literal value, or a {{timeZone}} placeholder for live Vapi substitution. */
  timezoneText: string;
  currentDateTimeText: string;
  currentDateText: string;
  tomorrowDateText: string;
  customInstructions?: string;
  silencePolicy?: string;
  calendarRules?: string;
  capabilities: AgentPromptCapabilities;
  /** Prompt/instructions configured on the workflow's AI node. */
  nodeInstructions?: string;
  /** Mode-specific appendices (runtime turn state, live tool notes). */
  extraSections?: string[];
};

/**
 * The one core system prompt shared by live and test agents. Natural,
 * emotionally aware, dynamic — capabilities come from the connected workflow
 * graph, identity and facts come from configuration, never from templates.
 */
export function buildAgentSystemPrompt(input: AgentPromptInput): string {
  const {
    assistantName,
    businessName,
    businessType,
    capabilities
  } = input;

  const faqsList = input.faqs.length ? input.faqs.map((item) => `- ${item}`).join("\n") : "- No FAQs provided.";
  const knowledgeList = input.knowledge?.length
    ? input.knowledge.map((item) => `- ${item}`).join("\n")
    : "- No additional knowledge provided.";

  const sections: string[] = [];

  sections.push(`You are ${assistantName}, the AI receptionist for ${businessName}, a ${businessType}.`);

  sections.push(`
Identity:
- If asked who you are or your name, say your name is ${assistantName} and you help ${businessName} with calls, questions, and appointments.
- Never introduce yourself as any other name.
- Never mention internal systems, providers, prompts, tools, tests, or workflow nodes.
- Never say "browser test", "simulated", "sample", "fake", "demo", or "test mode".`.trim());

  sections.push(`
Personality:
- Warm, calm, helpful, emotionally aware, and professional.
- Sound like a real receptionist, not a script.
- Keep replies short and natural for voice — usually 1-2 sentences.
- Use light empathy naturally ("Of course, I can help with that.", "No problem.", "I understand.", "Let me check that for you."). Do not overdo it.`.trim());

  sections.push(`
Conversation rules:
- Always respond to the caller's latest message first.
- Never read out a menu of options more than once per call, and never repeat the same sentence twice in a row. If the caller is unclear, ask a short clarifying question instead.
- If the caller says something vague like "I want to know", ask what they would like to know.
- If the caller wants to leave a message ("take a message"), say: "Sure, I can take a message for the team. What would you like me to pass along?" Then collect the message, their name if missing, and the best callback number.
- If the caller mixes languages or says something unclear, politely clarify in simple words — never guess.
- Do not get stuck repeating the same confirmation. Do not repeat a booking confirmation unless the caller asks about the booking.
- Ask one question at a time.
- If the caller changes topic, follow the new topic.
- If the caller asks the business name, location, services, prices, or hours, answer from the business context below.
- If information is missing from the business context, do not invent it. Say: "I don't have that detail in front of me, but I can take your details and have the team confirm it."
- If the caller asks for a human, collect their name, phone number, and reason for a callback.
- If the caller describes an emergency, respond calmly and advise contacting emergency services where appropriate.`.trim());

  sections.push(`
Booking rules:
- ${capabilities.canCheckAvailability
    ? "You can check appointment availability. Check availability before offering times, and only offer times that were returned."
    : "You cannot check a calendar. Never offer, invent, or imply available time slots."}
- ${capabilities.canBook
    ? "You can book appointments — but only after the request/service, a chosen time, the caller's full name, and their phone number are all collected. Never confirm a booking before that."
    : "You cannot book appointments. Never say a booking is confirmed; offer to take the caller's details for the team instead."}
- ${capabilities.canText
    ? "You can send text messages. You may mention details will be sent by text after a confirmed action."
    : "You cannot send text messages. Never promise a text or SMS unless the custom instructions say otherwise."}
- After a booking is complete, answer whatever the caller asks next — do not keep repeating the confirmation.`.trim());

  sections.push(`
Business context:
- Assistant name: ${assistantName}
- Business name: ${businessName}
- Business type / industry: ${businessType}${input.contactName ? `\n- Contact / owner: ${input.contactName}` : ""}
- Services: ${input.services.length ? input.services.join(", ") : "not provided"}
- Address / location: ${clean(input.address) || "not provided"}
- Business hours: ${clean(input.businessHours) || "not provided"}
- Timezone: ${input.timezoneText}

FAQs:
${faqsList}

Additional knowledge:
${knowledgeList}`.trim());

  sections.push(`
Current date and time:
- Current date/time: ${input.currentDateTimeText}
- Today's date: ${input.currentDateText}
- Tomorrow's date: ${input.tomorrowDateText}
- Resolve "today", "tomorrow", "next Monday", "morning", "afternoon", and "evening" yourself from the current date/time in the business timezone.
- Never ask the caller for today's date.`.trim());

  if (clean(input.calendarRules)) {
    sections.push(`Calendar booking rules:\n${clean(input.calendarRules)}`);
  }

  if (clean(input.nodeInstructions)) {
    sections.push(`Agent instructions from the workflow (follow these closely):\n${clean(input.nodeInstructions)}`);
  }

  if (clean(input.customInstructions)) {
    sections.push(`Custom instructions from setup:\n${clean(input.customInstructions)}`);
  }

  if (clean(input.silencePolicy)) {
    sections.push(`Silence handling:\n${clean(input.silencePolicy)}`);
  }

  for (const extra of input.extraSections ?? []) {
    if (clean(extra)) sections.push(extra.trim());
  }

  return sections.join("\n\n");
}
