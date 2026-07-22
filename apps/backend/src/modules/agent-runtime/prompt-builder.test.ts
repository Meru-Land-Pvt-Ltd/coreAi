import { extractPromptVariables, findUnknownPromptVariables } from "@coreai/shared";
import { describe, expect, it } from "vitest";
import {
  LIVE_VAPI_RUNTIME_VARIABLES,
  buildAgentFirstMessage,
  buildAgentSystemPrompt,
  fillPromptTemplateTokens,
  type AgentPromptInput
} from "./prompt-builder";

/**
 * Regression coverage for architect-written {{variables}} in prompts and
 * first messages. Unresolved tokens used to reach Vapi's Liquid engine —
 * unknown variables rendered EMPTY (the custom first message "disappeared")
 * and malformed ones errored the browser call.
 */

describe("fillPromptTemplateTokens", () => {
  const values = {
    assistantName: "Ava",
    businessName: "Bright Smile Dental",
    customerName: "Test Customer",
    appointmentService: "Cleaning"
  };

  it("fills every spelling the builder UI suggests (dotted, spaced, cased, snake)", () => {
    const text =
      "Hi {{customer.name}}, welcome to {{business.name}} / {{Business Name}} / {{business_name}} / {{businessName}} for your {{appointment.service}}.";
    expect(fillPromptTemplateTokens(text, values)).toBe(
      "Hi Test Customer, welcome to Bright Smile Dental / Bright Smile Dental / Bright Smile Dental / Bright Smile Dental for your Cleaning."
    );
  });

  it("leaves unknown tokens alone by default, strips them when asked", () => {
    const text = "Hello {{assistant.name}}, {{unknown token!}} bye.";
    expect(fillPromptTemplateTokens(text, values)).toBe("Hello Ava, {{unknown token!}} bye.");
    expect(fillPromptTemplateTokens(text, values, { stripUnresolved: true })).toBe("Hello Ava, bye.");
  });

  it("rewrites live runtime variables to Vapi's exact spelling instead of stripping", () => {
    const text = "Today is {{current date}} for {{customer.phone}} in {{time_zone}}.";
    const result = fillPromptTemplateTokens(text, {}, {
      runtimeVariables: LIVE_VAPI_RUNTIME_VARIABLES,
      stripUnresolved: true
    });
    expect(result).toBe("Today is {{currentDate}} for {{customerPhone}} in {{timeZone}}.");
  });

  it("build-time values win over runtime rewriting", () => {
    const result = fillPromptTemplateTokens("{{business.name}}", values, {
      runtimeVariables: LIVE_VAPI_RUNTIME_VARIABLES,
      stripUnresolved: true
    });
    expect(result).toBe("Bright Smile Dental");
  });

  it("returns non-template text untouched", () => {
    expect(fillPromptTemplateTokens("Plain greeting.", values, { stripUnresolved: true })).toBe(
      "Plain greeting."
    );
  });
});

describe("unknown-variable warnings (shared helpers)", () => {
  it("extracts {{tokens}} deduped in order of appearance", () => {
    expect(extractPromptVariables("Hi {{a}}, {{ b }} and {{a}} again.")).toEqual(["a", "b"]);
    expect(extractPromptVariables("no tokens here")).toEqual([]);
  });

  it("flags only variables the platform cannot fill, in any spelling", () => {
    const text =
      "Welcome to {{business.name}} — I'm {{Assistant Name}}. Your {{appointment.service}} with {{busines.nam}} and {{foo}}.";
    expect(findUnknownPromptVariables(text)).toEqual(["busines.nam", "foo"]);
  });

  it("whitelists node-scoped tokens via node prefixes", () => {
    const text = "{{AI Voice Conversation.firstMessage}} vs {{Some Other Node.prop}}";
    expect(
      findUnknownPromptVariables(text, { nodePrefixes: ["node-1", "AI Voice Conversation"] })
    ).toEqual(["Some Other Node.prop"]);
  });
});

describe("custom first message survives variable filling", () => {
  it("keeps the architect's first message once its tokens are filled", () => {
    const filled = fillPromptTemplateTokens(
      "Thanks for calling {{business.name}} — how can I help?",
      { businessName: "Bright Smile Dental" },
      { stripUnresolved: true }
    );
    const firstMessage = buildAgentFirstMessage({
      assistantName: "Ava",
      businessName: "Bright Smile Dental",
      customFirstMessage: filled
    });
    expect(firstMessage).toBe("Thanks for calling Bright Smile Dental — how can I help?");
  });

  it("falls back to the default greeting only when the message renders empty", () => {
    const filled = fillPromptTemplateTokens("{{totally.unknown}}", {}, { stripUnresolved: true });
    const firstMessage = buildAgentFirstMessage({
      assistantName: "Ava",
      businessName: "Bright Smile Dental",
      customFirstMessage: filled
    });
    expect(firstMessage).toBe("Hello, this is Ava from Bright Smile Dental. How can I help you today?");
  });
});

/**
 * The emotional-support directives are a product requirement: the agent must
 * acknowledge feelings, answer the caller's actual question with cautious
 * guidance, escalate immediate safety risks, and never collapse into
 * booking-only or robotic replies. These tests pin the prompt contract for
 * every business type — live Vapi deploys and chat/test runtimes both build
 * from this prompt.
 */
describe("buildAgentSystemPrompt emotional support", () => {
  const baseInput = (overrides: Partial<AgentPromptInput> = {}): AgentPromptInput => ({
    assistantName: "Ava",
    businessName: "Cool Breeze HVAC",
    businessType: "AC repair company",
    services: ["AC installation", "AC repair"],
    faqs: [],
    timezoneText: "America/New_York",
    currentDateTimeText: "Tuesday, July 22, 2026 10:00 AM",
    currentDateText: "2026-07-22",
    tomorrowDateText: "2026-07-23",
    capabilities: { canCheckAvailability: true, canBook: true, canText: false },
    ...overrides
  });

  it("instructs the agent to acknowledge the caller's feelings first", () => {
    const prompt = buildAgentSystemPrompt(baseInput());
    expect(prompt).toContain("Emotional support:");
    expect(prompt).toContain("acknowledge how they feel FIRST");
    expect(prompt).toMatch(/pain, discomfort, worry, stress, frustration/);
  });

  it("requires answering the actual question and forbids booking-only replies", () => {
    const prompt = buildAgentSystemPrompt(baseInput());
    expect(prompt).toContain("answer the caller's ACTUAL question directly");
    expect(prompt).toContain("Never skip straight to booking");
    expect(prompt).toContain("do NOT deflect or ignore it");
  });

  it("sets safe professional boundaries without shutting down empathy", () => {
    const prompt = buildAgentSystemPrompt(baseInput());
    expect(prompt).toContain("never diagnose a condition");
    expect(prompt).toMatch(/recommend or dose medication/);
    expect(prompt).toMatch(/legal opinions/);
    expect(prompt).toMatch(/financial or investment advice/);
    expect(prompt).toMatch(/guarantee any outcome/);
    // "do not invent" must stay scoped to business facts, not empathy.
    expect(prompt).toContain("it never means refusing to comfort the caller");
  });

  it("escalates immediate safety risks over everything else", () => {
    const prompt = buildAgentSystemPrompt(baseInput());
    expect(prompt).toContain("OVERRIDES everything else");
    expect(prompt).toMatch(/medical emergency/);
    expect(prompt).toMatch(/fire/);
    expect(prompt).toMatch(/sparking or smoking electrics/);
    expect(prompt).toMatch(/self-harm/);
    expect(prompt).toMatch(/violence/);
    expect(prompt).toContain("call their local emergency number (911 in the US)");
    expect(prompt).toContain("988 Suicide and Crisis Lifeline");
  });

  it("keeps the tone natural and non-robotic, not excessively emotional", () => {
    const prompt = buildAgentSystemPrompt(baseInput());
    expect(prompt).toContain("at most one empathy sentence per reply");
    expect(prompt).toContain("never repeat the same sympathetic phrase twice in a row");
    expect(prompt).toContain("never let sympathy replace answering the question");
    expect(prompt).toContain("Sound like a real human receptionist, not a script.");
  });

  it("covers multi-industry situational examples, not just dental", () => {
    const prompt = buildAgentSystemPrompt(baseInput());
    expect(prompt).toMatch(/Tooth pain/);
    expect(prompt).toMatch(/Feeling unwell before a visit/);
    expect(prompt).toMatch(/Broken AC/);
    expect(prompt).toMatch(/salon treatment/);
    expect(prompt).toMatch(/Water leak or urgent home issue/);
    expect(prompt).toMatch(/legal deadline/);
    expect(prompt).toMatch(/bill or missed payment/);
    expect(prompt).toContain("never limit yourself to these");
  });

  it("stays generic: adapts guidance to the configured business and booking label", () => {
    const lawFirm = buildAgentSystemPrompt(
      baseInput({
        businessName: "Harbor Legal Group",
        businessType: "law firm",
        bookingLabel: "consultation"
      })
    );
    expect(lawFirm).toContain("relevant to Harbor Legal Group's field");
    expect(lawFirm).toContain("a consultation, a callback, or a message to the team");

    const dental = buildAgentSystemPrompt(baseInput({ businessName: "Bright Smile Dental", businessType: "dental practice" }));
    expect(dental).toContain("relevant to Bright Smile Dental's field");
    expect(dental).toContain("an appointment, a callback, or a message to the team");
  });
});
