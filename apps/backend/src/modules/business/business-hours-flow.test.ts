import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { businessRoutes } from "./routes";
import { buildHoursFactSection } from "./business-facts";
import { loadBusinessHoursState, businessOpenStatusNow } from "./business-hours-state";
import { buildInstalledAgentChatTestSetup } from "./deploy";
import { resolveAppointmentSchedule } from "./scheduling";

const RUN = `hourstest-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
const createdUserIds: string[] = [];

let buyerA = { userId: "", businessId: "", token: "" };
let buyerB = { userId: "", businessId: "", token: "" };
let workflowId = "";

function app() {
  const instance = new Hono();
  instance.route("/business", businessRoutes);
  return instance;
}

function authed(token: string) {
  return {
    get: (path: string) => app().request(path, { headers: { Authorization: `Bearer ${token}` } }),
    put: (path: string, body: unknown) =>
      app().request(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      })
  };
}

const WEEKLY_PAYLOAD = {
  timeZone: "Asia/Kolkata",
  hours: [
    // Mon–Fri share hours with a lunch break; Saturday differs; Sunday closed.
    ...["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => ({
      day,
      closed: false,
      periods: [
        { open: "09:00", close: "13:00" },
        { open: "15:00", close: "18:00" }
      ]
    })),
    { day: "saturday", closed: false, periods: [{ open: "10:00", close: "14:00" }] },
    { day: "sunday", closed: true, periods: [] }
  ],
  specialDates: [
    { date: "2099-12-25", closed: true, periods: [], note: "Christmas", kind: "holiday" as const }
  ]
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[business-hours-flow.test] database unreachable — DB suites skipped");
    return;
  }

  async function createBuyer(key: string) {
    const user = await prisma.user.create({
      data: {
        email: `${RUN}-${key}@test.local`,
        role: "BUSINESS",
        roleMemberships: { create: { role: "BUSINESS" } }
      }
    });
    createdUserIds.push(user.id);
    const business = await prisma.business.create({
      data: { ownerId: user.id, name: `${RUN} ${key}`, type: "Salon" }
    });
    return {
      userId: user.id,
      businessId: business.id,
      token: await createAuthToken({ id: user.id, email: user.email, role: "BUSINESS" })
    };
  }

  [buyerA, buyerB] = await Promise.all([createBuyer("a"), createBuyer("b")]);

  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: buyerA.userId,
      name: `${RUN} workflow`,
      workflowJson: { nodes: [], edges: [] } as never
    }
  });
  workflowId = workflow.id;

  // Buyer A has an installed agent so the demo-context test has a target.
  await prisma.installedAgent.create({
    data: {
      businessId: buyerA.businessId,
      workflowId,
      name: `${RUN} agent`,
      status: "ACTIVE",
      installSource: "FREE_INSTALL"
    }
  });
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.installedAgent.deleteMany({ where: { business: { ownerId: { in: createdUserIds } } } });
    await prisma.workflowDefinition.deleteMany({ where: { architectUserId: { in: createdUserIds } } });
    await prisma.business.deleteMany({ where: { ownerId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe("PUT/GET /business/hours (DB)", () => {
  it("saves a complete weekly schedule with NO document upload and round-trips it", async () => {
    if (!dbAvailable) return;

    const put = await authed(buyerA.token).put("/business/hours", WEEKLY_PAYLOAD);
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as {
      data?: { configured?: boolean; confirmedAt?: string | null; sync?: { status: string } };
    };
    expect(putBody.data?.configured).toBe(true);
    expect(putBody.data?.confirmedAt).toBeTruthy();
    // No Vapi assistant exists — the sync must say so honestly, not "synced".
    expect(putBody.data?.sync?.status).toBe("not_deployed");

    const get = await authed(buyerA.token).get("/business/hours");
    const getBody = (await get.json()) as {
      data?: {
        hours?: Array<{ day: string; closed: boolean; periods: Array<{ open: string }> }>;
        timeZone?: string;
        specialDates?: Array<{ date: string; note?: string }>;
        weeklySummary?: string[];
      };
    };

    const monday = getBody.data?.hours?.find((d) => d.day === "monday");
    expect(monday?.periods).toHaveLength(2);
    const saturday = getBody.data?.hours?.find((d) => d.day === "saturday");
    expect(saturday?.periods?.[0]?.open).toBe("10:00");
    expect(getBody.data?.hours?.find((d) => d.day === "sunday")?.closed).toBe(true);
    expect(getBody.data?.timeZone).toBe("Asia/Kolkata");
    expect(getBody.data?.specialDates?.[0]?.date).toBe("2099-12-25");
    expect(getBody.data?.weeklySummary?.some((line) => line.startsWith("Sunday: Closed"))).toBe(true);
  });

  it("rejects invalid schedules (closing before opening, bad timezone, duplicate dates)", async () => {
    if (!dbAvailable) return;

    const badTimes = await authed(buyerA.token).put("/business/hours", {
      ...WEEKLY_PAYLOAD,
      hours: [{ day: "monday", closed: false, periods: [{ open: "17:00", close: "09:00" }] }]
    });
    expect(badTimes.status).toBe(422);

    const badZone = await authed(buyerA.token).put("/business/hours", {
      ...WEEKLY_PAYLOAD,
      timeZone: "Not/AZone"
    });
    expect(badZone.status).toBe(422);

    const dupDates = await authed(buyerA.token).put("/business/hours", {
      ...WEEKLY_PAYLOAD,
      specialDates: [
        { date: "2099-01-01", closed: true, periods: [], kind: "holiday" },
        { date: "2099-01-01", closed: true, periods: [], kind: "holiday" }
      ]
    });
    expect(dupDates.status).toBe(422);
  });

  it("keeps businesses isolated — buyer B sees no hours from buyer A", async () => {
    if (!dbAvailable) return;

    const get = await authed(buyerB.token).get("/business/hours");
    const body = (await get.json()) as { data?: { configured?: boolean; hours?: unknown } };
    expect(body.data?.configured).toBe(false);
    expect(body.data?.hours).toBeNull();

    const stateB = await loadBusinessHoursState(buyerB.businessId);
    expect(stateB.configured).toBe(false);
  });
});

describe("agent answers from structured hours (DB)", () => {
  it("the fact lookup answers open/closed questions from the configured schedule", async () => {
    if (!dbAvailable) return;

    const section = await buildHoursFactSection(buyerA.businessId, "Test Salon");
    expect(section.title).toContain("confirmed configuration");
    expect(section.content).toContain("Weekly schedule:");
    expect(section.content).toContain("Sunday: Closed");
    expect(section.content).toContain("Saturday: 10 AM–2 PM");
    expect(section.content).toContain("2099-12-25: Closed (Christmas)");
    expect(section.content).toMatch(/Right now: (Open now|Currently closed)/);
  });

  it("says hours are NOT confirmed (never guesses) for an unconfigured business", async () => {
    if (!dbAvailable) return;

    const section = await buildHoursFactSection(buyerB.businessId, "No Hours Yet");
    expect(section.title).toContain("not configured");
    expect(section.content).toContain("Do NOT guess");

    const status = await businessOpenStatusNow(buyerB.businessId);
    expect(status.state).toBe("unknown");
  });

  it("the demo/chat-test context carries the schedule with no PDF uploaded", async () => {
    if (!dbAvailable) return;

    const filesCount = await prisma.businessKnowledgeFile.count({
      where: { businessId: buyerA.businessId }
    });
    expect(filesCount).toBe(0); // truly no document

    const setup = await buildInstalledAgentChatTestSetup(buyerA.businessId);
    expect(setup?.context.businessHours).toContain("Business hours (Asia/Kolkata):");
    expect(setup?.context.businessHours).toContain("Sunday: Closed");
  });
});

describe("separation of schedules (DB)", () => {
  it("appointment hours stay separate: business 9–18 with structured appointment 10–17", async () => {
    if (!dbAvailable) return;

    const agent = await prisma.installedAgent.findFirst({
      where: { businessId: buyerA.businessId },
      select: { id: true, configJson: true }
    });

    await prisma.installedAgent.update({
      where: { id: agent!.id },
      data: {
        configJson: {
          ...((agent!.configJson as Record<string, unknown>) ?? {}),
          appointmentSchedule: {
            days: Object.fromEntries(
              ["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => [
                day,
                { open: "10:00", close: "17:00", closed: false }
              ])
            ),
            confirmed: true
          }
        } as never
      }
    });

    const updated = await prisma.installedAgent.findFirst({
      where: { id: agent!.id },
      select: { configJson: true }
    });
    const profile = await prisma.businessProfile.findUnique({
      where: { businessId: buyerA.businessId },
      select: { hoursJson: true, timeZone: true }
    });

    const schedule = resolveAppointmentSchedule({
      configJson: updated!.configJson,
      hoursJson: profile!.hoursJson,
      timeZone: profile!.timeZone
    });
    // Appointment hours (10:00) differ from business hours (09:00) — both kept.
    expect(schedule.source).toBe("configured");
    expect(schedule.days.monday.open).toBe("10:00");

    const businessState = await loadBusinessHoursState(buyerA.businessId);
    expect(businessState.weekly?.find((d) => d.day === "monday")?.periods[0]?.open).toBe("09:00");
  });

  it("a setup save without hours never wipes the confirmed schedule", async () => {
    if (!dbAvailable) return;

    const before = await loadBusinessHoursState(buyerA.businessId);
    expect(before.configured).toBe(true);

    const response = await app().request("/business/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${buyerA.token}` },
      body: JSON.stringify({
        businessName: `${RUN} a`,
        businessType: "Salon",
        forwardToPhone: "",
        services: [],
        faqs: [],
        hours: [],
        knowledge: []
      })
    });
    expect(response.status).toBe(200);

    const after = await loadBusinessHoursState(buyerA.businessId);
    expect(after.configured).toBe(true);
    expect(after.weekly?.find((d) => d.day === "monday")?.periods).toHaveLength(2);
    expect(after.confirmedAt).not.toBeNull();
  });
});
