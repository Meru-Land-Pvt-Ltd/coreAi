import {
  isPlatformMailConfigured,
  sendAppointmentBookedEmail
} from "../../lib/mailer";
import { prisma } from "../../lib/prisma";

export type AppointmentBookedNotificationResult =
  | { sent: true; recipient: string }
  | {
      sent: false;
      reason:
        | "MAIL_NOT_CONFIGURED"
        | "APPOINTMENT_NOT_FOUND"
        | "NOT_A_LIVE_BOOKING"
        | "RECIPIENT_NOT_FOUND";
    };

/**
 * Notify the business buyer after a real appointment is booked.
 *
 * Delivery is deliberately best-effort at the booking call site: an email
 * outage must never roll back a customer appointment that already exists.
 */
export async function sendBusinessAppointmentBookedEmail(
  appointmentId: string
): Promise<AppointmentBookedNotificationResult> {
  if (!isPlatformMailConfigured()) {
    return { sent: false, reason: "MAIL_NOT_CONFIGURED" };
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      service: true,
      providerName: true,
      startAt: true,
      endAt: true,
      timeZone: true,
      calendarEventLink: true,
      status: true,
      executionMode: true,
      business: {
        select: {
          name: true,
          billingEmail: true,
          owner: {
            select: {
              email: true
            }
          }
        }
      }
    }
  });

  if (!appointment) {
    return { sent: false, reason: "APPOINTMENT_NOT_FOUND" };
  }

  if (
    appointment.executionMode !== "LIVE" ||
    !["BOOKED", "CONFIRMED"].includes(appointment.status)
  ) {
    return { sent: false, reason: "NOT_A_LIVE_BOOKING" };
  }

  const recipient =
    appointment.business.billingEmail?.trim() ||
    appointment.business.owner.email.trim();
  if (!recipient) {
    return { sent: false, reason: "RECIPIENT_NOT_FOUND" };
  }

  await sendAppointmentBookedEmail({
    to: recipient,
    businessName: appointment.business.name,
    appointmentId: appointment.id,
    customerName: appointment.customerName,
    customerPhone: appointment.customerPhone,
    service: appointment.service,
    providerName: appointment.providerName,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    timeZone: appointment.timeZone,
    appointmentLink: appointment.calendarEventLink
  });

  return { sent: true, recipient };
}
