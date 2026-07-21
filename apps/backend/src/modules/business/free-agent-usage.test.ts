import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { recordVapiCallUsage } from "./usage-billing";
import { isSandboxExecutionBusiness } from "../architect/twilio-business-routing";

/**
 * FREE installs have no Payment row — the InstalledAgent is the acquisition
 * record. End-of-call usage (recording URL, duration, billing fields) must
 * still be written, and one architect sandbox agent on a dual-role owner's
 * business must never demote live buyer calls to dry runs.
 */

const RUN = `freeusage-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let businessId = "";
let workflowId = "";
let freeAgentId = "";
let sandboxAgentId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[free-agent-usage.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "BUSINESS", roleMemberships: { create: { role: "BUSINESS" } } }
  });
  ownerId = owner.id;

  businessId = (
    await prisma.business.create({ data: { ownerId, name: `${RUN} biz`, type: "salon" } })
  ).id;

  workflowId = (
    await prisma.workflowDefinition.create({
      data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: ownerId }
    })
  ).id;

  // Free buyer install: no Payment row, NULL configJson.
  freeAgentId = (
    await prisma.installedAgent.create({
      data: { businessId, workflowId, name: `${RUN} free agent`, installSource: "FREE_INSTALL" }
    })
  ).id;

  // Architect sandbox agent on the SAME business (dual-role owner).
  sandboxAgentId = (
    await prisma.installedAgent.create({
      data: {
        businessId,
        workflowId,
        name: `${RUN} sandbox agent`,
        installSource: "ARCHITECT_SELF_TEST",
        configJson: { purpose: "ARCHITECT_TEST" }
      }
    })
  ).id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.vapiCall.deleteMany({ where: { businessId } });
  await prisma.installedAgent.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("recordVapiCallUsage — free installs", () => {
  it("records the recording URL and usage fields with no Payment row", async () => {
    if (!dbAvailable) return;

    const callId = `${RUN}-call-1`;
    await prisma.vapiCall.create({
      data: { businessId, installedAgentId: freeAgentId, callId, customerPhone: "+15550150001", executionMode: "LIVE" }
    });

    await recordVapiCallUsage({
      businessId,
      installedAgentId: freeAgentId,
      callId,
      customerPhone: "+15550150001",
      webhookBody: {
        message: {
          type: "end-of-call-report",
          durationSeconds: 90,
          artifact: { recordingUrl: "https://recordings.test.local/free-1.wav" }
        }
      }
    });

    const call = await prisma.vapiCall.findUnique({ where: { callId } });
    expect(call?.recordingUrl).toBe("https://recordings.test.local/free-1.wav");
    expect(call?.billingRecordedAt).not.toBeNull();
    expect(call?.durationSeconds).toBe(90);
  });
});

describe("isSandboxExecutionBusiness — dual-role owners", () => {
  it("a live buyer agent's calls stay LIVE even when a sandbox agent shares the business", async () => {
    if (!dbAvailable) return;
    expect(await isSandboxExecutionBusiness(businessId, freeAgentId)).toBe(false);
  });

  it("the sandbox agent's own calls are classified as sandbox", async () => {
    if (!dbAvailable) return;
    expect(await isSandboxExecutionBusiness(businessId, sandboxAgentId)).toBe(true);
  });

  it("without an attributable agent, a mixed business is NOT a sandbox", async () => {
    if (!dbAvailable) return;
    expect(await isSandboxExecutionBusiness(businessId)).toBe(false);
  });

  it("a business with only sandbox agents is a sandbox", async () => {
    if (!dbAvailable) return;
    const sandboxOnly = await prisma.business.create({
      data: { ownerId, name: `${RUN} sandbox biz`, type: "salon" }
    });
    await prisma.installedAgent.create({
      data: {
        businessId: sandboxOnly.id,
        workflowId,
        name: `${RUN} only sandbox`,
        configJson: { purpose: "ARCHITECT_TEST" }
      }
    });
    try {
      expect(await isSandboxExecutionBusiness(sandboxOnly.id)).toBe(true);
    } finally {
      await prisma.installedAgent.deleteMany({ where: { businessId: sandboxOnly.id } });
      await prisma.business.delete({ where: { id: sandboxOnly.id } });
    }
  });
});
