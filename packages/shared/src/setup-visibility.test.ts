import { describe, expect, it } from "vitest";
import { deriveSetupVisibility, getSetupValidationPlan, DEFAULT_FLAGS } from "./setup-visibility";

describe("setup-visibility engine", () => {
  it("returns default false flags for empty or corrupt workflowJson", () => {
    const res1 = deriveSetupVisibility(null);
    expect(res1).toEqual(DEFAULT_FLAGS);

    const res2 = deriveSetupVisibility({});
    expect(res2).toEqual(DEFAULT_FLAGS);

    const res3 = deriveSetupVisibility({ nodes: "invalid" });
    expect(res3).toEqual(DEFAULT_FLAGS);
  });

  it("handles unknown node types safely without throwing", () => {
    const workflow = {
      nodes: [
        { type: "coreNode", data: { type: "foo.bar.unknown" } },
        { type: "custom.nonexistent" }
      ]
    };
    const visibility = deriveSetupVisibility(workflow);
    expect(visibility).toEqual(DEFAULT_FLAGS);
    expect(visibility.phone).toBe(false);
    expect(visibility.businessProfile).toBe(false);
  });

  it("derives flags correctly for Resume Analyzer graph (trigger.manual + ai.memory)", () => {
    const workflow = {
      nodes: [
        { data: { type: "trigger.manual" } },
        { data: { type: "ai.memory" } }
      ]
    };
    const visibility = deriveSetupVisibility(workflow);
    const plan = getSetupValidationPlan(visibility);

    expect(visibility.phone).toBe(false);
    expect(visibility.businessProfile).toBe(false);
    expect(visibility.hours).toBe(false);
    expect(visibility.calendar).toBe(false);
    expect(visibility.voiceIdentity).toBe(false);

    expect(plan.requireBusinessName).toBe(false);
    expect(plan.requirePhoneSelection).toBe(false);
    expect(plan.requireCalendar).toBe(false);
  });

  it("derives flags correctly for Dental SMS / Missed Call graph (missed_call + context_reply + send_sms)", () => {
    const workflow = {
      nodes: [
        { data: { type: "trigger.twilio_missed_call" } },
        { data: { type: "ai.context_reply" } },
        { data: { type: "action.send_sms" } }
      ]
    };
    const visibility = deriveSetupVisibility(workflow);
    const plan = getSetupValidationPlan(visibility);

    expect(visibility.phone).toBe(true);
    expect(visibility.callForwarding).toBe(true);
    expect(visibility.aiCallCoverage).toBe(true);
    expect(visibility.callTest).toBe(true);

    expect(visibility.businessProfile).toBe(true);
    expect(visibility.knowledge).toBe(true);
    expect(visibility.hours).toBe(true);
    expect(visibility.smsNote).toBe(true);

    expect(plan.requireBusinessName).toBe(true);
    expect(plan.requirePhoneSelection).toBe(true);
    expect(plan.requireCallForwarding).toBe(true);
  });

  it("derives flags correctly for Voice Receptionist graph (phone_call + voice_conversation + calendar.book_appointment)", () => {
    const workflow = {
      nodes: [
        { data: { type: "trigger.phone_call" } },
        { data: { type: "ai.voice_conversation" } },
        { data: { type: "calendar.book_appointment" } }
      ]
    };
    const visibility = deriveSetupVisibility(workflow);
    const plan = getSetupValidationPlan(visibility);

    expect(visibility.phone).toBe(true);
    expect(visibility.callForwarding).toBe(true);
    expect(visibility.answeringMode).toBe(true);
    expect(visibility.businessProfile).toBe(true);
    expect(visibility.knowledge).toBe(true);
    expect(visibility.hours).toBe(true);
    expect(visibility.voiceIdentity).toBe(true);
    expect(visibility.agentBehaviorVoice).toBe(true);
    expect(visibility.voicePreview).toBe(true);
    expect(visibility.calendar).toBe(true);
    expect(visibility.bookingRules).toBe(true);
    expect(visibility.calendarTest).toBe(true);

    expect(plan.requireBusinessName).toBe(true);
    expect(plan.requirePhoneSelection).toBe(true);
    expect(plan.requireVoiceIdentity).toBe(true);
    expect(plan.requireBookingRules).toBe(true);
    expect(plan.requireCalendar).toBe(true);
  });

  it("merges connector-derived flags as belt-and-suspenders backup", () => {
    const workflow = { nodes: [] };
    const visibility = deriveSetupVisibility(workflow, ["google_calendar", "twilio"]);

    expect(visibility.calendar).toBe(true);
    expect(visibility.phone).toBe(true);
  });

  it("derives calendly setup visibility from connector and nodes", () => {
    const fromConnector = deriveSetupVisibility({ nodes: [] }, ["calendly"]);
    expect(fromConnector.calendly).toBe(true);
    expect(fromConnector.calendar).toBe(false);
    expect(getSetupValidationPlan(fromConnector).requireCalendly).toBe(true);

    const fromNodes = deriveSetupVisibility({
      nodes: [{ data: { type: "trigger.calendly" } }, { data: { type: "action.calendly" } }]
    });
    expect(fromNodes.calendly).toBe(true);
  });
});
