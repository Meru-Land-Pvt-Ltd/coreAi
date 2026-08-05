import { prisma } from "../../lib/prisma";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 5 ? parsed : fallback;
}

export function telegramServiceSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "service";
}

export async function syncTelegramBusinessServices(options: {
  businessId: string;
  installedAgentId: string;
}) {
  const agent = await prisma.installedAgent.findFirst({
    where: {
      id: options.installedAgentId,
      businessId: options.businessId
    },
    include: {
      business: { include: { profile: true } }
    }
  });
  if (!agent) throw new Error("Installed agent was not found.");

  const config = record(agent.configJson);
  const appointmentSchedule = record(config.appointmentSchedule);
  const scheduling = record(config.scheduling);
  const durationMap = record(appointmentSchedule.serviceDurations);
  const defaultDuration = positiveInteger(
    appointmentSchedule.defaultDurationMinutes ?? scheduling.serviceDurationMinutes,
    30
  );
  const bufferMinutes = positiveInteger(
    appointmentSchedule.bufferMinutes ?? scheduling.bufferMinutes,
    10
  );
  const minimumNoticeMinutes = Math.max(0, Number(appointmentSchedule.minNoticeMinutes) || 0);
  const maximumAdvanceDays = Math.max(1, Number(appointmentSchedule.maxAdvanceDays) || 30);
  const names = (agent.business.profile?.services ?? []).map((name) => name.trim()).filter(Boolean);

  const activeSlugs: string[] = [];
  for (const [index, name] of names.entries()) {
    const baseSlug = telegramServiceSlug(name);
    const duplicateCount = activeSlugs.filter((slug) => slug === baseSlug || slug.startsWith(`${baseSlug}-`)).length;
    const slug = duplicateCount > 0 ? `${baseSlug}-${index + 1}` : baseSlug;
    activeSlugs.push(slug);
    const normalizedName = name.toLowerCase();
    const mappedDuration =
      Object.entries(durationMap).find(([key]) => key.toLowerCase() === normalizedName)?.[1] ?? defaultDuration;

    await prisma.businessService.upsert({
      where: {
        businessId_installedAgentId_slug: {
          businessId: options.businessId,
          installedAgentId: options.installedAgentId,
          slug
        }
      },
      create: {
        businessId: options.businessId,
        installedAgentId: options.installedAgentId,
        slug,
        name,
        durationMinutes: positiveInteger(mappedDuration, defaultDuration),
        bufferMinutes,
        minimumNoticeMinutes,
        maximumAdvanceDays,
        calendarId: agent.business.profile?.calendarId || "primary"
      },
      update: {
        name,
        durationMinutes: positiveInteger(mappedDuration, defaultDuration),
        bufferMinutes,
        minimumNoticeMinutes,
        maximumAdvanceDays,
        calendarId: agent.business.profile?.calendarId || "primary",
        active: true
      }
    });
  }

  await prisma.businessService.updateMany({
    where: {
      businessId: options.businessId,
      installedAgentId: options.installedAgentId,
      ...(activeSlugs.length > 0 ? { slug: { notIn: activeSlugs } } : {})
    },
    data: { active: false }
  });

  return prisma.businessService.findMany({
    where: {
      businessId: options.businessId,
      installedAgentId: options.installedAgentId,
      active: true
    },
    orderBy: [{ name: "asc" }, { id: "asc" }]
  });
}

export async function loadTelegramBusinessServices(options: {
  businessId: string;
  installedAgentId: string;
}) {
  // Business Profile is the source of truth. Sync on reads so each buyer can
  // change their own services without leaving stale Telegram menu entries.
  return syncTelegramBusinessServices(options);
}

export async function loadTelegramBusinessService(options: {
  businessId: string;
  installedAgentId: string;
  serviceSlug: string;
}) {
  return prisma.businessService.findFirst({
    where: {
      businessId: options.businessId,
      installedAgentId: options.installedAgentId,
      slug: options.serviceSlug,
      active: true
    }
  });
}
