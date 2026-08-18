import { describe, expect, it } from "vitest";
import { buildCallNote, splitSpokenName } from "./call-sync.service";
import { contactDisplayName, resolveStage, toHubSpotProperties } from "./utils/mapping";
import { phoneMatchKey, phoneSearchVariants, toE164 } from "./utils/phone";

/**
 * The rule under test throughout: consumer callers have a phone number and
 * often NOTHING else. Nothing in this pipeline may invent a name, an email or
 * a company, and nothing may block on their absence.
 */

describe("splitSpokenName", () => {
  it("splits a spoken full name", () => {
    expect(splitSpokenName("Maria Gomez")).toEqual({ firstName: "Maria", lastName: "Gomez" });
  });

  it("keeps a single spoken token as the first name only", () => {
    expect(splitSpokenName("Maria")).toEqual({ firstName: "Maria", lastName: null });
  });

  it("keeps multi-word surnames intact", () => {
    expect(splitSpokenName("Ana Maria de la Cruz")).toEqual({
      firstName: "Ana",
      lastName: "Maria de la Cruz"
    });
  });

  it("returns nulls when no name was collected — never a placeholder", () => {
    expect(splitSpokenName(null)).toEqual({ firstName: null, lastName: null });
    expect(splitSpokenName("   ")).toEqual({ firstName: null, lastName: null });
  });
});

describe("buildCallNote", () => {
  const base = { businessId: "b1", customerPhone: "+15551234567" };

  it("carries the AI summary with outcome and duration", () => {
    const note = buildCallNote({
      ...base,
      summary: "Caller booked a cleaning for Tuesday.",
      outcome: "BOOKED",
      durationSeconds: 185
    });

    expect(note).toContain("Phone call");
    expect(note).toContain("outcome: Booked");
    expect(note).toContain("3m 5s");
    expect(note).toContain("Caller booked a cleaning for Tuesday.");
  });

  it("is honest when no summary was captured", () => {
    expect(buildCallNote(base)).toContain("No summary was captured for this call.");
  });

  it("labels non-voice channels", () => {
    expect(buildCallNote({ ...base, channel: "WHATSAPP" })).toContain("Whatsapp conversation");
  });
});

describe("toHubSpotProperties", () => {
  it("omits fields that were not supplied", () => {
    const properties = toHubSpotProperties({ firstName: "Maria" });
    expect(properties).toEqual({ firstname: "Maria" });
    // The critical assertion: no fabricated email or company.
    expect(properties).not.toHaveProperty("email");
    expect(properties).not.toHaveProperty("company");
  });

  it("clears a field only when explicitly set to null", () => {
    expect(toHubSpotProperties({ email: null })).toEqual({ email: "" });
  });

  it("normalizes phone to E.164", () => {
    expect(toHubSpotProperties({ phone: "(555) 123-4567" }).phone).toBe("+15551234567");
  });

  it("maps vip to a string flag", () => {
    expect(toHubSpotProperties({ vip: true }).vip).toBe("true");
    expect(toHubSpotProperties({ vip: false }).vip).toBe("false");
  });
});

describe("contactDisplayName", () => {
  it("prefers a real name", () => {
    expect(contactDisplayName({ firstName: "Maria", lastName: "Gomez" })).toBe("Maria Gomez");
  });

  it("falls back to the phone number for a nameless consumer contact", () => {
    expect(contactDisplayName({ phone: "+15551234567" })).toBe("+15551234567");
  });

  it("falls back to email before giving up", () => {
    expect(contactDisplayName({ email: "a@b.com" })).toBe("a@b.com");
  });
});

describe("resolveStage", () => {
  it("prefers lead status over lifecycle stage", () => {
    expect(resolveStage({ hs_lead_status: "IN_PROGRESS", lifecyclestage: "lead" })).toBe(
      "In Progress"
    );
  });

  it("returns null when the portal populates neither", () => {
    expect(resolveStage({})).toBeNull();
  });
});

describe("phone helpers", () => {
  it("normalizes a national number to E.164", () => {
    expect(toE164("(555) 123-4567")).toBe("+15551234567");
  });

  it("returns null for unusable input rather than guessing", () => {
    expect(toE164("")).toBeNull();
    expect(toE164("12345")).toBeNull();
  });

  it("produces the variants a CRM might actually store", () => {
    const variants = phoneSearchVariants("+1 555 123 4567");
    // CRMs store whatever a human typed, so an E.164-only search misses people.
    expect(variants).toContain("+15551234567");
    expect(variants).toContain("15551234567");
    expect(variants).toContain("5551234567");
  });

  it("matches formats through a last-10-digits key", () => {
    expect(phoneMatchKey("+1 (555) 123-4567")).toBe(phoneMatchKey("555-123-4567"));
  });
});
