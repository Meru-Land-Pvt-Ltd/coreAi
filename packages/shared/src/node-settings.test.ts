import { describe, it, expect } from "vitest";
import { getNodeDefinition, type NodeSetting } from "./node-registry";

/**
 * QUESTION 5 OF THE SOP: EVERY SETTING, WRITTEN DOWN ONCE.
 *
 * A node could only ever declare `defaultConfig` — a bare pair of values — so
 * every setting on this platform lived inside one React panel and nothing else
 * could read it. The Smart Designer could not know a box stops at 200
 * characters, and the AI Composer could not fill a setting in without
 * inventing a value.
 *
 * These are the five nodes rebuilt to the SOP. The rest follow as each one is
 * rebuilt; that is the whole point of doing this node by node.
 */

const PERFECTED = [
  "block.prompt_composer",
  "block.output_stage",
  "ai.llm_call",
  "logic.condition",
  "ai.memory",
  "logic.loop",
  "block.file_upload",
  "trigger.schedule",
  "communication.send_email",
  "trigger.email_received",
  "ai.knowledge",
  "communication.escalate",
  "communication.approval",
  "calendar.availability",
  "calendar.book_appointment",
  "trigger.calendly",
  "action.calendly",
  "trigger.webhook",
  "action.api_call",
  "tool.node_frame",
  "trigger.whatsapp_message_received",
  "action.send_whatsapp"
] as const;

describe("the nodes we have finished answer question 5", () => {
  for (const type of PERFECTED) {
    const node = getNodeDefinition(type);
    const settings = (node?.settings ?? []) as NodeSetting[];

    it(`${node?.label} describes its settings at all`, () => {
      /* Declared is the requirement — declared-EMPTY is a real answer. The
         ear (Email received) has no dials on purpose: its address belongs to
         the business's Mail Setup. An undeclared settings field is the only
         failure — it means nobody answered question 5. */
      expect(node?.settings).toBeDefined();
    });

    it(`${node?.label} gives each setting the whole small form`, () => {
      for (const setting of settings) {
        expect(setting.key).toBeTruthy();
        // A name a person recognises — never the field name off the node.
        expect(setting.name).toBeTruthy();
        expect(setting.name).not.toBe(setting.key);
        expect(setting.whatItsFor.length).toBeGreaterThan(10);
        expect(setting.default).toBeDefined();
        expect(["architect", "business"]).toContain(setting.whoFills);
      }
    });

    it(`${node?.label} never asks the architect for something only the business knows`, () => {
      // Opening hours, a phone number, a price: the architect is building for
      // a thousand businesses and knows none of them.
      for (const setting of settings) {
        if (setting.whoFills !== "architect") continue;
        /* "Fixed address" (an inbox the architect chooses) is legitimate — the
           rule bans BUSINESS facts: their phone, their street, their prices. */
        expect(setting.name.toLowerCase()).not.toMatch(/phone|street|price|opening hours/);
      }
    });

    it(`${node?.label} keeps its declared defaults and its dropped defaults the same`, () => {
      // Two homes for one fact is how they drift apart.
      for (const setting of settings) {
        const dropped = node?.defaultConfig?.[setting.key];
        if (dropped === undefined || Array.isArray(dropped)) continue;
        expect(String(dropped)).toBe(String(setting.default));
      }
    });

    it(`${node?.label} offers real choices wherever it says "choice"`, () => {
      for (const setting of settings) {
        if (setting.type !== "choice") continue;
        const choices = setting.limits?.choices;
        // A picker whose options are fetched live (models, brains) declares
        // none here on purpose — the platform, not the file, holds that list.
        if (!choices) continue;
        expect(choices.length).toBeGreaterThan(1);
        for (const choice of choices) expect(choice.label).toBeTruthy();
      }
    });
  }

  it("Memory's dials are the two on its panel, in the same words", () => {
    const names = (getNodeDefinition("ai.memory")?.settings ?? []).map((s) => s.name);
    expect(names).toEqual(["Always remember", "How much to keep"]);
  });
});
