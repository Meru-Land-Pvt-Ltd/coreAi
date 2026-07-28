import { describe, expect, it } from "vitest";
import {
    billingMonthKey,
    canonicalAgentBilledCostMicroUsd,
    canonicalAgentExecutionCount,
    canonicalTotalExecutionCount,
    findCanonicalAgentUsage
} from "./canonical-execution-usage";

describe("canonical dashboard execution usage", () => {
    it("uses canonical execution fields before legacy call fields", () => {
        expect(
            canonicalTotalExecutionCount({
                totalExecutions: 17,
                totalCalls: 19,
                agentRollup: []
            })
        ).toBe(17);
        expect(
            canonicalAgentExecutionCount({
                agentId: "agent-1",
                executionCount: 8,
                callCount: 10
            })
        ).toBe(8);
    });

    it("maps usage only by the unique installed-agent id", () => {
        const usage = {
            totalExecutions: 7,
            agentRollup: [
                {
                    agentId: "installed-1",
                    installedAgentId: "installed-1",
                    executionCount: 3
                },
                {
                    agentId: "installed-2",
                    installedAgentId: "installed-2",
                    executionCount: 4
                }
            ]
        };

        expect(findCanonicalAgentUsage(usage, "installed-2")?.executionCount).toBe(4);
        expect(findCanonicalAgentUsage(usage, "listing-2")).toBeNull();
    });

    it("keeps the billed micro-USD value exact and supports the USD fallback", () => {
        expect(
            canonicalAgentBilledCostMicroUsd({
                agentId: "agent-1",
                billedCostMicroUsd: 2_610_000,
                billedCostUsd: 99
            })
        ).toBe(2_610_000);
        expect(
            canonicalAgentBilledCostMicroUsd({
                agentId: "agent-2",
                billedCostUsd: 1.843
            })
        ).toBe(1_843_000);
    });

    it("builds current and previous UTC billing-month keys", () => {
        const now = new Date("2026-01-15T10:00:00.000Z");
        expect(billingMonthKey(0, now)).toBe("2026-01");
        expect(billingMonthKey(-1, now)).toBe("2025-12");
    });
});
