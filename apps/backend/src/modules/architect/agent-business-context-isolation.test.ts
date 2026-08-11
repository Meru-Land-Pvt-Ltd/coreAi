import { describe, expect, it } from "vitest";
import { buildBusinessContext } from "./twilio-business-routing";

function business() {
  return {
    id: "biz-1",
    ownerId: "owner-1",
    // The account was RENAMED while the second agent was being set up — this is
    // the state that made the first agent speak as the wrong business.
    name: "Aurélie Nail Atelier",
    type: "Nail Salon",
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

/** contextVersion marks a FULLY migrated agent — see AGENT_BUSINESS_CONTEXT_VERSION. */
const NAIL_SALON_DETAILS = {
  contextVersion: 2,
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

  it("does not resurrect a field the buyer deliberately cleared", () => {
    // Owns its context and left escalation/booking blank: the shared profile
    // must NOT fill them, or the sibling's values silently come back.
    const context = buildBusinessContext(business(), "+17252376218", {
      id: "agent-nail-salon",
      configJson: {
        businessDetails: {
          contextVersion: 2,
          services: ["Gel manicure"],
          escalationRules: null,
          bookingUrl: null,
          faqs: []
        }
      }
    });

    expect(context.escalationRules).toBeUndefined();
    expect(context.bookingUrl).not.toBe("https://dreamday.example/book");
    expect(context.faqs).toEqual([]);
  });

  it("keeps profile values for a PARTIALLY migrated agent (no version marker)", () => {
    // Setup has long written a partial businessDetails block. Treating that as
    // full ownership would blank the buyer's FAQs, escalation rules and booking
    // URL — silent data loss for every pre-existing agent.
    const context = buildBusinessContext(business(), "+17252245895", {
      id: "agent-legacy-partial",
      configJson: {
        businessDetails: {
          assistantName: "June Scott",
          businessName: "DreamDayWeddings",
          services: ["Wedding planning"]
        }
      }
    });

    expect(context.services).toEqual(["Wedding planning"]);
    expect(context.escalationRules).toBe("Escalate venue disputes to the planner.");
    expect(context.bookingUrl).toBe("https://dreamday.example/book");
    expect(context.teamPhone).toBe("+15550000001");
    expect(context.faqs.join(" ")).toContain("venues");
  });

  it("speaks and signs as its OWN business name, not the renamed account", () => {
    const context = buildBusinessContext(business(), "+17252245895", {
      id: "agent-wedding",
      configJson: {
        businessDetails: {
          contextVersion: 2,
          businessName: "DreamDayWeddings",
          businessType: "Wedding Planning",
          services: ["Wedding planning"]
        }
      }
    });

    expect(context.businessName).toBe("DreamDayWeddings");
    expect(context.businessName).not.toBe("Aurélie Nail Atelier");
    expect(context.businessType).toBe("Wedding Planning");
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
