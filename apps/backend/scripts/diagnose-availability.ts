import { prisma } from "../src/lib/prisma";
import {
  checkBusinessExactTime,
  computeBusinessAvailability,
  resolveScheduleForBusiness
} from "../src/modules/business/scheduling";

async function main() {
  const nameFilter = process.argv[2] ?? "Dental";
  const business = await prisma.business.findFirst({
    where: { name: { contains: nameFilter, mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, profile: { select: { timeZone: true, calendarId: true } } }
  });
  if (!business) {
    console.log(`No business matching "${nameFilter}"`);
    return;
  }
  console.log("business:", business.name, business.id);
  console.log("profile timeZone:", business.profile?.timeZone ?? null);

  const { schedule, installedAgentId, ownerUserId } = await resolveScheduleForBusiness({
    businessId: business.id
  });
  console.log("installedAgentId:", installedAgentId, "ownerUserId:", ownerUserId);
  console.log("schedule:", JSON.stringify(schedule, null, 2).slice(0, 1500));

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = tomorrow.toLocaleDateString("en-CA", { timeZone: schedule.timeZone });
  console.log("checking date:", date, "timeZone:", schedule.timeZone);

  const day = await computeBusinessAvailability({ businessId: business.id, installedAgentId, date });
  console.log("full-day:", JSON.stringify({
    closed: day.closed,
    calendarStatus: day.calendarStatus,
    totalFreeSlots: day.totalFreeSlots,
    spoken: day.spokenSlots?.map((slot: { label: string }) => slot.label),
    openLabel: day.openLabel,
    closeLabel: day.closeLabel
  }));

  for (const [hour, minute] of [[10, 0], [15, 0], [17, 30]] as const) {
    const check = await checkBusinessExactTime({
      businessId: business.id,
      installedAgentId,
      date,
      hour,
      minute,
      serviceName: "Cleaning"
    });
    console.log(
      `exact ${hour}:${String(minute).padStart(2, "0")} →`,
      JSON.stringify({
        verdict: check.verdict,
        calendarStatus: check.calendarStatus,
        alternatives: check.alternatives?.map((slot: { label: string }) => slot.label)
      })
    );
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
