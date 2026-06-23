import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { requireAuth, requireRole } from "../../middleware/auth";

export const architectRoutes = new Hono();

architectRoutes.use("*", requireAuth);
architectRoutes.use("*", requireRole(["ARCHITECT"]));

const profileSchema = z.object({
  title: z.string().trim().min(2).optional().or(z.literal("")),
  bio: z.string().trim().min(10).optional().or(z.literal("")),
  portfolioUrl: z.string().trim().url().optional().or(z.literal("")),
  skills: z.array(z.string().trim().min(1)).default([]),
  hourlyRateCents: z.number().int().nonnegative().optional()
});

const workflowSchema = z.object({
  name: z.string().trim().min(2, "Workflow name is required"),
  description: z.string().trim().optional().or(z.literal("")),
  isTemplate: z.boolean().default(false),
  workflowJson: z.object({
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([])
  })
});

const workflowUpdateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  description: z.string().trim().optional().or(z.literal("")),
  isTemplate: z.boolean().optional(),
  workflowJson: z
    .object({
      nodes: z.array(z.any()).default([]),
      edges: z.array(z.any()).default([])
    })
    .optional()
});

const listingSchema = z.object({
  workflowId: z.string().optional().or(z.literal("")),
  name: z.string().trim().min(2, "Agent name is required"),
  shortDescription: z.string().trim().min(10, "Short description is required"),
  description: z.string().trim().optional().or(z.literal("")),
  priceCents: z.number().int().nonnegative().default(0),
  tags: z.array(z.string().trim().min(1)).default([]),
  requiredConnectors: z.array(z.string().trim().min(1)).default([]),
  supportedLlms: z.array(z.string().trim().min(1)).default([])
});

const proposalSchema = z.object({
  coverLetter: z.string().trim().min(20, "Cover letter must be at least 20 characters"),
  bidAmountCents: z.number().int().nonnegative().optional(),
  etaDays: z.number().int().positive().optional()
});

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

architectRoutes.get("/summary", async (c) => {
  const authUser = c.get("authUser");

  const [
    profile,
    workflows,
    listings,
    proposals,
    workflowCount,
    listingCount,
    proposalCount,
    openProjectsCount
  ] = await Promise.all([
    prisma.architectProfile.findUnique({
      where: {
        userId: authUser.id
      }
    }),

    prisma.workflowDefinition.findMany({
      where: {
        architectUserId: authUser.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 5
    }),

    prisma.agentListing.findMany({
      where: {
        architectUserId: authUser.id
      },
      include: {
        workflow: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 5
    }),

    prisma.projectProposal.findMany({
      where: {
        architectUserId: authUser.id
      },
      include: {
        project: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 5
    }),

    prisma.workflowDefinition.count({
      where: {
        architectUserId: authUser.id
      }
    }),

    prisma.agentListing.count({
      where: {
        architectUserId: authUser.id
      }
    }),

    prisma.projectProposal.count({
      where: {
        architectUserId: authUser.id
      }
    }),

    prisma.project.count({
      where: {
        status: "OPEN"
      }
    })
  ]);

  return successResponse(c, {
    user: authUser,
    profile,
    stats: {
      workflows: workflowCount,
      listings: listingCount,
      proposals: proposalCount,
      openProjects: openProjectsCount
    },
    recent: {
      workflows,
      listings,
      proposals
    }
  });
});

architectRoutes.get("/profile", async (c) => {
  const authUser = c.get("authUser");

  const profile = await prisma.architectProfile.findUnique({
    where: {
      userId: authUser.id
    }
  });

  return successResponse(c, {
    profile
  });
});

architectRoutes.put("/profile", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = profileSchema.parse(await c.req.json());

    const profile = await prisma.architectProfile.upsert({
      where: {
        userId: authUser.id
      },
      update: {
        title: input.title || null,
        bio: input.bio || null,
        portfolioUrl: input.portfolioUrl || null,
        skills: input.skills,
        hourlyRateCents: input.hourlyRateCents
      },
      create: {
        userId: authUser.id,
        title: input.title || null,
        bio: input.bio || null,
        portfolioUrl: input.portfolioUrl || null,
        skills: input.skills,
        hourlyRateCents: input.hourlyRateCents
      }
    });

    return successResponse(
      c,
      {
        profile
      },
      "Architect profile saved"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid profile input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not save profile", 500, "PROFILE_SAVE_FAILED");
  }
});

architectRoutes.get("/workflows", async (c) => {
  const authUser = c.get("authUser");

  const workflows = await prisma.workflowDefinition.findMany({
    where: {
      architectUserId: authUser.id
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return successResponse(c, {
    workflows
  });
});

architectRoutes.post("/workflows", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = workflowSchema.parse(await c.req.json());

    const workflow = await prisma.workflowDefinition.create({
      data: {
        architectUserId: authUser.id,
        name: input.name,
        description: input.description || null,
        isTemplate: input.isTemplate,
        workflowJson: input.workflowJson as never
      }
    });

    return successResponse(
      c,
      {
        workflow
      },
      "Workflow created",
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid workflow input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not create workflow", 500, "WORKFLOW_CREATE_FAILED");
  }
});

architectRoutes.get("/workflows/:workflowId", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");

  const workflow = await prisma.workflowDefinition.findFirst({
    where: {
      id: workflowId,
      architectUserId: authUser.id
    }
  });

  if (!workflow) {
    return errorResponse(c, "Workflow not found", 404, "WORKFLOW_NOT_FOUND");
  }

  return successResponse(c, {
    workflow
  });
});

architectRoutes.put("/workflows/:workflowId", async (c) => {
  try {
    const authUser = c.get("authUser");
    const workflowId = c.req.param("workflowId");
    const input = workflowUpdateSchema.parse(await c.req.json());

    const existingWorkflow = await prisma.workflowDefinition.findFirst({
      where: {
        id: workflowId,
        architectUserId: authUser.id
      }
    });

    if (!existingWorkflow) {
      return errorResponse(c, "Workflow not found", 404, "WORKFLOW_NOT_FOUND");
    }

    const workflow = await prisma.workflowDefinition.update({
      where: {
        id: workflowId
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description || null }
          : {}),
        ...(input.isTemplate !== undefined ? { isTemplate: input.isTemplate } : {}),
        ...(input.workflowJson !== undefined
          ? { workflowJson: input.workflowJson as never }
          : {})
      }
    });

    return successResponse(
      c,
      {
        workflow
      },
      "Workflow saved"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid workflow input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not save workflow", 500, "WORKFLOW_UPDATE_FAILED");
  }
});

architectRoutes.get("/listings", async (c) => {
  const authUser = c.get("authUser");

  const listings = await prisma.agentListing.findMany({
    where: {
      architectUserId: authUser.id
    },
    include: {
      workflow: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return successResponse(c, {
    listings
  });
});

architectRoutes.post("/listings", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = listingSchema.parse(await c.req.json());
    const workflowId = input.workflowId || undefined;

    if (workflowId) {
      const workflow = await prisma.workflowDefinition.findFirst({
        where: {
          id: workflowId,
          architectUserId: authUser.id
        }
      });

      if (!workflow) {
        return errorResponse(c, "Workflow not found", 404, "WORKFLOW_NOT_FOUND");
      }
    }

    const listing = await prisma.agentListing.create({
      data: {
        architectUserId: authUser.id,
        workflowId,
        name: input.name,
        shortDescription: input.shortDescription,
        description: input.description || null,
        priceCents: input.priceCents,
        tags: input.tags,
        requiredConnectors: input.requiredConnectors,
        supportedLlms: input.supportedLlms,
        status: "PENDING_REVIEW"
      }
    });

    return successResponse(
      c,
      {
        listing
      },
      "Agent listing submitted for review",
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid listing input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not create listing", 500, "LISTING_CREATE_FAILED");
  }
});

architectRoutes.get("/projects", async (c) => {
  const authUser = c.get("authUser");

  const projects = await prisma.project.findMany({
    where: {
      status: "OPEN",
      proposals: {
        none: {
          architectUserId: authUser.id
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return successResponse(c, {
    projects
  });
});

architectRoutes.post("/projects/:projectId/proposals", async (c) => {
  try {
    const authUser = c.get("authUser");
    const projectId = c.req.param("projectId");
    const input = proposalSchema.parse(await c.req.json());

    const project = await prisma.project.findUnique({
      where: {
        id: projectId
      }
    });

    if (!project) {
      return errorResponse(c, "Project not found", 404, "PROJECT_NOT_FOUND");
    }

    if (project.status !== "OPEN") {
      return errorResponse(c, "Project is not open for proposals", 409, "PROJECT_NOT_OPEN");
    }

    const proposal = await prisma.projectProposal.create({
      data: {
        projectId,
        architectUserId: authUser.id,
        coverLetter: input.coverLetter,
        bidAmountCents: input.bidAmountCents,
        etaDays: input.etaDays
      },
      include: {
        project: true
      }
    });

    return successResponse(
      c,
      {
        proposal
      },
      "Proposal submitted",
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid proposal input",
        422,
        "VALIDATION_ERROR"
      );
    }

    if (isPrismaErrorCode(error, "P2002")) {
      return errorResponse(
        c,
        "You already sent a proposal for this project",
        409,
        "PROPOSAL_EXISTS"
      );
    }

    return errorResponse(c, "Could not submit proposal", 500, "PROPOSAL_CREATE_FAILED");
  }
});

architectRoutes.get("/proposals", async (c) => {
  const authUser = c.get("authUser");

  const proposals = await prisma.projectProposal.findMany({
    where: {
      architectUserId: authUser.id
    },
    include: {
      project: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return successResponse(c, {
    proposals
  });
});

architectRoutes.delete("/workflows/:workflowId", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");

  const existingWorkflow = await prisma.workflowDefinition.findFirst({
    where: {
      id: workflowId,
      architectUserId: authUser.id
    }
  });

  if (!existingWorkflow) {
    return errorResponse(c, "Workflow not found", 404, "WORKFLOW_NOT_FOUND");
  }

  await prisma.workflowDefinition.delete({
    where: {
      id: workflowId
    }
  });

  return successResponse(c, { workflowId }, "Workflow deleted");
});