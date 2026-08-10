import { resolveBrowseIndustry } from "@coreai/shared";

export type AgentDemoProfile = {
  industry: string;
  subindustry: string;
  businessNameLabel: string;
  businessNamePlaceholder: string;
  contactNameLabel: string;
  contactNamePlaceholder: string;
  addressLabel: string;
  addressPlaceholder: string;
  servicesLabel: string;
  servicesPlaceholder: string;
};

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function getAgentDemoProfile(params: {
  listingName?: string | null;
  industry?: string | null;
  subindustry?: string | null;
}): AgentDemoProfile {
  const subindustry = clean(params.subindustry);
  const explicitIndustry = clean(params.industry);
  const resolvedIndustry =
    resolveBrowseIndustry(explicitIndustry) ??
    resolveBrowseIndustry(subindustry) ??
    (explicitIndustry || "Business");

  if (resolvedIndustry === "Legal") {
    const notary = /notary/i.test(subindustry || params.listingName || "");
    return {
      industry: "Legal",
      subindustry: subindustry || (notary ? "Notary Services" : "Law Firms"),
      businessNameLabel: notary ? "Notary Business Name" : "Law Firm Name",
      businessNamePlaceholder: notary ? "e.g. Citywide Notary Services" : "e.g. Morgan & Lee Law",
      contactNameLabel: notary ? "Notary / Team Contact" : "Attorney / Team Contact",
      contactNamePlaceholder: notary ? "e.g. Jamie Lee" : "e.g. Alex Morgan, Esq.",
      addressLabel: "Office / Service Area",
      addressPlaceholder: "e.g. Downtown Austin, TX",
      servicesLabel: notary ? "Notary Services" : "Practice Areas / Services",
      servicesPlaceholder: notary
        ? "e.g. Acknowledgments, jurats, document witnessing"
        : "e.g. Family law, estate planning, business consultations"
    };
  }

  if (resolvedIndustry === "Real Estate") {
    const commercial = /commercial/i.test(subindustry || params.listingName || "");
    return {
      industry: "Real Estate",
      subindustry: subindustry || (commercial ? "Commercial Real Estate" : "Residential Real Estate"),
      businessNameLabel: "Agency / Brokerage Name",
      businessNamePlaceholder: commercial ? "e.g. Summit Commercial Realty" : "e.g. Oak & Stone Realty",
      contactNameLabel: "Agent / Broker Contact",
      contactNamePlaceholder: "e.g. Jordan Taylor",
      addressLabel: "Market / Service Area",
      addressPlaceholder: "e.g. Miami, FL and nearby neighborhoods",
      servicesLabel: commercial ? "Commercial Property Services" : "Property Services",
      servicesPlaceholder: commercial
        ? "e.g. Office leasing, retail space, industrial properties"
        : "e.g. Home buying, selling, rentals, property viewings"
    };
  }

  if (resolvedIndustry === "Automotive") {
    const rental = /rental/i.test(subindustry || params.listingName || "");
    const service = /service/i.test(subindustry || params.listingName || "");
    return {
      industry: "Automotive",
      subindustry: subindustry || (rental ? "Car Rental Services" : service ? "Auto Service Centers" : "Car Dealerships"),
      businessNameLabel: rental
        ? "Rental Company Name"
        : service
          ? "Service Center Name"
          : "Dealership Name",
      businessNamePlaceholder: rental
        ? "e.g. MetroDrive Rentals"
        : service
          ? "e.g. Precision Auto Care"
          : "e.g. Horizon Motors",
      contactNameLabel: rental
        ? "Rental Team Contact"
        : service
          ? "Service Advisor / Team Contact"
          : "Sales / Team Contact",
      contactNamePlaceholder: service ? "e.g. Chris Patel" : "e.g. Taylor Reed",
      addressLabel: "Location / Service Area",
      addressPlaceholder: "e.g. 1200 Market St, Dallas, TX",
      servicesLabel: rental ? "Rental Options / Policies" : service ? "Vehicle Services" : "Vehicle / Sales Scope",
      servicesPlaceholder: rental
        ? "e.g. Economy, SUV, airport pickup, weekly rentals"
        : service
          ? "e.g. Oil changes, brakes, diagnostics, tire service"
          : "e.g. New & used vehicles, SUVs, test drives, trade-ins"
    };
  }

  if (resolvedIndustry === "Healthcare") {
    const context = subindustry || params.listingName || "";
    const veterinary = /veterinary|vet/i.test(context);
    const hospital = /hospital/i.test(context);
    const lab = /lab|diagnostic/i.test(context);
    const therapy = /mental health|therapy/i.test(context);
    const dental = /dental/i.test(context);
    const physio = /physiotherapy/i.test(context);
    const fertility = /fertility/i.test(context);
    const urgentCare = /urgent care/i.test(context);
    const singularBusinessType = (subindustry || "Healthcare Practice")
      .replace(/Clinics$/i, "Clinic")
      .replace(/Centers$/i, "Center")
      .replace(/Labs$/i, "Lab");

    return {
      industry: "Healthcare",
      subindustry: subindustry || "Healthcare",
      businessNameLabel: `${singularBusinessType} Name`,
      businessNamePlaceholder: veterinary
        ? "e.g. Greenfield Veterinary Clinic"
        : hospital
          ? "e.g. City General Hospital"
          : lab
            ? "e.g. Precision Diagnostics"
            : urgentCare
              ? "e.g. RapidCare Urgent Care"
              : "e.g. Apex Health Clinic",
      contactNameLabel: veterinary
        ? "Veterinarian / Team Contact"
        : therapy
          ? "Therapist / Team Contact"
          : dental
            ? "Dentist / Team Contact"
            : physio
              ? "Physiotherapist / Team Contact"
              : fertility
                ? "Fertility Specialist / Team Contact"
                : "Provider / Team Contact",
      contactNamePlaceholder: veterinary ? "e.g. Dr. Maya Singh" : "e.g. Dr. Sarah Jenkins",
      addressLabel: "Location / Address",
      addressPlaceholder: "e.g. 742 Evergreen Terrace, Springfield",
      servicesLabel: veterinary
        ? "Veterinary Services"
        : lab
          ? "Tests / Diagnostic Services"
          : "Services / Appointment Types",
      servicesPlaceholder: veterinary
        ? "e.g. Wellness exams, vaccinations, dental care"
        : lab
          ? "e.g. Blood tests, imaging, health packages"
          : dental
            ? "e.g. Cleanings, exams, consultations, emergency visits"
            : "e.g. Consultations, follow-ups, preventive care"
    };
  }

  return {
    industry: resolvedIndustry,
    subindustry: subindustry || resolvedIndustry,
    businessNameLabel: "Business Name",
    businessNamePlaceholder: "e.g. Acme Services",
    contactNameLabel: "Primary Team Contact",
    contactNamePlaceholder: "e.g. Alex Morgan",
    addressLabel: "Location / Service Area",
    addressPlaceholder: "e.g. Austin, TX",
    servicesLabel: "Key Services",
    servicesPlaceholder: "e.g. List the main services customers ask about"
  };
}
