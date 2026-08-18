import { prisma } from "../src/lib/prisma";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const off = process.argv.includes("--off");
  const businessId = arg("business")?.trim();

  if (!businessId) {
    console.error("Usage: --business <businessId> [--off] [--apply]");
    process.exitCode = 1;
    return;
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, billingExempt: true }
  });
  if (!business) {
    console.error(`Business ${businessId} not found.`);
    process.exitCode = 1;
    return;
  }

  const suspendedAgents = await prisma.installedAgent.findMany({
    where: { businessId, status: "SUSPENDED_BILLING" },
    select: { id: true, name: true }
  });
  const inactivePhones = await prisma.businessPhoneNumber.findMany({
    where: { businessId, isActive: false },
    select: { id: true, phoneNumber: true, installedAgentId: true, configJson: true }
  });

  console.log(
    `${apply ? "Applying" : "[dry-run]"} billingExempt=${!off} for ${business.name} (${businessId}); currently ${business.billingExempt}`
  );
  if (suspendedAgents.length) {
    console.log(`  suspended agents to reactivate: ${suspendedAgents.map((a) => a.name).join(", ")}`);
  }
  const suspendedPhones = inactivePhones.filter((phone) => {
    const config =
      phone.configJson && typeof phone.configJson === "object" && !Array.isArray(phone.configJson)
        ? (phone.configJson as Record<string, unknown>)
        : {};
    return config.billingSuspended === true;
  });
  if (suspendedPhones.length) {
    console.log(`  billing-suspended numbers to reactivate: ${suspendedPhones.map((p) => p.phoneNumber).join(", ")}`);
  }
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to commit.");
    return;
  }

  await prisma.business.update({
    where: { id: businessId },
    data: { billingExempt: !off }
  });

  if (!off) {
    // Lift any suspension already in place so the exemption takes effect now.
    if (suspendedAgents.length) {
      await prisma.installedAgent.updateMany({
        where: { businessId, status: "SUSPENDED_BILLING" },
        data: { status: "ACTIVE" }
      });
    }
    for (const phone of suspendedPhones) {
      const config =
        phone.configJson && typeof phone.configJson === "object" && !Array.isArray(phone.configJson)
          ? ({ ...(phone.configJson as Record<string, unknown>) })
          : {};
      delete config.billingSuspended;
      delete config.billingSuspensionKinds;
      delete config.billingSuspensionSourceIds;

      // Only re-activate when the agent has no other active number, so the
      // one-active-number-per-agent index is never violated.
      const agentId =
        phone.installedAgentId ??
        (
          await prisma.installedAgent.findMany({
            where: { businessId, status: "ACTIVE" },
            select: { id: true }
          })
        ).map((a) => a.id)[0];
      const conflict = agentId
        ? await prisma.businessPhoneNumber.findFirst({
            where: { installedAgentId: agentId, isActive: true, NOT: { id: phone.id } },
            select: { phoneNumber: true }
          })
        : null;
      if (conflict) {
        console.warn(`  skipped ${phone.phoneNumber}: agent already active on ${conflict.phoneNumber}`);
        continue;
      }

      await prisma.businessPhoneNumber.update({
        where: { id: phone.id },
        data: {
          isActive: true,
          ...(agentId ? { installedAgentId: agentId } : {}),
          configJson: config as object
        }
      });
      console.log(`  reactivated ${phone.phoneNumber}`);
    }
  }

  const after = await prisma.business.findUnique({
    where: { id: businessId },
    select: { billingExempt: true }
  });
  console.log(`Done. billingExempt=${after?.billingExempt}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
