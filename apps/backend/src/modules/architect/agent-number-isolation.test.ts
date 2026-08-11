import { describe, expect, it } from "vitest";
import { buildBusinessContext } from "./twilio-business-routing";

/**
 * A phone number belongs to exactly one InstalledAgent. When a call arrives on
 * it, only that agent's Vapi assistant may answer.
 *
 * BusinessProfile.vapiAssistantId is per-BUSINESS and last-deploy-wins, so a
 * business holding two agents has one shared value. Falling back to it meant an
 * undeployed agent's number was answered by whichever sibling deployed most
 * recently — a nail salon line answered by a wedding planner, with nothing in
 * the logs marking it wrong.
 */

const WEDDING_ASSISTANT = "cd597a6c-266d-41c9-933c-2ad5f201a32f";
const NAIL_SALON_ASSISTANT = "11111111-2222-3333-4444-555555555555";

function business() {
  return {
    id: "biz-1",
    ownerId: "owner-1",
    name: "DreamDayWeddings",
    type: "Wedding Planning",
    profile: {
      // The last agent to deploy owns this field.
      vapiAssistantId: WEDDING_ASSISTANT,
      vapiPhoneNumberId: "phone-wedding",
      timeZone: "America/New_York",
      calendarId: "primary"
    },
    knowledgeBases: []
  };
}

describe("number → agent isolation", () => {
  it("never lends the business assistant to an agent that has not deployed", () => {
    const context = buildBusinessContext(business(), "+17252376218", {
      id: "agent-nail-salon",
      listingId: "listing-nail",
      // PROVISIONING: deploy never ran, so no assistant was written.
      configJson: {}
    });

    expect(context.vapiAssistantId).toBeUndefined();
    expect(context.vapiPhoneNumberId).toBeUndefined();
    // The call still resolves to the right agent — it simply has nothing to
    // answer with, which the voice webhook turns into a forward or an honest
    // "not deployed yet" message.
    expect(context.installedAgentId).toBe("agent-nail-salon");
  });

  it("uses the agent's own assistant when it has deployed", () => {
    const context = buildBusinessContext(business(), "+17252376218", {
      id: "agent-nail-salon",
      listingId: "listing-nail",
      configJson: { vapiAssistantId: NAIL_SALON_ASSISTANT, vapiPhoneNumberId: "phone-nail" }
    });

    expect(context.vapiAssistantId).toBe(NAIL_SALON_ASSISTANT);
    expect(context.vapiAssistantId).not.toBe(WEDDING_ASSISTANT);
    expect(context.vapiPhoneNumberId).toBe("phone-nail");
  });

  it("treats a blank stored assistant id as undeployed, not as a reason to borrow", () => {
    const context = buildBusinessContext(business(), "+17252376218", {
      id: "agent-nail-salon",
      configJson: { vapiAssistantId: "   " }
    });

    expect(context.vapiAssistantId).toBeUndefined();
  });

  it("keeps the profile fallback for calls with no agent link at all", () => {
    // Legacy single-agent businesses resolve without an InstalledAgent; those
    // must keep working exactly as before.
    const context = buildBusinessContext(business(), "+17252245895");

    expect(context.vapiAssistantId).toBe(WEDDING_ASSISTANT);
    expect(context.vapiPhoneNumberId).toBe("phone-wedding");
  });

  it("gives two agents in one business two different assistants", () => {
    const nail = buildBusinessContext(business(), "+17252376218", {
      id: "agent-nail-salon",
      configJson: { vapiAssistantId: NAIL_SALON_ASSISTANT }
    });
    const wedding = buildBusinessContext(business(), "+17252245895", {
      id: "agent-wedding",
      configJson: { vapiAssistantId: WEDDING_ASSISTANT }
    });

    expect(nail.vapiAssistantId).not.toBe(wedding.vapiAssistantId);
  });
});
