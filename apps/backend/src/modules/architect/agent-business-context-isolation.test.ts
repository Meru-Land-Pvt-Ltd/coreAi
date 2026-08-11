import { describe, expect, it } from "vitest";
import { buildBusinessContext } from "./twilio-business-routing";

/**
 * Business context is per InstalledAgent, not per Business.
 *
 * BusinessProfile holds ONE row per business, so two agents under one business
 * shared a single set of services, FAQs, tone and escalation rules: the second
 * agent's setup wizard showed the first agent's answers, and saving one
 * overwrote the other. Agents now own their context under
 * configJson.businessDetails; the profile survives only as the business-level
 * view and as the fallback for agents installed before the split.
 */

function business() {
  return {
    id: "biz-1",
    ownerId: "owner-1",
    name: "DreamDayWeddings",
    type: "Wedding Planning",
    profile: {
      services: ["Wedding planning", "Venue booking"],
      faqsJson: [{ question: "Do you do venues?", answer: "Yes." }],
      tone: "elegant",
      escalationRules: "Escalate venue disputes to the planner.",
      bookingUrl: "https://dreamday.example/book",
      teamPhone: "+15550000001",
      timeZone: "America/New_York",
      calendarId: "primary"
    },
    knowledgeBases: []
  };
}

const NAIL_SALON_DETAILS = {
  services: ["Gel manicure", "Pedicure"],
  faqs: [{ question: "Do you take walk-ins?", answer: "Yes, before 4pm." }],
  tone: "friendly",
  escalationRules: "Send product-reaction calls to the owner.",
  bookingUrl: "https://nails.example/book",
  teamPhone: "+15550000002"
};

describe("per-agent business context", () => {
  it("answers with the agent's own services and FAQs, never the sibling's", () => {
    const context = buildBusinessContext(business(), "+17252376218", {
      id: "agent-nail-salon",
      configJson: { businessDetails: NAIL_SALON_DETAILS }
    });

    expect(context.services).toEqual(["Gel manicure", "Pedicure"]);
    expect(context.services).not.toContain("Wedding planning");
    expect(context.faqs.join(" ")).toContain("walk-ins");
    expect(context.faqs.join(" ")).not.toContain("venues");
  });

  it("uses the agent's own tone, escalation rules, booking URL and team phone", () => {
    const context = buildBusinessContext(business(), "+17252376218", {
      id: "agent-nail-salon",
      configJson: { businessDetails: NAIL_SALON_DETAILS }
    });

    expect(context.tone).toBe("friendly");
    expect(context.escalationRules).toBe("Send product-reaction calls to the owner.");
    expect(context.bookingUrl).toBe("https://nails.example/book");
    expect(context.teamPhone).toBe("+15550000002");
  });

  it("falls back to the profile for agents installed before the split", () => {
    const context = buildBusinessContext(business(), "+17252245895", {
      id: "agent-legacy",
      configJson: {}
    });

    expect(context.services).toEqual(["Wedding planning", "Venue booking"]);
    expect(context.tone).toBe("elegant");
    expect(context.bookingUrl).toBe("https://dreamday.example/book");
  });

  it("keeps two agents in one business fully separated", () => {
    const nail = buildBusinessContext(business(), "+17252376218", {
      id: "agent-nail-salon",
      configJson: { businessDetails: NAIL_SALON_DETAILS }
    });
    const wedding = buildBusinessContext(business(), "+17252245895", {
      id: "agent-wedding",
      configJson: {
        businessDetails: {
          services: ["Wedding planning"],
          tone: "elegant",
          teamPhone: "+15550000001"
        }
      }
    });

    expect(nail.services).not.toEqual(wedding.services);
    expect(nail.tone).not.toBe(wedding.tone);
    expect(nail.teamPhone).not.toBe(wedding.teamPhone);
  });

  it("keeps calendar and timezone business-level — one business, one clock", () => {
    const context = buildBusinessContext(business(), "+17252376218", {
      id: "agent-nail-salon",
      configJson: { businessDetails: NAIL_SALON_DETAILS }
    });

    expect(context.timeZone).toBe("America/New_York");
    expect(context.calendarId).toBe("primary");
  });
});
