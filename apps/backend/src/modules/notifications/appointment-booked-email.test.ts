import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  isPlatformMailConfigured: vi.fn(),
  sendAppointmentBookedEmail: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: mocks.findUnique
    }
  }
}));

vi.mock("../../lib/mailer", () => ({
  isPlatformMailConfigured: mocks.isPlatformMailConfigured,
  sendAppointmentBookedEmail: mocks.sendAppointmentBookedEmail
}));

import { sendBusinessAppointmentBookedEmail } from "./appointment-booked-email";

const bookedAppointment = {
  id: "appointment-123",
  customerName: "Ravi Buyer",
  customerPhone: "+919876543210",
  service: "Consultation",
  providerName: "Dr. Meera",
  startAt: new Date("2026-07-25T05:00:00.000Z"),
  endAt: new Date("2026-07-25T05:45:00.000Z"),
  timeZone: "Asia/Kolkata",
  calendarEventLink: "https://calendar.google.com/event/123",
  status: "BOOKED",
  executionMode: "LIVE",
  business: {
    name: "Asha Clinic",
    billingEmail: "billing@asha.example",
    owner: {
      email: "owner@asha.example"
    }
  }
};

describe("business appointment-booked notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPlatformMailConfigured.mockReturnValue(true);
    mocks.findUnique.mockResolvedValue(bookedAppointment);
    mocks.sendAppointmentBookedEmail.mockResolvedValue(undefined);
  });

  it("sends the booking details to the business billing email", async () => {
    const result = await sendBusinessAppointmentBookedEmail("appointment-123");

    expect(result).toEqual({
      sent: true,
      recipient: "billing@asha.example"
    });
    expect(mocks.sendAppointmentBookedEmail).toHaveBeenCalledOnce();
    expect(mocks.sendAppointmentBookedEmail).toHaveBeenCalledWith({
      to: "billing@asha.example",
      businessName: "Asha Clinic",
      appointmentId: "appointment-123",
      customerName: "Ravi Buyer",
      customerPhone: "+919876543210",
      service: "Consultation",
      providerName: "Dr. Meera",
      startAt: new Date("2026-07-25T05:00:00.000Z"),
      endAt: new Date("2026-07-25T05:45:00.000Z"),
      timeZone: "Asia/Kolkata",
      appointmentLink: "https://calendar.google.com/event/123"
    });
  });

  it("uses the owner's email when no billing email is configured", async () => {
    mocks.findUnique.mockResolvedValue({
      ...bookedAppointment,
      business: {
        ...bookedAppointment.business,
        billingEmail: null
      }
    });

    const result = await sendBusinessAppointmentBookedEmail("appointment-123");

    expect(result).toEqual({
      sent: true,
      recipient: "owner@asha.example"
    });
    expect(mocks.sendAppointmentBookedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@asha.example" })
    );
  });

  it.each([
    ["test-mode appointment", { executionMode: "BUSINESS_TEST" }],
    ["unconfirmed public request", { status: "REQUESTED" }]
  ])("does not send for a %s", async (_label, override) => {
    mocks.findUnique.mockResolvedValue({
      ...bookedAppointment,
      ...override
    });

    const result = await sendBusinessAppointmentBookedEmail("appointment-123");

    expect(result).toEqual({
      sent: false,
      reason: "NOT_A_LIVE_BOOKING"
    });
    expect(mocks.sendAppointmentBookedEmail).not.toHaveBeenCalled();
  });

  it("does not query booking data when platform email is unavailable", async () => {
    mocks.isPlatformMailConfigured.mockReturnValue(false);

    const result = await sendBusinessAppointmentBookedEmail("appointment-123");

    expect(result).toEqual({
      sent: false,
      reason: "MAIL_NOT_CONFIGURED"
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
