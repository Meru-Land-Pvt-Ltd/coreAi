import { describe, expect, it } from "vitest";
import { VOICE_NODE_TYPES } from "@coreai/shared";
import { buildEventReminders } from "./google-calendar-connector";
import { customBookingLabelOf, workflowNodeDefaults } from "./twilio-business-routing";

function workflow(overrides: {
  booking?: Record<string, unknown>;
  sms?: Record<string, unknown>;
}) {
  return {
    nodes: [
      { id: "n1", data: { type: VOICE_NODE_TYPES.voiceConversation } },
      { id: "n2", data: { type: VOICE_NODE_TYPES.bookAppointment, ...(overrides.booking ?? {}) } },
      { id: "n3", data: { type: VOICE_NODE_TYPES.sendSms, ...(overrides.sms ?? {}) } }
    ],
    edges: []
  };
}

/** The exact merge loadDentalToolConfig performs: node config is the FLOOR. */
function effectiveConfig(
  workflowJson: unknown,
  buyer: { dentalConfig?: Record<string, unknown>; scheduling?: Record<string, unknown> } = {}
) {
  return {
    ...workflowNodeDefaults(workflowJson),
    ...(buyer.dentalConfig ?? {}),
    ...(buyer.scheduling ?? {})
  };
}

describe("architect Book Appointment node reaches a buyer install", () => {
  it("carries event title, description, reminder, and confirmation message", () => {
    const defaults = workflowNodeDefaults(
      workflow({
        booking: {
          eventTitleFormat: "[Service] — [Patient Name]",
          eventDescription: "Phone: [Patient Phone]\nService: [Service]",
          reminderEnabled: "true",
          reminderTiming: "120",
          confirmationMessage: "You're set for [Service] on [Date]."
        }
      })
    );

    expect(defaults.eventTitleFormat).toBe("[Service] — [Patient Name]");
    expect(defaults.eventDescription).toBe("Phone: [Patient Phone]\nService: [Service]");
    expect(defaults.reminderEnabled).toBe("true");
    expect(defaults.reminderTiming).toBe("120");
    expect(defaults.confirmationMessage).toBe("You're set for [Service] on [Date].");
  });

  it("carries the Send SMS node's templates and both send toggles", () => {
    const defaults = workflowNodeDefaults(
      workflow({
        sms: {
          patientTemplate: "Confirmed: [Service] on [Date].",
          dentistTemplate: "New booking: [Patient Name] [Date].",
          sendToDentist: "false",
          sendToPatient: "true"
        }
      })
    );

    expect(defaults.patientTemplate).toBe("Confirmed: [Service] on [Date].");
    expect(defaults.dentistTemplate).toBe("New booking: [Patient Name] [Date].");
    expect(defaults.sendToDentist).toBe("false");
    expect(defaults.sendToPatient).toBe("true");
  });

  it("accepts the neutral customerTemplate/teamTemplate/sendToTeam aliases", () => {
    const defaults = workflowNodeDefaults(
      workflow({
        sms: { customerTemplate: "Hi [Customer Name]", teamTemplate: "New: [Customer Name]", sendToTeam: true }
      })
    );

    expect(defaults.patientTemplate).toBe("Hi [Customer Name]");
    expect(defaults.dentistTemplate).toBe("New: [Customer Name]");
    expect(defaults.sendToDentist).toBe(true);
  });

  it("omits keys the architect left blank so platform defaults still apply", () => {
    const defaults = workflowNodeDefaults(
      workflow({ booking: { eventTitleFormat: "   ", eventDescription: "" } })
    );

    expect(defaults).not.toHaveProperty("eventTitleFormat");
    expect(defaults).not.toHaveProperty("eventDescription");
  });

  it("a workflow with no nodes contributes nothing", () => {
    expect(workflowNodeDefaults(null)).toEqual({});
    expect(workflowNodeDefaults({ nodes: [] })).toEqual({});
    expect(workflowNodeDefaults({ nodes: "not-an-array" })).toEqual({});
  });
});

describe("buyer configuration still overrides the architect's node values", () => {
  const architect = workflow({
    booking: { eventTitleFormat: "[Service] — [Patient Name]", reminderTiming: "120" },
    sms: { patientTemplate: "Architect copy", sendToDentist: "false" }
  });

  it("configJson.dentalConfig wins over the node", () => {
    const cfg = effectiveConfig(architect, {
      dentalConfig: { patientTemplate: "Buyer copy", sendToDentist: "true" }
    });

    expect(cfg.patientTemplate).toBe("Buyer copy");
    expect(cfg.sendToDentist).toBe("true");
    // Untouched keys still come from the architect.
    expect(cfg.eventTitleFormat).toBe("[Service] — [Patient Name]");
  });

  it("configJson.scheduling wins over both the node and dentalConfig", () => {
    const cfg = effectiveConfig(architect, {
      dentalConfig: { reminderTiming: "60" },
      scheduling: { reminderTiming: "1440" }
    });

    expect(cfg.reminderTiming).toBe("1440");
  });

  it("a buyer who configured nothing gets the architect's values verbatim", () => {
    const cfg = effectiveConfig(architect);

    expect(cfg.eventTitleFormat).toBe("[Service] — [Patient Name]");
    expect(cfg.patientTemplate).toBe("Architect copy");
    expect(cfg.sendToDentist).toBe("false");
    expect(cfg.reminderTiming).toBe("120");
  });
});

describe("architect-defined booking labels", () => {
  it("reads the camelCase bookingType key emitted by the 25-agent setup schema", () => {
    expect(customBookingLabelOf({
      customFields: [{ key: "bookingType", label: "Booking type", value: "Dental appointment" }]
    })).toBe("Dental appointment");
  });

  it("keeps compatibility with legacy keys and label-based fields", () => {
    expect(customBookingLabelOf({
      customFields: [{ key: "booking-type", value: "Service visit" }]
    })).toBe("Service visit");
    expect(customBookingLabelOf({
      customFields: [{ key: "custom-1", label: "Booking label", value: "Legal consultation" }]
    })).toBe("Legal consultation");
  });
});

describe("buildEventReminders", () => {
  it("a configured timing replaces the calendar's defaults for that event", () => {
    expect(buildEventReminders(120)).toEqual({
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 120 },
          { method: "email", minutes: 120 }
        ]
      }
    });
  });

  it("no configuration leaves the calendar owner's own reminders in force", () => {
    // Contributing nothing is deliberate: emitting useDefault:false with an
    // empty override list would silently strip the owner's reminders.
    expect(buildEventReminders(null)).toEqual({});
    expect(buildEventReminders(undefined)).toEqual({});
  });

  it("rejects nonsense values rather than sending them to Google", () => {
    expect(buildEventReminders(Number.NaN)).toEqual({});
    expect(buildEventReminders(-5)).toEqual({});
    expect(buildEventReminders(Number.POSITIVE_INFINITY)).toEqual({});
  });

  it("clamps to Google's four-week maximum and rounds fractional minutes", () => {
    expect(buildEventReminders(999_999).reminders?.overrides[0]?.minutes).toBe(40320);
    expect(buildEventReminders(90.6).reminders?.overrides[0]?.minutes).toBe(91);
  });

  it("zero minutes means at start time, which is valid", () => {
    expect(buildEventReminders(0).reminders?.overrides[0]?.minutes).toBe(0);
  });
});

describe("reminder OFF is distinct from reminder UNCONFIGURED", () => {
  it('"off" suppresses the event reminders instead of falling back to calendar defaults', () => {
    // The bug this guards: mapping reminderEnabled=false to null made Google
    // apply the buyer calendar's own defaults, so switching reminders off in
    // the builder still produced reminders.
    expect(buildEventReminders("off")).toEqual({
      reminders: { useDefault: false, overrides: [] }
    });
  });

  it("unconfigured still means 'leave the calendar owner's defaults alone'", () => {
    expect(buildEventReminders(null)).toEqual({});
  });
});
