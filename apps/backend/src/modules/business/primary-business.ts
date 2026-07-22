import { prisma } from "../../lib/prisma";

export async function resolvePrimaryBusinessId(ownerId: string): Promise<string | null> {
  const withActiveNumber = await prisma.business.findFirst({
    where: { ownerId, phoneNumbers: { some: { isActive: true } } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (withActiveNumber) return withActiveNumber.id;

  const withAgents = await prisma.business.findMany({
    where: { ownerId, installedAgents: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true, installedAgents: { select: { configJson: true } } }
  });
  const withBuyerAgent = withAgents.find((business) =>
    business.installedAgents.some((agent) => {
      const config =
        agent.configJson && typeof agent.configJson === "object" && !Array.isArray(agent.configJson)
          ? (agent.configJson as Record<string, unknown>)
          : {};
      return config.purpose !== "ARCHITECT_TEST";
    })
  );
  if (withBuyerAgent) return withBuyerAgent.id;

  const newest = await prisma.business.findFirst({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  return newest?.id ?? null;
}
