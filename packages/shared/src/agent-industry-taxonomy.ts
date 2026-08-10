/**
 * Triven's initial cross-industry voice-agent taxonomy.
 *
 * Architects still create the actual workflows/agents themselves. This file is
 * only the canonical Industry -> Subindustry -> suggested agent-name mapping
 * shared by Architect Configure, marketplace filtering, buyer setup, and the
 * backend API/runtime. Keeping it in @coreai/shared prevents frontend/backend
 * taxonomy drift.
 */
export const TRIVEN_AGENT_TAXONOMY = {
  Healthcare: [
    { subindustry: "Dental Clinics", agentName: "Dental AI Receptionist" },
    { subindustry: "Medical Clinics", agentName: "Medical AI Receptionist" },
    { subindustry: "Hospitals", agentName: "Hospital AI Receptionist" },
    { subindustry: "Veterinary Clinics", agentName: "Veterinary AI Receptionist" },
    { subindustry: "Eye Clinics", agentName: "Eye Care AI Receptionist" },
    { subindustry: "Orthopedic Clinics", agentName: "Orthopedic Appointment AI" },
    { subindustry: "Physiotherapy Clinics", agentName: "Physiotherapy AI Assistant" },
    { subindustry: "Mental Health Clinics", agentName: "Therapy AI Assistant" },
    { subindustry: "Diagnostic Labs", agentName: "Lab Appointment AI" },
    { subindustry: "Cosmetic Surgery Clinics", agentName: "Cosmetic Surgery Consultation AI" },
    { subindustry: "Plastic Surgery Clinics", agentName: "Plastic Surgery AI Receptionist" },
    { subindustry: "Chiropractic Clinics", agentName: "Chiropractic Booking AI" },
    { subindustry: "Urgent Care Centers", agentName: "Urgent Care AI Assistant" },
    { subindustry: "Pediatric Clinics", agentName: "Pediatric Clinic AI" },
    { subindustry: "Cardiology Clinics", agentName: "Cardiology AI Receptionist" },
    { subindustry: "Dermatology Clinics", agentName: "Dermatology AI Assistant" },
    { subindustry: "ENT Clinics", agentName: "ENT Appointment AI" },
    { subindustry: "Fertility Clinics", agentName: "Fertility Consultation AI" }
  ],
  "Real Estate": [
    { subindustry: "Residential Real Estate", agentName: "Residential Property AI Agent" },
    { subindustry: "Commercial Real Estate", agentName: "Commercial Property AI Agent" }
  ],
  Automotive: [
    { subindustry: "Car Dealerships", agentName: "Vehicle Sales AI Agent" },
    { subindustry: "Auto Service Centers", agentName: "Vehicle Service Booking AI" },
    { subindustry: "Car Rental Services", agentName: "Car Rental Reservation AI" }
  ],
  Legal: [
    { subindustry: "Law Firms", agentName: "Legal Receptionist AI" },
    { subindustry: "Notary Services", agentName: "Notary Appointment AI" }
  ]
} as const;

export type TrivenTargetIndustry = keyof typeof TRIVEN_AGENT_TAXONOMY;

export type TrivenAgentTaxonomyEntry = {
  industry: TrivenTargetIndustry;
  subindustry: string;
  agentName: string;
};

export const TRIVEN_TARGET_INDUSTRIES = Object.freeze(
  Object.keys(TRIVEN_AGENT_TAXONOMY) as TrivenTargetIndustry[]
);

export const TRIVEN_AGENT_TAXONOMY_ENTRIES: readonly TrivenAgentTaxonomyEntry[] = Object.freeze(
  TRIVEN_TARGET_INDUSTRIES.flatMap((industry) =>
    TRIVEN_AGENT_TAXONOMY[industry].map((entry) => ({ industry, ...entry }))
  )
);

export const TRIVEN_TARGET_SUBINDUSTRIES: readonly string[] = Object.freeze(
  TRIVEN_AGENT_TAXONOMY_ENTRIES.map((entry) => entry.subindustry)
);

const AGENT_NAME_BY_SUBINDUSTRY = new Map(
  TRIVEN_AGENT_TAXONOMY_ENTRIES.map((entry) => [entry.subindustry.toLowerCase(), entry.agentName] as const)
);

const INDUSTRY_BY_SUBINDUSTRY = new Map(
  TRIVEN_AGENT_TAXONOMY_ENTRIES.map((entry) => [entry.subindustry.toLowerCase(), entry.industry] as const)
);

export function isTrivenTargetIndustry(value: string): value is TrivenTargetIndustry {
  return (TRIVEN_TARGET_INDUSTRIES as readonly string[]).includes(value);
}

export function getTrivenSubindustries(industry: string): readonly string[] {
  if (!isTrivenTargetIndustry(industry)) return [];
  return TRIVEN_AGENT_TAXONOMY[industry].map((entry) => entry.subindustry);
}

export function suggestedAgentNameForSubindustry(subindustry: string | null | undefined): string | null {
  const key = String(subindustry ?? "").trim().toLowerCase();
  return key ? AGENT_NAME_BY_SUBINDUSTRY.get(key) ?? null : null;
}

export function targetIndustryForSubindustry(subindustry: string | null | undefined): TrivenTargetIndustry | null {
  const key = String(subindustry ?? "").trim().toLowerCase();
  return key ? INDUSTRY_BY_SUBINDUSTRY.get(key) ?? null : null;
}
