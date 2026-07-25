import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import {
  checkBusinessExactTime,
  checkExactTime,
  computeDayAvailability,
  resolveAppointmentSchedule,
  resolveScheduleForBusiness,
  revalidateAndReserveSlot,
  selectSpokenSuggestions,
  type AppointmentSchedule
} from "./scheduling";

/**
 * The scheduling source of truth: full-day availability (never capped by the
 * spoken-suggestion limit), truthful exact-time verdicts, per-weekday hours
 * from the buyer's saved business hours, booking revalidation under a lock,
 * and per-business/per-agent isolation.
 */

const TZ = "America/New_York";

// A fixed reference "now" far in the past relative to test dates: Wed Jul 1 2099? Use
// a now BEFORE the target week so min-notice never interferes unless tested.
const NOW = new Date("2099-01-01T12:00:00Z");

// 2099-01-05 is a Monday; ...-09 Friday; ...-10 Saturday; ...-11 Sunday.
const MONDAY = "2099-01-05";
const FRIDAY = "2099-01-09";
const SATURDAY = "2099-01-10";
const SUNDAY = "2099-01-11";

const CLINIC_HOURS = [
  { day: "Monday", open: "08:00", close: "18:00", closed: false },
  { day: "Tuesday", open: "08:00", close: "18:00", closed: false },
  { day: "Wednesday", open: "08:00", close: "18:00", closed: false },
  { day: "Thursday", open: "08:00", close: "18:00", closed: false },
  { day: "Friday", open: "08:00", close: "17:00", closed: false },
  { day: "Saturday", open: "09:00", close: "14:00", closed: false },
  { day: "Sunday", open: "09:00", close: "17:00", closed: true }
];

function clinicSchedule(overrides: Partial<AppointmentSchedule> = {}): AppointmentSchedule {
  return {
    ...resolveAppointmentSchedule({ configJson: null, hoursJson: CLINIC_HOURS, timeZone: TZ }),
    minNoticeMinutes: 0,
    ...overrides
  };
}

describe("schedule resolution", () => {
  it("initializes per-weekday hours from saved business hours — never one global open/close", () => {
    const schedule = resolveAppointmentSchedule({ configJson: null, hoursJson: CLINIC_HOURS, timeZone: TZ });

    expect(schedule.source).toBe("business_hours");
    expect(schedule.days.monday).toEqual({ open: "08:00", close: "18:00", closed: false });
    expect(schedule.days.thursday).toEqual({ open: "08:00", close: "18:00", closed: false });
    expect(schedule.days.friday).toEqual({ open: "08:00", close: "17:00", closed: false });
    expect(schedule.days.saturday).toEqual({ open: "09:00", close: "14:00", closed: false });
    expect(schedule.days.sunday.closed).toBe(true);
  });

  it("structured appointmentSchedule NARROWS business hours by intersection; defaults safe for unconfigured agents", () => {
    const structured = resolveAppointmentSchedule({
      configJson: {
        appointmentSchedule: {
          days: { monday: { open: "10:00", close: "16:00", closed: false } },
          confirmed: true
        }
      },
      hoursJson: CLINIC_HOURS,
      timeZone: TZ
    });
    // Business Monday 08:00-18:00 ∩ appointment 10:00-16:00 = 10:00-16:00.
    // Business hours are the authoritative boundary → source is business_hours.
    expect(structured.source).toBe("business_hours");
    expect(structured.confirmed).toBe(true);
    expect(structured.days.monday.open).toBe("10:00");
    expect(structured.days.monday.close).toBe("16:00");

    const defaults = resolveAppointmentSchedule({ configJson: null, hoursJson: null, timeZone: TZ });
    expect(defaults.source).toBe("defaults");
    expect(defaults.days.monday.closed).toBe(false);
  });
});

describe("full-day availability", () => {
  it("computes the COMPLETE day — a spoken cap never truncates the calculation", () => {
    const schedule = clinicSchedule({ maxSpokenSuggestions: 5 });
    const day = computeDayAvailability({ schedule, date: MONDAY, busy: [], now: NOW });

    // 8:00–18:00, 30min + 10 buffer → 40-minute steps: 15 slots (last 17:20).
    expect(day.allSlots.length).toBe(15);
    expect(day.spokenSlots.length).toBe(5);
    expect(day.openLabel).toBe("8:00 AM");
    expect(day.closeLabel).toBe("6:00 PM");
    // The real availability includes late-afternoon times the sample may omit.
    expect(day.allSlots.map((slot) => slot.label)).toContain("5:20 PM");
  });

  it("spreads spoken suggestions across the day (morning AND afternoon)", () => {
    const schedule = clinicSchedule({ maxSpokenSuggestions: 5 });
    const day = computeDayAvailability({ schedule, date: MONDAY, busy: [], now: NOW });
    const labels = day.spokenSlots.map((slot) => slot.label);

    expect(labels[0]).toBe("8:00 AM");
    expect(labels[labels.length - 1]).toBe("5:20 PM");
    // At least one mid-day pick between the extremes.
    expect(day.spokenSlots.some((slot) => slot.minutes >= 11 * 60 && slot.minutes <= 15 * 60)).toBe(true);
  });

  it("respects per-weekday hours and closed days", () => {
    const schedule = clinicSchedule();
    expect(computeDayAvailability({ schedule, date: FRIDAY, busy: [], now: NOW }).closeLabel).toBe("5:00 PM");

    const saturday = computeDayAvailability({ schedule, date: SATURDAY, busy: [], now: NOW });
    expect(saturday.openLabel).toBe("9:00 AM");
    expect(saturday.closeLabel).toBe("2:00 PM");

    const sunday = computeDayAvailability({ schedule, date: SUNDAY, busy: [], now: NOW });
    expect(sunday.closed).toBe(true);
    expect(sunday.allSlots).toHaveLength(0);
  });

  it("service-specific durations respect closing time", () => {
    const schedule = clinicSchedule({ serviceDurations: { "root canal": 90 } });
    const day = computeDayAvailability({
      schedule,
      date: MONDAY,
      serviceName: "Root Canal",
      busy: [],
      now: NOW
    });
    // 90-minute service must START by 16:30 to finish before 18:00.
    const lastSlot = day.allSlots[day.allSlots.length - 1];
    expect(lastSlot.minutes).toBeLessThanOrEqual(16 * 60 + 30);
    expect(day.durationMinutes).toBe(90);
  });

  it("busy calendar events block overlapping slots (with buffer)", () => {
    const schedule = clinicSchedule();
    // Busy 10:00–10:30 in TZ on Monday.
    const busyStart = new Date("2099-01-05T15:00:00Z").getTime(); // 10:00 EST
    const busy = [{ start: busyStart, end: busyStart + 30 * 60_000 }];
    const day = computeDayAvailability({ schedule, date: MONDAY, busy, now: NOW });
    const labels = day.allSlots.map((slot) => slot.label);

    expect(labels).not.toContain("10:00 AM");
    // Buffer keeps 9:40 (would pad into 10:00) blocked too.
    expect(labels).not.toContain("9:40 AM");
    expect(labels).toContain("10:40 AM");
  });

  it("min notice removes near-term slots without touching later ones", () => {
    const schedule = clinicSchedule({ minNoticeMinutes: 120 });
    // "Now" is Monday 08:30 in TZ → earliest bookable 10:30 → first slot 10:40.
    const now = new Date("2099-01-05T13:30:00Z");
    const day = computeDayAvailability({ schedule, date: MONDAY, busy: [], now });
    expect(day.allSlots[0].label).toBe("10:40 AM");
  });
});

describe("exact-time verdicts", () => {
  it("5:00 PM is available when free — even though the spoken sample may not include it", () => {
    const schedule = clinicSchedule({ maxSpokenSuggestions: 6 });
    const result = checkExactTime({ schedule, date: MONDAY, hour: 17, minute: 0, busy: [], now: NOW });
    expect(result.verdict).toBe("available");
    expect(result.closeLabel).toBe("6:00 PM");
  });

  it("5:00 PM is occupied when a calendar event covers it — never 'the rest of the day is booked'", () => {
    const schedule = clinicSchedule();
    const busyStart = new Date("2099-01-05T22:00:00Z").getTime(); // 17:00 EST
    const busy = [{ start: busyStart, end: busyStart + 30 * 60_000 }];
    expect(checkExactTime({ schedule, date: MONDAY, hour: 17, minute: 0, busy, now: NOW }).verdict).toBe("occupied");
    // 15:00 the same day stays available.
    expect(checkExactTime({ schedule, date: MONDAY, hour: 15, minute: 0, busy, now: NOW }).verdict).toBe("available");
  });

  it("distinguishes outside-hours, closed, insufficient-time, and past", () => {
    const schedule = clinicSchedule({ serviceDurations: { cleaning: 90 } });

    expect(checkExactTime({ schedule, date: MONDAY, hour: 19, minute: 0, busy: [], now: NOW }).verdict).toBe("outside_hours");
    expect(checkExactTime({ schedule, date: SUNDAY, hour: 10, minute: 0, busy: [], now: NOW }).verdict).toBe("closed_day");
    expect(
      checkExactTime({ schedule, date: MONDAY, hour: 17, minute: 0, serviceName: "teeth cleaning", busy: [], now: NOW }).verdict
    ).toBe("insufficient_time_before_closing");
    expect(
      checkExactTime({ schedule, date: "2098-12-31", hour: 10, minute: 0, busy: [], now: NOW }).verdict
    ).toBe("past");
  });

  it("handles daylight-saving transition days without shifting hours", () => {
    // 2099-03-08 is the US spring-forward Sunday; use Monday 2099-03-09.
    const schedule = clinicSchedule({ maxAdvanceDays: 365 });
    const result = checkExactTime({ schedule, date: "2099-03-09", hour: 17, minute: 0, busy: [], now: NOW });
    expect(result.verdict).toBe("available");
    // 17:00 EDT = 21:00 UTC (not 22:00 as in EST).
    expect(result.startAt).toBe("2099-03-09T21:00:00.000Z");
  });
});

describe("spoken suggestions", () => {
  it("returns all slots when under the cap, else a first/last-inclusive spread", () => {
    const slots = Array.from({ length: 12 }, (_, index) => ({
      startAt: `2099-01-05T${String(9 + index).padStart(2, "0")}:00:00Z`,
      label: `slot-${index}`,
      minutes: (9 + index) * 60
    }));
    expect(selectSpokenSuggestions(slots.slice(0, 3), 5)).toHaveLength(3);

    const sample = selectSpokenSuggestions(slots, 5);
    expect(sample).toHaveLength(5);
    expect(sample[0].label).toBe("slot-0");
    expect(sample[4].label).toBe("slot-11");
  });
});

/* ------------------------------- DB-backed ------------------------------- */

const RUN = `sched-${process.pid}-${Date.now().toString(36)}`;
let dbAvailable = false;
let ownerId = "";
let businessId = "";
let otherBusinessId = "";
let workflowId = "";
let agentAId = "";
let agentBId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[scheduling.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;
  businessId = (await prisma.business.create({ data: { ownerId, name: `${RUN} A`, type: "clinic" } })).id;
  otherBusinessId = (await prisma.business.create({ data: { ownerId, name: `${RUN} B`, type: "spa" } })).id;
  await prisma.businessProfile.create({
    data: { businessId, timeZone: TZ, calendarId: "primary", hoursJson: CLINIC_HOURS }
  });
  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: ownerId }
    })
  ).id;
  agentAId = (
    await prisma.installedAgent.create({
      data: {
        businessId,
        workflowId,
        name: `${RUN} A1`,
        configJson: { appointmentSchedule: { days: { monday: { open: "08:00", close: "18:00", closed: false } }, confirmed: true } }
      }
    })
  ).id;
  agentBId = (
    await prisma.installedAgent.create({
      data: {
        businessId,
        workflowId,
        name: `${RUN} A2`,
        configJson: { appointmentSchedule: { days: { monday: { open: "12:00", close: "20:00", closed: false } }, confirmed: true } }
      }
    })
  ).id;
});

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.appointment.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.installedAgent.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.businessProfile.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("per-agent and per-business isolation", () => {
  it("two agents under one business use their OWN appointment hours", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const a = await resolveScheduleForBusiness({ businessId, installedAgentId: agentAId });
    const b = await resolveScheduleForBusiness({ businessId, installedAgentId: agentBId });

    expect(a.schedule.days.monday.open).toBe("08:00");
    expect(b.schedule.days.monday.open).toBe("12:00");
    // Agent B configured 12:00–20:00, but the business hours (08:00–18:00) are
    // the authoritative outer boundary, so B's close is capped to 18:00 by
    // intersection — an appointment schedule may narrow, never extend (#1).
    expect(b.schedule.days.monday.close).toBe("18:00");
  });

  it("a different business never inherits this business's schedule", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const other = await resolveScheduleForBusiness({ businessId: otherBusinessId });
    expect(other.schedule.source).toBe("defaults");
  });
});

describe("Triven bookings block slots and booking revalidates", () => {
  it("an existing LIVE Triven appointment occupies its exact time", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    // Book Monday 17:00 EST as a live appointment.
    await prisma.appointment.create({
      data: {
        businessId,
        customerPhone: "+15550300001",
        service: "Checkup",
        startAt: new Date("2099-01-05T22:00:00Z"),
        endAt: new Date("2099-01-05T22:30:00Z"),
        timeZone: TZ,
        executionMode: "LIVE",
        status: "BOOKED"
      }
    });

    const check = await checkBusinessExactTime({
      businessId,
      installedAgentId: agentAId,
      date: MONDAY,
      hour: 17,
      minute: 0,
      now: NOW
    });
    // Google is not connected for this fixture user, but Triven's own booking
    // still truthfully occupies 5 PM.
    expect(check.verdict).toBe("occupied");
    expect(check.alternatives.length).toBeGreaterThan(0);

    const free = await checkBusinessExactTime({
      businessId,
      installedAgentId: agentAId,
      date: MONDAY,
      hour: 15,
      minute: 0,
      now: NOW
    });
    expect(free.verdict).toBe("available");
    expect(free.calendarStatus).toBe("not_connected");
  });

  it("two concurrent callers cannot reserve the same slot", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const book = () =>
      revalidateAndReserveSlot({
        businessId,
        installedAgentId: agentAId,
        date: MONDAY,
        hour: 14,
        minute: 0,
        now: NOW,
        createBooking: async () =>
          prisma.appointment.create({
            data: {
              businessId,
              customerPhone: "+15550300002",
              service: "Checkup",
              startAt: new Date("2099-01-05T19:00:00Z"),
              endAt: new Date("2099-01-05T19:30:00Z"),
              timeZone: TZ,
              executionMode: "LIVE",
              status: "BOOKED"
            }
          })
      });

    const [first, second] = await Promise.all([book(), book()]);
    const okCount = [first, second].filter((result) => result.ok).length;
    const occupied = [first, second].find((result) => !result.ok);

    expect(okCount).toBe(1);
    expect(occupied && !occupied.ok ? occupied.result.verdict : null).toBe("occupied");
    expect(await prisma.appointment.count({ where: { businessId, startAt: new Date("2099-01-05T19:00:00Z") } })).toBe(1);
  });
});
