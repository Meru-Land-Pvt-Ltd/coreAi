import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appointmentFindUnique: vi.fn(),
  appointmentUpdate: vi.fn(),
  appointmentUpdateMany: vi.fn(),
  agentFindUnique: vi.fn(),
  reminderUpsert: vi.fn(),
  reminderUpdateMany: vi.fn(),
  reminderFindMany: vi.fn(),
  reminderUpdate: vi.fn()
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: mocks.appointmentFindUnique,
      update: mocks.appointmentUpdate,
      updateMany: mocks.appointmentUpdateMany
    },
    installedAgent: { findUnique: mocks.agentFindUnique },
    appointmentReminder: {
      upsert: mocks.reminderUpsert,
      updateMany: mocks.reminderUpdateMany,
      findMany: mocks.reminderFindMany,
      update: mocks.reminderUpdate
    }
  }
}));

import {
  DEFAULT_REMINDER_OFFSETS_MINUTES,
  MAX_REMINDER_OFFSET_MINUTES,
  MIN_REMINDER_OFFSET_MINUTES,
  resolveReminderConfig
} from "./reminder-config";
import {
  cancelRemindersForAppointment,
  reminderDedupeKey,
  rescheduleRemindersForAppointment,
  scheduleRemindersForAppointment
} from "./reminder-service";

const HOUR_MS = 60 * 60 * 1000;

function baseAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "appt-1",
    businessId: "biz-1",
    installedAgentId: "agent-1",
    startAt: new Date(Date.now() + 48 * HOUR_MS),
    status: "BOOKED",
    executionMode: "LIVE",
    ...overrides
  };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.reminderUpsert.mockResolvedValue({ id: "rem-1" });
  mocks.reminderUpdateMany.mockResolvedValue({ count: 1 });
  mocks.reminderUpdate.mockResolvedValue({ id: "rem-1" });
  mocks.reminderFindMany.mockResolvedValue([]);
  mocks.agentFindUnique.mockResolvedValue({ configJson: null });
});

describe("resolveReminderConfig", () => {
  it("defaults to enabled with a single 24h offset when config is absent", () => {
    for (const configJson of [null, undefined, {}, { reminders: null }, "junk", 42]) {
      expect(resolveReminderConfig(configJson)).toEqual({
        enabled: true,
        offsetsMinutes: DEFAULT_REMINDER_OFFSETS_MINUTES
      });
    }
  });

  it("clamps offsets into 5..10080, dedupes, and caps at 3", () => {
    const resolved = resolveReminderConfig({
      reminders: { offsetsMinutes: [1, 999999, 60, 60, 30, 45, 90, Number.NaN, "60"] }
    });
    // 1 → 5, 999999 → 10080, dupes and non-numbers dropped, top-3 descending.
    expect(resolved.offsetsMinutes).toEqual([
      MAX_REMINDER_OFFSET_MINUTES,
      90,
      60
    ]);
    expect(resolved.offsetsMinutes.length).toBeLessThanOrEqual(3);
    for (const offset of resolved.offsetsMinutes) {
      expect(offset).toBeGreaterThanOrEqual(MIN_REMINDER_OFFSET_MINUTES);
      expect(offset).toBeLessThanOrEqual(MAX_REMINDER_OFFSET_MINUTES);
    }
  });

  it("respects enabled=false and falls back to defaults for an empty offsets list", () => {
    expect(resolveReminderConfig({ reminders: { enabled: false } }).enabled).toBe(false);
    expect(resolveReminderConfig({ reminders: { offsetsMinutes: [] } }).offsetsMinutes).toEqual(
      DEFAULT_REMINDER_OFFSETS_MINUTES
    );
  });
});

describe("scheduleRemindersForAppointment", () => {
  it("schedules one row per future offset, keyed on appointmentId:offsetMinutes", async () => {
    mocks.appointmentFindUnique.mockResolvedValue(baseAppointment());
    mocks.agentFindUnique.mockResolvedValue({
      configJson: { reminders: { offsetsMinutes: [24 * 60, 60] } }
    });

    const result = await scheduleRemindersForAppointment({ appointmentId: "appt-1" });

    expect(result).toEqual({ scheduled: 2, skippedPast: 0, skippedReason: null });
    expect(mocks.reminderUpsert).toHaveBeenCalledTimes(2);
    const keys = mocks.reminderUpsert.mock.calls.map((call) => call[0].where.dedupeKey);
    expect(keys).toEqual(["appt-1:1440", "appt-1:60"]);
    expect(reminderDedupeKey("appt-1", 1440)).toBe("appt-1:1440");

    // sendAt is plain UTC instant math: startAt - offset.
    const appointment = mocks.appointmentFindUnique.mock.results[0].value;
    const create = mocks.reminderUpsert.mock.calls[0][0].create;
    expect(create.sendAt.getTime()).toBe(
      (await appointment).startAt.getTime() - 1440 * 60 * 1000
    );
    expect(create.status).toBe("SCHEDULED");
    expect(create.businessId).toBe("biz-1");
  });

  it("skips offsets whose sendAt is already in the past (or under 2 minutes away)", async () => {
    // Appointment in 2 hours: the 24h offset already passed, 60min is fine.
    mocks.appointmentFindUnique.mockResolvedValue(
      baseAppointment({ startAt: new Date(Date.now() + 2 * HOUR_MS) })
    );
    mocks.agentFindUnique.mockResolvedValue({
      configJson: { reminders: { offsetsMinutes: [24 * 60, 60] } }
    });

    const result = await scheduleRemindersForAppointment({ appointmentId: "appt-1" });

    expect(result.scheduled).toBe(1);
    expect(result.skippedPast).toBe(1);
    expect(mocks.reminderUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.reminderUpsert.mock.calls[0][0].where.dedupeKey).toBe("appt-1:60");
  });

  it("never schedules for non-LIVE or non-BOOKED appointments", async () => {
    mocks.appointmentFindUnique.mockResolvedValueOnce(
      baseAppointment({ executionMode: "BUSINESS_TEST" })
    );
    expect(await scheduleRemindersForAppointment({ appointmentId: "appt-1" })).toMatchObject({
      scheduled: 0,
      skippedReason: "NOT_LIVE"
    });

    mocks.appointmentFindUnique.mockResolvedValueOnce(baseAppointment({ status: "CANCELLED" }));
    expect(await scheduleRemindersForAppointment({ appointmentId: "appt-1" })).toMatchObject({
      scheduled: 0,
      skippedReason: "NOT_BOOKED"
    });

    expect(mocks.reminderUpsert).not.toHaveBeenCalled();
  });

  it("schedules nothing when the agent config disables reminders", async () => {
    mocks.appointmentFindUnique.mockResolvedValue(baseAppointment());
    mocks.agentFindUnique.mockResolvedValue({ configJson: { reminders: { enabled: false } } });

    const result = await scheduleRemindersForAppointment({ appointmentId: "appt-1" });

    expect(result.skippedReason).toBe("DISABLED");
    expect(mocks.reminderUpsert).not.toHaveBeenCalled();
  });

  it("is idempotent: the same dedupeKey twice keeps single-row semantics and never rewinds SENT", async () => {
    mocks.appointmentFindUnique.mockResolvedValue(baseAppointment());
    mocks.agentFindUnique.mockResolvedValue({
      configJson: { reminders: { offsetsMinutes: [60] } }
    });

    await scheduleRemindersForAppointment({ appointmentId: "appt-1" });
    await scheduleRemindersForAppointment({ appointmentId: "appt-1" });

    // Both passes target the SAME unique dedupeKey → one row in the DB.
    expect(mocks.reminderUpsert).toHaveBeenCalledTimes(2);
    for (const call of mocks.reminderUpsert.mock.calls) {
      expect(call[0].where.dedupeKey).toBe("appt-1:60");
      // The upsert's update branch is a deliberate no-op...
      expect(call[0].update).toEqual({});
    }
    // ...and the real refresh is guarded so SENT rows are never rewound.
    for (const call of mocks.reminderUpdateMany.mock.calls) {
      expect(call[0].where.status).toEqual({ notIn: ["SENT"] });
      expect(call[0].data.status).toBe("SCHEDULED");
    }
  });

  it("never modifies the appointment row", async () => {
    mocks.appointmentFindUnique.mockResolvedValue(baseAppointment());
    await scheduleRemindersForAppointment({ appointmentId: "appt-1" });
    expect(mocks.appointmentUpdate).not.toHaveBeenCalled();
    expect(mocks.appointmentUpdateMany).not.toHaveBeenCalled();
  });
});

describe("cancelRemindersForAppointment", () => {
  it("cancels only still-pending reminders (SCHEDULED/RETRYING)", async () => {
    mocks.reminderUpdateMany.mockResolvedValue({ count: 2 });

    const cancelled = await cancelRemindersForAppointment("appt-1");

    expect(cancelled).toBe(2);
    expect(mocks.reminderUpdateMany).toHaveBeenCalledWith({
      where: { appointmentId: "appt-1", status: { in: ["SCHEDULED", "RETRYING"] } },
      data: { status: "CANCELLED" }
    });
  });
});

describe("rescheduleRemindersForAppointment", () => {
  it("recomputes sendAt for non-SENT rows from the current startAt and cancels rows now in the past", async () => {
    const startAt = new Date(Date.now() + 2 * HOUR_MS);
    mocks.appointmentFindUnique.mockResolvedValue(baseAppointment({ startAt }));
    mocks.reminderFindMany.mockResolvedValue([
      { id: "rem-future", offsetMinutes: 60 },
      { id: "rem-past", offsetMinutes: 24 * 60 }
    ]);

    const result = await rescheduleRemindersForAppointment("appt-1");

    expect(result).toEqual({ rescheduled: 1, cancelled: 1 });
    expect(mocks.reminderFindMany.mock.calls[0][0].where.status).toEqual({ notIn: ["SENT"] });

    const updates = new Map(
      mocks.reminderUpdate.mock.calls.map((call) => [call[0].where.id, call[0].data])
    );
    expect(updates.get("rem-future")).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect((updates.get("rem-future") as { sendAt: Date }).sendAt.getTime()).toBe(
      startAt.getTime() - 60 * 60 * 1000
    );
    expect(updates.get("rem-past")).toMatchObject({ status: "CANCELLED" });
  });

  it("degrades to a plain cancel when the appointment is no longer BOOKED", async () => {
    mocks.appointmentFindUnique.mockResolvedValue(baseAppointment({ status: "CANCELLED" }));
    mocks.reminderUpdateMany.mockResolvedValue({ count: 1 });

    const result = await rescheduleRemindersForAppointment("appt-1");

    expect(result).toEqual({ rescheduled: 0, cancelled: 1 });
    expect(mocks.reminderUpdateMany).toHaveBeenCalledWith({
      where: { appointmentId: "appt-1", status: { in: ["SCHEDULED", "RETRYING"] } },
      data: { status: "CANCELLED" }
    });
    expect(mocks.reminderUpdate).not.toHaveBeenCalled();
  });
});
