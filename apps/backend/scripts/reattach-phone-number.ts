import { prisma } from "../src/lib/prisma";
import { assignPlatformNumber } from "../src/modules/business/phone-assignment";
import { configureWebhooks } from "../src/modules/admin/twilio-number-service";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const replace = process.argv.includes("--replace");
  const number = arg("number")?.trim();
  const businessIdArg = arg("business")?.trim();
  const agentIdArg = arg("agent")?.trim();

  if (!number) {
    console.error("Usage: --number +1XXXXXXXXXX [--business <id>] [--agent <id>] [--replace] [--apply]");
    process.exitCode = 1;
    return;
  }

  const platform = await prisma.platformPhoneNumber.findFirst({ where: { phoneNumber: number } });
  if (!platform) {
    console.error(`${number}: not in the platform inventory — nothing to re-attach.`);
    process.exitCode = 1;
    return;
  }
  if (platform.isPlatformSmsSender) {
    console.error(`${number}: reserved shared SMS sender — never assignable to a business.`);
    process.exitCode = 1;
    return;
  }

  // Prior mapping tells us who owned it when the release happened.
  const priorMapping = await prisma.businessPhoneNumber.findFirst({
    where: { phoneNumber: number },
    orderBy: { updatedAt: "desc" }
  });
  const businessId = businessIdArg || platform.businessId || priorMapping?.businessId;
  if (!businessId) {
    console.error(`${number}: no previous business mapping found — pass --business <id> explicitly.`);
    process.exitCode = 1;
    return;
  }

  // Never take a number that now belongs to someone else.
  if (platform.businessId && platform.businessId !== businessId) {
    console.error(
      `${number}: currently assigned to a DIFFERENT business (${platform.businessId}) — refusing.`
    );
    process.exitCode = 1;
    return;
  }
  if (platform.status !== "AVAILABLE" && platform.status !== "ASSIGNED") {
    console.error(`${number}: status is ${platform.status} — resolve that before re-attaching.`);
    process.exitCode = 1;
    return;
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, ownerId: true }
  });
  if (!business) {
    console.error(`Business ${businessId} not found.`);
    process.exitCode = 1;
    return;
  }

  const agent = agentIdArg
    ? await prisma.installedAgent.findFirst({
        where: { id: agentIdArg, businessId },
        select: { id: true, name: true, status: true }
      })
    : await prisma.installedAgent.findFirst({
        where: { businessId, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, status: true }
      });
  if (!agent) {
    console.error(`${business.name}: no ACTIVE installed agent to attach the number to.`);
    process.exitCode = 1;
    return;
  }

  // One active number per agent (partial unique index) — surface the conflict
  // instead of letting the constraint throw mid-transaction.
  const agentsExistingNumber = await prisma.businessPhoneNumber.findFirst({
    where: { installedAgentId: agent.id, isActive: true, NOT: { phoneNumber: number } },
    select: { id: true, phoneNumber: true }
  });
  if (agentsExistingNumber && !replace) {
    console.error(
      `${agent.name} already has active number ${agentsExistingNumber.phoneNumber}. ` +
        `Re-run with --replace to release it and attach ${number} instead.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `${apply ? "Re-attaching" : "[dry-run] Would re-attach"} ${number} → ${business.name} / ${agent.name} (${agent.id})`
  );
  console.log(
    `  platform: status=${platform.status} businessId=${platform.businessId ?? "null"} agentId=${platform.installedAgentId ?? "null"}`
  );
  console.log(
    `  mapping:  isActive=${priorMapping?.isActive ?? "-"} agentId=${priorMapping?.installedAgentId ?? "null"} forward="${priorMapping?.forwardToPhone ?? ""}"`
  );
  if (agentsExistingNumber) {
    console.log(`  NOTE: --replace will deactivate ${agentsExistingNumber.phoneNumber} for this agent.`);
  }
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to commit.");
    return;
  }

  const lockKey = `business-number-assignment:${businessId}`;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    // Re-read under the lock: a concurrent purchase may have claimed it.
    const fresh = await tx.platformPhoneNumber.findUnique({ where: { id: platform.id } });
    if (!fresh || (fresh.businessId && fresh.businessId !== businessId)) {
      throw new Error("NUMBER_CLAIMED_CONCURRENTLY");
    }

    if (agentsExistingNumber) {
      await tx.businessPhoneNumber.update({
        where: { id: agentsExistingNumber.id },
        data: { isActive: false, installedAgentId: null }
      });
      await tx.platformPhoneNumber.updateMany({
        where: { phoneNumber: agentsExistingNumber.phoneNumber, businessId },
        data: {
          status: "AVAILABLE",
          businessId: null,
          buyerUserId: null,
          installedAgentId: null,
          assignedAt: null,
          feeBilledAt: null
        }
      });
    }

    await assignPlatformNumber(tx, {
      platform: fresh,
      businessId,
      installedAgentId: agent.id,
      buyerUserId: business.ownerId,
      // Preserve whatever forwarding the buyer had configured.
      ...(priorMapping?.forwardToPhone ? { forwardToPhone: priorMapping.forwardToPhone } : {})
    });
  });

  // Point Twilio's voice/SMS webhooks back at this deployment.
  try {
    await configureWebhooks(platform.id);
    console.log("  webhooks: reconfigured at Twilio.");
  } catch (error) {
    console.error(
      "  WARNING webhook configuration failed — fix in Twilio console or re-run admin sync:",
      error instanceof Error ? error.message : error
    );
  }

  const [afterPlatform, afterMapping] = await Promise.all([
    prisma.platformPhoneNumber.findUnique({ where: { id: platform.id } }),
    prisma.businessPhoneNumber.findFirst({ where: { phoneNumber: number } })
  ]);
  console.log(
    `Done. platform.status=${afterPlatform?.status} businessId=${afterPlatform?.businessId} agentId=${afterPlatform?.installedAgentId}; mapping.isActive=${afterMapping?.isActive} agentId=${afterMapping?.installedAgentId}`
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
