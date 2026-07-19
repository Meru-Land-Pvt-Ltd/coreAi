import { describe, expect, it } from "vitest";
import { shouldAnswerWithAiByMode } from "./twilio-business-routing";

/**
 * AI Call Coverage answer gate: `mode` (the forward condition) and `coverage`
 * (the time window) are independent gates ANDed together. Legacy configs
 * without a coverage keep their exact previous behavior, and unknown hours
 * never drop a call.
 *
 * These schedules use an always-open / never-open week so the checks are
 * time-of-day independent.
 */

const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const ALWAYS_OPEN = WEEK.map((day) => ({ day, closed: false, open: "00:00", close: "23:59" }));

// A CONFIGURED week that is closed right now: today (UTC) is closed, every
// other day is open. (An entirely closed week would read as "unconfigured",
// which the engine treats as unknown — answer, never guess.)
const todayIndex = new Date().getUTCDay();
const NEVER_OPEN = WEEK.map((day, index) =>
  index === todayIndex
    ? { day, closed: true, open: "", close: "" }
    : { day, closed: false, open: "00:00", close: "23:59" }
);

// No businessId → the special-hours lookup short-circuits (no DB needed).
function agent(input: { hours?: unknown; coverage?: string; answeringHours?: unknown }) {
  return {
    business: { hours: input.hours, timeZone: "UTC" },
    coverage: input.coverage,
    answeringHours: input.answeringHours
  };
}

describe("legacy behavior without coverage (unchanged)", () => {
  it("AI_FIRST / NO_ANSWER / BUSY / UNREACHABLE always answer", async () => {
    for (const mode of ["AI_FIRST", "NO_ANSWER", "BUSY", "UNREACHABLE"]) {
      expect(await shouldAnswerWithAiByMode(mode, agent({}))).toBe(true);
    }
  });

  it("BUSINESS_HOURS mode answers while open, not while closed, and when hours are unknown", async () => {
    expect(await shouldAnswerWithAiByMode("BUSINESS_HOURS", agent({ hours: ALWAYS_OPEN }))).toBe(true);
    expect(await shouldAnswerWithAiByMode("BUSINESS_HOURS", agent({ hours: NEVER_OPEN }))).toBe(false);
    expect(await shouldAnswerWithAiByMode("BUSINESS_HOURS", agent({}))).toBe(true);
  });

  it("legacy CUSTOM_HOURS mode gates on the answeringHours schedule alone", async () => {
    expect(await shouldAnswerWithAiByMode("CUSTOM_HOURS", agent({ answeringHours: ALWAYS_OPEN }))).toBe(true);
    expect(await shouldAnswerWithAiByMode("CUSTOM_HOURS", agent({ answeringHours: NEVER_OPEN }))).toBe(false);
    expect(await shouldAnswerWithAiByMode("CUSTOM_HOURS", agent({}))).toBe(true);
  });
});

describe("coverage gate (new)", () => {
  it('"always" (and absent) keeps every mode answering', async () => {
    expect(await shouldAnswerWithAiByMode("NO_ANSWER", agent({ coverage: "always" }))).toBe(true);
    expect(await shouldAnswerWithAiByMode("AI_FIRST", agent({ coverage: "always", hours: NEVER_OPEN }))).toBe(true);
  });

  it('"business_hours" answers only while the business is open', async () => {
    expect(await shouldAnswerWithAiByMode("NO_ANSWER", agent({ coverage: "business_hours", hours: ALWAYS_OPEN }))).toBe(true);
    expect(await shouldAnswerWithAiByMode("NO_ANSWER", agent({ coverage: "business_hours", hours: NEVER_OPEN }))).toBe(false);
    // Unknown hours → answer, never drop the call.
    expect(await shouldAnswerWithAiByMode("NO_ANSWER", agent({ coverage: "business_hours" }))).toBe(true);
  });

  it('"custom" answers only within the custom answering schedule', async () => {
    expect(
      await shouldAnswerWithAiByMode("AI_FIRST", agent({ coverage: "custom", answeringHours: ALWAYS_OPEN }))
    ).toBe(true);
    expect(
      await shouldAnswerWithAiByMode("AI_FIRST", agent({ coverage: "custom", answeringHours: NEVER_OPEN }))
    ).toBe(false);
    // The custom AI schedule is independent of Business Hours.
    expect(
      await shouldAnswerWithAiByMode(
        "AI_FIRST",
        agent({ coverage: "custom", hours: ALWAYS_OPEN, answeringHours: NEVER_OPEN })
      )
    ).toBe(false);
  });

  it("the mode gate still applies before coverage (AND, not OR)", async () => {
    // AFTER_HOURS + open business → mode says no; coverage can never re-open it.
    expect(
      await shouldAnswerWithAiByMode(
        "AFTER_HOURS",
        agent({ coverage: "always", hours: ALWAYS_OPEN })
      )
    ).toBe(false);
  });
});
