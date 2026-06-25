import { Hono, type Context } from "hono";
import { z } from "zod";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createGmailOAuthUrl,
  disconnectGmail,
  getGmailConnectionStatus,
  handleGmailOAuthCallback
} from "./gmail-connector";
import { runWorkflowTest } from "./workflow-runner";

export const architectRoutes = new Hono();

/**
 * Gmail OAuth callback must stay PUBLIC.
 * Do not place it after requireAuth, because Google redirects here without your app JWT.
 */
architectRoutes.get("/connectors/gmail/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      return c.redirect(`${env.FRONTEND_URL}/architect/profile?gmail=failed`);
    }

    await handleGmailOAuthCallback({
      code,
      state
    });

    return c.redirect(`${env.FRONTEND_URL}/architect/profile?gmail=connected`);
  } catch (error) {
    console.error(error);
    return c.redirect(`${env.FRONTEND_URL}/architect/profile?gmail=failed`);
  }
});

architectRoutes.post("/connectors/twilio/missed-call/:workflowId", async (c) => {
  try {
    const workflowId = c.req.param("workflowId");
    const contentType = c.req.header("content-type") ?? "";

    const rawBody = contentType.includes("application/json")
      ? await c.req.json().catch(() => ({}))
      : await c.req.parseBody();
    const body = rawBody as Record<string, unknown>;

    const callerNumber = String(body.From ?? body.from ?? body.Caller ?? "").trim();
    const calledNumber = String(body.Called ?? body.To ?? body.to ?? "").trim();

    if (!callerNumber) {
      return c.text("<Response></Response>", 422, {
        "Content-Type": "text/xml"
      });
    }

    const workflow = await prisma.workflowDefinition.findUnique({
      where: {
        id: workflowId
      },
      select: {
        id: true,
        architectUserId: true,
        workflowJson: true
      }
    });

    if (!workflow) {
      return c.text("<Response></Response>", 404, {
        "Content-Type": "text/xml"
      });
    }

    await runWorkflowTest({
      userId: workflow.architectUserId,
      workflowId: workflow.id,
      workflowJson: workflow.workflowJson,
      mode: "live",
      input: {
        callerNumber,
        businessName: env.TWILIO_DEFAULT_BUSINESS_NAME ?? calledNumber,
        callStatus: String(body.CallStatus ?? body.callStatus ?? "no-answer"),
        callTimestamp: new Date().toISOString(),
        missedCallReason: "Twilio missed-call webhook triggered this agent."
      }
    });

    return c.text("<Response></Response>", 200, {
      "Content-Type": "text/xml"
    });
  } catch (error) {
    console.error(error);
    return c.text("<Response></Response>", 200, {
      "Content-Type": "text/xml"
    });
  }
});

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
  name: z.string().trim().min(2, "Agent name is required"),
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

const workflowRunInputSchema = z.object({
  callerNumber: z.string().trim().optional(),
  callerName: z.string().trim().optional(),
  businessName: z.string().trim().optional(),
  callStatus: z.string().trim().optional(),
  callTimestamp: z.string().trim().optional(),
  missedCallReason: z.string().trim().optional()
});

const workflowRunTestSchema = z.object({
  input: workflowRunInputSchema.optional()
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

    return successResponse(c, { profile }, "Architect profile saved");
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

architectRoutes.get("/connectors/gmail/status", async (c) => {
  const authUser = c.get("authUser");
  const status = await getGmailConnectionStatus(authUser.id);

  return successResponse(c, status);
});

architectRoutes.get("/connectors/gmail/oauth-url", async (c) => {
  try {
    const authUser = c.get("authUser");
    const url = createGmailOAuthUrl(authUser.id);

    return successResponse(c, {
      url
    });
  } catch (error) {
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not create Gmail OAuth URL",
      500,
      "GMAIL_OAUTH_URL_FAILED"
    );
  }
});

architectRoutes.delete("/connectors/gmail", async (c) => {
  const authUser = c.get("authUser");

  await disconnectGmail(authUser.id);

  return successResponse(c, null, "Gmail disconnected");
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

    return successResponse(c, { workflow }, "Agent created", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid agent input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not create agent", 500, "WORKFLOW_CREATE_FAILED");
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
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
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
      return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
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

    return successResponse(c, { workflow }, "Agent saved");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid agent input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not save agent", 500, "WORKFLOW_UPDATE_FAILED");
  }
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
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  await prisma.workflowDefinition.delete({
    where: {
      id: workflowId
    }
  });

  return successResponse(c, { workflowId }, "Agent deleted");
});

async function runOwnedWorkflow({
  c,
  mode
}: {
  c: Context;
  mode: "test" | "live";
}) {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");
  const body = await c.req.json().catch(() => ({}));
  const input = workflowRunTestSchema.parse(body);

  const workflow = await prisma.workflowDefinition.findFirst({
    where: {
      id: workflowId,
      architectUserId: authUser.id
    }
  });

  if (!workflow) {
    return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
  }

  if (mode === "live" && !input.input?.callerNumber?.trim()) {
    return errorResponse(
      c,
      "Caller number is required before sending with Twilio",
      422,
      "CALLER_NUMBER_REQUIRED"
    );
  }

  const run = await runWorkflowTest({
    userId: authUser.id,
    workflowId,
    workflowJson: workflow.workflowJson,
    input: input.input,
    mode
  });

  return successResponse(
    c,
    { run },
    mode === "live" ? "Twilio workflow run completed" : "Workflow test completed"
  );
}

architectRoutes.post("/workflows/:workflowId/run-test", async (c) => {
  try {
    return await runOwnedWorkflow({ c, mode: "test" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid test input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not run workflow test", 500, "WORKFLOW_TEST_FAILED");
  }
});

architectRoutes.post("/workflows/:workflowId/run-live", async (c) => {
  try {
    return await runOwnedWorkflow({ c, mode: "live" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid Twilio test input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(
      c,
      error instanceof Error ? error.message : "Could not send Twilio SMS",
      500,
      "TWILIO_RUN_FAILED"
    );
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
        return errorResponse(c, "Agent workflow not found", 404, "WORKFLOW_NOT_FOUND");
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

    return successResponse(c, { listing }, "Agent submitted for review", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid agent listing input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not create agent listing", 500, "LISTING_CREATE_FAILED");
  }
});

architectRoutes.get("/listings/completed", async (c) => {
  const listings = await prisma.agentListing.findMany({
    where: {
      status: "APPROVED"
    },
    include: {
      architect: {
        select: {
          id: true,
          fullName: true,
          email: true,
          architectProfile: {
            select: {
              title: true,
              bio: true,
              portfolioUrl: true,
              skills: true,
              hourlyRateCents: true,
              rating: true,
              completedJobs: true
            }
          }
        }
      },
      workflow: {
        select: {
          id: true,
          name: true,
          description: true,
          isTemplate: true,
          createdAt: true,
          updatedAt: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return successResponse(c, {
    listings
  });
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

    return successResponse(c, { proposal }, "Proposal submitted", 201);
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