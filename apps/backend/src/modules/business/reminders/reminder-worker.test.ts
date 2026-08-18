import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reminderFindMany: vi.fn(),
  reminderUpdateMany: vi.fn(),
  reminderFindUnique: vi.fn(),
  reminderUpdate: vi.fn(),
  businessFindUnique: vi.fn(),
  appointmentUpdate: vi.fn(),
  appointmentUpdateMany: vi.fn(),
  appointmentDelete: vi.fn(),
  sendTrackedSms: vi.fn()
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    appointmentReminder: {
      findMany: mocks.reminderFindMany,
      updateMany: mocks.reminderUpdateMany,
      findUnique: mocks.reminderFindUnique,
      update: mocks.reminderUpdate
    },
    business: { findUnique: mocks.businessFindUnique },
    appointment: {
      update: mocks.appointmentUpdate,
      updateMany: mocks.appointmentUpdateMany,
      delete: mocks.appointmentDelete
    }
  }
}));

vi.mock("../../notifications/sms-notification-service", () => ({
  sendTrackedSms: mocks.sendTrackedSms
}));

import { composeReminderMessage, runReminderSweep } from "./reminder-worker";

const HOUR_MS = 60 * 60 * 1000;

function smsOutcome(overrides: Record<string, unknown> = {}) {
  return {
    attempted: true,
    sent: true,
    simulated: false,
    testCredentials: false,
    alreadySent: false,
    suppressed: false,
    executionId: "exec-1",
    messageSid: "SM123",
    status: "SENT",
    from: "+17250000000",
    messagingServiceSid: null,
    error: null,
    errorCode: null,
    ...overrides
  };
}

function claimedReminder(overrides: Record<string, unknown> = {}) {
  const appointment = {
    id: "appt-1",
    businessId: "biz-1",
    installedAgentId: "agent-1",
    customerPhone: "+15551230000",
    customerName: "Pat",
    service: "Cleaning",
    startAt: new Date(Date.now() + 24 * HOUR_MS),
    timeZone: "America/Los_Angeles",
    status: "BOOKED",
    executionMode: "LIVE",
    ...(overrides.appointment as Record<string, unknown> | undefined)
  };
  return {
    id: "rem-1",
    businessId: "biz-1",
    appointmentId: "appt-1",
    offsetMinutes: 1440,
    sendAt: new Date(Date.now() - 1000),
    channel: "SMS",
    status: "SENDING",
    attempts: 1,
    dedupeKey: "appt-1:1440",
    ...overrides,
    appointment
  };
}

/** Wire up one due reminder that is successfully claimed. */
function primeDue(reminder: ReturnType<typeof claimedReminder>) {
  mocks.reminderFindMany.mockResolvedValue([{ id: reminder.id }]);
  mocks.reminderUpdateMany.mockResolvedValue({ count: 1 });
  mocks.reminderFindUnique.mockImplementation(async (args: { select?: { attempts?: boolean } }) => {
    if (args?.select?.attempts) return { attempts: reminder.attempts };
    return reminder;
  });
  mocks.businessFindUnique.mockResolvedValue({ name: "Bright Smiles Dental" });
}

function reminderUpdateFor(id: string) {
  const call = mocks.reminderUpdate.mock.calls.find((c) => c[0].where.id === id);
  return call?.[0].data as Record<string, unknown> | undefined;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.reminderFindMany.mockResolvedValue([]);
  mocks.reminderUpdate.mockResolvedValue({ id: "rem-1" });
  mocks.sendTrackedSms.mockResolvedValue(smsOutcome());
});

describe("composeReminderMessage", () => {
  it("formats the appointment time in the appointment's timezone", () => {
    // 2026-08-20T17:00:00Z = 10:00 AM in Los Angeles (PDT, UTC-7).
    const body = composeReminderMessage({
      businessName: "Bright Smiles Dental",
      service: "Cleaning",
      startAt: new Date("2026-08-20T17:00:00Z"),
      timeZone: "America/Los_Angeles"
    });
    expect(body).toContain("Reminder from Bright Smiles Dental");
    expect(body).toContain("your Cleaning appointment");
    expect(body).toContain("10:00");
    expect(body).toContain("(America/Los_Angeles)");
    expect(body).toContain("Reply C to cancel.");
  });

  it("omits the service phrase when no service is set and survives a bad timezone", () => {
    const body = composeReminderMessage({
      businessName: "Acme HVAC",
      service: null,
      startAt: new Date("2026-08-20T17:00:00Z"),
      timeZone: "Not/AZone"
    });
    expect(body).toContain("your appointment is on");
    expect(body).not.toContain("undefined");
  });
});

describe("runReminderSweep — claiming", () => {
  it("claims atomically and skips the row when another worker already claimed it (count 0)", async () => {
    mocks.reminderFindMany.mockResolvedValue([{ id: "rem-1" }]);
    mocks.reminderUpdateMany.mockResolvedValue({ count: 0 });

    const summary = await runReminderSweep();

    expect(summary.claimed).toBe(0);
    expect(mocks.sendTrackedSms).not.toHaveBeenCalled();
    expect(mocks.reminderUpdate).not.toHaveBeenCalled();

    // The claim itself must be conditional on the still-claimable statuses.
    const claim = mocks.reminderUpdateMany.mock.calls[0][0];
    expect(claim.where.status).toEqual({ in: ["SCHEDULED", "RETRYING"] });
    expect(claim.data).toMatchObject({ status: "SENDING", attempts: { increment: 1 } });
  });

  it("only queries rows that are due, claimable, and under the attempt cap", async () => {
    await runReminderSweep(new Date("2026-08-13T12:00:00Z"));
    const where = mocks.reminderFindMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["SCHEDULED", "RETRYING"] });
    expect(where.sendAt.lte).toEqual(new Date("2026-08-13T12:00:00Z"));
    expect(where.attempts).toEqual({ lt: 3 });
  });
});

describe("runReminderSweep — outcomes", () => {
  it("marks SENT with providerId and sentAt on a successful send", async () => {
    primeDue(claimedReminder());
    mocks.sendTrackedSms.mockResolvedValue(smsOutcome());

    const summary = await runReminderSweep();

    expect(summary.sent).toBe(1);
    const update = reminderUpdateFor("rem-1");
    expect(update).toMatchObject({ status: "SENT", providerId: "SM123", lastError: null });
    expect(update?.sentAt).toBeInstanceOf(Date);

    // The SMS goes out with the provider-level dedupe key and reminder purpose.
    const sms = mocks.sendTrackedSms.mock.calls[0][0];
    expect(sms.dedupeKey).toBe("appointment-reminder:appt-1:1440");
    expect(sms.smsPurpose).toBe("APPOINTMENT_REMINDER");
    expect(sms.to).toBe("+15551230000");
    expect(sms.appointmentId).toBe("appt-1");
  });

  it("maps a consent-suppressed outcome to terminal SKIPPED_NO_CONSENT with no retry", async () => {
    primeDue(claimedReminder());
    mocks.sendTrackedSms.mockResolvedValue(
      smsOutcome({
        attempted: false,
        sent: false,
        suppressed: true,
        messageSid: null,
        error: "Recipient has opted out of this business's SMS program.",
        errorCode: "SMS_OPTED_OUT"
      })
    );

    const summary = await runReminderSweep();

    expect(summary.skippedNoConsent).toBe(1);
    expect(summary.retried).toBe(0);
    const update = reminderUpdateFor("rem-1");
    expect(update?.status).toBe("SKIPPED_NO_CONSENT");
    expect(String(update?.lastError)).toContain("opted out");
    // Terminal: exactly one status write, nothing pushed back to RETRYING.
    expect(mocks.reminderUpdate).toHaveBeenCalledTimes(1);
  });

  it("treats deterministic rejections (purpose guard / invalid phone) as FAILED without retry", async () => {
    primeDue(claimedReminder());
    mocks.sendTrackedSms.mockResolvedValue(
      smsOutcome({
        attempted: false,
        sent: false,
        suppressed: true,
        messageSid: null,
        error: "Message blocked by the transactional-campaign purpose guard.",
        errorCode: "SMS_PURPOSE_NOT_ALLOWED"
      })
    );

    const summary = await runReminderSweep();

    expect(summary.failed).toBe(1);
    expect(reminderUpdateFor("rem-1")?.status).toBe("FAILED");
  });

  it("retries a transient failure: RETRYING with sendAt pushed by 5min * attempts", async () => {
    primeDue(claimedReminder({ attempts: 1 }));
    mocks.sendTrackedSms.mockResolvedValue(
      smsOutcome({ sent: false, messageSid: null, status: "FAILED", error: "Twilio 500" })
    );

    const now = new Date("2026-08-13T12:00:00Z");
    const summary = await runReminderSweep(now);

    expect(summary.retried).toBe(1);
    const update = reminderUpdateFor("rem-1");
    expect(update?.status).toBe("RETRYING");
    expect(update?.lastError).toBe("Twilio 500");
    expect((update?.sendAt as Date).getTime()).toBe(now.getTime() + 5 * 60 * 1000);
  });

  it("marks FAILED once attempts are exhausted, with lastError truncated to 300 chars", async () => {
    primeDue(claimedReminder({ attempts: 3 }));
    mocks.sendTrackedSms.mockResolvedValue(
      smsOutcome({ sent: false, messageSid: null, status: "FAILED", error: "x".repeat(1000) })
    );

    const summary = await runReminderSweep();

    expect(summary.failed).toBe(1);
    const update = reminderUpdateFor("rem-1");
    expect(update?.status).toBe("FAILED");
    expect(String(update?.lastError)).toHaveLength(300);
  });

  it("cancels the reminder (no SMS) when the appointment was cancelled after scheduling", async () => {
    primeDue(claimedReminder({ appointment: { status: "CANCELLED" } }));

    const summary = await runReminderSweep();

    expect(summary.cancelled).toBe(1);
    expect(mocks.sendTrackedSms).not.toHaveBeenCalled();
    expect(reminderUpdateFor("rem-1")?.status).toBe("CANCELLED");
  });

  it("cancels the reminder (no SMS) when the appointment start time already passed", async () => {
    primeDue(claimedReminder({ appointment: { startAt: new Date(Date.now() - HOUR_MS) } }));

    const summary = await runReminderSweep();

    expect(summary.cancelled).toBe(1);
    expect(mocks.sendTrackedSms).not.toHaveBeenCalled();
    expect(reminderUpdateFor("rem-1")?.status).toBe("CANCELLED");
  });

  it("recovers from a thrown send (network error) via the retry path", async () => {
    primeDue(claimedReminder({ attempts: 1 }));
    mocks.sendTrackedSms.mockRejectedValue(new Error("socket hang up"));

    const summary = await runReminderSweep();

    expect(summary.retried).toBe(1);
    const update = reminderUpdateFor("rem-1");
    expect(update?.status).toBe("RETRYING");
    expect(update?.lastError).toBe("socket hang up");
  });

  it("NEVER touches the appointment row, on any outcome", async () => {
    const outcomes = [
      smsOutcome(),
      smsOutcome({ sent: false, suppressed: true, errorCode: "SMS_CONSENT_REQUIRED" }),
      smsOutcome({ sent: false, error: "Twilio 500" })
    ];
    for (const outcome of outcomes) {
      primeDue(claimedReminder());
      mocks.sendTrackedSms.mockResolvedValue(outcome);
      await runReminderSweep();
    }

    expect(mocks.appointmentUpdate).not.toHaveBeenCalled();
    expect(mocks.appointmentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.appointmentDelete).not.toHaveBeenCalled();
  });
});
