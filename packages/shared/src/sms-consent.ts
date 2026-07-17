
export const SMS_MESSAGING_PROGRAM_TRANSACTIONAL_BOOKING = "TRANSACTIONAL_BOOKING";

export const SMS_CONSENT_DISCLOSURE_VERSION = "2026-07-17.v1";

export const SMS_CONSENT_SUPPORT_EMAIL = "info@triven.ai";

export function verbalSmsConsentDisclosure(businessName: string): string {
  return (
    `Would you like to receive transactional text messages from ${businessName} ` +
    "through Triven.ai about this appointment, booking, or service request, " +
    "including confirmations, reminders, updates, cancellations, and " +
    "customer-support messages? Message frequency varies. Message and data " +
    "rates may apply. Reply STOP to opt out or HELP for help. Consent is not " +
    "required to complete the booking or service request. Please say yes or no."
  );
}

export function webFormSmsConsentDisclosure(businessName: string): string {
  return (
    `I agree to receive transactional SMS messages from ${businessName} ` +
    "through Triven.ai regarding appointment confirmations, reminders, booking " +
    "updates, rescheduling notices, cancellations, service updates, and " +
    "customer support. Message frequency varies. Message and data rates may " +
    "apply. Reply STOP to opt out or HELP for help. Consent is not a condition " +
    "of purchase, booking, or receiving services."
  );
}
