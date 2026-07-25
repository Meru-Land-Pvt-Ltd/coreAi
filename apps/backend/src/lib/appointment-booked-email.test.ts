import { describe, expect, it } from "vitest";
import { buildAppointmentBookedEmailHtml } from "./mailer";

const appointment = {
  businessName: "Asha & Sons Clinic",
  appointmentId: "appointment-123",
  customerName: "Ravi <Buyer>",
  customerPhone: "+91 98765 43210",
  service: "Initial consultation & assessment",
  providerName: "Dr. Meera",
  startAt: new Date("2026-07-25T05:00:00.000Z"),
  endAt: new Date("2026-07-25T05:45:00.000Z"),
  timeZone: "Asia/Kolkata",
  appointmentLink: "https://calendar.google.com/calendar/event?eid=abc"
};

describe("appointment-booked email template", () => {
  it("uses the Triven shell and presents the booking in a readable detail card", () => {
    const html = buildAppointmentBookedEmailHtml(appointment);

    expect(html).toContain("<title>New appointment booked</title>");
    expect(html).toContain('alt="Triven.ai"');
    expect(html).toContain("Asha &amp; Sons Clinic");
    expect(html).toContain("Ravi &lt;Buyer&gt;");
    expect(html).toContain("+91 98765 43210");
    expect(html).toContain("Initial consultation &amp; assessment");
    expect(html).toContain("Saturday, July 25, 2026");
    expect(html).toContain("10:30 AM");
    expect(html).toContain("45 minutes");
    expect(html).toContain("Dr. Meera");
    expect(html).toContain("appointment-123");
    expect(html).toContain(
      'href="https://calendar.google.com/calendar/event?eid=abc"'
    );
    expect(html).toContain("View appointment");
    expect(html).toContain(">Privacy</a>");
    expect(html).toContain(">Help Center</a>");
  });

  it("falls back to the business dashboard for a missing or unsafe event link", () => {
    const html = buildAppointmentBookedEmailHtml({
      ...appointment,
      appointmentLink: "javascript:alert(1)"
    });

    expect(html).toContain('href="http://localhost:3000/business/dashboard"');
    expect(html).not.toContain("javascript:");
  });
});
