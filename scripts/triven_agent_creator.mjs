#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const API_BASE = (
  process.env.TRIVEN_API_BASE || "https://triven.ai/api"
).replace(/\/$/, "");

const APP_BASE = (
  process.env.TRIVEN_APP_BASE || "https://triven.ai"
).replace(/\/$/, "");
const TOKEN = (process.env.TRIVEN_ARCHITECT_TOKEN || "").trim();
const UPDATE_EXISTING = /^(1|true|yes)$/i.test(process.env.UPDATE_EXISTING || "");
const SUBMIT_REVIEW = /^(1|true|yes)$/i.test(process.env.SUBMIT_REVIEW || "");
const CONFIRM_TESTED = /^(1|true|yes)$/i.test(process.env.CONFIRM_TESTED || "");
const ONLY_INDUSTRY = (process.env.ONLY_INDUSTRY || "").trim().toLowerCase();
const ONLY_SUBINDUSTRY = (process.env.ONLY_SUBINDUSTRY || "").trim().toLowerCase();
const PRICE = 199;
const PRICING_MODEL = "one_time";
const FREE_TRIAL_DAYS = 7;
const MAX_ICON_BYTES = 1024 * 1024;
const DRY_RUN = process.argv.includes("--dry-run");

if (!DRY_RUN && !TOKEN) {
  console.error("Missing TRIVEN_ARCHITECT_TOKEN. Log in as Architect and export the token before running this script.");
  process.exit(1);
}
if (SUBMIT_REVIEW && !CONFIRM_TESTED) {
  console.error("SUBMIT_REVIEW=1 requires CONFIRM_TESTED=1. Only enable this after each agent has been tested with at least 3 real scenarios.");
  process.exit(1);
}

const AGENTS = [
  // Healthcare (18)
  { industry: "Healthcare", subindustry: "Dental Clinics", name: "Dental AI Receptionist", bookingLabel: "Dental appointment", purpose: "Handle patient calls, answer administrative FAQs, check availability, and book or reschedule dental appointments.", intake: ["appointment reason", "new or existing patient", "preferred date and time"], templateType: "AI Receptionist" },
  { industry: "Healthcare", subindustry: "Medical Clinics", name: "Medical AI Receptionist", bookingLabel: "Medical appointment", purpose: "Handle administrative patient calls, clinic FAQs, provider availability, and appointment scheduling.", intake: ["visit reason", "new or existing patient", "preferred date and time"], templateType: "AI Receptionist" },
  { industry: "Healthcare", subindustry: "Hospitals", name: "Hospital AI Receptionist", bookingLabel: "Hospital appointment", purpose: "Handle non-emergency hospital inquiries, department information, scheduling, and administrative routing.", intake: ["department or service needed", "patient name", "preferred date and time"], templateType: "AI Receptionist", sensitive: true },
  { industry: "Healthcare", subindustry: "Veterinary Clinics", name: "Veterinary AI Receptionist", bookingLabel: "Veterinary appointment", purpose: "Handle pet-owner calls, appointment scheduling, vaccination and service FAQs, and administrative routing.", intake: ["pet name and type", "visit reason", "preferred date and time"], templateType: "AI Receptionist", veterinary: true },
  { industry: "Healthcare", subindustry: "Eye Clinics", name: "Eye Care AI Receptionist", bookingLabel: "Eye care appointment", purpose: "Handle eye-care inquiries, exam scheduling, provider availability, and administrative FAQs.", intake: ["service or exam needed", "new or existing patient", "preferred date and time"], templateType: "Appointment Booking" },
  { industry: "Healthcare", subindustry: "Orthopedic Clinics", name: "Orthopedic Appointment AI", bookingLabel: "Orthopedic appointment", purpose: "Handle orthopedic appointment requests, administrative intake, provider availability, and scheduling.", intake: ["body area or appointment type", "new or existing patient", "preferred date and time"], templateType: "Appointment Booking" },
  { industry: "Healthcare", subindustry: "Physiotherapy Clinics", name: "Physiotherapy AI Assistant", bookingLabel: "Physiotherapy appointment", purpose: "Handle physiotherapy inquiries, initial consultations, recurring appointment scheduling, and administrative FAQs.", intake: ["therapy or consultation type", "new or existing patient", "preferred date and time"], templateType: "Appointment Booking" },
  { industry: "Healthcare", subindustry: "Mental Health Clinics", name: "Therapy AI Assistant", bookingLabel: "Therapy consultation", purpose: "Handle administrative therapy inquiries, therapist availability, consultation scheduling, and non-clinical FAQs.", intake: ["appointment type", "new or existing client", "preferred date and time"], templateType: "AI Receptionist", sensitive: true, mentalHealth: true },
  { industry: "Healthcare", subindustry: "Diagnostic Labs", name: "Lab Appointment AI", bookingLabel: "Lab appointment", purpose: "Handle diagnostic lab scheduling, test preparation information supplied by the business, hours, and administrative FAQs.", intake: ["test or service requested", "referral or order status if applicable", "preferred date and time"], templateType: "Appointment Booking" },
  { industry: "Healthcare", subindustry: "Cosmetic Surgery Clinics", name: "Cosmetic Surgery Consultation AI", bookingLabel: "Cosmetic surgery consultation", purpose: "Qualify cosmetic procedure interest administratively, answer business-approved FAQs, and book consultations.", intake: ["procedure of interest", "consultation goal", "preferred date and time"], templateType: "Lead Follow-Up" },
  { industry: "Healthcare", subindustry: "Plastic Surgery Clinics", name: "Plastic Surgery AI Receptionist", bookingLabel: "Plastic surgery consultation", purpose: "Handle plastic surgery inquiries, non-clinical procedure FAQs, consultation scheduling, and follow-up routing.", intake: ["procedure of interest", "consultation goal", "preferred date and time"], templateType: "AI Receptionist" },
  { industry: "Healthcare", subindustry: "Chiropractic Clinics", name: "Chiropractic Booking AI", bookingLabel: "Chiropractic appointment", purpose: "Handle new-patient inquiries, administrative intake, availability checks, and chiropractic appointment booking.", intake: ["appointment reason", "new or existing patient", "preferred date and time"], templateType: "Appointment Booking" },
  { industry: "Healthcare", subindustry: "Urgent Care Centers", name: "Urgent Care AI Assistant", bookingLabel: "Urgent care visit", purpose: "Handle non-emergency administrative inquiries, hours, availability, and visit scheduling without providing medical triage.", intake: ["administrative reason for visit", "patient name", "preferred arrival or appointment time"], templateType: "AI Receptionist", sensitive: true },
  { industry: "Healthcare", subindustry: "Pediatric Clinics", name: "Pediatric Clinic AI", bookingLabel: "Pediatric appointment", purpose: "Handle parent or guardian calls, pediatric appointment scheduling, provider availability, and administrative FAQs.", intake: ["child appointment type", "new or existing patient", "preferred date and time"], templateType: "AI Receptionist", sensitive: true },
  { industry: "Healthcare", subindustry: "Cardiology Clinics", name: "Cardiology AI Receptionist", bookingLabel: "Cardiology appointment", purpose: "Handle cardiology administrative inquiries, referral and appointment questions, availability, and scheduling.", intake: ["appointment or referral type", "new or existing patient", "preferred date and time"], templateType: "AI Receptionist", sensitive: true },
  { industry: "Healthcare", subindustry: "Dermatology Clinics", name: "Dermatology AI Assistant", bookingLabel: "Dermatology consultation", purpose: "Handle dermatology appointment inquiries, treatment-service FAQs approved by the clinic, and consultation scheduling.", intake: ["appointment or service type", "new or existing patient", "preferred date and time"], templateType: "AI Receptionist" },
  { industry: "Healthcare", subindustry: "ENT Clinics", name: "ENT Appointment AI", bookingLabel: "ENT appointment", purpose: "Handle ENT administrative inquiries, provider availability, appointment types, and scheduling.", intake: ["appointment reason", "new or existing patient", "preferred date and time"], templateType: "Appointment Booking" },
  { industry: "Healthcare", subindustry: "Fertility Clinics", name: "Fertility Consultation AI", bookingLabel: "Fertility consultation", purpose: "Handle fertility-clinic administrative inquiries, consultation scheduling, business-approved FAQs, and follow-up routing.", intake: ["consultation type", "new or existing patient", "preferred date and time"], templateType: "Lead Follow-Up", sensitive: true },

  // Real Estate (2)
  { industry: "Real Estate", subindustry: "Residential Real Estate", name: "Residential Property AI Agent", bookingLabel: "Property viewing or consultation", purpose: "Qualify residential buyer, seller, renter, or investor inquiries and schedule property viewings or agent consultations.", intake: ["buyer, seller, renter, or investor intent", "preferred location and property type", "budget range and timeline"], templateType: "Lead Follow-Up" },
  { industry: "Real Estate", subindustry: "Commercial Real Estate", name: "Commercial Property AI Agent", bookingLabel: "Commercial property consultation", purpose: "Qualify commercial property requirements and schedule broker consultations, property tours, or follow-up meetings.", intake: ["lease, purchase, sale, or investment intent", "property type and location", "budget, size, and timeline"], templateType: "Lead Follow-Up" },

  // Automotive (3)
  { industry: "Automotive", subindustry: "Car Dealerships", name: "Vehicle Sales AI Agent", bookingLabel: "Test drive or sales appointment", purpose: "Handle vehicle inquiries, qualify buyer interest, answer approved dealership FAQs, and schedule test drives or sales appointments.", intake: ["vehicle or model interest", "new or used preference", "purchase timeline and appointment preference"], templateType: "Lead Follow-Up" },
  { industry: "Automotive", subindustry: "Auto Service Centers", name: "Vehicle Service Booking AI", bookingLabel: "Vehicle service appointment", purpose: "Handle vehicle-service calls, collect basic vehicle and service details, check availability, and book service appointments.", intake: ["vehicle year, make, and model", "requested service or reported issue", "preferred date and time"], templateType: "Appointment Booking" },
  { industry: "Automotive", subindustry: "Car Rental Services", name: "Car Rental Reservation AI", bookingLabel: "Car rental reservation consultation", purpose: "Handle rental inquiries, collect reservation requirements, answer approved policies, and schedule or request reservations based on configured availability.", intake: ["pickup and return dates", "pickup location", "vehicle category or requirements"], templateType: "AI Receptionist" },

  // Legal (2)
  { industry: "Legal", subindustry: "Law Firms", name: "Legal Receptionist AI", bookingLabel: "Legal consultation", purpose: "Handle prospective-client intake, identify the legal matter at a high level, collect contact details, and schedule consultations without giving legal advice.", intake: ["legal matter category", "brief non-confidential summary", "preferred consultation date and time"], templateType: "AI Receptionist" },
  { industry: "Legal", subindustry: "Notary Services", name: "Notary Appointment AI", bookingLabel: "Notary appointment", purpose: "Handle notary-service inquiries, collect document and appointment requirements, answer approved FAQs, and schedule notary appointments.", intake: ["document or notary service type", "number of signers if relevant", "preferred date and time"], templateType: "Appointment Booking" }
];

function iconFilename(agentName) {
  return `${agentName.replace(/\s+/g, "_")}.png`;
}

function resolveIconDirectory() {
  const candidates = [
    (process.env.AGENT_ICON_DIR || "").trim(),
    path.resolve(process.cwd(), "triven_25_agent_icons"),
    path.resolve(process.cwd(), "scripts", "triven_25_agent_icons"),
    path.resolve(process.cwd(), "apps", "frontend", "public", "triven_25_agent_icons"),
    path.resolve(process.cwd(), "apps", "frontend", "public", "agent-icons")
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Try the next supported location.
    }
  }

  throw new Error(
    `Agent icon folder not found. Expected the extracted triven_25_agent_icons folder. ` +
    `Set AGENT_ICON_DIR=/absolute/path/to/triven_25_agent_icons if it is stored elsewhere.`
  );
}

function mimeTypeForIcon(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  throw new Error(`Unsupported icon type: ${filePath}`);
}

function loadAgentIconDataUrl(agent, iconDirectory) {
  const expectedBase = agent.name.replace(/\s+/g, "_");
  const extensions = [".png", ".webp", ".jpg", ".jpeg", ".svg"];
  const filePath = extensions
    .map((ext) => path.join(iconDirectory, `${expectedBase}${ext}`))
    .find((candidate) => fs.existsSync(candidate));

  if (!filePath) {
    throw new Error(`Missing icon for ${agent.name}. Expected ${iconFilename(agent.name)} in ${iconDirectory}`);
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) throw new Error(`Icon path is not a file: ${filePath}`);
  if (stats.size <= 0) throw new Error(`Icon file is empty: ${filePath}`);
  if (stats.size >= MAX_ICON_BYTES) {
    throw new Error(
      `Icon for ${agent.name} must be under 1 MB. Current size: ${(stats.size / 1024).toFixed(1)} KB`
    );
  }

  const mime = mimeTypeForIcon(filePath);
  const base64 = fs.readFileSync(filePath).toString("base64");
  return {
    dataUrl: `data:${mime};base64,${base64}`,
    filePath,
    bytes: stats.size
  };
}

function buildTagline(agent) {
  const source = String(agent.purpose || "").replace(/\s+/g, " ").trim();
  if (source.length < 10) throw new Error(`Tagline source is too short for ${agent.name}`);
  if (source.length < 100) return source;

  const clipped = source.slice(0, 96);
  const clean = clipped.replace(/\s+\S*$/, "").trim() || clipped.trim();
  const tagline = `${clean}...`;
  if (tagline.length >= 100) throw new Error(`Generated tagline is not under 100 characters for ${agent.name}`);
  return tagline;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function healthcareSafety(agent) {
  if (agent.industry !== "Healthcare") return "";
  if (agent.veterinary) {
    return `\nSafety boundary:\n- You are an administrative veterinary receptionist, not a veterinarian.\n- Do not diagnose, prescribe, recommend medication doses, or determine medical severity.\n- If the caller describes an animal in immediate danger or a potentially life-threatening emergency, do not delay care with questioning; advise them to contact the clinic's configured emergency line or the nearest emergency veterinary service immediately.`;
  }
  const mental = agent.mentalHealth
    ? "\n- If the caller mentions suicidal thoughts, self-harm, violence, or immediate danger, do not counsel or assess severity; direct them to local emergency services or the business's configured crisis/emergency resource immediately."
    : "";
  return `\nSafety boundary:\n- You are an administrative receptionist, not a clinician.\n- Do not diagnose conditions, provide treatment plans, interpret test results, recommend medications, or perform medical triage.\n- For severe symptoms, immediate danger, or a medical emergency, do not delay emergency care with scheduling questions; direct the caller to local emergency services or the business's configured emergency instructions.${mental}`;
}

function industrySafety(agent) {
  if (agent.industry === "Legal") {
    return `\nSafety boundary:\n- You are an administrative legal receptionist, not a lawyer.\n- Do not provide legal advice, predict case outcomes, establish an attorney-client relationship, or guarantee representation.\n- Collect only the minimum information needed for intake and scheduling; avoid requesting unnecessary sensitive or privileged details.`;
  }
  if (agent.industry === "Real Estate") {
    return `\nSafety boundary:\n- Do not guarantee property availability, valuations, investment returns, financing approval, legal status, or contract terms.\n- Use only business-provided property and policy information. If information is unavailable, say so and arrange human follow-up.`;
  }
  if (agent.industry === "Automotive") {
    return `\nSafety boundary:\n- Do not guarantee inventory, financing approval, repair diagnosis, parts availability, rental availability, or final pricing unless verified by connected business data.\n- If a caller reports an unsafe vehicle condition, do not diagnose it; advise them to follow the business's configured safety/roadside instructions.`;
  }
  return healthcareSafety(agent);
}

function systemPrompt(agent) {
  return `You are ${agent.name}, an AI calling agent for a ${agent.subindustry} business on Triven.ai.

Primary role:
${agent.purpose}

Call behavior:
- Greet the caller professionally and identify the business using the buyer's configured business context.
- Determine the caller's intent before asking detailed questions.
- Answer only from verified buyer business information, services, FAQs, hours, policies, and connected knowledge.
- Never invent prices, availability, staff names, addresses, policies, inventory, or business facts.
- For a booking request, collect the caller's name and callback number plus: ${agent.intake.join("; ")}.
- Ask for the preferred date and time before checking calendar availability.
- Use the calendar availability capability when scheduling is requested.
- Book only after the caller confirms the date/time and required booking details.
- After a successful booking, offer an SMS confirmation when the workflow supports SMS. Follow the platform-required SMS consent disclosure exactly, record affirmative consent before sending, and never claim a text was sent unless the SMS tool confirms success.
- If the caller does not want to book, answer their administrative question and close naturally.
- Keep responses concise, conversational, and suitable for a phone call.
- Escalate or arrange human follow-up when the request is outside the configured knowledge or permissions.${industrySafety(agent)}`.trim();
}

function makeWorkflow(agent) {
  const prefix = slugify(agent.name).slice(0, 24);
  const ids = {
    trigger: `${prefix}-phone`,
    ai: `${prefix}-voice`,
    availability: `${prefix}-availability`,
    book: `${prefix}-book`,
    sms: `${prefix}-sms`,
    end: `${prefix}-end`
  };

  const nodes = [
    {
      id: ids.trigger,
      type: "coreNode",
      position: { x: 80, y: 300 },
      data: {
        type: "trigger.phone_call",
        nodeKind: "trigger",
        label: "Phone Call Trigger",
        title: "Phone Call Trigger",
        subtitle: "Starts when a customer calls the assigned business number.",
        connector: "Twilio",
        callHandlingMode: "AI_ANSWERS",
        answerAfterRings: "1",
        forwardingSchedule: "always"
      }
    },
    {
      id: ids.ai,
      type: "coreNode",
      position: { x: 360, y: 300 },
      data: {
        type: "ai.voice_conversation",
        nodeKind: "ai",
        label: "AI Voice Conversation",
        title: agent.name,
        subtitle: `${agent.subindustry} voice conversation`,
        connector: "Vapi",
        assistantName: agent.name,
        language: "en-US",
        speakingSpeed: "1.0",
        model: "gpt-4o-mini",
        firstMessage: "Thank you for calling {{business.name}}. How can I help you today?",
        fallbackResponse: "I don't have that information available. I can help with another question or arrange follow-up from the team.",
        systemPrompt: systemPrompt(agent),
        customInstructions: ""
      }
    },
    {
      id: ids.availability,
      type: "coreNode",
      position: { x: 640, y: 300 },
      data: {
        type: "calendar.availability",
        nodeKind: "connector",
        label: "Calendar Availability",
        title: "Calendar Availability",
        subtitle: "Check available booking slots.",
        connector: "Google Calendar",
        connectorAction: "check_availability",
        bufferMinutes: "10",
        maxAdvanceDays: "30",
        slotsToOffer: "3"
      }
    },
    {
      id: ids.book,
      type: "coreNode",
      position: { x: 920, y: 300 },
      data: {
        type: "calendar.book_appointment",
        nodeKind: "connector",
        label: "Book Calendar Appointment",
        title: `Book ${agent.bookingLabel}`,
        subtitle: `Create a ${agent.bookingLabel.toLowerCase()} in the connected calendar.`,
        connector: "Google Calendar",
        connectorAction: "book_appointment",
        eventTitleFormat: `[Service] - [Customer Name]`,
        eventDescription: `Phone: [Customer Phone]\nBooked by ${agent.name}\nService: [Service]`,
        reminderEnabled: "true",
        reminderTiming: "120",
        confirmationMessage: `You're all set for your ${agent.bookingLabel.toLowerCase()} on [Date] at [Time].`
      }
    },
    {
      id: ids.sms,
      type: "coreNode",
      position: { x: 1200, y: 300 },
      data: {
        type: "communication.send_sms",
        nodeKind: "connector",
        label: "Send SMS",
        title: "Send SMS Confirmation",
        subtitle: `Send the customer a confirmation after the ${agent.bookingLabel.toLowerCase()} is booked.`,
        connector: "SMS",
        connectorAction: "send_notification",
        sendToCustomer: "true",
        customerTemplate: "Confirmed: [Service] on [Date] at [Time] with [Business Name]. Reply STOP to opt out.",
        sendToTeam: "false",
        teamTemplate: ""
      }
    },
    {
      id: ids.end,
      type: "coreNode",
      position: { x: 1480, y: 300 },
      data: {
        type: "flow.end",
        nodeKind: "output",
        label: "End Flow",
        title: "End Flow",
        subtitle: "Close the call professionally.",
        closingMessage: "Thank you for calling {{business.name}}. Have a great day.",
        afterCallAction: "hangup",
        callRecording: "true"
      }
    }
  ];

  const edges = [
    { id: `${prefix}-e1`, source: ids.trigger, target: ids.ai },
    { id: `${prefix}-e2`, source: ids.ai, target: ids.availability },
    { id: `${prefix}-e3`, source: ids.availability, target: ids.book },
    { id: `${prefix}-e4`, source: ids.book, target: ids.sms },
    { id: `${prefix}-e5`, source: ids.sms, target: ids.end }
  ];

  return { nodes, edges };
}

function commonBuyerSetup(agent) {
  const fields = [
    { key: "businessServices", label: "Services offered", type: "textarea", required: true, placeholder: "List the services this agent may discuss and book.", helper: "Use exact service names customers commonly ask for." },
    { key: "bookingType", label: "Booking type", type: "text", required: true, defaultValue: agent.bookingLabel, helper: "The booking/consultation label the agent should use on calls." },
    { key: "teamMembers", label: agent.industry === "Legal" ? "Attorneys / team members" : agent.industry === "Real Estate" ? "Agents / brokers" : agent.industry === "Automotive" ? "Sales / service team" : "Providers / team members", type: "textarea", required: false, placeholder: "Names, roles, specialties, and routing notes." },
    { key: "bookingRules", label: "Booking rules", type: "textarea", required: true, placeholder: "Lead time, duration, services that can be booked, restrictions, cancellation rules." },
    { key: "escalationRules", label: "Escalation and human follow-up rules", type: "textarea", required: true, placeholder: "When should the AI stop and arrange human follow-up?" },
    { key: "faqNotes", label: "Important FAQs / policies", type: "textarea", required: false, placeholder: "Pricing policy, insurance/payment policy, service area, documents needed, or other approved answers." }
  ];

  if (agent.industry === "Real Estate") {
    fields.push({ key: "serviceArea", label: "Service areas / markets", type: "textarea", required: true, placeholder: "Cities, neighborhoods, regions, property types." });
  }
  if (agent.industry === "Automotive") {
    fields.push({ key: "vehicleScope", label: "Vehicle / service scope", type: "textarea", required: true, placeholder: "Brands, vehicle categories, services, rental classes, or dealership scope." });
  }
  if (agent.industry === "Legal") {
    fields.push({ key: "practiceAreas", label: "Practice areas / notary services", type: "textarea", required: true, placeholder: "List only the matters/services the business accepts." });
  }

  return fields;
}

function configure(agent, workflowJson, iconUrl, complianceChecked = false) {
  const tagline = buildTagline(agent);
  const fullDescription = `${agent.name} is a production-oriented AI voice agent for ${agent.subindustry}. It answers inbound calls, understands the caller's administrative or sales intent, uses the buyer's verified business knowledge to answer approved questions, checks connected Google Calendar availability, books ${agent.bookingLabel.toLowerCase()} when appropriate, and can send a consent-based SMS confirmation after a successful booking. The buyer configures services, business hours, team information, booking rules, escalation rules, and FAQs during setup. The agent is designed to stay within administrative and scheduling boundaries and arrange human follow-up whenever the request is outside its configured permissions.`;

  return {
    version: 1,
    basics: {
      agentName: agent.name,
      tagline,
      category: agent.subindustry,
      industryTags: [agent.industry],
      iconUrl,
      visibility: "public",
      shortDescription: `${agent.name} handles inbound ${agent.subindustry.toLowerCase()} calls, answers approved FAQs, checks availability, and books ${agent.bookingLabel.toLowerCase()}.`
    },
    media: {
      fullDescription,
      includedFeatures: [
        "Inbound phone call answering",
        "Industry-specific AI voice conversation",
        "Business knowledge and FAQ handling",
        "Real-time calendar availability check",
        `Automated ${agent.bookingLabel.toLowerCase()} booking`,
        "Consent-based SMS booking confirmations"
      ],
      screenshotUrls: [],
      demoVideoUrl: ""
    },
    template: {
      templateType: agent.templateType,
      supportedIndustries: [agent.industry],
      requiredBuyerSetup: commonBuyerSetup(agent),
      setupTimeEstimate: "5-10 min",
      requiredIntegrations: {
        phone: true,
        sms: true,
        calendar: true,
        email: false,
        crm: false,
        webhook: false,
        telegram: false,
        vapi: true,
        twilio: true,
        whatsapp: false
      },
      buyerSetupInstructions: `Connect the business phone number, Twilio SMS capability, and Google Calendar, then provide verified ${agent.subindustry} services, team information, business hours, booking rules, escalation rules, and FAQs. Complete any required A2P/10DLC registration and review the SMS consent/confirmation behavior before activation. Review the generated voice prompt before activation.`,
      installInstructions: `Install ${agent.name}, complete buyer setup, connect telephony, SMS, and Google Calendar, assign exactly one phone number to the installed voice agent, verify SMS registration/consent handling, run browser/preview tests, then activate the live agent.`
    },
    pricing: {
      pricingModel: PRICING_MODEL,
      price: PRICE,
      executionFee: 0,
      freeTrialEnabled: true,
      trialDays: FREE_TRIAL_DAYS,
      platformCommissionPercent: 30
    },
    compliance: {
      processesPersonalData: true,
      storesConversationHistory: true,
      connectsThirdPartyServices: true,
      complianceChecks: {
        guidelines: complianceChecked,
        tested: complianceChecked,
        accurate: complianceChecked,
        terms: complianceChecked
      }
    }
  };
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const message = payload?.error || payload?.message || `${response.status} ${response.statusText}`;
    const error = new Error(`${method} ${path}: ${message}`);
    error.code = payload?.code;
    error.status = response.status;
    throw error;
  }
  return payload?.data ?? payload;
}

function matchesFilter(agent) {
  if (ONLY_INDUSTRY && agent.industry.toLowerCase() !== ONLY_INDUSTRY) return false;
  if (ONLY_SUBINDUSTRY && agent.subindustry.toLowerCase() !== ONLY_SUBINDUSTRY) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const selected = AGENTS.filter(matchesFilter);
  const iconDirectory = resolveIconDirectory();
  const iconsByAgent = new Map();

  for (const agent of selected) {
    const icon = loadAgentIconDataUrl(agent, iconDirectory);
    const tagline = buildTagline(agent);
    if (tagline.length >= 100) throw new Error(`Tagline must be under 100 characters for ${agent.name}`);
    iconsByAgent.set(agent.name, icon);
  }

  console.log(`\nTriven.ai - Devansh Sir Agent Templates`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "CREATE/UPDATE DRAFTS"}`);
  console.log(`API: ${API_BASE}`);
  console.log(`Selected: ${selected.length} / ${AGENTS.length}`);
  console.log(`Update existing: ${UPDATE_EXISTING ? "YES" : "NO"}`);
  console.log(`Pricing: $${PRICE} one-time purchase`);
  console.log(`Free trial: ${FREE_TRIAL_DAYS} days`);
  console.log(`Icons: ${iconDirectory}`);
  console.log(`Submit review: ${SUBMIT_REVIEW ? "YES (confirmed tested)" : "NO - drafts only"}\n`);

  for (const [index, agent] of selected.entries()) {
    const icon = iconsByAgent.get(agent.name);
    console.log(
      `${String(index + 1).padStart(2, "0")}. [${agent.industry}] ${agent.subindustry} -> ${agent.name}` +
      ` | tagline ${buildTagline(agent).length} chars | icon ${(icon.bytes / 1024).toFixed(1)} KB`
    );
  }

  if (DRY_RUN) {
    console.log("\nDry run complete. No API calls were made.");
    return;
  }

  const workflowsData = await api("/architect/workflows");
  const existingWorkflows = Array.isArray(workflowsData?.workflows) ? workflowsData.workflows : [];
  const existingByName = new Map(existingWorkflows.map((workflow) => [String(workflow.name || "").trim().toLowerCase(), workflow]));

  const results = [];
  for (const [index, agent] of selected.entries()) {
    const key = agent.name.toLowerCase();
    let workflow = existingByName.get(key);
    const workflowJson = makeWorkflow(agent);
    const icon = iconsByAgent.get(agent.name);
    if (!icon) throw new Error(`Icon preflight missing for ${agent.name}`);
    const draftConfigure = configure(agent, workflowJson, icon.dataUrl, false);

    try {
      if (workflow && !UPDATE_EXISTING) {
        console.log(`\n[${index + 1}/${selected.length}] SKIP ${agent.name} - workflow already exists (${workflow.id})`);
        results.push({ agent, workflowId: workflow.id, action: "skipped" });
        continue;
      }

      if (workflow) {
        console.log(`\n[${index + 1}/${selected.length}] UPDATE ${agent.name}`);
        const updated = await api(`/architect/workflows/${encodeURIComponent(workflow.id)}`, {
          method: "PUT",
          body: {
            name: agent.name,
            description: draftConfigure.basics.shortDescription,
            isTemplate: false,
            workflowJson
          }
        });
        workflow = updated.workflow || workflow;
      } else {
        console.log(`\n[${index + 1}/${selected.length}] CREATE ${agent.name}`);
        const created = await api("/architect/workflows", {
          method: "POST",
          body: {
            name: agent.name,
            description: draftConfigure.basics.shortDescription,
            isTemplate: false,
            workflowJson
          }
        });
        workflow = created.workflow;
        existingByName.set(key, workflow);
      }

      await api(`/architect/workflows/${encodeURIComponent(workflow.id)}/configure/save-draft`, {
        method: "POST",
        body: { configure: draftConfigure }
      });

      let submitted = false;
      if (SUBMIT_REVIEW) {
        const testedConfigure = configure(agent, workflowJson, icon.dataUrl, true);
        await api(`/architect/workflows/${encodeURIComponent(workflow.id)}/submit-review`, {
          method: "POST",
          body: { configure: testedConfigure }
        });
        submitted = true;
      }

      const builderUrl = `${APP_BASE}/architect/workflows/${encodeURIComponent(workflow.id)}/builder?tab=configure`;
      console.log(`  OK: ${submitted ? "submitted for review" : "draft created"}`);
      console.log(`  ${builderUrl}`);
      results.push({ agent, workflowId: workflow.id, action: submitted ? "submitted" : workflow ? "created/updated" : "created", builderUrl });
    } catch (error) {
      console.error(`  FAILED: ${error.message}`);
      results.push({ agent, action: "failed", error: error.message });
    }

    await sleep(150);
  }

  const success = results.filter((r) => r.action !== "failed");
  const failed = results.filter((r) => r.action === "failed");
  console.log(`\nCompleted: ${success.length}/${results.length}`);
  console.log(`Failed: ${failed.length}`);

  if (!SUBMIT_REVIEW) {
    console.log("\nNEXT STEP:");
    console.log("1. Open Architect -> Workflows.");
    console.log("2. Test each agent with at least 3 realistic scenarios.");
    console.log("3. Review Configure, pricing, buyer setup fields, and prompt.");
    console.log("4. Complete the compliance confirmations yourself.");
    console.log("5. Submit each tested agent for review from the Publish tab.");
  }

  if (failed.length) {
    console.log("\nFailures:");
    for (const item of failed) console.log(`- ${item.agent.name}: ${item.error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("\nFatal error:", error?.stack || error);
  process.exit(1);
});
