import { describe, expect, it } from "vitest";
import { EXAM_BATTERY, markExam, type BuilderExam } from "./builder-exams";
import type { ComposerResult } from "./composer/compose";

/**
 * THE MARKERS ARE MARKED (2026-08-26).
 *
 * An examination hall whose markers grade wrongly is worse than no hall —
 * it stamps "passed" on a dumb employee. So the marking logic itself sits
 * its own exam here, with fabricated answers whose grades are known, and
 * the battery is held to its own laws: every exam guards a named law, no
 * two exams share an id, and nothing in the battery rehearses the
 * founder's blind test.
 */

function plan(types: string[], config: Record<string, unknown> = {}): ComposerResult {
  return {
    ok: true,
    plan: {
      summary: "a fabricated plan",
      nodes: types.map((type, index) => ({ id: `n${index}`, type, title: type, config })),
      edges: [],
      asksTheBusiness: []
    } as never,
    menu: [],
    attempts: 1
  };
}

const asked = (question: string, suggestion: string): ComposerResult =>
  ({ ok: false, ask: { question, suggestion }, message: question }) as ComposerResult;

const EXAM: BuilderExam = {
  id: "specimen",
  law: "a specimen law",
  ask: "build something",
  expect: {
    trigger: ["trigger.email_received"],
    mustInclude: ["communication.send_email"],
    maxFacePieces: 0,
    mustNotAsk: true
  }
};

describe("the markers", () => {
  it("pass a lawful plan", () => {
    const mark = markExam(EXAM, plan(["trigger.email_received", "ai.llm_call", "communication.send_email"]));
    expect(mark.passed).toBe(true);
    expect(mark.faults).toEqual([]);
  });

  it("fail the wrong way in", () => {
    const mark = markExam(EXAM, plan(["trigger.manual", "communication.send_email"]));
    expect(mark.passed).toBe(false);
    expect(mark.faults.join(" ")).toContain("Wrong way in");
  });

  it("fail the monster — Face pieces where none belong", () => {
    const mark = markExam(
      EXAM,
      plan(["trigger.email_received", "block.prompt_composer", "communication.send_email"])
    );
    expect(mark.passed).toBe(false);
    expect(mark.faults.join(" ")).toContain("Face pieces");
  });

  it("fail asking when the request was complete", () => {
    const mark = markExam(EXAM, asked("What colour should it be?", "blue"));
    expect(mark.passed).toBe(false);
    expect(mark.faults.join(" ")).toContain("Asked when the request was complete");
  });

  it("pass a proper question — and fail an empty-handed one", () => {
    const wantsAsk: BuilderExam = { ...EXAM, expect: { shouldAsk: true } };
    expect(markExam(wantsAsk, asked("What should it say first?", "Hi! How can I help?")).passed).toBe(true);
    const emptyHanded = markExam(wantsAsk, asked("What should it say first?", ""));
    expect(emptyHanded.passed).toBe(false);
    expect(emptyHanded.faults.join(" ")).toContain("empty-handed");
  });

  it("fail building when asking was the right move", () => {
    const wantsAsk: BuilderExam = { ...EXAM, expect: { shouldAsk: true } };
    const mark = markExam(wantsAsk, plan(["trigger.manual", "ai.llm_call"]));
    expect(mark.passed).toBe(false);
    expect(mark.faults.join(" ")).toContain("invented instead of asked");
  });

  it("guard the human's exact words", () => {
    const sacred: BuilderExam = { ...EXAM, expect: { verbatim: "Namaste! We are honoured." } };
    expect(
      markExam(sacred, plan(["trigger.manual"], { greeting: "Namaste! We are honoured." })).passed
    ).toBe(true);
    const improved = markExam(sacred, plan(["trigger.manual"], { greeting: "Hello! We are honored." }));
    expect(improved.passed).toBe(false);
    expect(improved.faults.join(" ")).toContain("exact words");
  });
});

describe("the battery's own laws", () => {
  it("every exam guards a named law and carries expectations", () => {
    for (const exam of EXAM_BATTERY) {
      expect(exam.law.length, exam.id).toBeGreaterThan(10);
      expect(Object.keys(exam.expect).length, exam.id).toBeGreaterThan(0);
    }
  });

  it("no two exams share an id", () => {
    const ids = EXAM_BATTERY.map((exam) => exam.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never rehearses the founder's blind test", () => {
    /* Exams observe the Builder; they must not become the rehearsal for a
       demonstration the founder wants to run cold. */
    const whole = JSON.stringify(EXAM_BATTERY).toLowerCase();
    expect(whole).not.toContain("telegram");
  });

  it("covers asking, refusing to ask, and the sacred words — the character's three edges", () => {
    expect(EXAM_BATTERY.some((exam) => exam.expect.shouldAsk)).toBe(true);
    expect(EXAM_BATTERY.some((exam) => exam.expect.mustNotAsk)).toBe(true);
    expect(EXAM_BATTERY.some((exam) => exam.expect.verbatim)).toBe(true);
  });
});
