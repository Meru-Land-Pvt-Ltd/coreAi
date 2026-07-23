import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { businessRoutes } from "./routes";

/**
 * POST /business/setup payload safety: the InstalledAgent configJson is MERGED,
 * never rebuilt — sections a save doesn't send survive untouched (architect
 * phoneRouting fields, appointment schedule, email recipients, custom fields,
 * deploy ids), the profile timezone is owned by the Business Hours editor, and
 * AI Call Coverage persists independently of the answering mode.
 */

const RUN = `cfgsave-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let userId = "";
let businessId = "";
let workflowId = "";
let agentId = "";
let token = "";

function app() {
  const instance = new Hono();
  instance.route("/business", businessRoutes);
  return instance;
}

function postSetup(body: Record<string, unknown>) {
  return app().request("/business/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      businessName: `${RUN} Clinic`,
      businessType: "clinic",
      forwardToPhone: "",
      services: [],
      faqs: [],
      hours: [],
      knowledge: [],
      deploy: false,
      workflowId,
      ...body
    })
  });
}

function getSetup() {
  return app().request("/business/setup", {
    headers: { Authorization: `Bearer ${token}` }
  });
}

const SEED_CONFIG = {
  purpose: "SOME_FLAG",
  vapiAssistantId: "asst_seed_123",
  appointmentSchedule: {
    useBusinessHours: false,
    days: { monday: { open: "11:00", close: "15:00", closed: false } },
    defaultDurationMinutes: 45,
    confirmed: true
  },
  scheduling: { bookingLabel: "Visit" },
  emailRecipients: { recipientType: "team", customRecipient: "", cc: [], bcc: [] },
  customFields: [{ key: "parking", label: "Parking", value: "Behind the building" }],
  afterHoursPolicy: {
    enabled: true,
    emergencyScreeningEnabled: true,
    emergencyCategory: "DENTAL",
    emergencyContactMethod: "SMS",
    offerAppointmentBooking: true,
    useEmergencySlots: false,
    allowUrgentCallbackRequest: true
  },
  phoneRouting: {
    mode: "BUSY",
    publicBusinessNumber: "+15550001111",
    setupStatus: "ACTIVE",
    answeringHours: [{ day: "Monday", open: "09:00", close: "17:00", closed: false }]
  }
};

async function readAgentConfig(): Promise<Record<string, any>> {
  const agent = await prisma.installedAgent.findUniqueOrThrow({ where: { id: agentId } });
  return (agent.configJson ?? {}) as Record<string, any>;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[configure-save-preservation.test] database unreachable — suite skipped");
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: `${RUN}@test.local`,
      role: "BUSINESS",
      roleMemberships: { create: { role: "BUSINESS" } }
    }
  });
  userId = user.id;
  token = await createAuthToken({ id: user.id, email: user.email, role: "BUSINESS" });

  businessId = (
    await prisma.business.create({ data: { ownerId: userId, name: `${RUN} Clinic`, type: "clinic" } })
  ).id;

  await prisma.businessProfile.create({
    data: {
      businessId,
      timeZone: "Asia/Kolkata",
      hoursJson: [
        { day: "monday", closed: false, open: "08:00", close: "18:00", periods: [{ open: "08:00", close: "18:00" }] }
      ] as never,
      hoursSource: "manual",
      hoursConfirmedAt: new Date()
    }
  });

  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: userId }
    })
  ).id;

  agentId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId, name: `${RUN} agent`, configJson: SEED_CONFIG as never }
    })
  ).id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.businessKnowledgeBase.deleteMany({ where: { businessId } });
  await prisma.businessPhoneNumber.deleteMany({ where: { businessId } });
  await prisma.businessProfile.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("setup save preserves everything it doesn't own", () => {
  it("a minimal save keeps schedule, routing extras, recipients, custom fields, and deploy ids", async () => {
    if (!dbAvailable) return;

    const res = await postSetup({});
    expect(res.status).toBe(200);

    const config = await readAgentConfig();
    // Unknown/foreign keys survive the merge.
    expect(config.purpose).toBe("SOME_FLAG");
    expect(config.vapiAssistantId).toBe("asst_seed_123");
    // Appointment schedule untouched (custom + confirmed).
    expect(config.appointmentSchedule).toEqual(SEED_CONFIG.appointmentSchedule);
    // Legacy scheduling + email recipients + custom fields survive.
    expect(config.scheduling).toEqual(SEED_CONFIG.scheduling);
    expect(config.emailRecipients).toEqual(SEED_CONFIG.emailRecipients);
    expect(config.customFields).toEqual(SEED_CONFIG.customFields);
    // After-hours policy survives a save that omits it.
    expect(config.afterHoursPolicy).toEqual(SEED_CONFIG.afterHoursPolicy);
    // Architect-written phoneRouting fields and the buyer's mode survive.
    expect(config.phoneRouting.mode).toBe("BUSY");
    expect(config.phoneRouting.publicBusinessNumber).toBe("+15550001111");
    expect(config.phoneRouting.setupStatus).toBe("ACTIVE");
    expect(config.phoneRouting.answeringHours).toEqual(SEED_CONFIG.phoneRouting.answeringHours);

    // Profile: timezone + structured hours untouched by a save without them.
    const profile = await prisma.businessProfile.findUniqueOrThrow({ where: { businessId } });
    expect(profile.timeZone).toBe("Asia/Kolkata");
    expect(Array.isArray(profile.hoursJson)).toBe(true);
    expect((profile.hoursJson as Array<{ open?: string }>)[0]?.open).toBe("08:00");
    expect(profile.hoursConfirmedAt).not.toBeNull();
    expect(profile.vapiAssistantId).toBeNull(); // was never set on the profile — stays unset
  });

  it("AI Call Coverage persists without clobbering mode or the custom schedule", async () => {
    if (!dbAvailable) return;

    const res = await postSetup({ aiCallCoverage: { kind: "business_hours" } });
    expect(res.status).toBe(200);

    let config = await readAgentConfig();
    expect(config.phoneRouting.coverage).toBe("business_hours");
    expect(config.phoneRouting.mode).toBe("BUSY");
    expect(config.phoneRouting.answeringHours).toEqual(SEED_CONFIG.phoneRouting.answeringHours);

    // Custom coverage replaces the answering schedule with the sent rows.
    const custom = await postSetup({
      aiCallCoverage: {
        kind: "custom",
        answeringHours: [{ day: "Friday", open: "10:00", close: "16:00", closed: false }]
      }
    });
    expect(custom.status).toBe(200);
    config = await readAgentConfig();
    expect(config.phoneRouting.coverage).toBe("custom");
    expect(config.phoneRouting.answeringHours).toEqual([
      { day: "Friday", open: "10:00", close: "16:00", closed: false }
    ]);
    expect(config.phoneRouting.publicBusinessNumber).toBe("+15550001111");
  });

  it("GET /business/setup reports coverage and the advisory Business Hours checklist item", async () => {
    if (!dbAvailable) return;

    const res = await getSetup();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, any> };

    expect(body.data.aiCallCoverage).toBe("custom");

    const hoursItem = (body.data.checklist as Array<Record<string, any>>).find(
      (item) => item.key === "business_hours"
    );
    expect(hoursItem).toBeTruthy();
    expect(hoursItem!.required).toBe(false);
    expect(hoursItem!.complete).toBe(true); // hoursConfirmedAt is set
  });

  it("saving an inherited appointment schedule keeps custom day rows for later", async () => {
    if (!dbAvailable) return;

    const res = await postSetup({
      appointmentSchedule: {
        useBusinessHours: true,
        days: { monday: { open: "11:00", close: "15:00", closed: false } },
        defaultDurationMinutes: 45,
        confirmed: true
      }
    });
    expect(res.status).toBe(200);

    const config = await readAgentConfig();
    expect(config.appointmentSchedule.useBusinessHours).toBe(true);
    // Rows are kept so flipping back to custom restores them…
    expect(config.appointmentSchedule.days.monday.open).toBe("11:00");

    // …but the RESOLVED schedule follows Business Hours (08:00 Monday).
    const scheduleRes = await app().request("/business/setup/appointment-schedule", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const scheduleBody = (await scheduleRes.json()) as { data: Record<string, any> };
    expect(scheduleBody.data.schedule.useBusinessHours).toBe(true);
    expect(scheduleBody.data.schedule.source).toBe("business_hours");
    expect(scheduleBody.data.schedule.days.monday.open).toBe("08:00");
  });

  it("legacy CUSTOM_HOURS mode reads back as coverage 'custom'", async () => {
    if (!dbAvailable) return;

    await prisma.installedAgent.update({
      where: { id: agentId },
      data: {
        configJson: {
          ...SEED_CONFIG,
          phoneRouting: { mode: "CUSTOM_HOURS", answeringHours: SEED_CONFIG.phoneRouting.answeringHours }
        } as never
      }
    });

    const res = await getSetup();
    const body = (await res.json()) as { data: Record<string, any> };
    expect(body.data.aiCallCoverage).toBe("custom");
    expect(body.data.answeringMode).toBe("CUSTOM_HOURS");
  });

  it("a save WITH afterHoursPolicy replaces it (normalized) and it reads back on GET /business/setup", async () => {
    if (!dbAvailable) return;

    const res = await postSetup({
      afterHoursPolicy: {
        enabled: true,
        emergencyScreeningEnabled: true,
        emergencyCategory: "SERVICE",
        emergencyContactMethod: "EMAIL",
        offerAppointmentBooking: false,
        greeting: "We're closed right now, {{businessName}} will help tomorrow."
      }
    });
    expect(res.status).toBe(200);

    const config = await readAgentConfig();
    expect(config.afterHoursPolicy.enabled).toBe(true);
    expect(config.afterHoursPolicy.emergencyCategory).toBe("SERVICE");
    expect(config.afterHoursPolicy.emergencyContactMethod).toBe("EMAIL");
    expect(config.afterHoursPolicy.offerAppointmentBooking).toBe(false);
    // Normalizer defaults fill unsent booleans.
    expect(config.afterHoursPolicy.allowUrgentCallbackRequest).toBe(true);
    expect(config.afterHoursPolicy.useEmergencySlots).toBe(false);

    const readBack = await getSetup();
    const body = (await readBack.json()) as { data: Record<string, any> };
    expect(body.data.afterHoursPolicy?.emergencyCategory).toBe("SERVICE");

    // A follow-up save WITHOUT the field preserves the replaced policy.
    const minimal = await postSetup({});
    expect(minimal.status).toBe(200);
    const preserved = await readAgentConfig();
    expect(preserved.afterHoursPolicy.emergencyCategory).toBe("SERVICE");
  });
});
