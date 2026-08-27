import { describe, it, expect } from "vitest";
import { allPlatformDials, getNodeDefinition, nodeCatalogue, type NodeSetting } from "./node-registry";

/**
 * QUESTION 5 OF THE SOP: EVERY SETTING, WRITTEN DOWN ONCE.
 *
 * A node could only ever declare `defaultConfig` — a bare pair of values — so
 * every setting on this platform lived inside one React panel and nothing else
 * could read it. The AI Builder could not know a box stops at 200
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
  "action.send_whatsapp",
  "logic.script",
  "ai.image_generation",
  "trigger.manual",
  "flow.end",
  "trigger.telegram_message",
  "action.telegram_send_message"
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
        expect(["architect", "business", "admin"]).toContain(setting.whoFills);
      }
    });

    it(`${node?.label} says who fills every setting — all three sides in one row`, () => {
      /* The founder's ruling (2026-08-26): admin dials used to live in a
         separate drawer, so one node was described in two filing systems.
         One node, one row, three columns. */
      for (const setting of settings) {
        if (setting.whoFills !== "admin") continue;
        expect(setting.storedAs, `${setting.key} must say where it is stored`).toBeTruthy();
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
    /* The architect's column only — the admin's four now sit in the same row,
       which is the point of the ruling, not a change to this panel. */
    const names = (getNodeDefinition("ai.memory")?.settings ?? [])
      .filter((s) => s.whoFills === "architect")
      .map((s) => s.name);
    expect(names).toEqual(["Always remember", "How much to keep"]);
  });

  it("every admin dial on the platform names the row it is stored under", () => {
    /* The uniform record's promise: the platform can read any dial without a
       hand-written module per node. */
    const dials = allPlatformDials();
    expect(dials.length).toBeGreaterThan(10);
    for (const dial of dials) {
      expect(dial.storedAs, `${dial.nodeLabel} / ${dial.key}`).toBeTruthy();
      expect(dial.nodeType).toBeTruthy();
    }
  });

  it("every business row has a named home on the business's screen", () => {
    /* THE HOMELESS-ROW LAW (2026-08-26). The webhook node declared a
       business row — its private link — and no screen showed it, so the one
       action the business had to take was invisible for weeks. A business
       row must name its home: the setup section, card or contract mechanism
       that puts it in front of them. A new row fails here until someone says
       where the business will actually see it. */
    const HOMES: Record<string, string> = {
      "communication.send_email/mailIdentity": "Mail Setup section",
      "ai.knowledge/libraryDocuments": "Knowledge section (document shelf)",
      "trigger.webhook/webhookLink": "inbound-addresses card in setup",
      "trigger.whatsapp_message_received/whatsappConnection": "WhatsApp section",
      "action.send_whatsapp/whatsappConnection": "WhatsApp section",
      "trigger.calendly/calendlyConnection": "Calendly section",
      "action.calendly/calendlyConnection": "Calendly section",
      "calendar.availability/calendarConnection": "Calendar section (Google connect button)",
      "calendar.book_appointment/calendarConnection": "Calendar section (Google connect button)",
      /* Both resolve live from the install's email recipients, which the
         business fills in setup (resolveEscalationInbox, workflow-runner). */
      "communication.escalate/escalationInbox": "setup email recipients",
      "communication.approval/approvalInbox": "setup email recipients",
      "trigger.telegram_message/telegramConnection": "Telegram section in setup (setup-field-rules: telegram)"
    };
    for (const row of nodeCatalogue()) {
      for (const setting of row.settings.business) {
        const home = HOMES[`${row.type}/${setting.key}`];
        expect(home, `${row.type}/${setting.key} has no home on the business's screen`).toBeTruthy();
      }
    }
  });

  it("the catalogue gives every node one row with all three columns", () => {
    const rows = nodeCatalogue();
    expect(rows.length).toBeGreaterThan(40);
    const memory = rows.find((row) => row.type === "ai.memory");
    expect(memory?.element).toBe("Brain");
    expect(memory?.settings.admin.length).toBe(4);
    expect(memory?.settings.architect.length).toBe(2);
    expect(memory?.gives).toContain("memory");
    const email = rows.find((row) => row.type === "communication.send_email");
    expect(email?.settings.business.length).toBeGreaterThan(0);
  });
});
