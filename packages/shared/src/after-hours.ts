import {
  businessOpenStatus,
  dateInTimeZone,
  describeOpenStatus,
  formatMinutes12h,
  minutesOfDayInTimeZone,
  type BusinessOpenStatus,
  type BusinessWeekday,
  type SpecialHoursEntry,
  type WeeklyHours
} from "./business-hours";
import { isValidIanaTimeZone } from "./business-hours";
import type { ExecutionMode } from "./execution-mode";

export const AFTER_HOURS_POLICY_VERSION = "2026-07.v1";

export const AFTER_HOURS_EMERGENCY_CATEGORIES = ["DENTAL", "MEDICAL", "SERVICE", "NONE"] as const;
export type AfterHoursEmergencyCategory = (typeof AFTER_HOURS_EMERGENCY_CATEGORIES)[number];

export const AFTER_HOURS_CONTACT_METHODS = ["PHONE", "SMS", "EMAIL", "WEBHOOK", "NONE"] as const;
export type AfterHoursContactMethod = (typeof AFTER_HOURS_CONTACT_METHODS)[number];

export const SUPPORTED_AFTER_HOURS_CONTACT_METHODS = ["SMS", "EMAIL", "NONE"] as const;

export const AFTER_HOURS_CONTACT_METHOD_UNSUPPORTED = "AFTER_HOURS_CONTACT_METHOD_UNSUPPORTED";

export function isSupportedAfterHoursContactMethod(value: unknown): value is "SMS" | "EMAIL" | "NONE" {
  return (
    typeof value === "string" && (SUPPORTED_AFTER_HOURS_CONTACT_METHODS as readonly string[]).includes(value)
  );
}

export type AfterHoursPolicy = {
  enabled: boolean;
  timezone?: string;
  greeting?: string;
  emergencyScreeningEnabled: boolean;
  emergencyCategory: AfterHoursEmergencyCategory;
  emergencyContactMethod: AfterHoursContactMethod;
  emergencyContact?: string;
  offerAppointmentBooking: boolean;
  preferEarliestAvailableSlot: boolean;
  allowUrgentCallbackRequest: boolean;
  lifeThreateningInstruction?: string;
  includeCallbackInStaffAlert: boolean;
};

function cleanStr(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

export function normalizeAfterHoursPolicy(raw: unknown): AfterHoursPolicy | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;

  const categoryRaw = String(record.emergencyCategory ?? "").toUpperCase();
  const emergencyCategory = (AFTER_HOURS_EMERGENCY_CATEGORIES as readonly string[]).includes(categoryRaw)
    ? (categoryRaw as AfterHoursEmergencyCategory)
    : "NONE";

  const contactRaw = String(record.emergencyContactMethod ?? "").toUpperCase();
  const emergencyContactMethod = (AFTER_HOURS_CONTACT_METHODS as readonly string[]).includes(contactRaw)
    ? (contactRaw as AfterHoursContactMethod)
    : "NONE";

  const timezone = cleanStr(record.timezone, 80);

  return {
    enabled: record.enabled === true,
    ...(timezone && isValidIanaTimeZone(timezone) ? { timezone } : {}),
    ...(cleanStr(record.greeting, 600) ? { greeting: cleanStr(record.greeting, 600) } : {}),
    emergencyScreeningEnabled: record.emergencyScreeningEnabled === true,
    emergencyCategory,
    emergencyContactMethod,
    ...(cleanStr(record.emergencyContact, 200) ? { emergencyContact: cleanStr(record.emergencyContact, 200) } : {}),
    offerAppointmentBooking: record.offerAppointmentBooking !== false,
    preferEarliestAvailableSlot:
      record.preferEarliestAvailableSlot === true || record.useEmergencySlots === true,
    allowUrgentCallbackRequest: record.allowUrgentCallbackRequest !== false,
    ...(cleanStr(record.lifeThreateningInstruction, 600)
      ? { lifeThreateningInstruction: cleanStr(record.lifeThreateningInstruction, 600) }
      : {}),
    includeCallbackInStaffAlert: record.includeCallbackInStaffAlert !== false
  };
}

const PLATFORM_DEFAULT_BASE = {
  enabled: true,
  emergencyContactMethod: "SMS",
  offerAppointmentBooking: true,
  preferEarliestAvailableSlot: true,
  allowUrgentCallbackRequest: true,
  includeCallbackInStaffAlert: true
} as const;

export const DEFAULT_DENTAL_AFTER_HOURS_POLICY: AfterHoursPolicy = Object.freeze({
  ...PLATFORM_DEFAULT_BASE,
  emergencyScreeningEnabled: true,
  emergencyCategory: "DENTAL"
});

export const DEFAULT_MEDICAL_AFTER_HOURS_POLICY: AfterHoursPolicy = Object.freeze({
  ...PLATFORM_DEFAULT_BASE,
  emergencyScreeningEnabled: true,
  emergencyCategory: "MEDICAL"
});

export const DEFAULT_GENERAL_AFTER_HOURS_POLICY: AfterHoursPolicy = Object.freeze({
  ...PLATFORM_DEFAULT_BASE,
  emergencyScreeningEnabled: false,
  emergencyCategory: "NONE"
});

const PLATFORM_DEFAULT_POLICIES: readonly AfterHoursPolicy[] = Object.freeze([
  DEFAULT_DENTAL_AFTER_HOURS_POLICY,
  DEFAULT_MEDICAL_AFTER_HOURS_POLICY,
  DEFAULT_GENERAL_AFTER_HOURS_POLICY
]);

export function isPlatformDefaultAfterHoursPolicy(
  policy: AfterHoursPolicy | null | undefined
): boolean {
  return Boolean(policy) && PLATFORM_DEFAULT_POLICIES.includes(policy as AfterHoursPolicy);
}

const DENTAL_BUSINESS_TYPE =
  /\b(dental|dentist\w*|dentistry|orthodont\w*|endodont\w*|periodont\w*|prosthodont\w*|oral surg\w*|oral health)\b/;

const MEDICAL_BUSINESS_TYPE =
  /\b(medical|medicine|clinic|clinical|doctor\w*|physician\w*|surgeon\w*|surgery|hospital|urgent care|health care|healthcare|pediatric\w*|paediatric\w*|dermatolog\w*|cardiolog\w*|neurolog\w*|oncolog\w*|ophthalmolog\w*|optometr\w*|chiropract\w*|physiotherap\w*|physical therapy|podiatr\w*|gynecolog\w*|gynaecolog\w*|obstetric\w*|psychiatr\w*|urology|urologist|nurse|nursing|midwif\w*|midwives)\b/;

/**
 * Animal care is excluded from clinical screening even though "veterinary
 * clinic" reads as medical: the screening script directs callers to 911 and the
 * nearest emergency department, which is the wrong instruction for a pet.
 */
const ANIMAL_CARE_BUSINESS_TYPE =
  /\b(vet|vets|veterinar\w*|animal|animals|pet|pets|equine|canine|feline|kennel|grooming)\b/;

/**
 * Which emergency category a business type warrants BEFORE anyone configures a
 * policy. Only human clinical practices get proactive screening; everything
 * else falls to NONE.
 */
export function emergencyCategoryForBusinessType(
  businessType: string | null | undefined
): AfterHoursEmergencyCategory {
  const value = ` ${String(businessType ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  if (!value.trim()) return "NONE";
  if (ANIMAL_CARE_BUSINESS_TYPE.test(value)) return "NONE";
  if (DENTAL_BUSINESS_TYPE.test(value)) return "DENTAL";
  if (MEDICAL_BUSINESS_TYPE.test(value)) return "MEDICAL";
  return "NONE";
}

export function platformDefaultAfterHoursPolicy(
  businessType?: string | null
): AfterHoursPolicy {
  switch (emergencyCategoryForBusinessType(businessType)) {
    case "DENTAL":
      return DEFAULT_DENTAL_AFTER_HOURS_POLICY;
    case "MEDICAL":
      return DEFAULT_MEDICAL_AFTER_HOURS_POLICY;
    default:
      return DEFAULT_GENERAL_AFTER_HOURS_POLICY;
  }
}

export function policyScreensForEmergencies(policy: AfterHoursPolicy | null | undefined): boolean {
  return Boolean(policy?.enabled && policy.emergencyScreeningEnabled && policy.emergencyCategory !== "NONE");
}


export type BusinessHoursStateKind = "OPEN" | "CLOSED" | "UNKNOWN";

export function businessHoursStateFromStatus(
  status: BusinessOpenStatus | null | undefined
): BusinessHoursStateKind {
  if (!status || status.state === "unknown") return "UNKNOWN";
  return status.state === "open" ? "OPEN" : "CLOSED";
}

export function formatNextOpenText(status: BusinessOpenStatus | null | undefined): string {
  if (!status) return "";
  if (status.reopensTodayAt) return `today at ${status.reopensTodayAt}`;
  if (status.nextOpen) {
    if (status.nextOpen.isToday) return `today at ${status.nextOpen.opensAt}`;
    const weekday = status.nextOpen.weekday.charAt(0).toUpperCase() + status.nextOpen.weekday.slice(1);
    return `${weekday} (${status.nextOpen.date}) at ${status.nextOpen.opensAt}`;
  }
  return "";
}

export type AfterHoursSnapshot = {
  state: BusinessHoursStateKind;
  timeZone: string;
  localDate: string;
  localTime: string;
  weekday: BusinessWeekday;
  statusLine: string;
  nextOpenText: string;
  simulated?: "open" | "closed";
};

export function buildAfterHoursSnapshot(input: {
  weekly: WeeklyHours | null;
  special?: SpecialHoursEntry[] | null;
  timeZone: string;
  now?: Date;
  simulate?: "open" | "closed" | null;
}): AfterHoursSnapshot {
  const now = input.now ?? new Date();
  const status = businessOpenStatus({
    weekly: input.weekly,
    special: input.special ?? [],
    timeZone: input.timeZone,
    now
  });

  const localDate = dateInTimeZone(input.timeZone, now);
  const localTime = formatMinutes12h(minutesOfDayInTimeZone(input.timeZone, now));

  if (input.simulate === "open" || input.simulate === "closed") {
    const state: BusinessHoursStateKind = input.simulate === "open" ? "OPEN" : "CLOSED";
    return {
      state,
      timeZone: input.timeZone,
      localDate,
      localTime,
      weekday: status.weekday,
      statusLine: `Simulated for testing: the business is treated as ${input.simulate} right now.`,
      nextOpenText: input.simulate === "closed" ? formatNextOpenText(status) : "",
      simulated: input.simulate
    };
  }

  return {
    state: businessHoursStateFromStatus(status),
    timeZone: input.timeZone,
    localDate,
    localTime,
    weekday: status.weekday,
    statusLine: describeOpenStatus(status),
    nextOpenText: status.state === "closed" ? formatNextOpenText(status) : ""
  };
}

export function resolveSimulatedHoursState(
  executionMode: ExecutionMode,
  requested: unknown
): "open" | "closed" | null {
  if (executionMode === "LIVE") return null;
  return requested === "open" || requested === "closed" ? requested : null;
}

export function emergencyNounForCategory(category: AfterHoursEmergencyCategory): string | null {
  switch (category) {
    case "DENTAL":
      return "a dental emergency";
    case "MEDICAL":
      return "a medical emergency";
    case "SERVICE":
      return "an urgent service issue";
    default:
      return null;
  }
}

export function defaultAfterHoursGreeting(params: {
  businessName: string;
  emergencyNoun: string | null;
  offerAppointmentBooking: boolean;
}): string {
  const opening = `Thank you for calling ${params.businessName}. Our office is currently closed.`;

  if (params.emergencyNoun) {
    return `${opening} I hope everything is okay.\n\nAre you calling about ${params.emergencyNoun}, or would you like help scheduling the next available appointment?`;
  }

  return params.offerAppointmentBooking
    ? `${opening} I can help you schedule the next available appointment, or take a message for the team. How can I help?`
    : `${opening} I can take a message for the team and help with any questions. How can I help?`;
}

export function resolveAfterHoursGreeting(params: {
  policy: AfterHoursPolicy;
  businessName: string;
}): string {
  const custom = params.policy.greeting?.trim();
  if (custom) {
    return custom
      .replaceAll("{{businessName}}", params.businessName)
      .replaceAll("{{business_name}}", params.businessName)
      .replaceAll("{{business.name}}", params.businessName)
      .replaceAll("{{Business Name}}", params.businessName);
  }

  return defaultAfterHoursGreeting({
    businessName: params.businessName,
    emergencyNoun: policyScreensForEmergencies(params.policy)
      ? emergencyNounForCategory(params.policy.emergencyCategory)
      : null,
    offerAppointmentBooking: params.policy.offerAppointmentBooking
  });
}

/* -------------------------- canonical script lines ------------------------- */

export const AFTER_HOURS_RED_FLAG_QUESTION =
  "Are you having difficulty breathing, speaking, or swallowing, severe or rapidly increasing swelling around your mouth or neck, heavy bleeding that will not stop, or a serious injury to your face or jaw?";

export const AFTER_HOURS_CLARIFY_QUESTION =
  "I want to make sure I understand. Are you having difficulty breathing or swallowing, severe swelling, uncontrolled bleeding, or a serious injury?";

export function defaultLifeThreateningInstruction(category: AfterHoursEmergencyCategory): string {
  const waitLine =
    category === "DENTAL" ? "Do not wait for a dental appointment." : "Do not wait for an appointment.";
  return `This may require immediate medical attention. Please call 911 now or go to the nearest emergency department. ${waitLine}\n\nIf you are unable to call safely, ask someone nearby to call for you.`;
}

export function resolveLifeThreateningInstruction(policy: AfterHoursPolicy): string {
  return policy.lifeThreateningInstruction?.trim() || defaultLifeThreateningInstruction(policy.emergencyCategory);
}

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim()} `;
}

export const RED_FLAG_KINDS = [
  "difficulty_breathing",
  "difficulty_speaking",
  "difficulty_swallowing",
  "severe_swelling",
  "uncontrolled_bleeding",
  "serious_facial_injury",
  "loss_of_consciousness",
  "head_injury_warning_signs"
] as const;

export type RedFlagKind = (typeof RED_FLAG_KINDS)[number];

type FlagRule = { flag: RedFlagKind; pattern: RegExp; negative?: RegExp };

const RED_FLAG_RULES: FlagRule[] = [
  {
    flag: "difficulty_breathing",
    pattern:
      /\b(can(no|')?t|cannot|hard(er)?\s+to|trouble|difficult\w*|struggling\s+to)\s+(breath\w*)|shortness of breath|gasping for (air|breath)|\bcan'?t\s+get\s+(any\s+)?air\b/,
    negative: /\b(no|not having( any)?|without( any)?)\s+(trouble|difficulty|problems?)\s+breath\w*|\bbreathing\s+(is\s+)?(fine|okay|ok|normal)\b|\bcan breathe (fine|okay|ok|normally)\b/
  },
  {
    flag: "difficulty_speaking",
    pattern: /\b(can(no|')?t|cannot|hard(er)?\s+to|trouble|difficult\w*|struggling\s+to)\s+(speak|talk)\w*/,
    negative: /\b(no|not having( any)?|without( any)?)\s+(trouble|difficulty|problems?)\s+(speak|talk)\w*/
  },
  {
    flag: "difficulty_swallowing",
    pattern: /\b(can(no|')?t|cannot|hard(er)?\s+to|trouble|difficult\w*|struggling\s+to|painful\s+to)\s+swallow\w*/,
    negative: /\b(no|not having( any)?|without( any)?)\s+(trouble|difficulty|problems?)\s+swallow\w*|\bcan swallow (fine|okay|ok|normally)\b/
  },
  {
    flag: "severe_swelling",
    pattern:
      /\b(sever\w+|rapid\w*|extreme\w*|huge|massive|spreading|getting (worse|bigger))\b[^.!?]{0,60}\bsw(e|o)ll\w*|\bsw(e|o)ll\w*\b[^.!?]{0,60}\b(sever\w+|rapid\w*|spreading|getting (worse|bigger)|down my (neck|throat)|neck|throat|closing)\b|\b(face|cheek|jaw|neck|throat|lips?|mouth)\b[^.!?]{0,40}\b(really|very|badly|hugely)\s+swollen\b/,
    negative: /\b(no|not( really)?|without( any)?|isn'?t)\s+(sever\w+\s+)?sw(e|o)ll\w*|\bswelling\s+(has\s+)?(gone|went)\s+down\b|\ba (little|bit|slightly) swollen\b/
  },
  {
    flag: "uncontrolled_bleeding",
    pattern:
      /\bbleed\w*\b[^.!?]{0,60}\b(won'?t|will not|can'?t|cannot|not|doesn'?t|does not|hasn'?t|has not)\s*(stop|stopping|stopped)\b|\b(heavy|uncontrolled|uncontrollable|constant|nonstop|so much|a lot of)\s+(bleeding|blood)\b|\b(won'?t|will not)\s+stop\s+bleeding\b|\bsoak\w*\b[^.!?]{0,30}\b(gauze|blood)\b/,
    negative: /\b(bleeding|it)\s+(has\s+)?stopped\b|\bnot bleeding\b|\bno (more )?bleeding\b|\bbleeding\s+(is\s+)?(under control|controlled|minor|slight)\b/
  },
  {
    flag: "serious_facial_injury",
    pattern:
      /\b(broke\w*|broken|fracture\w*|smashed|crushed|dislocated|shattered)\b[^.!?]{0,40}\b(jaw|face|facial|cheekbone)\b|\b(jaw|face|cheekbone)\b[^.!?]{0,40}\b(broken|fractured|smashed|crushed|dislocated|shattered)\b|\bserious\s+(injury|trauma)\b[^.!?]{0,30}\b(face|facial|jaw)\b|\bcan'?t\s+(open|close|move)\s+my\s+jaw\b/
  },
  {
    flag: "loss_of_consciousness",
    pattern: /\b(passed out|blacked out|lost consciousness|unconscious|fainted|knocked out cold)\b/,
    negative: /\b(didn'?t|did not|never)\s+(pass out|black out|lose consciousness|faint)\b/
  },
  {
    flag: "head_injury_warning_signs",
    pattern:
      /\b(hit|injured|banged)\b[^.!?]{0,40}\bhead\b[^.!?]{0,80}\b(vomit\w*|throwing up|confus\w*|vision|blurry|seeing double|dizzy)\b|\b(vomit\w*|throwing up|confus\w*|blurr?y vision|seeing double)\b[^.!?]{0,80}\b(hit|injured|banged)\b[^.!?]{0,40}\bhead\b/
  }
];

export function detectRedFlags(text: string): RedFlagKind[] {
  const value = normalize(text);
  if (!value.trim()) return [];

  const flags: RedFlagKind[] = [];
  for (const rule of RED_FLAG_RULES) {
    if (rule.negative?.test(value)) continue;
    if (rule.pattern.test(value)) flags.push(rule.flag);
  }
  return flags;
}

export function detectUrgentSymptoms(text: string): boolean {
  const value = normalize(text);
  if (/\b(no|not an?|isn'?t an?|it'?s not an?)\s+emergency\b/.test(value)) {
    if (
      !/\b(pain|bleed|swoll|swell|broke|broken|knocked|chipped|cracked|accident|injur|abscess|fever|toothache)\w*\b/.test(
        value
      )
    ) {
      return false;
    }
  }

  return (
    /\b(this is|i have|it'?s)\s+an?\s+emergency\b/.test(value) ||
    /\b(sever\w+|extreme\w*|unbearable|excruciating|terrible|awful|really bad|worst)\b[^.!?]{0,40}\bpain\b/.test(value) ||
    /\bpain\b[^.!?]{0,40}\b(sever\w+|unbearable|excruciating|terrible|really bad|10|ten|nine|eight)\b/.test(value) ||
    /\btooth(ache)?\b[^.!?]{0,40}\b(broke|broken|cracked|chipped|knocked|fell)\b/.test(value) ||
    /\b(broke|broken|cracked|chipped|knocked)\b[^.!?]{0,40}\btooth\b/.test(value) ||
    /\bknocked[- ]?out\b/.test(value) ||
    /\bbleed\w*\b/.test(value) ||
    /\bswoll\w*|\bswell\w*/.test(value) ||
    /\babscess\b/.test(value) ||
    /\b(had|been in|was in)\s+an?\s+accident\b/.test(value) ||
    /\binjur\w+\b/.test(value) ||
    /\b(child|kid|son|daughter)\b[^.!?]{0,60}\b(tooth|teeth|mouth|jaw)\b/.test(value) ||
    /\bfever\b/.test(value)
  );
}

export function isAffirmativeReply(text: string): boolean {
  const value = normalize(text);
  if (/\b(no|nope|nah|not|don'?t|isn'?t)\b/.test(value)) return false;
  return /\b(yes|yeah|yep|yup|correct|that'?s right|i am|i think so it is|definitely|absolutely)\b/.test(value);
}

export function isNegativeReply(text: string): boolean {
  const value = normalize(text);
  return (
    /^\s*(no|nope|nah|none|no,? (nothing|none of (that|those|them))|not really|thankfully no|luckily no)\b/.test(
      value.trim() === value ? value : value.trim()
    ) ||
    /\b(no|none) of (that|those|them)\b/.test(value) ||
    /\b(not|isn'?t|it'?s not)\s+an?\s+emergency\b/.test(value) ||
    /\bno emergency\b/.test(value) ||
    /\bjust\s+(want|need|looking)\b[^.!?]{0,40}\b(appointment|schedule|booking|checkup|cleaning)\b/.test(value)
  );
}

const ROUTINE_SCHEDULING_PHRASES =
  /\b(opening|openings|slot|slots|availability|available (?:time|times|slot|slots|day|days)|free (?:time|times|slot|slots)|first available|earliest available|walk[- ]?in|come in|get in|fit me in|squeeze me in)\b/;

/** Any symptom or urgency word disqualifies the routine-phrase shortcut. */
const SYMPTOM_OR_URGENCY_HINT =
  /\b(pain|painful|hurt\w*|ache|aching|sore|swell\w*|swoll\w*|bleed\w*|blood|broke\w*|broken|crack\w*|chip\w*|knocked|abscess|infect\w*|fever|injur\w*|accident|emergency|urgent|asap|right now|immediately)\b/;

/** The reply chose the scheduling side of the emergency-or-appointment question. */
export function mentionsSchedulingIntent(text: string): boolean {
  const value = normalize(text);
  if (
    /\b(appointment|schedule|schedul\w+|book(ing)?|rebook|reschedul\w+|checkup|check-up|cleaning|consultation|next available)\b/.test(
      value
    )
  ) {
    return true;
  }
  return ROUTINE_SCHEDULING_PHRASES.test(value) && !SYMPTOM_OR_URGENCY_HINT.test(value);
}

export function isAmbiguousEmergencyReply(text: string): boolean {
  const value = normalize(text).trim();
  if (!value) return true;
  return /\b(i (don'?t|do not) know|not (really )?sure|maybe|possibly|perhaps|i guess|unsure|dunno|hard to say|kind of|sort of)\b/.test(
    ` ${value} `
  );
}

export function asksEmergencyQuestion(text: string): boolean {
  const value = normalize(text);
  if (!value.includes("?")) return false;
  return (
    /\bemergency\b/.test(value) ||
    /\burgent (service )?(issue|problem|concern)\b/.test(value)
  );
}

export function asksRedFlagQuestion(text: string): boolean {
  const value = normalize(text);
  if (!value.includes("?")) return false;
  const signals = [
    /\bbreath\w*\b/.test(value),
    /\bswallow\w*\b/.test(value),
    /\bswell\w*\b/.test(value),
    /\bbleed\w*\b/.test(value),
    /\binjur\w+\b/.test(value)
  ].filter(Boolean).length;
  return signals >= 2;
}

export function gaveEmergencyInstruction(text: string): boolean {
  const value = normalize(text);
  return /\b911\b/.test(value) || /\bemergency (department|room|services)\b/.test(value);
}

export const AFTER_HOURS_ROUTES = [
  "NOT_STARTED",
  "EMERGENCY_QUESTION_ASKED",
  "POSSIBLE_EMERGENCY",
  "NON_EMERGENCY",
  "RED_FLAG_DETECTED",
  "URGENT_DENTAL",
  "STANDARD_BOOKING",
  "HUMAN_REVIEW"
] as const;

export type AfterHoursRoute = (typeof AFTER_HOURS_ROUTES)[number];

export type AfterHoursRoutingOutcome =
  | "IMMEDIATE_MEDICAL_EMERGENCY"
  | "URGENT_DENTAL_REQUEST"
  | "STANDARD_APPOINTMENT_REQUEST"
  | "UNCLEAR_REQUIRES_HUMAN_REVIEW"
  | null;

export type AfterHoursConversationState = {
  route: AfterHoursRoute;
  outcome: AfterHoursRoutingOutcome;
  redFlags: RedFlagKind[] | Array<RedFlagKind | "affirmed_warning_signs">;
  emergencyQuestionAsked: boolean;
  redFlagQuestionAsked: boolean;
  emergencyInstructionGiven: boolean;
  clarificationAsked: boolean;
  needsClarification: boolean;
};

type TranscriptTurn = { role: "user" | "assistant"; content: string };

function outcomeForRoute(route: AfterHoursRoute): AfterHoursRoutingOutcome {
  switch (route) {
    case "RED_FLAG_DETECTED":
      return "IMMEDIATE_MEDICAL_EMERGENCY";
    case "URGENT_DENTAL":
      return "URGENT_DENTAL_REQUEST";
    case "NON_EMERGENCY":
    case "STANDARD_BOOKING":
      return "STANDARD_APPOINTMENT_REQUEST";
    case "HUMAN_REVIEW":
      return "UNCLEAR_REQUIRES_HUMAN_REVIEW";
    default:
      return null;
  }
}

export function deriveAfterHoursState(params: {
  history: TranscriptTurn[];
  message: string;
  screeningEnabled: boolean;
}): AfterHoursConversationState {
  const turns: TranscriptTurn[] = [
    ...params.history.filter((turn) => turn.role === "user" || turn.role === "assistant"),
    { role: "user", content: params.message }
  ];

  const state: AfterHoursConversationState = {
    route: "NOT_STARTED",
    outcome: null,
    redFlags: [],
    emergencyQuestionAsked: false,
    redFlagQuestionAsked: false,
    emergencyInstructionGiven: false,
    clarificationAsked: false,
    needsClarification: false
  };

  if (!params.screeningEnabled) {
    state.route = "STANDARD_BOOKING";
    for (const turn of turns) {
      if (turn.role === "assistant") {
        if (gaveEmergencyInstruction(turn.content)) state.emergencyInstructionGiven = true;
        continue;
      }
      const flags = detectRedFlags(turn.content);
      if (flags.length > 0) {
        state.redFlags = Array.from(new Set([...state.redFlags, ...flags]));
        state.route = "RED_FLAG_DETECTED";
      }
    }
    state.outcome = outcomeForRoute(state.route);
    return state;
  }

  let pendingQuestion: "emergency" | "red_flag" | null = null;
  let unclearAnswers = 0;

  for (const turn of turns) {
    if (turn.role === "assistant") {
      if (gaveEmergencyInstruction(turn.content)) state.emergencyInstructionGiven = true;

      if (asksRedFlagQuestion(turn.content)) {
        state.redFlagQuestionAsked = true;
        if (unclearAnswers > 0) state.clarificationAsked = true;
        pendingQuestion = "red_flag";
      } else if (asksEmergencyQuestion(turn.content)) {
        state.emergencyQuestionAsked = true;
        if (unclearAnswers > 0) state.clarificationAsked = true;
        pendingQuestion = "emergency";
        if (state.route === "NOT_STARTED") state.route = "EMERGENCY_QUESTION_ASKED";
      } else {
        pendingQuestion = null;
      }
      continue;
    }

    const text = turn.content;
    const flags = detectRedFlags(text);
    const urgent = detectUrgentSymptoms(text);
    const negative = isNegativeReply(text);
    const affirmative = isAffirmativeReply(text);

    state.needsClarification = false;

    if (flags.length > 0) {
      state.redFlags = Array.from(new Set([...state.redFlags, ...flags]));
      state.route = "RED_FLAG_DETECTED";
      pendingQuestion = null;
      continue;
    }

    if (state.route === "RED_FLAG_DETECTED") {
      pendingQuestion = null;
      continue;
    }

    if (pendingQuestion === "red_flag") {
      if (affirmative) {
        state.redFlags = Array.from(new Set([...state.redFlags, "affirmed_warning_signs" as const]));
        state.route = "RED_FLAG_DETECTED";
      } else if (negative || mentionsSchedulingIntent(text)) {
        // No warning signs. When the check followed a CONFIRMED possible
        // emergency, continue the urgent flow; when it was the clarification
        // for an ambiguous answer (emergency never confirmed), a denial or a
        // scheduling request safely routes to standard booking — later
        // symptoms still re-enter screening.
        state.route = state.route === "EMERGENCY_QUESTION_ASKED" ? "STANDARD_BOOKING" : "URGENT_DENTAL";
      } else if (urgent) {
        state.route = "URGENT_DENTAL";
      } else {
        unclearAnswers += 1;
        if (unclearAnswers >= 2) {
          state.route = "HUMAN_REVIEW";
        } else {
          state.needsClarification = true;
          state.route = "POSSIBLE_EMERGENCY";
        }
      }
      pendingQuestion = null;
      continue;
    }

    if (pendingQuestion === "emergency") {
      if (urgent || affirmative) {
        state.route = "POSSIBLE_EMERGENCY";
      } else if (negative || mentionsSchedulingIntent(text)) {
        state.route = "STANDARD_BOOKING";
      } else {
        unclearAnswers += 1;
        if (unclearAnswers >= 2) {
          state.route = "HUMAN_REVIEW";
        } else {
          state.needsClarification = true;
          state.route = "EMERGENCY_QUESTION_ASKED";
        }
      }
      pendingQuestion = null;
      continue;
    }

    if (urgent) {
      state.route = state.redFlagQuestionAsked ? "URGENT_DENTAL" : "POSSIBLE_EMERGENCY";
    } else if (negative && (state.route === "POSSIBLE_EMERGENCY" || state.route === "HUMAN_REVIEW")) {
      state.route = "STANDARD_BOOKING";
    } else if ((negative || mentionsSchedulingIntent(text)) && state.route === "NOT_STARTED") {
      state.route = "STANDARD_BOOKING";
    }
    pendingQuestion = null;
  }

  if (unclearAnswers > 0) state.clarificationAsked = true;

  if (
    (state.route === "NOT_STARTED" || state.route === "EMERGENCY_QUESTION_ASKED") &&
    state.redFlags.length === 0 &&
    turns.some((turn) => turn.role === "user" && mentionsSchedulingIntent(turn.content)) &&
    !turns.some(
      (turn) =>
        turn.role === "user" &&
        (detectUrgentSymptoms(turn.content) || detectRedFlags(turn.content).length > 0)
    )
  ) {
    state.route = "STANDARD_BOOKING";
  }

  state.outcome = outcomeForRoute(state.route);
  return state;
}

/* ---------------------------- prompt rendering ----------------------------- */

export type AfterHoursPromptCapabilities = {
  canCheckAvailability?: boolean;
  canBook?: boolean;
  canNotifyStaff?: boolean;
};

function screeningRules(params: {
  policy: AfterHoursPolicy;
  businessName: string;
  bookingLabel: string;
  capabilities: AfterHoursPromptCapabilities;
}): string {
  const { policy, businessName, bookingLabel, capabilities } = params;
  const noun = emergencyNounForCategory(policy.emergencyCategory) ?? "an emergency";
  const instruction = resolveLifeThreateningInstruction(policy);
  const medicalScreening = policy.emergencyCategory === "DENTAL" || policy.emergencyCategory === "MEDICAL";

  const lines: string[] = [];

  lines.push(`- Emergency screening (enabled for this business):
  - Your opening line already asked whether the caller is calling about ${noun} or wants help scheduling. Interpret their FIRST answer against that exact question: a standalone "yes" means possible emergency ONLY when your immediately preceding question asked about an emergency. Never treat a random "yes" elsewhere in the call as emergency intent.
  - If the answer is clearly NO emergency: say "I'm glad to hear that. I'd be happy to help you schedule the next available ${bookingLabel}. May I have your name, please?" and follow the normal booking flow. Do not ask emergency questions again unless the caller later reports an urgent symptom.
  - If the answer is unclear ("I don't know", "maybe", silence, or a topic change): ask ONCE: "${AFTER_HOURS_CLARIFY_QUESTION}" If it is STILL unclear, do not declare it a non-emergency; take the caller's name and number, recommend contacting an appropriate medical professional if symptoms are involved, and pass the call details to the team for human review. Never ask the same emergency question more than twice in total.`);

  if (medicalScreening) {
    lines.push(`- Possible emergency — warning-sign check comes FIRST:
  - Say: "I'm sorry you're dealing with this. I'll ask a few quick questions to understand how urgently you may need help." Never say you will diagnose anything or determine what condition they have.
  - Before any other questions, ask exactly: "${AFTER_HOURS_RED_FLAG_QUESTION}"
  - If the caller reports ANY of those warning signs (or already described one — do not re-ask what they already told you), IMMEDIATELY say: "${instruction.replace(/\n\n/g, " ")}"
  - Give that instruction BEFORE any other questions. Never continue routine ${bookingLabel} questions first, never present a clinic visit as an alternative to 911, never promise the team will call back immediately, never diagnose the cause, and never delay this direction to collect optional details.
  - After giving it, you may ask ONLY what is essential: the caller's name, a callback number, and whether they want ${businessName} notified.${capabilities.canNotifyStaff ? " If they want the team notified, send the internal team notification." : ""} Notifying the team never replaces calling 911 — say so if asked.
  - If the caller later mentions a warning sign at ANY point in the call — even during normal booking — treat it as a red flag immediately.`);
  }

  const urgentQuestions = [
    `"Please briefly tell me what happened."`,
    `"When did this begin?"`,
    `"On a scale from zero to ten, how severe is the pain?"`,
    `"Is there any swelling?"`,
    `"Is there bleeding, and has it stopped?"`,
    ...(policy.emergencyCategory === "DENTAL" ? [`"Did you break or knock out a tooth?"`] : []),
    `"Do you have a fever or feel seriously unwell?"`,
    `"Are you an existing ${policy.emergencyCategory === "DENTAL" ? "patient" : "customer"} of ${businessName}?"`
  ];

  const urgentClose: string[] = [];
  if (policy.offerAppointmentBooking && capabilities.canCheckAvailability) {
    urgentClose.push(
      `check the earliest available ${bookingLabel} with the availability tools${policy.preferEarliestAvailableSlot ? ` — say "I'll check the earliest available ${bookingLabel}." Never claim to be checking special "emergency slots"; no such designation exists on the calendar` : ""}. When one exists say: "I found the earliest available urgent ${bookingLabel} for [date] at [time]. Would you like me to book that?" Book it only through the booking tool, and only claim it is booked when the tool confirmed.`
    );
  }
  if (policy.allowUrgentCallbackRequest) {
    urgentClose.push(
      `when no urgent ${bookingLabel} can be confirmed, say: "I'm unable to confirm an urgent ${bookingLabel} right now. I can send an urgent request to the team with your contact details. If your symptoms worsen, or you develop difficulty breathing or swallowing, severe swelling, or uncontrolled bleeding, call 911 or go to the nearest emergency department."${capabilities.canNotifyStaff ? " Then send the internal team notification marked urgent." : " Take their name and number for the team."}`
    );
  }

  lines.push(`- Urgent (no life-threatening warning signs):
  - Say: "I'm sorry you're going through that. I'll ask a few quick questions so I can understand how urgently you may need ${policy.emergencyCategory === "DENTAL" ? "dental care" : "help"}."
  - Ask only the minimum useful questions, ONE at a time, skipping anything the caller already answered: ${urgentQuestions.join(" ")} Collect a name and callback number if you do not have them.
  - Never force every question, never repeat questions after a warning sign becomes clear, and never diagnose — you are only understanding urgency.
  - Then: ${urgentClose.length ? urgentClose.join(" Otherwise, ") : `take the caller's details and let them know the team will follow up.`}
  - Clearly explain what was completed. Never claim a booking, request, or notification succeeded unless the tool result confirmed it.`);

  return lines.join("\n");
}

export function buildAfterHoursPromptSection(params: {
  policy: AfterHoursPolicy;
  businessName: string;
  bookingLabel?: string;
  capabilities?: AfterHoursPromptCapabilities;
  render:
    | { kind: "liquid" }
    | { kind: "literal"; state: BusinessHoursStateKind; statusLine?: string; nextOpenText?: string };
}): string {
  const { policy, businessName } = params;
  if (!policy.enabled) return "";

  const bookingLabel = params.bookingLabel?.trim() || "appointment";
  const capabilities = params.capabilities ?? {};
  const screening = policyScreensForEmergencies(policy);

  const closedRules: string[] = [];

  closedRules.push(
    `- The after-hours opening line was already spoken when the call connected — do not repeat it. Stay calm, professional, empathetic, and concise.`
  );

  if (screening) {
    closedRules.push(screeningRules({ policy, businessName, bookingLabel, capabilities }));
  } else {
    closedRules.push(
      `- Offer to ${policy.offerAppointmentBooking ? `schedule the next available ${bookingLabel} (using the availability tools only — never invent times)` : "take a message for the team"} or take a message. If the caller describes a possible medical emergency or immediate danger, calmly tell them to call 911 right away before anything else.`
    );
  }

  closedRules.push(
    `- Being closed never blocks scheduling. Business hours and ${bookingLabel} hours are two different schedules: business hours only say whether the office is staffed right now, while ${bookingLabel} hours decide which future times can be booked. The caller may book, reschedule, or cancel on this call for any future time the availability tool returns — never tell them to call back during business hours.`,
    `- Hours honesty: never say "the next business day" or promise a specific ${bookingLabel} time unless an availability check confirmed it. When asked when the office reopens, use the configured next opening time if you have it — never guess.`,
    `- Messaging rules are unchanged after hours: an emergency NEVER creates SMS consent, a booking NEVER creates SMS consent, and no confirmation text is sent just because the call was urgent. Internal team notifications are separate from customer texts.`
  );

  const closedBlock = closedRules.join("\n");

  const unknownLine = `Business hours could not be confirmed for this call. NEVER claim the office is open or closed. Use neutral wording such as: "I can help with an appointment request or urgent concern." Handle emergencies with the same screening rules as after hours, and never guess opening times.`;

  if (params.render.kind === "liquid") {
    return `
After-hours call handling (policy ${AFTER_HOURS_POLICY_VERSION}):
- Current business-hours status for this call: {{businessOpenState}} — {{businessHoursStatusLine}}
- Next opening time, when known: {{businessNextOpenTime}}
- If the status above is "open": handle the call with the normal workflow and IGNORE the rest of this section.
- If the status above is "unknown": ${unknownLine}
- If the status above is "closed", follow these after-hours rules:
${closedBlock}`.trim();
  }

  const { state } = params.render;

  if (state === "OPEN") return "";

  if (state === "UNKNOWN") {
    return `
After-hours call handling (policy ${AFTER_HOURS_POLICY_VERSION}):
- ${unknownLine}
${screening ? screeningRules({ policy, businessName, bookingLabel, capabilities }) : ""}`.trim();
  }

  const statusLine = params.render.statusLine ? `\n- Status: ${params.render.statusLine}` : "";
  const nextOpen = params.render.nextOpenText
    ? `\n- The office next opens ${params.render.nextOpenText}. Share this if the caller asks when the office reopens.`
    : "";

  return `
After-hours call handling (policy ${AFTER_HOURS_POLICY_VERSION}) — the business is CLOSED right now:${statusLine}${nextOpen}
${closedBlock}`.trim();
}

export function buildAfterHoursTurnStateSection(params: {
  state: AfterHoursConversationState;
  policy: AfterHoursPolicy;
  snapshot: AfterHoursSnapshot;
}): string {
  const { state, policy, snapshot } = params;
  const instruction = resolveLifeThreateningInstruction(policy);

  const lines: string[] = [
    `After-hours routing state this turn (internal — never read this aloud):`,
    `- Business-local time: ${snapshot.localDate} ${snapshot.localTime} (${snapshot.timeZone})${snapshot.simulated ? ` [SIMULATED ${snapshot.simulated.toUpperCase()} for testing]` : ""}`,
    `- Business-hours state: ${snapshot.state}`,
    `- Current route: ${state.route}${state.outcome ? ` (${state.outcome})` : ""}`
  ];

  if (state.redFlags.length > 0) {
    lines.push(`- Warning signs reported: ${state.redFlags.join(", ")}`);
  }

  if (state.route === "RED_FLAG_DETECTED") {
    lines.push(
      state.emergencyInstructionGiven
        ? `- The 911/emergency-department instruction was ALREADY given. Do not repeat it as if new; ask only essential follow-ups (name, callback number, whether to notify the team) and keep directing them to emergency care if they hesitate. No booking flow.`
        : `- You MUST begin your reply with the emergency instruction now, before anything else: "${instruction.replace(/\n\n/g, " ")}"`
    );
  } else if (state.needsClarification) {
    lines.push(`- The last answer was unclear. Ask exactly once: "${AFTER_HOURS_CLARIFY_QUESTION}"`);
  } else if (state.route === "HUMAN_REVIEW") {
    lines.push(
      `- Still unclear after clarifying. Do NOT declare this a non-emergency and do NOT keep asking. Collect name and callback number, recommend contacting an appropriate medical professional if symptoms are involved, and tell the caller the team will review and follow up.`
    );
  } else if (state.route === "POSSIBLE_EMERGENCY" && !state.redFlagQuestionAsked) {
    lines.push(`- Possible emergency: ask the warning-sign question now, exactly: "${AFTER_HOURS_RED_FLAG_QUESTION}"`);
  } else if (state.route === "URGENT_DENTAL") {
    lines.push(
      `- Urgent, no warning signs: continue the short urgent questions (skip any already answered), then the earliest-available ${policy.emergencyCategory === "DENTAL" ? "urgent appointment" : "urgent booking"} or an urgent callback request. Never claim anything succeeded without a tool confirmation.`
    );
  } else if (state.route === "STANDARD_BOOKING") {
    lines.push(`- No emergency: follow the normal booking flow. Do not ask emergency questions again.`);
  }

  return lines.join("\n");
}

/* ----------------------- LIVE distributed call state ----------------------- */

/**
 * Live Vapi calls add one route the chat machine folds into booleans: the
 * warning-sign question has been ASKED but the caller has not answered yet.
 */
export const AFTER_HOURS_LIVE_ROUTES = [
  "NOT_STARTED",
  "EMERGENCY_QUESTION_ASKED",
  "POSSIBLE_EMERGENCY",
  "RED_FLAG_CHECK_ASKED",
  "RED_FLAG_DETECTED",
  "URGENT_DENTAL",
  "STANDARD_BOOKING",
  "HUMAN_REVIEW"
] as const;

export type AfterHoursLiveRoute = (typeof AFTER_HOURS_LIVE_ROUTES)[number];

export type EmergencyInstructionStatus = "NOT_REQUIRED" | "REQUIRED" | "GIVEN";

export type StaffNotificationStatus = "NOT_REQUESTED" | "PENDING" | "SENT" | "FAILED";

/** Neutral routing state persisted per live call — never transcripts. */
export type AfterHoursLiveCallState = {
  businessHoursState: BusinessHoursStateKind;
  route: AfterHoursLiveRoute;
  emergencyInstructionStatus: EmergencyInstructionStatus;
  staffNotificationStatus: StaffNotificationStatus;
  redFlags: string[];
  policyVersion: string;
  updatedAt: string;
};

/** One structured, role-tagged, FINAL (non-partial) conversation turn. */
export type AfterHoursCallTurn = { role: "assistant" | "user"; content: string };

/**
 * The assistant SPOKE the emergency direction. Matched only against
 * assistant-authored segments by the caller of this function — caller speech
 * mentioning 911 never satisfies the requirement.
 */
export function containsEmergencyDirection(text: string, policy?: AfterHoursPolicy | null): string | null {
  const value = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (/\b(call|dial|calling)\s*9\s*[-.]?\s*1\s*[-.]?\s*1\b/.test(value) || /\bcall nine one one\b/.test(value)) {
    return "call_911";
  }
  if (/\bgo to (the )?(nearest )?emergency (department|room)\b/.test(value)) {
    return "emergency_department";
  }
  // A custom configured instruction counts when its leading sentence was spoken.
  const custom = policy?.lifeThreateningInstruction?.trim();
  if (custom) {
    const lead = custom.split(/[.!?]/)[0]?.toLowerCase().replace(/\s+/g, " ").trim();
    if (lead && lead.length >= 12 && value.includes(lead)) return "configured_instruction";
  }
  return null;
}

/**
 * Deterministic live-call route derivation from structured, role-tagged FINAL
 * turns. Pure over the turn list, so repeated/duplicated webhook deliveries of
 * the same conversation produce the identical state (idempotent by
 * construction), and out-of-order partials must simply not be passed in.
 */
export function deriveLiveAfterHoursCallState(params: {
  turns: AfterHoursCallTurn[];
  policy: AfterHoursPolicy;
  businessHoursState: BusinessHoursStateKind;
}): Omit<AfterHoursLiveCallState, "staffNotificationStatus" | "updatedAt"> {
  const screeningEnabled = policyScreensForEmergencies(params.policy);
  const turns = params.turns.filter(
    (turn) => (turn.role === "assistant" || turn.role === "user") && turn.content.trim().length > 0
  );

  // While the business is OPEN the after-hours machine never engages.
  if (params.businessHoursState === "OPEN" || !params.policy.enabled) {
    return {
      businessHoursState: params.businessHoursState,
      route: "STANDARD_BOOKING",
      emergencyInstructionStatus: "NOT_REQUIRED",
      redFlags: [],
      policyVersion: AFTER_HOURS_POLICY_VERSION
    };
  }

  const lastUserIndex = (() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      if (turns[index]!.role === "user") return index;
    }
    return -1;
  })();

  let route: AfterHoursLiveRoute;
  let redFlags: string[] = [];
  let redFlagQuestionAsked = false;

  if (lastUserIndex === -1) {
    // Only assistant speech so far (greeting). Screening starts at the
    // emergency question; nothing is bookable yet.
    route = screeningEnabled ? "EMERGENCY_QUESTION_ASKED" : "STANDARD_BOOKING";
  } else {
    const derived = deriveAfterHoursState({
      history: turns.slice(0, lastUserIndex),
      message: turns[lastUserIndex]!.content,
      screeningEnabled
    });
    redFlags = [...derived.redFlags];
    redFlagQuestionAsked = derived.redFlagQuestionAsked;
    route = derived.route === "NON_EMERGENCY" ? "STANDARD_BOOKING" : derived.route;

    // Trailing assistant turns after the caller's last answer: an unanswered
    // screening question moves the route to its *_ASKED form so tool gating
    // waits for the answer instead of acting on a stale earlier reply.
    for (let index = lastUserIndex + 1; index < turns.length; index += 1) {
      const trailing = turns[index]!;
      if (trailing.role !== "assistant") continue;
      if (route === "RED_FLAG_DETECTED") break;
      if (asksRedFlagQuestion(trailing.content)) {
        route = "RED_FLAG_CHECK_ASKED";
      } else if (asksEmergencyQuestion(trailing.content) && route === "NOT_STARTED") {
        route = "EMERGENCY_QUESTION_ASKED";
      }
    }
  }

  // Emergency instruction: REQUIRED once a red flag is present; GIVEN only
  // when an ASSISTANT turn at/after the first red-flag signal spoke the
  // direction. Caller turns are never consulted.
  let emergencyInstructionStatus: EmergencyInstructionStatus = "NOT_REQUIRED";
  if (route === "RED_FLAG_DETECTED") {
    emergencyInstructionStatus = "REQUIRED";
    const firstFlagIndex = turns.findIndex(
      (turn) =>
        turn.role === "user" &&
        (detectRedFlags(turn.content).length > 0 || isAffirmativeReply(turn.content))
    );
    for (let index = Math.max(firstFlagIndex, 0); index < turns.length; index += 1) {
      const turn = turns[index]!;
      if (turn.role !== "assistant") continue;
      if (containsEmergencyDirection(turn.content, params.policy)) {
        emergencyInstructionStatus = "GIVEN";
        break;
      }
    }
  }

  return {
    businessHoursState: params.businessHoursState,
    route,
    emergencyInstructionStatus,
    redFlags,
    policyVersion: AFTER_HOURS_POLICY_VERSION
  };
}

/* ------------------------- live server-side tool gate ---------------------- */

export const AFTER_HOURS_GATE_CODES = {
  screeningRequired: "AFTER_HOURS_EMERGENCY_SCREENING_REQUIRED",
  redFlagResponseRequired: "AFTER_HOURS_RED_FLAG_RESPONSE_REQUIRED",
  emergencyInstructionRequired: "AFTER_HOURS_EMERGENCY_INSTRUCTION_REQUIRED",
  bookingBlocked: "AFTER_HOURS_BOOKING_BLOCKED",
  humanReviewRequired: "AFTER_HOURS_HUMAN_REVIEW_REQUIRED",
  stateStoreUnavailable: "AFTER_HOURS_STATE_STORE_UNAVAILABLE"
} as const;

export type AfterHoursGatedAction =
  | "check_availability"
  | "book_appointment"
  | "customer_sms"
  | "customer_email"
  | "urgent_callback"
  | "staff_alert";

export type AfterHoursGateResult =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

export function evaluateAfterHoursToolGate(params: {
  route: AfterHoursLiveRoute;
  emergencyInstructionStatus: EmergencyInstructionStatus;
  action: AfterHoursGatedAction;
}): AfterHoursGateResult {
  const { route, emergencyInstructionStatus, action } = params;

  if (action === "staff_alert") return { allowed: true };

  switch (route) {
    case "STANDARD_BOOKING":
      return { allowed: true };

    case "URGENT_DENTAL":
      return { allowed: true };

    case "NOT_STARTED":
    case "EMERGENCY_QUESTION_ASKED":
    case "POSSIBLE_EMERGENCY":
      return {
        allowed: false,
        code: AFTER_HOURS_GATE_CODES.screeningRequired,
        message:
          route === "POSSIBLE_EMERGENCY"
            ? `Emergency screening is not finished. Ask the warning-sign question first, exactly: "${AFTER_HOURS_RED_FLAG_QUESTION}" Do not book or send anything until it is answered.`
            : "Emergency screening has not been completed. Ask whether this is an emergency or an appointment request, and act only on the caller's answer to that question."
      };

    case "RED_FLAG_CHECK_ASKED":
      return {
        allowed: false,
        code: AFTER_HOURS_GATE_CODES.redFlagResponseRequired,
        message:
          "The warning-sign question has been asked but not answered. Wait for the caller's answer before booking or sending anything."
      };

    case "RED_FLAG_DETECTED":
      if (emergencyInstructionStatus !== "GIVEN") {
        return {
          allowed: false,
          code: AFTER_HOURS_GATE_CODES.emergencyInstructionRequired,
          message:
            "A life-threatening warning sign was reported. FIRST tell the caller to call 911 now or go to the nearest emergency department — before any other action. Then you may collect their name and callback number and offer to notify the team; notifying the team never replaces calling 911."
        };
      }
      if (action === "urgent_callback") return { allowed: true };
      return {
        allowed: false,
        code: AFTER_HOURS_GATE_CODES.bookingBlocked,
        message:
          "This caller was directed to emergency care. Ordinary booking and customer notifications stay blocked; only essential follow-up details and the internal team alert are appropriate."
      };

    case "HUMAN_REVIEW":
      if (action === "urgent_callback") return { allowed: true };
      return {
        allowed: false,
        code: AFTER_HOURS_GATE_CODES.humanReviewRequired,
        message:
          "The emergency status is still unclear. Collect only the caller's name and callback number for team review; do not book and do not send customer notifications."
      };

    default:
      return { allowed: true };
  }
}

/* ------------------------- internal staff alert text ----------------------- */

/** Minimum-information urgent alert — no symptoms, no transcript, no diagnosis. */
export function buildUrgentStaffAlert(params: {
  businessName: string;
  callerName?: string | null;
  callbackNumber?: string | null;
  callId?: string | null;
  includeCallback: boolean;
}): string {
  const lines = [`URGENT after-hours call for ${params.businessName}.`];
  if (params.callerName?.trim()) lines.push(`Caller: ${params.callerName.trim()}.`);
  if (params.includeCallback && params.callbackNumber?.trim()) {
    lines.push(`Callback: ${params.callbackNumber.trim()}.`);
  }
  if (params.callId?.trim()) lines.push(`Reference: ${params.callId.trim()}.`);
  lines.push("Please review and follow up as soon as possible.");
  return lines.join("\n");
}

/** Red-flag alert — states only that the emergency direction was given. */
export function buildRedFlagStaffAlert(params: {
  businessName: string;
  callerName?: string | null;
  callbackNumber?: string | null;
  callId?: string | null;
  includeCallback: boolean;
}): string {
  const lines = [
    `EMERGENCY after-hours call for ${params.businessName}.`,
    "The caller was instructed to call 911 or go to the nearest emergency department."
  ];
  if (params.callerName?.trim()) lines.push(`Caller: ${params.callerName.trim()}.`);
  if (params.includeCallback && params.callbackNumber?.trim()) {
    lines.push(`Callback: ${params.callbackNumber.trim()}.`);
  }
  if (params.callId?.trim()) lines.push(`Reference: ${params.callId.trim()}.`);
  lines.push("Please review.");
  return lines.join("\n");
}
