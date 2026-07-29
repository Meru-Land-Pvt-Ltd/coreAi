export type BillingAgentIdentity = {
  id?: string | null;
  installedAgentId?: string | null;
  listingId?: string | null;
};

export type UsageAgentIdentity = {
  agentId?: string | null;
  installedAgentId?: string | null;
  listingId?: string | null;
};

export function billingAgentMatchesUsage(
  agent: BillingAgentIdentity,
  usage: UsageAgentIdentity
) {
  const agentInstalledId = agent.installedAgentId ?? null;
  const usageInstalledId = usage.installedAgentId ?? usage.agentId ?? null;

  if (agentInstalledId || usageInstalledId) {
    return Boolean(
      agentInstalledId &&
        usageInstalledId &&
        agentInstalledId === usageInstalledId
    );
  }

  const agentListingId = agent.listingId ?? agent.id ?? null;
  return Boolean(
    agentListingId &&
      usage.listingId &&
      agentListingId === usage.listingId
  );
}
