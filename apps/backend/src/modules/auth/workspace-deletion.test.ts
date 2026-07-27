import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { deleteUserWorkspace } from "./workspace-deletion";

/**
 * Deleting one workspace must never take the other one with it. The previous
 * implementation ran `prisma.user.delete()`, so a dual-role account that
 * deleted its business account also lost every architect listing and workflow.
 */

const RUN = `wsdel-${Date.now()}`;
let dbAvailable = false;

async function dbUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function createDualRoleUser(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${suffix}@test.local`,
      role: "ARCHITECT",
      roleMemberships: { create: [{ role: "ARCHITECT" }, { role: "BUSINESS" }] }
    }
  });

  await prisma.business.create({ data: { ownerId: user.id, name: `${RUN} biz`, type: "salon" } });
  await prisma.workflowDefinition.create({
    data: { name: `${RUN} wf`, workflowJson: { nodes: [], edges: [] }, architectUserId: user.id }
  });

  return user.id;
}

async function cleanup(userId: string): Promise<void> {
  await prisma.workflowDefinition.deleteMany({ where: { architectUserId: userId } });
  await prisma.business.deleteMany({ where: { ownerId: userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

beforeEach(async () => {
  dbAvailable = await dbUp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("deleteUserWorkspace — one workspace at a time", () => {
  it("deleting BUSINESS keeps the architect account, its workflows, and the User row", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");
    const userId = await createDualRoleUser("biz");

    const result = await deleteUserWorkspace(userId, "BUSINESS");

    expect(result.accountRemoved).toBe(false);
    expect(result.remainingRoles).toEqual(["ARCHITECT"]);
    expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
    expect(await prisma.business.count({ where: { ownerId: userId } })).toBe(0);
    // The architect side is untouched.
    expect(await prisma.workflowDefinition.count({ where: { architectUserId: userId } })).toBe(1);
    expect(
      await prisma.userRoleMembership.count({ where: { userId, role: "ARCHITECT" } })
    ).toBe(1);
    expect(await prisma.userRoleMembership.count({ where: { userId, role: "BUSINESS" } })).toBe(0);

    await cleanup(userId);
  });

  it("deleting ARCHITECT keeps the business account and its businesses", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");
    const userId = await createDualRoleUser("arch");

    const result = await deleteUserWorkspace(userId, "ARCHITECT");

    expect(result.accountRemoved).toBe(false);
    expect(result.remainingRoles).toEqual(["BUSINESS"]);
    expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
    expect(await prisma.workflowDefinition.count({ where: { architectUserId: userId } })).toBe(0);
    // The buyer side is untouched.
    expect(await prisma.business.count({ where: { ownerId: userId } })).toBe(1);

    // The legacy primary-role column no longer points at the deleted side.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    expect(user?.role).toBe("BUSINESS");

    await cleanup(userId);
  });

  it("a single-role account is removed entirely — no orphan User row is left behind", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");
    const user = await prisma.user.create({
      data: {
        email: `${RUN}-solo@test.local`,
        role: "BUSINESS",
        roleMemberships: { create: [{ role: "BUSINESS" }] }
      }
    });
    await prisma.business.create({ data: { ownerId: user.id, name: `${RUN} solo`, type: "gym" } });

    const result = await deleteUserWorkspace(user.id, "BUSINESS");

    expect(result.accountRemoved).toBe(true);
    expect(result.remainingRoles).toEqual([]);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await prisma.business.count({ where: { ownerId: user.id } })).toBe(0);
  });

  it("a legacy account with no membership rows still keeps its other side", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently.");
    // user.role counts as an implicit grant when memberships predate the table.
    const user = await prisma.user.create({
      data: { email: `${RUN}-legacy@test.local`, role: "ARCHITECT" }
    });
    await prisma.business.create({ data: { ownerId: user.id, name: `${RUN} legacy`, type: "spa" } });

    const result = await deleteUserWorkspace(user.id, "BUSINESS");

    expect(result.accountRemoved).toBe(false);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    expect(await prisma.business.count({ where: { ownerId: user.id } })).toBe(0);

    await cleanup(user.id);
  });
});
