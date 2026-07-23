import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import {
  isWorkspaceDerivedAllowedForLiveVoice,
  liveVoicePipelineBlockReason,
  resolveDefaultLiveVoicePipeline
} from "../src/modules/compliance/workspace-ai-guard";

async function main() {
  const nameFilter = process.argv[2];
  if (!nameFilter) {
    console.error('Usage: npx tsx scripts/diagnose-google-booking.ts "<business name>"');
    process.exit(1);
  }

  const business = await prisma.business.findFirst({
    where: { name: { contains: nameFilter, mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      ownerId: true,
      profile: { select: { calendarId: true, timeZone: true } }
    }
  });
  if (!business) {
    console.log(`No business matching "${nameFilter}" in THIS database.`);
    console.log("If you tested against production, run this script on the production server.");
    return;
  }
  console.log(`business: ${business.name} (${business.id})`);
  console.log(`calendarId: ${business.profile?.calendarId ?? "primary"} timeZone: ${business.profile?.timeZone ?? "(unset)"}`);

  // 1. Google connection for the owner.
  const credential = await prisma.connectorCredential.findUnique({
    where: { userId_provider: { userId: business.ownerId, provider: "GMAIL" } },
    select: { refreshTokenEnc: true, accessTokenEnc: true, updatedAt: true }
  });
  const connected = Boolean(credential?.refreshTokenEnc || credential?.accessTokenEnc);
  console.log(
    `1. Google connected for owner: ${connected ? `YES (updated ${credential?.updatedAt.toISOString()})` : "NO — complete the Connect step (Google OAuth) as this business owner"}`
  );

  // 2. Limited Use guard on THIS server's env.
  const pipeline = resolveDefaultLiveVoicePipeline();
  const allowed = isWorkspaceDerivedAllowedForLiveVoice(undefined, pipeline);
  console.log(
    `2. Limited Use guard allows Google for live AI: ${allowed ? "YES" : `NO — blocked by ${liveVoicePipelineBlockReason(undefined, pipeline)}; set the compliance env flags and restart`}`
  );

  // 3. Recent appointments and whether each reached Google.
  const appointments = await prisma.appointment.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: {
      createdAt: true,
      customerName: true,
      status: true,
      executionMode: true,
      calendarEventId: true,
      notes: true
    }
  });
  console.log(`3. Last ${appointments.length} appointment(s):`);
  for (const appointment of appointments) {
    const local = !appointment.calendarEventId;
    const reason = local
      ? appointment.notes?.includes("calendar not connected")
        ? "local record (calendar not connected at booking time)"
        : "local record (no Google event — guard restricted or calendar write failed)"
      : "ON GOOGLE CALENDAR";
    console.log(
      `   ${appointment.createdAt.toISOString()} ${appointment.customerName ?? "?"} [${appointment.executionMode}/${appointment.status}] → ${reason}`
    );
  }
  if (appointments.length === 0) console.log("   (none — the calls may have hit a different environment's database)");

  console.log("");
  console.log(
    connected && allowed
      ? "VERDICT: prerequisites are met on this server — NEW bookings should create Google events. If they don't, capture the backend log for one booking and investigate."
      : "VERDICT: bookings will stay LOCAL until every item above says YES. Appointments booked before that will not be backfilled to Google."
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
