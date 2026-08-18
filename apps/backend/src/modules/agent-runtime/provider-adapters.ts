import { zonedWallClockToUtc, type ExecutionMode } from "@coreai/shared";
import { env } from "../../config/env";
import { isWorkspaceDerivedAllowedForChatRuntime } from "../compliance/workspace-ai-guard";
import { checkBusinessExactTime, computeBusinessAvailability } from "../business/scheduling";
import { classifyCalendarError } from "../architect/calendar-errors";
import { listAvailableSlots } from "../architect/google-calendar-connector";
import { createTestCalendarEvent } from "../architect/test-calendar-events";
import { addDays, asRecord, asString, dateOnly, type AgentMessage, type AgentRuntimeMode } from "./runtime-context";

export type CalendarAvailabilityInput = {
  calendarId: string;
  timeZone: string;
  date: string;
  maxSlots: number;
  bufferMinutes: number;
  openHour?: number;
  closeHour?: number;
  durationMinutes?: number;
  /** Caller-requested service — drives service-specific durations. */
  serviceName?: string;
};

export type CalendarAvailabilityResult = {
  /** Date-prefixed labels, e.g. "2026-07-06 10:00 AM" — the FULL day result. */
  slots: string[];
  source: "calendar" | "test" | "unavailable";
  /** Internal note for logs/tool panel — never spoken. */
  note: string;
  /** Balanced sample for conversation; slots stays complete. */
  spoken?: string[];
  totalFree?: number;
  openUntil?: string | null;
  closed?: boolean;
};

export type CalendarBookingInput = {
  calendarId: string;
  timeZone: string;
  slot: string;
  service: string;
  customerName: string;
  customerPhone: string;
  durationMinutes?: number;
};

export type CalendarBookingEventDetails = {
  /** TestCalendarEvent row id — used by the delete-test-event action. */
  testEventId?: string;
  title: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  htmlLink: string | null;
  /** SIMULATED = preview only, CREATED = real Google event. */
  status: "SIMULATED" | "CREATED";
  description?: string;
};

export type CalendarBookingResult = {
  status: "confirmed" | "failed";
  confirmationId: string;
  calendarEventId: string;
  note: string;
  /** Structured event preview/details for the test UI. */
  event?: CalendarBookingEventDetails;
  /** Safe public error code when status is "failed". */
  errorCode?: string;
  remediation?: string;
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
        max_tokens: 1024,
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

/** Parse a runtime slot string ("2026-07-25 3:00 PM") into its UTC start in `timeZone`. */
export function parseSlotStartUtc(slot: string, timeZone: string): Date | null {
  const match = slot.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);

  if (!match) return null;

  const meridiem = (match[4] ?? "").toUpperCase();
  let hour = Number(match[2]) % 12;
  if (meridiem === "PM") hour += 12;
  if (!meridiem) hour = Number(match[2]);

  const parsed = zonedWallClockToUtc(match[1] ?? "", hour, Number(match[3]), timeZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type TestBookingIdentity = {
  /** Calendar owner: the architect for dry runs, the business owner for business tests. */
  ownerUserId: string;
  executionMode: Extract<ExecutionMode, "ARCHITECT_DRY_RUN" | "BUSINESS_TEST">;
  businessId?: string | null;
  installedAgentId?: string | null;
  workflowId?: string | null;
  testSessionId?: string | null;
  businessName: string;
  /** false = simulate (no Google write). Business tests always write; architect
   * dry runs write only when the architect opted into their test calendar. */
  writeRealEvent: boolean;
};

async function bookTestAppointment(
  identity: TestBookingIdentity,
  input: CalendarBookingInput
): Promise<CalendarBookingResult> {
  const startAt = parseSlotStartUtc(input.slot, input.timeZone);

  if (!startAt) {
    return {
      status: "failed",
      confirmationId: "",
      calendarEventId: "",
      note: `Could not interpret the requested time "${input.slot}".`,
      errorCode: "INVALID_APPOINTMENT_TIME",
      remediation: "Provide the date and time again, e.g. \"July 25 at 3:00 PM\"."
    };
  }

  // Must match the length availability offered — a 40-minute service booked
  // as 30 leaves the calendar disagreeing with what the caller was told.
  const durationMinutes = input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : 30;
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

  const result = await createTestCalendarEvent({
    executionMode: identity.executionMode,
    ownerUserId: identity.ownerUserId,
    businessId: identity.businessId,
    installedAgentId: identity.installedAgentId,
    workflowId: identity.workflowId,
    testSessionId: identity.testSessionId,
    serviceName: input.service,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    startAt,
    endAt,
    timeZone: input.timeZone,
    calendarId: input.calendarId,
    businessName: identity.businessName,
    simulate: !identity.writeRealEvent
  });

  if (!result.ok) {
    return {
      status: "failed",
      confirmationId: "",
      calendarEventId: "",
      note: result.error.message,
      errorCode: result.error.code,
      remediation: result.error.remediation
    };
  }

  const event = result.event;

  return {
    status: "confirmed",
    confirmationId: event.testEventId,
    calendarEventId: event.googleEventId ?? "",
    note:
      event.status === "CREATED"
        ? `Created test calendar event "${event.title}" (${event.timeZone}).`
        : `Simulated calendar event "${event.title}" (${event.timeZone}). No live calendar event was created.`,
    event: {
      testEventId: event.testEventId,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      timeZone: event.timeZone,
      htmlLink: event.htmlLink,
      status: event.status,
      description: event.description
    }
  };
}

async function readCalendarAvailability(
  ownerUserId: string,
  ownerLabel: string,
  input: CalendarAvailabilityInput
): Promise<CalendarAvailabilityResult> {
  // Limited Use guard: Google-derived availability may only feed the chat LLM
  // when the OpenAI confirmations are in place. Fail closed to business-hours
  // test slots — no live calendar read at all.
  if (!isWorkspaceDerivedAllowedForChatRuntime()) {
    return {
      slots: fallbackTestSlots(input),
      source: "test",
      note: "Live calendar reads are disabled by platform compliance settings. Used business-hours test slots; no Google Calendar data was read."
    };
  }

  try {
    const availability = await listAvailableSlots({
      userId: ownerUserId,
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
        note: `Read availability from ${ownerLabel}.`
      };
    }

    return {
      slots: fallbackTestSlots(input),
      source: "test",
      note: "Calendar returned no open slots for that day. Used business-hours test slots instead."
    };
  } catch (error) {
    const classified = classifyCalendarError(error, "availability");
    return {
      slots: fallbackTestSlots(input),
      source: "test",
      note: `${classified.userMessage} Used business-hours test slots. No live Google Calendar read was performed. (${classified.code})`
    };
  }
}

/**
 * Business-test availability: the SAME scheduling service live calls use —
 * full-day computation, per-weekday appointment hours, Triven + Google busy.
 * Calendar failures are reported truthfully; no fabricated slots.
 */
async function readBusinessAvailability(
  options: { businessId: string; installedAgentId?: string },
  input: CalendarAvailabilityInput
): Promise<CalendarAvailabilityResult> {
  // Limited Use guard — same fail-closed rule as readCalendarAvailability;
  // the runtime reports honestly that live availability is unavailable.
  if (!isWorkspaceDerivedAllowedForChatRuntime()) {
    return {
      slots: [],
      source: "unavailable",
      note: "Live Google Calendar availability is disabled by platform compliance settings. No slots were offered."
    };
  }

  try {
    const availability = await computeBusinessAvailability({
      businessId: options.businessId,
      installedAgentId: options.installedAgentId ?? null,
      date: input.date,
      serviceName: input.serviceName
    });

    if (availability.calendarStatus !== "connected") {
      return {
        slots: [],
        source: "unavailable",
        note: "Live Google Calendar availability could not be confirmed (connection problem). No slots were offered — reconnect the calendar.",
        openUntil: availability.closeLabel
      };
    }

    if (availability.closed) {
      return {
        slots: [],
        source: "calendar",
        note: "The business is closed on that day.",
        closed: true,
        totalFree: 0,
        openUntil: null
      };
    }

    return {
      slots: availability.allSlots.map((slot) => `${input.date} ${slot.label}`),
      spoken: availability.spokenSlots.map((slot) => `${input.date} ${slot.label}`),
      totalFree: availability.totalFreeSlots,
      openUntil: availability.closeLabel,
      source: "calendar",
      note: `Full-day availability: ${availability.totalFreeSlots} free ${availability.durationMinutes}-minute slots (calendar ${availability.calendarStatus}).`
    };
  } catch (error) {
    const classified = classifyCalendarError(error, "availability");
    return {
      slots: [],
      source: "unavailable",
      note: `${classified.userMessage} No slots were offered — live availability must never be invented. (${classified.code})`
    };
  }
}

export type ArchitectTestProviderOptions = {
  userId: string;
  workflowId?: string;
  testSessionId?: string;
  businessName?: string;
  /** Create real events in the architect's own connected test calendar. */
  useTestCalendar?: boolean;
  /**
   * Public agent-page traffic: availability is ALWAYS business-hours test
   * slots — anonymous visitors must never read the architect's real calendar.
   */
  forceTestAvailability?: boolean;
};

/**
 * Architect dry-run providers:
 * - Calendar availability reads the architect's connected Google Calendar when
 *   permission exists; otherwise clean test slots (noted in logs only).
 * - Booking simulates by default (full preview) or, when the architect opted
 *   in, creates a clearly-marked event in the architect's OWN calendar —
 *   never a buyer's. SMS is always simulated; telephony/Vapi are disabled.
 */
export function createArchitectTestProviders(options: ArchitectTestProviderOptions): AgentProviders {
  const { userId } = options;

  return {
    mode: "architect_test",
    telephonyEnabled: false,
    calendar: {
      checkAvailability: (input) =>
        options.forceTestAvailability
          ? Promise.resolve({
              slots: fallbackTestSlots(input),
              source: "test" as const,
              note: "Public preview: used business-hours test slots. No Google Calendar data was read."
            })
          : readCalendarAvailability(userId, "the architect's connected Google Calendar", input),
      bookAppointment: (input) =>
        bookTestAppointment(
          {
            ownerUserId: userId,
            executionMode: "ARCHITECT_DRY_RUN",
            workflowId: options.workflowId,
            testSessionId: options.testSessionId,
            businessName: options.businessName ?? "Sample Business",
            writeRealEvent: options.useTestCalendar === true
          },
          input
        )
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

export type BusinessTestProviderOptions = {
  /** Business owner user id — the Google Calendar connection belongs to them. */
  ownerUserId: string;
  businessId: string;
  installedAgentId?: string;
  workflowId?: string;
  testSessionId?: string;
  businessName: string;
};

/**
 * Business test providers:
 * - Availability reads the business's own connected Google Calendar.
 * - Booking creates a REAL, clearly-marked test event on the business calendar
 *   so the owner can verify the integration end-to-end.
 * - SMS is simulated (explicit test-recipient sends go through the dedicated
 *   test-sms endpoint). Telephony/Vapi are disabled.
 */
export function createBusinessTestProviders(options: BusinessTestProviderOptions): AgentProviders {
  return {
    mode: "business_test",
    telephonyEnabled: false,
    calendar: {
      checkAvailability: (input) => readBusinessAvailability(options, input),
      bookAppointment: async (input) => {
        // Revalidate with the same rules availability uses before creating the
        // test event — checking and booking can never disagree.
        const startAt = parseSlotStartUtc(input.slot, input.timeZone);
        if (startAt) {
          const wall = new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: input.timeZone
          })
            .format(startAt)
            .split(":");
          const dateInZone = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone }).format(startAt);
          const check = await checkBusinessExactTime({
            businessId: options.businessId,
            installedAgentId: options.installedAgentId ?? null,
            date: dateInZone,
            hour: Number(wall[0]),
            minute: Number(wall[1]),
            serviceName: input.service
          });
          if (check.verdict !== "available") {
            return {
              status: "failed",
              confirmationId: "",
              calendarEventId: "",
              note: `Requested time is not bookable (${check.verdict}).`,
              errorCode: "SLOT_UNAVAILABLE",
              remediation:
                check.alternatives.length > 0
                  ? `Offer these free times instead: ${check.alternatives.map((slot) => slot.label).join(", ")}.`
                  : "Offer another day or time."
            };
          }
        }

        return bookTestAppointment(
          {
            ownerUserId: options.ownerUserId,
            executionMode: "BUSINESS_TEST",
            businessId: options.businessId,
            installedAgentId: options.installedAgentId,
            workflowId: options.workflowId,
            testSessionId: options.testSessionId,
            businessName: options.businessName,
            writeRealEvent: true
          },
          input
        );
      }
    },
    sms: {
      async send() {
        return {
          status: "simulated",
          note: "Business test: SMS simulated. No customer SMS was sent."
        };
      }
    },
    llm: {
      complete: openAiComplete
    }
  };
}
