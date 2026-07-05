import { env } from "../../config/env";
import { listAvailableSlots } from "../architect/google-calendar-connector";
import { addDays, asRecord, asString, dateOnly, type AgentMessage, type AgentRuntimeMode } from "./runtime-context";

/**
 * Provider adapters. The runtime is identical across modes — these adapters
 * are the only thing that changes between the Architect browser test, the
 * Business browser test, and the live Vapi/Twilio call flow.
 */

export type CalendarAvailabilityInput = {
  calendarId: string;
  timeZone: string;
  date: string;
  maxSlots: number;
  bufferMinutes: number;
  openHour?: number;
  closeHour?: number;
  durationMinutes?: number;
};

export type CalendarAvailabilityResult = {
  /** Date-prefixed labels, e.g. "2026-07-06 10:00 AM". */
  slots: string[];
  source: "calendar" | "test";
  /** Internal note for logs/tool panel — never spoken. */
  note: string;
};

export type CalendarBookingInput = {
  calendarId: string;
  timeZone: string;
  slot: string;
  service: string;
  customerName: string;
  customerPhone: string;
};

export type CalendarBookingResult = {
  status: "confirmed" | "failed";
  confirmationId: string;
  calendarEventId: string;
  note: string;
};

export type SmsSendInput = {
  to: string;
  body: string;
};

export type SmsSendResult = {
  status: "simulated" | "sent" | "failed";
  note: string;
};

export type LlmCompleteInput = {
  systemPrompt: string;
  history: AgentMessage[];
  message: string;
};

export type AgentProviders = {
  mode: AgentRuntimeMode;
  telephonyEnabled: boolean;
  calendar: {
    checkAvailability(input: CalendarAvailabilityInput): Promise<CalendarAvailabilityResult>;
    bookAppointment(input: CalendarBookingInput): Promise<CalendarBookingResult>;
  };
  sms: {
    send(input: SmsSendInput): Promise<SmsSendResult>;
  };
  llm: {
    complete(input: LlmCompleteInput): Promise<string | null>;
  };
};

/**
 * Test slots generated from the configured business-hours window — the same
 * walk the real calendar read performs, just without busy events. Never a
 * fixed hardcoded list.
 */
function fallbackTestSlots(input: CalendarAvailabilityInput): string[] {
  const openHour = input.openHour ?? 9;
  const closeHour = input.closeHour ?? 17;
  const duration = input.durationMinutes ?? 30;
  const step = Math.max(duration + Math.max(input.bufferMinutes, 0), 5);
  const slots: string[] = [];

  for (
    let minutes = openHour * 60;
    minutes + duration <= closeHour * 60 && slots.length < input.maxSlots;
    minutes += step
  ) {
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const meridiem = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

    slots.push(`${input.date} ${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`);
  }

  if (slots.length === 0) {
    const nextDay = dateOnly(addDays(new Date(`${input.date}T00:00:00Z`), 1));
    slots.push(`${nextDay} 10:00 AM`);
  }

  return slots;
}

async function openAiComplete(input: LlmCompleteInput): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.ARCHITECT_TEST_LLM_MODEL,
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          { role: "system", content: input.systemPrompt },
          ...input.history.map((item) => ({ role: item.role, content: item.content })),
          { role: "user", content: input.message }
        ]
      })
    });

    const json = asRecord(await response.json().catch(() => ({})));

    if (!response.ok) {
      const errorRecord = asRecord(json.error);
      throw new Error(asString(errorRecord.message) || `OpenAI returned ${response.status}`);
    }

    const choices = Array.isArray(json.choices) ? json.choices : [];
    const firstChoice = asRecord(choices[0]);
    const message = asRecord(firstChoice.message);

    return asString(message.content) || null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Architect browser call test providers:
 * - Calendar availability reads the architect's connected Google Calendar when
 *   permission exists; otherwise clean test slots (noted in logs only).
 * - Booking and SMS are always dry runs. Telephony/Vapi are disabled.
 */
export function createArchitectTestProviders({ userId }: { userId: string }): AgentProviders {
  return {
    mode: "architect_test",
    telephonyEnabled: false,
    calendar: {
      async checkAvailability(input) {
        try {
          const availability = await listAvailableSlots({
            userId,
            calendarId: input.calendarId,
            timeZone: input.timeZone,
            date: input.date,
            bufferMinutes: input.bufferMinutes,
            maxSlots: input.maxSlots,
            openHour: input.openHour,
            closeHour: input.closeHour,
            durationMinutes: input.durationMinutes
          });

          if (availability.slots.length > 0) {
            return {
              slots: availability.slots.map((slot) => `${input.date} ${slot}`),
              source: "calendar",
              note: "Read availability from the architect's connected Google Calendar."
            };
          }

          return {
            slots: fallbackTestSlots(input),
            source: "test",
            note: "Calendar returned no open slots for that day. Used business-hours test slots instead."
          };
        } catch {
          return {
            slots: fallbackTestSlots(input),
            source: "test",
            note: "Calendar permission missing. Used business-hours test slots. No live Google Calendar read was performed."
          };
        }
      },
      async bookAppointment(input) {
        return {
          status: "confirmed",
          confirmationId: `test_appt_${Date.now()}`,
          calendarEventId: "",
          note: `Created a dry-run booking for ${input.slot}. No live calendar event was created.`
        };
      }
    },
    sms: {
      async send() {
        return {
          status: "simulated",
          note: "Created a test SMS result. No Twilio SMS was sent."
        };
      }
    },
    llm: {
      complete: openAiComplete
    }
  };
}
