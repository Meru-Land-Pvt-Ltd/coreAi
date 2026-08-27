import { describe, expect, it } from "vitest";
import { allNodeDocs, docsSummary, nodeDocFor } from "./node-docs";

/**
 * THE DOCUMENTATION'S OWN LAWS (2026-08-27).
 *
 * The founder ordered a knowledge base for architects who build by hand, and
 * the one rule that makes it worth having: it is GENERATED from the node's
 * own row, so it can never drift from the software. These pin that — and
 * they fail the day someone writes a page by hand, or ships a node whose row
 * cannot answer an architect's obvious questions.
 */

describe("the documentation", () => {
  const docs = allNodeDocs();

  it("covers every node an architect can actually place", () => {
    expect(docs.length).toBeGreaterThan(30);
    /* A deleted card is not documented — documenting a thing nobody can
       place would be documenting a thing that does not exist. */
    for (const doc of docs) {
      expect(doc.type).not.toBe("block.model_picker");
      expect(doc.type).not.toBe("flow.end");
    }
  });

  it("answers the first three questions for every node: what, needs, gives", () => {
    for (const doc of docs) {
      expect(doc.title, doc.type).toBeTruthy();
      expect(doc.oneLine.length, doc.type).toBeGreaterThan(10);
      expect(Array.isArray(doc.needs), doc.type).toBe(true);
      expect(Array.isArray(doc.gives), doc.type).toBe(true);
      expect(["Trigger", "Brain", "Face", "Hand", "Connection"], doc.type).toContain(doc.element);
    }
  });

  it("says WHO fills every setting, in a person's words — never our column names", () => {
    for (const doc of docs) {
      for (const setting of [...doc.yourSettings, ...doc.businessAnswers, ...doc.platformLimits]) {
        expect(["you", "the business", "Triven"], `${doc.type}/${setting.name}`).toContain(setting.filledBy);
        expect(setting.whatItsFor.length, `${doc.type}/${setting.name}`).toBeGreaterThan(10);
        /* A setting's documented name must be the one on screen, never the
           machine key — the same law the panels keep. */
        expect(setting.name, doc.type).not.toMatch(/^[a-z]+[A-Z]/);
      }
    }
  });

  it("shows the architect's settings separately from what the business answers", () => {
    const email = nodeDocFor("communication.send_email");
    expect(email).not.toBeNull();
    expect(email!.yourSettings.length).toBeGreaterThan(0);
    expect(email!.businessAnswers.length).toBeGreaterThan(0);
    /* The two must never be mixed: an architect asked for a business's own
       fact is the oldest mistake this platform corrected. */
    for (const setting of email!.yourSettings) expect(setting.filledBy).toBe("you");
    for (const setting of email!.businessAnswers) expect(setting.filledBy).toBe("the business");
  });

  it("carries the Soul's own wisdom for the nodes that have it — one source, not two", () => {
    const brain = nodeDocFor("ai.llm_call");
    expect(brain?.wisdom, "the AI Brain has a written wisdom page").toBeTruthy();
    expect(brain!.wisdom!.length).toBeGreaterThan(100);
  });

  it("tells an architect why a parked card sleeps, instead of hiding it", () => {
    const parked = docs.filter((doc) => doc.parked);
    expect(parked.length).toBeGreaterThan(0);
    for (const doc of parked) expect(String(doc.parked).length).toBeGreaterThan(10);
  });

  it("puts the working cards before the sleeping ones, element by element", () => {
    const firstParkedAt = docs.findIndex((doc) => Boolean(doc.parked));
    if (firstParkedAt === -1) return;
    const elementOfFirstParked = docs[firstParkedAt]!.element;
    /* Within one element, nothing awake may sit after something asleep. */
    const sameElement = docs.filter((doc) => doc.element === elementOfFirstParked);
    const parkedSeen = sameElement.findIndex((doc) => Boolean(doc.parked));
    for (let i = parkedSeen; i < sameElement.length; i += 1) {
      expect(Boolean(sameElement[i]!.parked), sameElement[i]!.type).toBe(true);
    }
  });

  it("counts itself honestly", () => {
    const summary = docsSummary();
    expect(summary.total).toBe(docs.length);
    expect(summary.working + summary.parked).toBe(summary.total);
  });
});
