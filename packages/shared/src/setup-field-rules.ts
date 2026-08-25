import type { SetupFieldKey, SetupVisibility } from "./setup-visibility.js";

export interface SetupFieldRulesConfig {
  version: number;
  default: SetupVisibility;
  nodes: Record<string, Partial<Record<SetupFieldKey, boolean>>>;
}

export const SETUP_FIELD_RULES: SetupFieldRulesConfig = {
  version: 1,
  default: {
    phone: false,
    callForwarding: false,
    answeringMode: false,
    calendar: false,
    calendly: false,
    mail: false,
    telegram: false,
    deepgram: false,
    smsNote: false,
    businessProfile: false,
    knowledge: false,
    hours: false,
    bookingRules: false,
    aiCallCoverage: false,
    voiceIdentity: false,
    agentBehaviorVoice: false,
    callTest: false,
    calendarTest: false,
    voicePreview: false,
    deepgramTest: false
  },
  nodes: {
    "trigger.twilio_missed_call": {
      phone: true,
      callForwarding: true,
      aiCallCoverage: true,
      callTest: true
    },
    "trigger.phone_call": {
      phone: true,
      callForwarding: true,
      answeringMode: true,
      aiCallCoverage: true,
      hours: true,
      callTest: true
    },
    "trigger.twilio_inbound_sms": {
      phone: true,
      smsNote: true
    },
    "ai.context_reply": {
      businessProfile: true,
      knowledge: true,
      hours: true
    },
    "ai.voice_conversation": {
      businessProfile: true,
      knowledge: true,
      hours: true,
      voiceIdentity: true,
      agentBehaviorVoice: true,
      voicePreview: true
    },
    "ai.knowledge_base_search": {
      knowledge: true
    },
    "calendar.availability": {
      calendar: true,
      hours: true,
      bookingRules: true,
      calendarTest: true
    },
    "calendar.book_appointment": {
      calendar: true,
      hours: true,
      bookingRules: true,
      calendarTest: true
    },
    "communication.send_email": {
      mail: true
    },
    "communication.escalate": {
      mail: true
    },
    "trigger.telegram_message": {
      telegram: true,
      businessProfile: true
    },
    "ai.image_generation": {},
    "ai.deepgram": {
      deepgram: true,
      deepgramTest: true
    },
    "ai.deepgram_stt": {
      deepgram: true,
      deepgramTest: true
    },
    "ai.deepgram_tts": {
      deepgram: true,
      deepgramTest: true
    },
    "trigger.manual": {},
    "ai.memory": {},
    "ai.knowledge": {
      knowledge: true
    },
    "action.send_sms": {
      phone: true,
      smsNote: true
    },
    "communication.send_sms": {
      phone: true,
      smsNote: true
    },
    "action.google_calendar_availability": {
      calendar: true,
      hours: true,
      bookingRules: true,
      calendarTest: true
    },
    "action.google_calendar_create_appointment": {
      calendar: true,
      hours: true,
      bookingRules: true,
      calendarTest: true
    },
    "trigger.calendly": {
      calendly: true
    },
    "action.calendly": {
      calendly: true
    },
    "trigger.calendly_meeting_booked": {
      calendly: true
    },
    "trigger.calendly_meeting_cancelled": {
      calendly: true
    },
    "trigger.calendly_meeting_rescheduled": {
      calendly: true
    },
    "trigger.calendly_routing_form_submitted": {
      calendly: true
    },
    "action.calendly_find_available_times": {
      calendly: true
    },
    "action.calendly_create_scheduling_link": {
      calendly: true
    },
    "integration.gmail_send_email": {
      mail: true
    },
    "integration.gmail_read_emails": {
      mail: true
    },
    "integration.gmail_create_draft": {
      mail: true
    },
    "inbound_sms": {
      phone: true,
      smsNote: true
    },
    "gmail_send": {
      mail: true
    },
    "trigger.gmail_new_email": {
      mail: true
    }
  }
};
