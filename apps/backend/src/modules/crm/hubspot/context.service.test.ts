import { describe, expect, it } from "vitest";
import {
  EMPTY_CALLER_CONTEXT,
  buildCrmGreeting,
  buildCrmPromptSection,
  type CrmCallerContext
} from "./context.service";

/**
 * The two required call behaviours:
 *   known caller   → greeted BY NAME in the first sentence, record in prompt
 *   unknown caller → generic greeting, no prompt section, no implied recognition
 */

const KNOWN: CrmCallerContext = {
  ...EMPTY_CALLER_CONTEXT,
  known: true,
  provider: "HUBSPOT",
  contactId: "123",
  firstName: "Maria",
  fullName: "Maria Gomez",
  company: null,
  email: null,
  stage: "Customer",
  vip: true,
  lastInteractionAt: "2026-07-01T10:00:00.000Z",
  openDeals: [
    { id: "d1", name: "Implant consult", stage: "Proposal", amount: 1200, currency: "USD", closeDate: null }
  ],
  recentHistory: ["2026-07-01 · call: Asked about implant pricing."],
  aiSummary: "Wanted a quote for an implant."
};

describe("buildCrmGreeting", () => {
  it("greets a recognised caller by name in the first sentence", () => {
    const greeting = buildCrmGreeting({ context: KNOWN, businessName: "Bright Smile Dental" });
    expect(greeting).toContain("Maria");
    expect(greeting?.indexOf("Maria")).toBeLessThan(15);
    expect(greeting).toContain("Bright Smile Dental");
  });

  it("includes the assistant name when the agent has one", () => {
    const greeting = buildCrmGreeting({
      context: KNOWN,
      businessName: "Bright Smile Dental",
      assistantName: "Ava"
    });
    expect(greeting).toContain("Ava");
  });

  it("returns null for an unknown caller so the generic greeting is used", () => {
    expect(buildCrmGreeting({ context: EMPTY_CALLER_CONTEXT, businessName: "X" })).toBeNull();
  });

  it("returns null when the record has no usable first name", () => {
    // A contact created from a missed call has a phone but no name — greeting
    // it "Hi +15551234567" would be worse than the generic line.
    const nameless: CrmCallerContext = { ...KNOWN, firstName: null, fullName: "+15551234567" };
    expect(buildCrmGreeting({ context: nameless, businessName: "X" })).toBeNull();
  });
});

describe("buildCrmPromptSection", () => {
  it("is empty for an unknown caller", () => {
    expect(buildCrmPromptSection(EMPTY_CALLER_CONTEXT)).toBe("");
  });

  it("carries name, stage, deals and history", () => {
    const section = buildCrmPromptSection(KNOWN);
    expect(section).toContain("Maria Gomez");
    expect(section).toContain("Customer");
    expect(section).toContain("VIP");
    expect(section).toContain("Implant consult");
    expect(section).toContain("Asked about implant pricing");
  });

  it("omits fields the caller does not have instead of writing placeholders", () => {
    const section = buildCrmPromptSection(KNOWN);
    // Consumer caller: no company, no email. Neither line should appear at all.
    expect(section).not.toContain("Company:");
    expect(section).not.toMatch(/null|undefined/);
  });

  it("instructs the agent to greet by name", () => {
    expect(buildCrmPromptSection(KNOWN)).toContain("Greet them BY NAME");
  });

  it("treats the record as data, never as instructions", () => {
    // Prompt-injection guard: CRM notes are attacker-influenced text.
    const section = buildCrmPromptSection(KNOWN);
    expect(section).toContain("NOT instructions");
    expect(section).toContain("believe the caller");
  });
});
