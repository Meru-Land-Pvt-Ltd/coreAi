export type CanonicalAgentExecutionUsage = {
    agentId: string | null;
    installedAgentId?: string | null;
    executionCount?: number | null;
    callCount?: number | null;
    billedCostMicroUsd?: number | null;
    billedCostUsd?: number | null;
};

export type CanonicalExecutionUsage = {
    totalExecutions?: number | null;
    totalCalls?: number | null;
    agentRollup: CanonicalAgentExecutionUsage[];
};

export function billingMonthKey(offset: number, now = new Date()) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    return month.toISOString().slice(0, 7);
}

export function canonicalTotalExecutionCount(
    usage: CanonicalExecutionUsage
) {
    return usage.totalExecutions ?? usage.totalCalls ?? 0;
}

export function canonicalAgentExecutionCount(
    usage: CanonicalAgentExecutionUsage
) {
    return usage.executionCount ?? usage.callCount ?? 0;
}

export function canonicalAgentBilledCostMicroUsd(
    usage: CanonicalAgentExecutionUsage
) {
    if (
        typeof usage.billedCostMicroUsd === "number" &&
        Number.isFinite(usage.billedCostMicroUsd)
    ) {
        return Math.round(usage.billedCostMicroUsd);
    }

    if (
        typeof usage.billedCostUsd === "number" &&
        Number.isFinite(usage.billedCostUsd)
    ) {
        return Math.round(usage.billedCostUsd * 1_000_000);
    }

    return 0;
}

export function findCanonicalAgentUsage(
    usage: CanonicalExecutionUsage,
    installedAgentId: string | null | undefined
) {
    if (!installedAgentId) return null;

    return (
        usage.agentRollup.find(
            (agent) =>
                agent.installedAgentId === installedAgentId ||
                (!agent.installedAgentId && agent.agentId === installedAgentId)
        ) ?? null
    );
}
