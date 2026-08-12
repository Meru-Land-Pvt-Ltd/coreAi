/**
 * Complete agent isolation (real local DB; suite skips when unreachable):
 *
 * 1. A newly purchased agent starts COMPLETELY fresh — a configured sibling's
 *    services, FAQs, tone, contact details, hours, and knowledge never appear
 *    pre-filled in its wizard.
 * 2. A reassigned phone number never carries the previous agent's history to
 *    its new holder: phone-based attribution is bounded to the current
 *    assignment window, so old unattributed calls stay unattributed instead of
 *    being billed to the new agent.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { createAuthToken } from "../../lib/jwt";
import { businessRoutes } from "./routes";
import { reconcileBusinessExecutionUsage } from "./execution-billing";

const RUN = `isolation-${process.pid}-${Date.now().toString(36)}`;
const NUMBER = `+1774${String(Date.now()).slice(-7)}`;

let dbAvailable = false;
let ownerId = "";
let token = "";
let businessId = "";
let workflowId = "";
let listingConfiguredId = "";
let listingFreshId = "";
let configuredAgentId = "";
let freshAgentId = "";

function app() {
  const instance = new Hono();
  instance.route("/business", businessRoutes);
  return instance;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[agent-isolation.test] database unreachable — suite skipped");
    return;
  }

  ownerId = (
    await prisma.user.create({
      data: { email: `${RUN}-owner@test.local`, role: "BUSINESS", fullName: "Isolation Owner" }
    })
  ).id;
  await prisma.userRoleMembership.create({ data: { userId: ownerId, role: "BUSINESS" } });
  token = await createAuthToken({ id: ownerId, email: `${RUN}-owner@test.local`, role: "BUSINESS" });

  businessId = (
    await prisma.business.create({
      data: { ownerId, name: `${RUN} Salon`, type: "Nail Salon" }
    })
  ).id;
  // The shared profile carries the FIRST agent's wizard answers — exactly the
  // data that used to appear pre-filled in a newly purchased agent.
  await prisma.businessProfile.create({
    data: {
      businessId,
      services: ["Gel manicure", "Pedicure"],
      faqsJson: [{ question: "Walk-ins?", answer: "Yes" }],
      tone: "friendly",
      escalationRules: "Escalate reactions to the owner.",
      bookingUrl: "https://salon.example/book",
      teamPhone: "+15550001111",
      vapiAssistantId: "assistant-of-agent-a"
    }
  });

  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, architectUserId: ownerId, workflowJson: { nodes: [], edges: [] } }
    })
  ).id;
  const listings = await Promise.all(
    ["configured", "fresh"].map((kind) =>
      prisma.agentListing.create({
        data: {
          name: `${RUN} ${kind}`,
          shortDescription: "isolation test listing",
          status: "APPROVED",
          architectUserId: ownerId,
          workflowId,
          requiredConnectors: [],
          supportedLlms: [],
          tags: []
        },
        select: { id: true }
      })
    )
  );
  listingConfiguredId = listings[0].id;
  listingFreshId = listings[1].id;

  configuredAgentId = (
    await prisma.installedAgent.create({
      data: {
        businessId,
        workflowId,
        listingId: listingConfiguredId,
        name: `${RUN} configured`,
        status: "ACTIVE",
        configJson: {
          assistantName: "June",
          vapiAssistantId: "assistant-of-agent-a",
          businessDetails: {
            contextVersion: 2,
            businessName: `${RUN} Salon`,
            services: ["Gel manicure", "Pedicure"],
            faqs: [{ question: "Walk-ins?", answer: "Yes" }],
            tone: "friendly"
          }
        }
      }
    })
  ).id;
  // Newly purchased: exactly what every install path writes — empty config.
  freshAgentId = (
    await prisma.installedAgent.create({
      data: {
        businessId,
        workflowId,
        listingId: listingFreshId,
        name: `${RUN} fresh`,
        status: "PROVISIONING",
        configJson: {}
      }
    })
  ).id;

  // Manual knowledge owned by the configured agent.
  await prisma.businessKnowledgeBase.create({
    data: {
      businessId,
      installedAgentId: configuredAgentId,
      title: "Aftercare",
      content: "Gel manicure aftercare instructions."
    }
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.agentUsageExecution.deleteMany({ where: { businessId } });
  await prisma.vapiCall.deleteMany({ where: { businessId } });
  await prisma.businessKnowledgeBase.deleteMany({ where: { businessId } });
  await prisma.businessPhoneNumber.deleteMany({ where: { businessId } });
  await prisma.platformPhoneNumber.deleteMany({ where: { phoneNumber: NUMBER } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.agentListing.deleteMany({
    where: { id: { in: [listingConfiguredId, listingFreshId] } }
  });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.businessProfile.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.userRoleMembership.deleteMany({ where: { userId: ownerId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("fresh agent configuration", () => {
  it("serves a completely blank wizard to a newly purchased agent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const response = await app().request(
      `/business/setup?listingId=${listingFreshId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        business: { name: string; type: string } | null;
        profile: {
          services: string[];
          faqs: unknown[];
          tone: string | null;
          escalationRules: string | null;
          bookingUrl: string | null;
          teamPhone: string | null;
          hours: unknown[];
          vapiAssistantId: string | null;
        } | null;
        knowledge: unknown[];
      };
    };

    // Nothing from the configured sibling appears.
    expect(body.data.business?.name).toBe("");
    expect(body.data.profile?.services).toEqual([]);
    expect(body.data.profile?.faqs).toEqual([]);
    expect(body.data.profile?.tone).toBeNull();
    expect(body.data.profile?.escalationRules).toBeNull();
    expect(body.data.profile?.bookingUrl).toBeNull();
    expect(body.data.profile?.teamPhone).toBeNull();
    expect(body.data.profile?.hours).toEqual([]);
    // The sibling's deployed assistant never marks this agent voice-ready.
    expect(body.data.profile?.vapiAssistantId).toBeNull();
    expect(body.data.knowledge).toEqual([]);
  });

  it("keeps serving the configured agent its OWN values", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const response = await app().request(
      `/business/setup?listingId=${listingConfiguredId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        profile: { services: string[]; tone: string | null } | null;
        knowledge: Array<{ title: string }>;
      };
    };

    expect(body.data.profile?.services).toEqual(["Gel manicure", "Pedicure"]);
    expect(body.data.profile?.tone).toBe("friendly");
    expect(body.data.knowledge.map((item) => item.title)).toEqual(["Aftercare"]);
  });
});

describe("number reassignment isolation", () => {
  it("never attributes a previous holder's call to the number's new agent", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const reassignedAt = new Date();
    const beforeAssignment = new Date(reassignedAt.getTime() - 60 * 60 * 1000);
    const afterAssignment = new Date(reassignedAt.getTime() + 60 * 1000);
    const month = afterAssignment.toISOString().slice(0, 7);

    // The number is NOW held by the fresh agent; assignedAt marks the switch.
    await prisma.businessPhoneNumber.create({
      data: {
        businessId,
        installedAgentId: freshAgentId,
        phoneNumber: NUMBER,
        isActive: true
      }
    });
    await prisma.platformPhoneNumber.create({
      data: {
        phoneNumber: NUMBER,
        status: "ASSIGNED",
        businessId,
        installedAgentId: freshAgentId,
        assignedAt: reassignedAt
      }
    });

    // Two unattributed LIVE calls carrying the number in their frozen
    // metadata: one from BEFORE the reassignment, one after.
    await prisma.vapiCall.createMany({
      data: [
        {
          businessId,
          callId: `${RUN}-old-call`,
          customerPhone: "+15555550130",
          executionMode: "LIVE",
          createdAt: beforeAssignment,
          endedAt: beforeAssignment,
          metadataJson: { metadata: { assignedPhoneNumber: NUMBER } }
        },
        {
          businessId,
          callId: `${RUN}-new-call`,
          customerPhone: "+15555550131",
          executionMode: "LIVE",
          createdAt: afterAssignment,
          endedAt: afterAssignment,
          metadataJson: { metadata: { assignedPhoneNumber: NUMBER } }
        }
      ]
    });

    await reconcileBusinessExecutionUsage(businessId, month);

    // The pre-reassignment call must NOT move to the new holder…
    const oldCall = await prisma.vapiCall.findFirst({
      where: { businessId, callId: `${RUN}-old-call` },
      select: { installedAgentId: true }
    });
    expect(oldCall?.installedAgentId).not.toBe(freshAgentId);

    // …and no ledger row (count or cost) lands on the new agent for it.
    const freshLedger = await prisma.agentUsageExecution.findMany({
      where: { businessId, installedAgentId: freshAgentId },
      select: { sourceId: true }
    });
    expect(freshLedger.map((row) => row.sourceId)).not.toContain(`${RUN}-old-call`);

    // The post-reassignment call DOES belong to the new holder.
    const newCall = await prisma.vapiCall.findFirst({
      where: { businessId, callId: `${RUN}-new-call` },
      select: { installedAgentId: true }
    });
    expect(newCall?.installedAgentId).toBe(freshAgentId);
  });
});
