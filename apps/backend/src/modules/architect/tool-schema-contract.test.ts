/**
 * Vapi tool-schema contract (#8). Asserts the deployed assistant's function
 * schemas match the hardened server contract: record_sms_consent takes NO
 * phone parameter, and update_appointment_contact exposes corrected_phone
 * (prepare) + confirmed (commit). Also confirms tool gating attaches
 * update_appointment_contact only where booking is supported.
 */
import { describe, expect, it } from "vitest";
import { VOICE_TOOL_NAMES } from "@coreai/shared";
import { genericAssistantTools, shouldIncludeAssistantTool } from "./vapi-connector";

type ToolFn = { function: { name: string; parameters: { properties?: Record<string, unknown>; required?: string[] } } };

function tool(name: string): ToolFn {
  const found = (genericAssistantTools() as ToolFn[]).find((t) => t.function.name === name);
  if (!found) throw new Error(`tool ${name} not found in assistant tool schema`);
  return found;
}

describe("record_sms_consent schema", () => {
  const t = tool(VOICE_TOOL_NAMES.recordSmsConsent);
  const props = t.function.parameters.properties ?? {};

  it("has NO customer_phone / phone parameter (recipient is server-resolved)", () => {
    expect(props).not.toHaveProperty("customer_phone");
    expect(props).not.toHaveProperty("phone");
    expect(props).not.toHaveProperty("corrected_phone");
  });

  it("exposes affirmative (required) and appointment_id (optional)", () => {
    expect(props).toHaveProperty("affirmative");
    expect(props).toHaveProperty("appointment_id");
    expect(t.function.parameters.required).toEqual(["affirmative"]);
  });
});

describe("update_appointment_contact schema", () => {
  const t = tool(VOICE_TOOL_NAMES.updateAppointmentContact);
  const props = t.function.parameters.properties ?? {};

  it("exposes appointment_id, corrected_phone (prepare) and confirmed (commit)", () => {
    expect(props).toHaveProperty("appointment_id");
    expect(props).toHaveProperty("corrected_phone");
    expect(props).toHaveProperty("confirmed");
  });
});

describe("tool gating — update_appointment_contact ships with booking only", () => {
  it("attaches when bookAppointment is supported", () => {
    expect(shouldIncludeAssistantTool(VOICE_TOOL_NAMES.updateAppointmentContact, { bookAppointment: true })).toBe(true);
  });
  it("is withheld when booking is disabled", () => {
    expect(shouldIncludeAssistantTool(VOICE_TOOL_NAMES.updateAppointmentContact, { bookAppointment: false })).toBe(false);
  });
});
