/**
 * Report-only phone-number reconciliation.
 *
 * Prints every inconsistency between Twilio, PlatformPhoneNumber,
 * BusinessPhoneNumber, and PhoneProvisioningRequest — orphaned purchases,
 * half-assigned numbers, and stuck provisioning requests — WITHOUT mutating
 * anything (no DB writes, no Twilio calls that change state, no releases).
 *
 * Usage:
 *   npx tsx scripts/reconcile-phone-numbers.ts
 */
import { prisma } from "../src/lib/prisma";
import { syncTwilioNumbers } from "../src/modules/admin/twilio-number-service";

type Finding = { category: string; detail: string };

async function main() {
  const findings: Finding[] = [];

  // 1. Twilio ↔ inventory drift (dry run: reports adds/updates it WOULD make).
  try {
    const sync = await syncTwilioNumbers({ dryRun: true });
    for (const number of sync.created) {
      findings.push({ category: "ON_TWILIO_NOT_IN_DB", detail: `${number} exists on Twilio but not in inventory.` });
    }
    for (const number of sync.updated) {
      findings.push({ category: "INVENTORY_OUT_OF_DATE", detail: `${number} would be updated by a sync.` });
    }
    for (const number of sync.missingInTwilio) {
      findings.push({ category: "IN_DB_NOT_ON_TWILIO", detail: `${number} is in inventory but missing on Twilio.` });
    }
  } catch (error) {
    findings.push({
      category: "TWILIO_UNREACHABLE",
      detail: `Could not compare against Twilio: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  // 2. ASSIGNED platform numbers with no active routing row (half-assigned).
  const assigned = await prisma.platformPhoneNumber.findMany({
    where: { status: "ASSIGNED", isPlatformSmsSender: false },
    select: { id: true, phoneNumber: true, businessId: true, installedAgentId: true, webhookStatus: true }
  });
  for (const number of assigned) {
    const routing = await prisma.businessPhoneNumber.findFirst({
      where: { phoneNumber: number.phoneNumber, isActive: true },
      select: { businessId: true }
    });
    if (!routing) {
      findings.push({
        category: "ASSIGNED_WITHOUT_ROUTING",
        detail: `${number.phoneNumber} is ASSIGNED to business ${number.businessId ?? "?"} but has no active BusinessPhoneNumber row.`
      });
    } else if (number.businessId && routing.businessId !== number.businessId) {
      findings.push({
        category: "ASSIGNMENT_MISMATCH",
        detail: `${number.phoneNumber}: platform businessId ${number.businessId} != routing businessId ${routing.businessId}.`
      });
    }
    if (number.webhookStatus !== "CONFIGURED") {
      findings.push({
        category: "WEBHOOKS_NOT_CONFIGURED",
        detail: `${number.phoneNumber} is ASSIGNED but webhookStatus=${number.webhookStatus}.`
      });
    }
  }

  // 3. Active routing rows pointing at numbers missing from inventory.
  const activeRouting = await prisma.businessPhoneNumber.findMany({
    where: { isActive: true, provider: "TWILIO" },
    select: { phoneNumber: true, businessId: true }
  });
  for (const routing of activeRouting) {
    const platform = await prisma.platformPhoneNumber.findFirst({
      where: { OR: [{ phoneNumber: routing.phoneNumber }, { e164: routing.phoneNumber }] },
      select: { status: true }
    });
    if (!platform) {
      findings.push({
        category: "ROUTING_WITHOUT_INVENTORY",
        detail: `Active routing for ${routing.phoneNumber} (business ${routing.businessId}) has no PlatformPhoneNumber row.`
      });
    } else if (platform.status !== "ASSIGNED") {
      findings.push({
        category: "ROUTING_STATUS_MISMATCH",
        detail: `Active routing for ${routing.phoneNumber} but inventory status is ${platform.status}.`
      });
    }
  }

  // 4. Provisioning requests stuck in a non-terminal state (> 1 hour old).
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const stuck = await prisma.phoneProvisioningRequest.findMany({
    where: {
      status: { notIn: ["ACTIVE", "FAILED", "RELEASED"] },
      updatedAt: { lt: oneHourAgo }
    },
    select: { id: true, businessId: true, status: true, selectedPhoneNumber: true, updatedAt: true }
  });
  for (const request of stuck) {
    findings.push({
      category: "STUCK_PROVISIONING_REQUEST",
      detail: `Request ${request.id} (business ${request.businessId}) stuck in ${request.status} since ${request.updatedAt.toISOString()} for ${request.selectedPhoneNumber}.`
    });
  }

  // 5. Purchases that reached Twilio but failed afterwards (money spent).
  const orphanedPurchases = await prisma.phoneProvisioningRequest.findMany({
    where: {
      status: "FAILED",
      errorCode: { in: ["PURCHASE_SAVED_ON_TWILIO_ONLY", "ASSIGNMENT_FAILED", "WEBHOOK_CONFIGURATION_FAILED"] }
    },
    select: { id: true, businessId: true, errorCode: true, selectedPhoneNumber: true, platformPhoneNumberId: true }
  });
  for (const request of orphanedPurchases) {
    findings.push({
      category: "PURCHASED_BUT_INCOMPLETE",
      detail: `Request ${request.id} (business ${request.businessId}): ${request.errorCode} for ${request.selectedPhoneNumber}${request.platformPhoneNumberId ? ` (inventory ${request.platformPhoneNumberId})` : ""}. Do NOT purchase again — recover this number.`
    });
  }

  console.log("=== Phone number reconciliation (REPORT ONLY — no mutations) ===");
  if (findings.length === 0) {
    console.log("No inconsistencies found.");
  } else {
    for (const finding of findings) {
      console.log(`[${finding.category}] ${finding.detail}`);
    }
    console.log(`\n${findings.length} finding(s).`);
  }
}

main()
  .catch((error) => {
    console.error("Reconciliation failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
