import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "../../lib/prisma";

const ARCHITECT_EMAIL = "featured-test-architect@example.com";
const ids: string[] = [];
let architectId = "";
let workflowId = "";
/** Whatever the database already had featured — restored in afterAll. */
let preexistingFeaturedId: string | null = null;

async function makeListing(name: string) {
  const listing = await prisma.agentListing.create({
    data: {
      name,
      shortDescription: `${name} short description`,
      status: "APPROVED",
      architectUserId: architectId,
      workflowId,
      requiredConnectors: [],
      supportedLlms: [],
      tags: []
    },
    select: { id: true }
  });
  ids.push(listing.id);
  return listing.id;
}

beforeAll(async () => {
  const architect = await prisma.user.create({
    data: { email: ARCHITECT_EMAIL, role: "ARCHITECT", fullName: "Featured Test" },
    select: { id: true }
  });
  architectId = architect.id;

  // Only ONE row may be featured database-wide, so park any existing pick for
  // the duration of this test and put it back afterwards.
  const alreadyFeatured = await prisma.agentListing.findFirst({
    where: { featuredAt: { not: null } },
    select: { id: true }
  });
  if (alreadyFeatured) {
    preexistingFeaturedId = alreadyFeatured.id;
    await prisma.agentListing.update({ where: { id: alreadyFeatured.id }, data: { featuredAt: null } });
  }

  const workflow = await prisma.workflowDefinition.create({
    data: { name: "Featured test workflow", architectUserId: architectId, workflowJson: { nodes: [], edges: [] } },
    select: { id: true }
  });
  workflowId = workflow.id;
});

afterAll(async () => {
  await prisma.agentListing.deleteMany({ where: { id: { in: ids } } });
  if (preexistingFeaturedId) {
    await prisma.agentListing.update({
      where: { id: preexistingFeaturedId },
      data: { featuredAt: new Date() }
    });
  }
  await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
  await prisma.user.deleteMany({ where: { id: architectId } });
});

describe("single featured listing", () => {
  it("rejects a second featured listing at the database level", async () => {
    const first = await makeListing("Featured A");
    const second = await makeListing("Featured B");

    await prisma.agentListing.update({ where: { id: first }, data: { featuredAt: new Date() } });

    // The unique partial index must refuse this — the endpoint clearing the
    // previous pick is a convenience, not the guarantee.
    await expect(
      prisma.agentListing.update({ where: { id: second }, data: { featuredAt: new Date() } })
    ).rejects.toThrow();

    const featured = await prisma.agentListing.findMany({
      where: { id: { in: [first, second] }, featuredAt: { not: null } },
      select: { id: true }
    });
    expect(featured).toHaveLength(1);
    expect(featured[0]!.id).toBe(first);
  });

  it("allows featuring a different listing once the previous one is cleared", async () => {
    const [first, second] = ids.slice(0, 2) as [string, string];

    await prisma.$transaction([
      prisma.agentListing.updateMany({ where: { id: first }, data: { featuredAt: null } }),
      prisma.agentListing.update({ where: { id: second }, data: { featuredAt: new Date() } })
    ]);

    const featured = await prisma.agentListing.findMany({
      where: { featuredAt: { not: null } },
      select: { id: true }
    });
    expect(featured.map((row) => row.id)).toEqual([second]);
  });

  it("allows any number of UNfeatured listings", async () => {
    await prisma.agentListing.updateMany({ where: { id: { in: ids } }, data: { featuredAt: null } });

    const featured = await prisma.agentListing.count({ where: { featuredAt: { not: null } } });
    expect(featured).toBe(0);
  });
});
