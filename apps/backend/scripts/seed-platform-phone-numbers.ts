import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";

const DEMO_NUMBER = "+18173985754";

type NumberEntry = {
  phoneNumber: string;
  provider: string;
  twilioSid?: string;
  country?: string;
  region?: string;
  locality?: string;
  capabilities?: { voice: boolean; sms: boolean; mms: boolean };
  status?: string;
};

function normalizePhone(value: string): string {
  return value.replace(/[^+\d]/g, "").trim();
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1" || value.toLowerCase() === "yes";
}

/** --key=value flags (quoted values already joined by the shell). */
function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1], match[2] ?? "true");
  }
  return flags;
}

/** Minimal CSV parser (no quoted-comma support needed for these columns). */
function parseCsv(filePath: string): NumberEntry[] {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((cell) => cell.trim());
  const col = (row: string[], name: string) => {
    const index = header.indexOf(name);
    return index >= 0 ? (row[index] ?? "").trim().replace(/^"|"$/g, "") : "";
  };

  return lines.slice(1).map((line) => {
    const row = line.split(",");
    return {
      phoneNumber: normalizePhone(col(row, "phoneNumber")),
      provider: col(row, "provider") || "TWILIO",
      twilioSid: col(row, "twilioSid") || undefined,
      country: col(row, "country") || undefined,
      region: col(row, "region") || undefined,
      locality: col(row, "locality") || undefined,
      capabilities: {
        voice: parseBool(col(row, "voice"), true),
        sms: parseBool(col(row, "sms"), false),
        mms: parseBool(col(row, "mms"), false)
      },
      status: col(row, "status") || undefined
    };
  });
}

/** Legacy positional "+1...|PNsid" entries. */
function parseLegacyEntry(raw: string): NumberEntry {
  const [rawNumber, sid] = raw.split("|");
  return {
    phoneNumber: normalizePhone(rawNumber),
    provider: "TWILIO",
    twilioSid: sid?.trim() || undefined
  };
}

async function releaseDemoNumber() {
  await prisma.businessPhoneNumber.deleteMany({ where: { phoneNumber: DEMO_NUMBER } });

  await prisma.platformPhoneNumber.upsert({
    where: { phoneNumber: DEMO_NUMBER },
    update: { provider: "TWILIO", status: "AVAILABLE", businessId: null, assignedAt: null },
    create: { phoneNumber: DEMO_NUMBER, provider: "TWILIO", status: "AVAILABLE" }
  });

  console.log(`${DEMO_NUMBER} released and marked AVAILABLE for local demo.`);
}

async function upsertEntry(entry: NumberEntry) {
  if (!entry.phoneNumber || !entry.phoneNumber.startsWith("+")) {
    console.warn(`Skipping invalid number: "${entry.phoneNumber}" (must be E.164, e.g. +17252202182)`);
    return;
  }

  const provider = entry.provider.toUpperCase() === "TWILIO" ? "TWILIO" : entry.provider.toUpperCase();
  const metadata = {
    provider: provider as never,
    ...(entry.twilioSid ? { twilioSid: entry.twilioSid, providerNumberId: entry.twilioSid } : {}),
    ...(entry.country ? { country: entry.country } : {}),
    ...(entry.region ? { region: entry.region } : {}),
    ...(entry.locality ? { locality: entry.locality } : {}),
    ...(entry.capabilities ? { capabilities: entry.capabilities as never } : {})
  };

  const existing = await prisma.platformPhoneNumber.findUnique({
    where: { phoneNumber: entry.phoneNumber }
  });

  if (existing?.businessId) {
    // ASSIGNED — metadata-only refresh; never touch status/businessId/assignedAt.
    const row = await prisma.platformPhoneNumber.update({
      where: { phoneNumber: entry.phoneNumber },
      data: metadata
    });
    console.log(`${row.phoneNumber} is ASSIGNED to a business — updated metadata only.`);
    return;
  }

  if (existing) {
    const row = await prisma.platformPhoneNumber.update({
      where: { phoneNumber: entry.phoneNumber },
      data: { ...metadata, status: (entry.status as never) ?? "AVAILABLE" }
    });
    console.log(`Updated ${row.phoneNumber} -> ${row.status}`);
    return;
  }

  const row = await prisma.platformPhoneNumber.create({
    data: {
      phoneNumber: entry.phoneNumber,
      ...metadata,
      status: (entry.status as never) ?? "AVAILABLE"
    }
  });
  console.log(`Created ${row.phoneNumber} -> ${row.status}`);
}

async function main() {
  const rawArgs = process.argv
    .slice(2)
    .map((value) => value.trim())
    .filter(Boolean);
  const flags = parseFlags(rawArgs);

  // Explicit, dev-only escape hatch — never un-assign numbers automatically.
  if (flags.has("release-demo")) {
    if (process.env.NODE_ENV === "production") {
      console.error("--release-demo is a local/dev-only flag and refuses to run with NODE_ENV=production.");
      process.exitCode = 1;
      return;
    }
    await releaseDemoNumber();
    return;
  }

  let entries: NumberEntry[] = [];

  const csvFile = flags.get("file");
  if (csvFile) {
    entries = parseCsv(csvFile);
    if (entries.length === 0) {
      console.error(`No rows parsed from ${csvFile}. Expected header: phoneNumber,provider,twilioSid,country,region,locality,voice,sms,mms,status`);
      process.exitCode = 1;
      return;
    }
  } else if (flags.has("number")) {
    entries = [
      {
        phoneNumber: normalizePhone(flags.get("number") ?? ""),
        provider: flags.get("provider") ?? "TWILIO",
        twilioSid: flags.get("sid") || undefined,
        country: flags.get("country") || undefined,
        region: flags.get("region") || undefined,
        locality: flags.get("locality") || undefined,
        capabilities: {
          voice: parseBool(flags.get("voice"), true),
          sms: parseBool(flags.get("sms"), false),
          mms: parseBool(flags.get("mms"), false)
        }
      }
    ];
  } else {
    // Legacy positional entries ("+1...", "+1...|PNsid").
    const positional = rawArgs.filter((arg) => !arg.startsWith("--"));
    if (positional.length === 0) {
      console.log(
        [
          "No numbers given. Usage:",
          "  -- --number=+17252202182 --sid=PN... --country=US --region=NV --locality=\"Las Vegas\" --voice=true --sms=false --mms=false",
          "  -- --file=platform-numbers.csv",
          "  -- +15550100001 +15550100002|PNxxxx   (legacy)"
        ].join("\n")
      );
      return;
    }
    entries = positional.map(parseLegacyEntry);
  }

  for (const entry of entries) {
    await upsertEntry(entry);
  }

  console.log(`Done. ${entries.length} platform number(s) processed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
