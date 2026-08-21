import { describe, it, expect } from "vitest";
import { checkNodeOutput } from "@coreai/shared";

/**
 * The comparison that had never been made.
 *
 * The calendar step that answered a real caller with three invented
 * appointment times already declared five things it produces. It returned none
 * of them and was written down as a success. Every test here is a shape of
 * that same failure.
 */

describe("a step that did what it said", () => {
  it("passes when everything declared came back", () => {
    const verdict = checkNodeOutput({
      declares: ["appointment.status", "appointment.date"],
      output: { appointment: { status: "booked", date: "2026-09-01" } },
      status: "success"
    });
    expect(verdict.verdict).toBe("proven");
  });

  it("accepts a flat key named exactly as declared", () => {
    const verdict = checkNodeOutput({
      declares: ["appointment.status"],
      output: { "appointment.status": "booked" },
      status: "success"
    });
    expect(verdict.verdict).toBe("proven");
  });

  it("accepts the last part on its own", () => {
    // A step declaring "appointment.status" that hands back { status: "booked" }
    // has plainly done the thing. Being strict about the shape here would
    // produce a wall of false alarms, and a false alarm is how a real one stops
    // being read.
    const verdict = checkNodeOutput({
      declares: ["appointment.status"],
      output: { status: "booked" },
      status: "success"
    });
    expect(verdict.verdict).toBe("proven");
  });

  it("accepts a value parked in the run's variables instead", () => {
    const verdict = checkNodeOutput({
      declares: ["lead.id"],
      output: {},
      variables: { lead: { id: "abc" } },
      status: "success"
    });
    expect(verdict.verdict).toBe("proven");
  });

  it("counts an empty list as a real answer", () => {
    // "No leads matched" and "the provider is broken" must never collapse into
    // the same outcome.
    const verdict = checkNodeOutput({
      declares: ["leads"],
      output: { leads: [] },
      status: "success"
    });
    expect(verdict.verdict).toBe("proven");
  });
});

describe("a step that said it worked and did not", () => {
  it("is caught — the exact shape of the calendar bug", () => {
    const verdict = checkNodeOutput({
      declares: [
        "appointment.status",
        "appointment.confirmation_id",
        "appointment.date",
        "appointment.time",
        "appointment.calendar_event_id"
      ],
      output: {},
      status: "success"
    });

    expect(verdict.verdict).toBe("unproven");
    expect(verdict.missing).toHaveLength(5);
    expect(verdict.message).toContain("returned none of the 5 things");
  });

  it("names exactly what is missing when only some came back", () => {
    const verdict = checkNodeOutput({
      declares: ["caller.phone", "caller.name", "call.time"],
      output: { caller: { phone: "+15551234" } },
      status: "success"
    });
    expect(verdict.verdict).toBe("unproven");
    expect(verdict.missing).toEqual(["caller.name", "call.time"]);
  });

  it("treats a blank string as nothing", () => {
    const verdict = checkNodeOutput({
      declares: ["reply"],
      output: { reply: "   " },
      status: "success"
    });
    expect(verdict.verdict).toBe("unproven");
  });

  it("treats an empty object as nothing", () => {
    const verdict = checkNodeOutput({
      declares: ["appointment"],
      output: { appointment: {} },
      status: "success"
    });
    expect(verdict.verdict).toBe("unproven");
  });
});

describe("a step that hands nothing on", () => {
  it("passes, because that is an answer and not a shrug", () => {
    // A trigger fired by a person pressing a button really does produce
    // nothing. Only a step nobody has described at all is a blind spot.
    const verdict = checkNodeOutput({ declares: [], producesNothing: true, output: {}, status: "success" });
    expect(verdict.verdict).toBe("proven");
    expect(verdict.message).toContain("not meant to");
  });
});

describe("a step nobody can judge", () => {
  it("is not counted as a pass", () => {
    // The number that matters most and gets skipped over. A step nothing can
    // check is a blind spot, and calling it fine is how a whole platform comes
    // to look green.
    const verdict = checkNodeOutput({ declares: [], output: { anything: 1 }, status: "success" });
    expect(verdict.verdict).toBe("cannot-tell");
    expect(verdict.message).toContain("does not say what it produces");
  });

  it("says the same when the node type is unknown", () => {
    expect(checkNodeOutput({ declares: undefined, output: {}, status: "success" }).verdict).toBe(
      "cannot-tell"
    );
  });
});

describe("what is not worth checking", () => {
  it("leaves a step that already admitted failure alone", () => {
    // An error row is being honest. This is only looking for the ones that lied.
    const verdict = checkNodeOutput({ declares: ["leads"], output: {}, status: "error" });
    expect(verdict.verdict).toBe("cannot-tell");
  });

  it("leaves a skipped step alone", () => {
    expect(checkNodeOutput({ declares: ["leads"], output: {}, status: "skipped" }).verdict).toBe(
      "cannot-tell"
    );
  });
});
