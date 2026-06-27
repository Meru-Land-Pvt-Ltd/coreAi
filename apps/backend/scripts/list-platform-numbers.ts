/**
 * List PlatformPhoneNumber inventory (available + assigned) for admin/dev.
 *
 * Usage:
 *   npm run list:numbers --workspace=@coreai/backend
 *
 * Read-only. Does not expose any Twilio auth token.
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const numbers = await prisma.platformPhoneNumber.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      phoneNumber: true,
      twilioSid: true,
      provider: true,
      status: true,
      businessId: true,
      assignedAt: true
    }
  });

  const available = numbers.filter((n) => n.status === "AVAILABLE");
  const assigned = numbers.filter((n) => n.status === "ASSIGNED");

  console.log(`Platform phone numbers: ${numbers.length} total`);
  console.log(`  AVAILABLE: ${available.length}`);
  console.log(`  ASSIGNED:  ${assigned.length}`);
  console.log("");

  for (const n of numbers) {
    const sid = n.twilioSid ? ` sid=${n.twilioSid}` : "";
    const owner = n.businessId ? ` business=${n.businessId}` : "";
    console.log(`  ${n.phoneNumber.padEnd(16)} ${n.status.padEnd(10)}${sid}${owner}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
