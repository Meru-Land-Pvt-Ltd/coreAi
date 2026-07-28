/**
 * Read-only administrator verification of the LIVE pricing configuration.
 *
 * Reads the SAME database/service layer that backs
 * GET /admin/pricing/services?includeInactive=true (listUsageServicePricing —
 * no HTTP round-trip to the public URL), then verifies that the configured
 * records support the current pipeline-to-service mappings. Rates are printed
 * dynamically and are NEVER validated against hardcoded amounts — this script
 * checks existence, unit compatibility, and mapping compatibility only.
 *
 * No records are modified. Vendor actual costs are masked unless
 * --show-actual-costs is passed (they are internal margin data).
 *
 * Usage:
 *   npx tsx scripts/verify-pricing-services.ts [--show-actual-costs]
 *
 * Exit code 0 = configuration verified; 1 = problems found.
 */
import { prisma } from "../src/lib/prisma";
import { listUsageServicePricing } from "../src/modules/admin/usage-pricing-service";
import { USAGE_SERVICE_CODES } from "../src/lib/usage-service-resolver";
import { PHONE_NUMBER_FEE_ENABLED } from "../src/modules/business/phone-provisioning";

const SHOW_ACTUAL = process.argv.includes("--show-actual-costs");

/** Expected service ids and their expected billing units. Existence + unit
 * compatibility only — rates stay dynamic. */
const EXPECTED_SERVICES: Array<{ code: string; unit: string }> = [
  { code: USAGE_SERVICE_CODES.TWILIO_VOICE, unit: "PER_MINUTE" },
  { code: USAGE_SERVICE_CODES.DEEPGRAM_NOVA3, unit: "PER_MINUTE" },
  { code: USAGE_SERVICE_CODES.OPENAI_GPT4O_MINI, unit: "PER_MINUTE" },
  { code: USAGE_SERVICE_CODES.ELEVENLABS_FLASH_V25, unit: "PER_MINUTE" },
  { code: USAGE_SERVICE_CODES.SMS_CONFIRMATION, unit: "PER_SMS" },
  { code: PHONE_NUMBER_SERVICE_CODE, unit: "PER_UNIT" },
  { code: USAGE_SERVICE_CODES.DATABASE_STORAGE, unit: "PER_MINUTE" },
  { code: USAGE_SERVICE_CODES.GOOGLE_CALENDAR, unit: "PER_MINUTE" }
];

function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

async function main() {
  const problems: string[] = [];
  const records = await listUsageServicePricing({ includeInactive: true });

  const active = records.filter((record) => record.active);
  const inactive = records.filter((record) => !record.active);

  console.log("=== Platform usage pricing verification (read-only) ===");
  console.log(`Records: ${records.length} total — ${active.length} active, ${inactive.length} inactive`);
  console.log("");

  console.log("--- Services ---");
  for (const record of records) {
    const actual = SHOW_ACTUAL ? usd(record.actualCostMicroUsd) : "(masked)";
    console.log(
      `${record.active ? "ACTIVE  " : "INACTIVE"}  ${record.serviceId.padEnd(24)} ${record.unit.padEnd(11)} billing=${usd(record.billingCostMicroUsd)}  actual=${actual}  version=${record.pricingVersion}`
    );
  }
  console.log("");

  // Grouped totals (billing rates, active only).
  const groups = new Map<string, number>();
  for (const record of active) {
    groups.set(record.unit, (groups.get(record.unit) ?? 0) + record.billingCostMicroUsd);
  }
  console.log("--- Grouped billing totals (active) ---");
  for (const [unit, total] of groups) {
    console.log(`${unit.padEnd(11)} ${usd(total)}${unit === "PER_MINUTE" ? " per combined minute" : ""}`);
  }
  console.log("");

  // Duplicate / ambiguous codes.
  const byCode = new Map<string, number>();
  for (const record of records) {
    byCode.set(record.serviceId, (byCode.get(record.serviceId) ?? 0) + 1);
  }
  for (const [code, count] of byCode) {
    if (count > 1) problems.push(`DUPLICATE: service code "${code}" appears ${count} times`);
  }

  // Required mappings: existence + unit compatibility. Rates remain dynamic.
  const activeByCode = new Map(active.map((record) => [record.serviceId, record]));
  for (const expected of EXPECTED_SERVICES) {
    const record = activeByCode.get(expected.code);
    if (!record) {
      const inactiveMatch = records.find((item) => item.serviceId === expected.code);
      problems.push(
        inactiveMatch
          ? `INACTIVE: required service "${expected.code}" exists but is not active`
          : `MISSING: required service "${expected.code}" is not configured`
      );
      continue;
    }
    if (record.unit !== expected.unit) {
      problems.push(
        `UNIT_MISMATCH: "${expected.code}" is ${record.unit}, pipeline mapping expects ${expected.unit}`
      );
    }
  }

  // Phone-number billing honesty check.
  console.log("--- Phone-number billing ---");
  console.log(
    `Flag PHONE_NUMBER_FEE_ENABLED=${PHONE_NUMBER_FEE_ENABLED} — ` +
      (PHONE_NUMBER_FEE_ENABLED
        ? "billing ACTIVE monthly from the assigned number's Twilio current_price (round USD + $1); Admin Pricing is not used"
        : 'billing DISABLED (buyers see "Phone-number billing is currently not enabled.")')
  );
  console.log("");

  if (problems.length === 0) {
    console.log("RESULT: OK — all required services exist, are active, and are unit-compatible with the pipeline mappings.");
  } else {
    console.log(`RESULT: ${problems.length} problem(s) found:`);
    for (const problem of problems) console.log(`  - ${problem}`);
  }

  await prisma.$disconnect();
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("verify-pricing-services failed:", error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
