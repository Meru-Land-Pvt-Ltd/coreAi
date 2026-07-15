import { extractPromptVariables, findUnknownPromptVariables } from "@coreai/shared";
import { describe, expect, it } from "vitest";
import {
  LIVE_VAPI_RUNTIME_VARIABLES,
  buildAgentFirstMessage,
  fillPromptTemplateTokens
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
