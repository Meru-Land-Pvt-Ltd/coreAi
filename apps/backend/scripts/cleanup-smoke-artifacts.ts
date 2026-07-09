import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes("--confirm");
const VAPI = process.argv.includes("--vapi");
const SMOKE_EMAILS = [
  "architect-smoke@example.com",
  "buyer-smoke@example.com",
  // Mail-setup smoke businesses (SES proxy email tests)
  "smile-dental-smoke@example.com",
  "elite-plumbing-smoke@example.com",
  "grand-stay-smoke@example.com"
];
const VAPI_ASSISTANT_ID = "ace422e6-2015-4186-9d89-c95a5e7bf4c3";

async function main() {
  const users = await prisma.user.findMany({ where: { email: { in: SMOKE_EMAILS } }, select: { id: true, email: true, role: true } });
  const userIds = users.map((u) => u.id);
  const workflows = await prisma.workflowDefinition.findMany({ where: { architectUserId: { in: userIds } }, select: { id: true, name: true } });
  const workflowIds = workflows.map((w) => w.id);
  const listings = await prisma.agentListing.findMany({ where: { workflowId: { in: workflowIds } }, select: { id: true, name: true, status: true } });
  const businesses = await prisma.business.findMany({ where: { ownerId: { in: userIds } }, select: { id: true, name: true } });
  const businessIds = businesses.map((b) => b.id);
  const installedAgents = await prisma.installedAgent.findMany({ where: { businessId: { in: businessIds } }, select: { id: true } });

  console.log("=== Smoke artifact inventory ===");
  for (const u of users) console.log(`user            ${u.id}  ${u.email} (${u.role})`);
  for (const w of workflows) console.log(`workflow        ${w.id}  ${w.name}`);
  for (const l of listings) console.log(`listing         ${l.id}  ${l.name} (${l.status})`);
  for (const b of businesses) console.log(`business        ${b.id}  ${b.name}`);
  for (const a of installedAgents) console.log(`installedAgent  ${a.id}`);
  console.log(`vapi assistant  ${VAPI_ASSISTANT_ID}  (delete with --vapi)`);

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --confirm to delete.");
    await prisma.$disconnect();
    return;
  }

  // FK-safe order: leaves first, users last.
  const listingIds = listings.map((l) => l.id);
  const agentIds = installedAgents.map((a) => a.id);
  const steps: Array<[string, () => Promise<{ count: number }>]> = [
    ["conversationMessages", () => prisma.conversationMessage.deleteMany({ where: { conversation: { businessId: { in: businessIds } } } })],
    ["conversations", () => prisma.conversation.deleteMany({ where: { businessId: { in: businessIds } } })],
    ["leads", () => prisma.lead.deleteMany({ where: { businessId: { in: businessIds } } })],
    ["businessPhoneNumbers", () => prisma.businessPhoneNumber.deleteMany({ where: { businessId: { in: businessIds } } })],
    ["installedAgents", () => prisma.installedAgent.deleteMany({ where: { id: { in: agentIds } } })],
    ["knowledgeBases", () => prisma.businessKnowledgeBase.deleteMany({ where: { businessId: { in: businessIds } } })],
    ["businessProfiles", () => prisma.businessProfile.deleteMany({ where: { businessId: { in: businessIds } } })],
    ["emailMessages", () =>
      prisma.emailMessage.deleteMany({
        where: {
          OR: [
            { businessId: { in: businessIds } },
            { toEmail: { endsWith: "@reply.triven.ai" } },
            { fromEmail: { endsWith: "@reply.triven.ai" } }
          ]
        }
      })],
    ["emailAliases", () => prisma.businessEmailAlias.deleteMany({ where: { businessId: { in: businessIds } } })],
    ["businesses", () => prisma.business.deleteMany({ where: { id: { in: businessIds } } })],
    ["agentListings", () => prisma.agentListing.deleteMany({ where: { id: { in: listingIds } } })],
    ["workflows", () => prisma.workflowDefinition.deleteMany({ where: { id: { in: workflowIds } } })],
    ["architectProfiles", () => prisma.architectProfile.deleteMany({ where: { userId: { in: userIds } } })],
    ["emailVerificationCodes", () => prisma.emailVerificationCode.deleteMany({ where: { email: { in: SMOKE_EMAILS } } })],
    ["activeSessions", () => prisma.userActiveSession.deleteMany({ where: { userId: { in: userIds } } })],
    ["loginHistory", () => prisma.userLoginHistory.deleteMany({ where: { userId: { in: userIds } } })],
    ["users", () => prisma.user.deleteMany({ where: { id: { in: userIds } } })]
  ];

  console.log("\n=== Deleting ===");
  for (const [name, run] of steps) {
    try {
      const { count } = await run();
      console.log(`deleted ${count}  ${name}`);
    } catch (error) {
      console.log(`SKIP ${name}: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  if (VAPI && process.env.VAPI_API_KEY) {
    const res = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` }
    });
    console.log(`vapi assistant delete: HTTP ${res.status}`);
  } else {
    console.log("vapi assistant NOT deleted (pass --vapi to delete)");
  }

  await prisma.$disconnect();
  console.log("\nCleanup complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
