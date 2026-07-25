type ExportField = {
  label: string;
  value: string;
};

export type ReadableExportSection = {
  title: string;
  description: string;
  data: unknown;
};

type ReadableDataExportOptions = {
  title: string;
  generatedAt: Date;
  summary: string;
  subject: ExportField[];
  exclusions: string[];
  sections: ReadableExportSection[];
};

const SPECIAL_LABELS: Record<string, string> = {
  id: "ID",
  businessId: "Business ID",
  userId: "User ID",
  ownerId: "Owner ID",
  architectUserId: "Architect user ID",
  installedAgentId: "Installed agent ID",
  workflowId: "Workflow ID",
  listingId: "Listing ID",
  callId: "Call ID",
  fullName: "Full name",
  profilePhotoUrl: "Profile photo URL",
  portfolioUrl: "Portfolio URL",
  githubUrl: "GitHub URL",
  linkedinUrl: "LinkedIn URL",
  twitterHandle: "X / Twitter handle",
  configJson: "Configuration",
  workflowJson: "Workflow details",
  inputJson: "Input details",
  outputJson: "Output details",
  metadataJson: "Metadata",
  contextJson: "Context",
  payloadJson: "Payload",
  amountCents: "Amount",
  priceCents: "Price",
  thresholdCents: "Threshold",
  externalAccountEmail: "Connected account email",
  tokenType: "Connection type",
  accountLast4: "Account ending in",
  routingLast4: "Routing number ending in",
  ipAddress: "IP address"
};

function humanizeLabel(key: string): string {
  const special = SPECIAL_LABELS[key];
  if (special) return special;

  const words = key
    .replace(/Json$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (lower === "id") return "ID";
      if (lower === "url") return "URL";
      if (lower === "sms") return "SMS";
      if (lower === "api") return "API";
      if (lower === "ip") return "IP";
      if (lower === "oauth") return "OAuth";
      if (lower === "utc") return "UTC";
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

function formatDate(value: Date): string {
  if (Number.isNaN(value.getTime())) return "Not available";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).format(value);
}

function formatNumber(key: string | undefined, value: number): string {
  if (key?.toLowerCase().endsWith("cents")) {
    return `${(value / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} (stored in the smallest currency unit)`;
  }

  return value.toLocaleString("en-US");
}

function formatScalar(value: unknown, key?: string): string[] {
  if (value === null || value === undefined || value === "") return ["Not provided"];
  if (value instanceof Date) return [formatDate(value)];
  if (typeof value === "boolean") return [value ? "Yes" : "No"];
  if (typeof value === "number") return [formatNumber(key, value)];
  if (typeof value === "bigint") return [value.toString()];

  const text = String(value).replace(/\r\n?/g, "\n");
  return text.split("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function recordSummary(value: Record<string, unknown>, index: number): string {
  const descriptorKeys = ["name", "title", "displayName", "email", "channel", "status", "id"];

  for (const key of descriptorKeys) {
    const descriptor = value[key];
    if (typeof descriptor === "string" && descriptor.trim()) {
      return `Record ${index + 1} — ${descriptor.trim()}`;
    }
  }

  return `Record ${index + 1}`;
}

function renderValue(value: unknown, indent: number, key?: string): string[] {
  const padding = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${padding}No records found.`];

    if (value.every((item) => !isRecord(item) && !Array.isArray(item))) {
      return value.flatMap((item) => {
        const rendered = formatScalar(item, key);
        return rendered.map((line, lineIndex) => `${padding}${lineIndex === 0 ? "• " : "  "}${line}`);
      });
    }

    return value.flatMap((item, index) => {
      const heading = isRecord(item) ? recordSummary(item, index) : `Record ${index + 1}`;
      return [
        `${padding}${heading}`,
        `${padding}${"-".repeat(Math.max(8, heading.length))}`,
        ...renderValue(item, indent + 2),
        ""
      ];
    });
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return [`${padding}No information available.`];

    return entries.flatMap(([entryKey, entryValue]) => {
      const label = humanizeLabel(entryKey);

      if (Array.isArray(entryValue)) {
        const countLabel = `${entryValue.length} ${entryValue.length === 1 ? "record" : "records"}`;
        return [`${padding}${label} (${countLabel}):`, ...renderValue(entryValue, indent + 2, entryKey)];
      }

      if (isRecord(entryValue)) {
        return [`${padding}${label}:`, ...renderValue(entryValue, indent + 2, entryKey)];
      }

      const rendered = formatScalar(entryValue, entryKey);
      if (rendered.length === 1) return [`${padding}${label}: ${rendered[0]}`];

      return [
        `${padding}${label}:`,
        ...rendered.map((line) => `${" ".repeat(indent + 2)}${line || " "}`)
      ];
    });
  }

  return formatScalar(value, key).map((line) => `${padding}${line}`);
}

function sectionRule(title: string): string {
  return "-".repeat(Math.max(24, title.length));
}

/**
 * Converts exported records into a plain-language UTF-8 document. The result
 * deliberately avoids JSON syntax so it can be opened and read in any text
 * editor without technical knowledge.
 */
export function buildReadableDataExport(options: ReadableDataExportOptions): string {
  const title = options.title.toUpperCase();
  const lines = [
    title,
    "=".repeat(title.length),
    "",
    "ABOUT THIS DOCUMENT",
    sectionRule("ABOUT THIS DOCUMENT"),
    options.summary,
    "",
    `Generated: ${formatDate(options.generatedAt)}`,
    ...options.subject.map((field) => `${field.label}: ${field.value || "Not provided"}`),
    "",
    "HOW TO READ THIS FILE",
    sectionRule("HOW TO READ THIS FILE"),
    "Information is grouped into named sections. “Not provided” means no value was saved,",
    "and “No records found” means there are no entries in that category.",
    "",
    "CONTENTS",
    sectionRule("CONTENTS"),
    ...options.sections.map((section, index) => `${index + 1}. ${section.title}`),
    "",
    "SECURITY AND PRIVACY",
    sectionRule("SECURITY AND PRIVACY"),
    "For your protection, this document does not include:",
    ...options.exclusions.map((item) => `• ${item}`),
    ""
  ];

  options.sections.forEach((section, index) => {
    const heading = `${index + 1}. ${section.title.toUpperCase()}`;
    lines.push(
      heading,
      sectionRule(heading),
      section.description,
      "",
      ...renderValue(section.data, 0),
      "",
      ""
    );
  });

  lines.push(
    "END OF EXPORT",
    sectionRule("END OF EXPORT"),
    "This is the complete readable data export generated for the account and scope shown above.",
    ""
  );

  return `\uFEFF${lines.join("\n")}`;
}
