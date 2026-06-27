import { apiDelete, apiGet, apiPost } from "@/lib/api";

export type BusinessFaq = {
  question: string;
  answer: string;
};

export type BusinessKnowledgeItem = {
  title: string;
  content: string;
};

export type BusinessHoursItem = {
  day: string;
  open?: string;
  close?: string;
  closed: boolean;
};

export type BusinessSetupInput = {
  businessName: string;
  businessType: string;
  forwardToPhone: string;
  bookingUrl?: string;
  teamPhone?: string;
  timeZone?: string;
  tone?: string;
  escalationRules?: string;
  services: string[];
  faqs: BusinessFaq[];
  hours: BusinessHoursItem[];
  knowledge: BusinessKnowledgeItem[];
  vapiAssistantId?: string;
  vapiPhoneNumberId?: string;
  calendarId?: string;
  listingId?: string;
  workflowId?: string;
};

export type BusinessSetupData = {
  business: { id: string; name: string; type: string } | null;
  profile: {
    bookingUrl: string | null;
    teamPhone: string | null;
    calendarId: string | null;
    timeZone: string | null;
    tone: string | null;
    escalationRules: string | null;
    services: string[];
    faqs: BusinessFaq[];
    hours: BusinessHoursItem[];
    vapiAssistantId: string | null;
    vapiPhoneNumberId: string | null;
  } | null;
  phoneNumber: {
    phoneNumber: string;
    forwardToPhone: string | null;
    twilioPhoneNumberSid: string | null;
  } | null;
  installedAgent: { id: string; name: string; status: string } | null;
  knowledge: BusinessKnowledgeItem[];
  calendar: { connected: boolean; email: string | null };
  webhooks: {
    voice: string;
    voiceAction: string;
    sms: string;
    vapi: string;
  } | null;
  assignedPhoneNumber?: string;
};

export type BusinessCalendarStatus = {
  connected: boolean;
  email: string | null;
  provider?: string;
  expiresAt?: string | null;
  scopes?: string[];
};

export function getBusinessSetup() {
  return apiGet<BusinessSetupData>("/business/setup");
}

export function saveBusinessSetup(body: BusinessSetupInput) {
  return apiPost<BusinessSetupData>(
    "/business/setup",
    body as unknown as Record<string, unknown>
  );
}

export function getBusinessCalendarStatus() {
  return apiGet<BusinessCalendarStatus>("/business/connectors/google-calendar/status");
}

export function getBusinessCalendarOAuthUrl() {
  return apiGet<{ url: string }>("/business/connectors/google-calendar/oauth-url");
}

export function disconnectBusinessCalendar() {
  return apiDelete<null>("/business/connectors/google-calendar");
}
