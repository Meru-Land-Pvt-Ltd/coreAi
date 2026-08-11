import { describe, expect, it, vi } from "vitest";
import { emergencyCategoryForBusinessType, platformDefaultAfterHoursPolicy } from "@coreai/shared";
import { buildAgentSystemPrompt } from "../agent-runtime/prompt-builder";
import { parseGraph, runAgentWorkflow } from "../agent-runtime/graph-runner";
import type { AgentProviders } from "../agent-runtime/provider-adapters";
import { AGENTS, systemPrompt, makeWorkflow } from "../../../../../scripts/triven_agent_creator.mjs";

/**
 * The catalog ships one agent per subindustry across Healthcare, Real Estate,
 * Automotive, and Legal. A buyer in any of them must get an agent that speaks
 * their vocabulary — nothing may leak from the original dental build.
 */

/** Vocabulary that only ever belongs to a dental/clinical business. */
const DENTAL_ONLY = /\b(dental|dentist\w*|tooth|teeth|jaw|orthodont\w*|cavity|cavities|hygienist)\b/i;

/**
 * Framing that only makes sense inside a clinic. Deliberately excludes
 * "diagnose"/"medication": the platform safety floor names medical, legal, AND
 * financial boundaries for every business, and "repair diagnosis" is ordinary
 * automotive language.
 */
const CLINICAL_ONLY = /\b(patients?|triage|clinician|hygienist|prescription)\b/i;

const NON_HEALTHCARE = AGENTS.filter((agent) => agent.industry !== "Healthcare");

function promptFor(agent: (typeof AGENTS)[number]): string {
  return buildAgentSystemPrompt({
    assistantName: "Avery",
    businessName: "Genericity Test Business",
    businessType: agent.subindustry,
    services: ["Service A", "Service B"],
    faqs: [],
    timezoneText: "America/New_York",
    currentDateTimeText: "Tuesday, July 22, 2026 10:00 AM",
    currentDateText: "2026-07-22",
    tomorrowDateText: "2026-07-23",
    bookingLabel: agent.bookingLabel,
    capabilities: { canCheckAvailability: true, canBook: true, canText: true }
  });
}

describe("Triven catalog — cross-industry genericity", () => {
  it("covers every industry the catalog claims to serve", () => {
    const industries = [...new Set(AGENTS.map((agent) => agent.industry))].sort();
    expect(industries).toEqual(["Automotive", "Healthcare", "Legal", "Real Estate"]);
    expect(AGENTS).toHaveLength(25);
  });

  it.each(NON_HEALTHCARE)(
    "$industry / $subindustry: architect prompt carries no dental or clinical framing",
    (agent) => {
      const prompt = systemPrompt(agent);

      expect(prompt).not.toMatch(DENTAL_ONLY);
      expect(prompt).not.toMatch(CLINICAL_ONLY);
      // It must still describe the buyer's own business and booking language.
      expect(prompt).toContain(agent.subindustry);
    }
  );

  it.each(NON_HEALTHCARE)(
    "$industry / $subindustry: runtime system prompt stays in the buyer's vocabulary",
    (agent) => {
      const prompt = promptFor(agent);

      expect(prompt).not.toMatch(DENTAL_ONLY);
      expect(prompt).not.toMatch(CLINICAL_ONLY);
      expect(prompt).toContain(agent.bookingLabel);
      expect(prompt).toContain("Genericity Test Business");
    }
  );

  it.each(AGENTS)("$subindustry: proactive symptom screening is dental-only", (agent) => {
    const policy = platformDefaultAfterHoursPolicy(agent.subindustry);
    const category = emergencyCategoryForBusinessType(agent.subindustry);

    // Only a dental practice inherits the legacy proactive triage script. Every
    // other subindustry — including medical — answers administratively and
    // reacts to reported danger through the global safety rules instead.
    expect(policy.emergencyScreeningEnabled).toBe(category === "DENTAL");

    if (agent.industry !== "Healthcare") {
      expect(category).toBe("NONE");
      expect(policy.emergencyScreeningEnabled).toBe(false);
    }
  });

  it.each(NON_HEALTHCARE)("$subindustry: booking node labels use the buyer's booking type", (agent) => {
    const workflow = makeWorkflow(agent);
    const serialized = JSON.stringify(workflow);

    expect(serialized).not.toMatch(DENTAL_ONLY);
    expect(serialized).toContain(agent.bookingLabel);
  });
});

describe("Triven catalog — confirmation SMS never ships with holes", () => {
  function providers() {
    const checkAvailability = vi.fn(async () => ({
      slots: ["2099-01-05 10:00 AM"],
      source: "test" as const,
      note: "slots"
    }));
    const bookAppointment = vi.fn(async () => ({
      status: "confirmed" as const,
      confirmationId: "c1",
      calendarEventId: "e1",
      note: "booked"
    }));
    const send = vi.fn(async () => ({ status: "simulated" as const, note: "sms" }));
    const complete = vi.fn(async () => "Sure, I can help with that.");

    const runtimeProviders: AgentProviders = {
      mode: "business_test",
      telephonyEnabled: false,
      calendar: { checkAvailability, bookAppointment },
      sms: { send },
      llm: { complete }
    };

    return { runtimeProviders, send };
  }

  const sample = NON_HEALTHCARE.slice(0, 5);

  it.each(sample)(
    "$subindustry: a consented follow-up SMS with no booking is still a complete sentence",
    async (agent) => {
      const workflow = makeWorkflow(agent);
      expect(parseGraph(workflow, "phone_call").executionOrder).toHaveLength(6);

      const { runtimeProviders, send } = providers();

      await runAgentWorkflow({
        workflowId: `generic-${agent.name}`,
        workflowJson: workflow,
        mode: "business_test",
        input: {
          channel: "phone_call",
          event: "user_message",
          // Asks for a text WITHOUT booking, so service/date/time never resolve.
          message: "Can you text me your address? My number is 555-123-9999.",
          history: [],
          business: {
            name: "Genericity Test Business",
            type: agent.subindustry,
            assistantName: "Avery",
            timezone: "America/New_York",
            calendarId: "primary",
            appointmentService: agent.bookingLabel,
            services: [agent.bookingLabel],
            faqs: []
          },
          caller: { name: "Jordan", phone: "+15551239999" }
        },
        providers: runtimeProviders
      });

      for (const call of send.mock.calls) {
        const body = call[0]?.body ?? "";
        // No unfilled placeholders, and no collapsed "Confirmed:  on  at" gaps.
        expect(body).not.toMatch(/\[[^\]]+\]/);
        expect(body).not.toMatch(/\s{2,}/);
        expect(body).not.toMatch(/\b(on|at|with)\s*[.,]/);
      }
    }
  );
});
