import { describe, expect, it } from "vitest";
import {
  ARCHITECT_TEST_EVENT_PREFIX,
  BUSINESS_TEST_EVENT_PREFIX,
  calendarEventTitleForMode,
  describeZonedTime,
  executionSideEffectPolicy,
  isValidTimeZone,
  resolveExecutionTimezone,
  zonedWallClockToUtc
} from "@coreai/shared";
import { runArchitectConversationTest } from "../architect/workflow-conversation-test";
import { parseSlotStartUtc } from "./provider-adapters";

describe("execution modes", () => {
  it("architect dry run and business test are never billable or production usage", () => {
    for (const mode of ["ARCHITECT_DRY_RUN", "BUSINESS_TEST"] as const) {
      const policy = executionSideEffectPolicy(mode);
      expect(policy.billable).toBe(false);
      expect(policy.countsAsProductionUsage).toBe(false);
      expect(policy.allowCustomerNotifications).toBe(false);
      expect(policy.allowPhoneProvisioning).toBe(false);
    }
  });

  it("live mode keeps production behavior", () => {
    const policy = executionSideEffectPolicy("LIVE");
    expect(policy.billable).toBe(true);
    expect(policy.countsAsProductionUsage).toBe(true);
    expect(policy.calendarEventTitlePrefix).toBe("");
  });

  it("keeps the exact service name and applies test prefixes only in test modes", () => {
    expect(calendarEventTitleForMode("ARCHITECT_DRY_RUN", "Test Appointment")).toBe(
      `${ARCHITECT_TEST_EVENT_PREFIX} Test Appointment`
    );
    expect(calendarEventTitleForMode("BUSINESS_TEST", "Test Appointment")).toBe(
      `${BUSINESS_TEST_EVENT_PREFIX} Test Appointment`
    );
    expect(calendarEventTitleForMode("LIVE", "Test Appointment")).toBe("Test Appointment");
  });
});

describe("timezone resolution", () => {
  it("uses the architect-selected timezone for dry runs", () => {
    const result = resolveExecutionTimezone({
      executionMode: "ARCHITECT_DRY_RUN",
      selectedTestTimezone: "Asia/Kolkata",
      businessTimezone: "America/New_York"
    });
    expect(result).toEqual({ ok: true, timeZone: "Asia/Kolkata", source: "selected" });
  });

  it("uses the business timezone for business tests and live runs", () => {
    for (const executionMode of ["BUSINESS_TEST", "LIVE"] as const) {
      const result = resolveExecutionTimezone({
        executionMode,
        selectedTestTimezone: "Asia/Kolkata",
        businessTimezone: "Europe/London"
      });
      expect(result).toEqual({ ok: true, timeZone: "Europe/London", source: "business" });
    }
  });

  it("blocks on missing timezone instead of falling back to the server zone", () => {
    const result = resolveExecutionTimezone({ executionMode: "LIVE" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("CALENDAR_TIMEZONE_MISSING");
  });

  it("blocks on invalid timezone", () => {
    const result = resolveExecutionTimezone({
      executionMode: "BUSINESS_TEST",
      businessTimezone: "Not/AZone"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("CALENDAR_TIMEZONE_INVALID");
  });

  it("canonicalizes deprecated aliases", () => {
    const result = resolveExecutionTimezone({
      executionMode: "LIVE",
      businessTimezone: "Asia/Calcutta"
    });
    expect(result.ok && result.timeZone).toBe("Asia/Kolkata");
  });

  it("validates IANA names", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/OlympusMons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("wall-clock conversion", () => {
  it("stores UTC correctly for IST (no DST)", () => {
    // 2026-07-25 15:00 IST = 09:30 UTC.
    expect(zonedWallClockToUtc("2026-07-25", 15, 0, "Asia/Kolkata").toISOString()).toBe(
      "2026-07-25T09:30:00.000Z"
    );
  });

  it("stores UTC correctly for US Eastern in summer (DST)", () => {
    // 2026-07-25 15:00 EDT (UTC-4) = 19:00 UTC.
    expect(zonedWallClockToUtc("2026-07-25", 15, 0, "America/New_York").toISOString()).toBe(
      "2026-07-25T19:00:00.000Z"
    );
  });

  it("stores UTC correctly for US Eastern in winter (standard time)", () => {
    // 2026-01-25 15:00 EST (UTC-5) = 20:00 UTC.
    expect(zonedWallClockToUtc("2026-01-25", 15, 0, "America/New_York").toISOString()).toBe(
      "2026-01-25T20:00:00.000Z"
    );
  });

  it("handles the nonexistent spring-forward local time without crashing", () => {
    // 2026-03-08 02:30 does not exist in America/New_York (clocks jump 2→3).
    const result = zonedWallClockToUtc("2026-03-08", 2, 30, "America/New_York");
    expect(Number.isNaN(result.getTime())).toBe(false);
    // The resolved instant must fall inside the DST day, between 06:30Z and 07:30Z.
    expect(result.getTime()).toBeGreaterThanOrEqual(Date.parse("2026-03-08T06:30:00Z"));
    expect(result.getTime()).toBeLessThanOrEqual(Date.parse("2026-03-08T07:30:00Z"));
  });

  it("resolves the ambiguous fall-back local time to a single instant", () => {
    // 2026-11-01 01:30 occurs twice in America/New_York.
    const result = zonedWallClockToUtc("2026-11-01", 1, 30, "America/New_York");
    expect([
      "2026-11-01T05:30:00.000Z", // EDT occurrence
      "2026-11-01T06:30:00.000Z" // EST occurrence
    ]).toContain(result.toISOString());
  });

  it("describes requested local time with matching display labels", () => {
    const described = describeZonedTime({
      date: "2026-07-25",
      hour: 15,
      minute: 0,
      timeZone: "America/New_York"
    });
    expect(described.startAtUtc).toBe("2026-07-25T19:00:00.000Z");
    expect(described.displayDate).toBe("July 25, 2026");
    expect(described.displayTime).toBe("3:00 PM");
    expect(described.timeZone).toBe("America/New_York");
  });

  it("parses runtime slot strings in the execution timezone", () => {
    expect(parseSlotStartUtc("2026-07-25 3:00 PM", "America/New_York")?.toISOString()).toBe(
      "2026-07-25T19:00:00.000Z"
    );
    expect(parseSlotStartUtc("2026-07-25 12:15 AM", "Asia/Kolkata")?.toISOString()).toBe(
      "2026-07-24T18:45:00.000Z"
    );
    expect(parseSlotStartUtc("garbage", "Asia/Kolkata")).toBeNull();
  });
});

describe("conversation test timezone gating", () => {
  const workflowJson = { nodes: [{ id: "n1", data: { type: "voice.conversation" } }], edges: [] };

  it("architect dry run without a timezone returns a config error and books nothing", async () => {
    const result = await runArchitectConversationTest({
      userId: "user-1",
      workflowId: "wf-1",
      workflowJson,
      message: "Book me tomorrow at 3pm",
      executionMode: "ARCHITECT_DRY_RUN",
      testContext: { appointmentService: "Test Appointment" }
    });

    expect(result.configError?.code).toBe("CALENDAR_TIMEZONE_MISSING");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.executionMode).toBe("ARCHITECT_DRY_RUN");
  });

  it("invalid timezone blocks with CALENDAR_TIMEZONE_INVALID", async () => {
    const result = await runArchitectConversationTest({
      userId: "user-1",
      workflowId: "wf-1",
      workflowJson,
      message: "Book me tomorrow at 3pm",
      executionMode: "ARCHITECT_DRY_RUN",
      testContext: { timeZone: "Not/AZone", appointmentService: "Test Appointment" }
    });

    expect(result.configError?.code).toBe("CALENDAR_TIMEZONE_INVALID");
  });

  it("business test requires businessIdentity", async () => {
    await expect(
      runArchitectConversationTest({
        userId: "user-1",
        workflowId: "wf-1",
        workflowJson,
        message: "hello",
        executionMode: "BUSINESS_TEST",
        testContext: { timeZone: "America/New_York" }
      })
    ).rejects.toThrow("BUSINESS_TEST requires businessIdentity.businessId");
  });
});
