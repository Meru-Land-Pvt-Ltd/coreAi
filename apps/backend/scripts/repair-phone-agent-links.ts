import { prisma } from "../src/lib/prisma";

async function main() {
  const unlinked = await prisma.businessPhoneNumber.findMany({
    where: { installedAgentId: null },
    orderBy: { createdAt: "asc" }
  });

  if (unlinked.length === 0) {
    console.log("No BusinessPhoneNumber rows need linking.");
    return;
  }

  let linked = 0;
  for (const row of unlinked) {
    const agent = await prisma.installedAgent.findFirst({
      where: { businessId: row.businessId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" }
    });

    if (!agent) {
      console.log(`${row.phoneNumber}: no ACTIVE installed agent for its business — skipped.`);
      continue;
    }

    await prisma.businessPhoneNumber.update({
      where: { id: row.id },
      data: { installedAgentId: agent.id, isActive: true }
    });
    linked += 1;
    console.log(`${row.phoneNumber}: linked to installed agent ${agent.id} ("${agent.name}").`);
  }

  console.log(`Done. Linked ${linked}/${unlinked.length} BusinessPhoneNumber row(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
