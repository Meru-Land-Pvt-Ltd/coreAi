export const GOOGLE_CALENDAR_DISCLOSURE_VERSION = "google-calendar-2026-07-22.1";

export const GOOGLE_CALENDAR_INTEGRATION = "GOOGLE_CALENDAR";

/** The only action that counts as consent. Dismissals are never recorded. */
export const GOOGLE_DISCLOSURE_ACTION_AGREED = "AGREED";

export const GOOGLE_CALENDAR_DISCLOSURE = {
  version: GOOGLE_CALENDAR_DISCLOSURE_VERSION,
  integration: GOOGLE_CALENDAR_INTEGRATION,
  title: "Connect Google Calendar",
  intro:
    "Before you continue to Google, here is exactly what Triven will access and how it is used:",
  bullets: [
    "Triven requests access only to your Google Calendar events and the email address of the connected account.",
    "Calendar event timing is used solely to compute open appointment times and to create, reschedule, or cancel appointments you or your customers request.",
    "Raw calendar event contents (titles, descriptions, attendees) never leave Triven's backend systems and are never shared with AI providers.",
    "Google user data is never used to train or improve AI/ML models, is never sold, and is never used for advertising.",
    "You can disconnect at any time; disconnecting revokes Triven's access with Google and deletes the stored credentials."
  ],
  policyNote:
    "Triven's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. See our Privacy Policy for details.",
  agreeLabel: "Agree and continue to Google",
  cancelLabel: "Cancel"
} as const;
