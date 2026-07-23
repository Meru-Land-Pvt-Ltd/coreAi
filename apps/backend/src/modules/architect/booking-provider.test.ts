import { describe, expect, it } from "vitest";
import { buildAppointmentEventContent } from "./google-calendar-connector";
import { resolveRequestedProvider } from "./twilio-business-routing";

describe("resolveRequestedProvider", () => {
  it("reads the doctor argument and trims whitespace", () => {
    expect(resolveRequestedProvider({ doctor: "  Dr.  Patel " })).toBe("Dr. Patel");
  });

  it("accepts neutral aliases for non-dental businesses", () => {
    expect(resolveRequestedProvider({ provider: "Maya (stylist)" })).toBe("Maya (stylist)");
    expect(resolveRequestedProvider({ practitioner: "Dr. Lee" })).toBe("Dr. Lee");
    expect(resolveRequestedProvider({ staff_member: "Sam" })).toBe("Sam");
    expect(resolveRequestedProvider({ doctor_name: "Dr. Kim" })).toBe("Dr. Kim");
  });

  it("returns null when nothing was provided", () => {
    expect(resolveRequestedProvider({})).toBeNull();
    expect(resolveRequestedProvider({ doctor: "   " })).toBeNull();
  });

  it("treats no-preference answers as absent — never guessed", () => {
    for (const answer of ["any", "Anyone", "either", "no preference", "doesn't matter", "first available"]) {
      expect(resolveRequestedProvider({ doctor: answer })).toBeNull();
    }
  });
});

describe("buildAppointmentEventContent", () => {
  const base = {
    businessName: "Bright Smiles Dental",
    customerName: "Jane Doe",
    customerPhone: "+12135550100",
    service: "Cleaning"
  };

  it("puts the doctor and the patient together in the event title", () => {
    const content = buildAppointmentEventContent({ ...base, providerName: "Dr. Patel" });
    expect(content.summary).toBe("Cleaning - Jane Doe with Dr. Patel");
  });

  it("lists the doctor and customer in the event description", () => {
    const content = buildAppointmentEventContent({ ...base, providerName: "Dr. Patel" });
    expect(content.description).toContain("Customer: Jane Doe");
    expect(content.description).toContain("With: Dr. Patel");
    expect(content.description).toContain("Service: Cleaning");
  });

  it("keeps the original title when no provider was chosen", () => {
    const content = buildAppointmentEventContent(base);
    expect(content.summary).toBe("Cleaning - Jane Doe");
    expect(content.description).not.toContain("With:");
  });

  it("falls back to the phone number when the customer name is missing", () => {
    const content = buildAppointmentEventContent({ ...base, customerName: null, providerName: "Dr. Patel" });
    expect(content.summary).toBe("Cleaning - +12135550100 with Dr. Patel");
  });

  it("summaryOverride (test-mode titles) always wins", () => {
    const content = buildAppointmentEventContent({
      ...base,
      providerName: "Dr. Patel",
      summaryOverride: "[TEST] Cleaning"
    });
    expect(content.summary).toBe("[TEST] Cleaning");
  });

  it("an explicit description is preserved verbatim", () => {
    const content = buildAppointmentEventContent({
      ...base,
      providerName: "Dr. Patel",
      description: "Custom description"
    });
    expect(content.description).toBe("Custom description");
  });
});
