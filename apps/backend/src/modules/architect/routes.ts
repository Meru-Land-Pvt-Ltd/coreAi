import { Hono, type Context } from "hono";
import { z } from "zod";
import { requiredConnectorKeys } from "@coreai/shared";
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
import {
  handleTwilioInboundSms,
  handleTwilioMissedCall,
  handleTwilioVoice,
  handleTwilioVoiceAction,
  handleVapiWebhook
} from "./twilio-business-routing";
import { deployDentalWorkflow } from "./dental-deploy";
import {
  getPhoneRoutingStatus,
  setPhoneRoutingMode,
  setupPhoneRouting,
  testPhoneRouting
} from "./phone-routing";
import {
  cloneTemplateWorkflow,
  getTemplateBySlug,
  listTemplateCards
} from "./templates";
import { getVoiceAnswerStatus } from "./vapi-connector";
import { generateVoicePreview, listVoicePresets, voicePreviewDiagnostics, VoicePreviewError } from "./voice-presets";
import { runWorkflowTest } from "./workflow-runner";

const voicePreviewSchema = z.object({
  presetId: z.string().trim().optional(),
  voiceId: z.string().trim().optional(),
  text: z.string().trim().max(300).optional()
});

export const architectRoutes = new Hono();

architectRoutes.get("/connectors/gmail/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      return c.redirect(`${env.FRONTEND_URL}/architect/profile?gmail=failed`);
    }

    const { redirectPath } = await handleGmailOAuthCallback({
      code,
      state
    });

    const target = redirectPath ?? "/architect/profile";
    const separator = target.includes("?") ? "&" : "?";

    return c.redirect(`${env.FRONTEND_URL}${target}${separator}gmail=connected`);
  } catch (error) {
    console.error(error);
    return c.redirect(`${env.FRONTEND_URL}/architect/profile?gmail=failed`);
  }
});

architectRoutes.post("/connectors/twilio/voice", handleTwilioVoice);
architectRoutes.post("/connectors/twilio/voice/:workflowId", handleTwilioVoice);
architectRoutes.post("/connectors/twilio/voice-action", handleTwilioVoiceAction);
architectRoutes.post("/connectors/twilio/voice-action/:workflowId", handleTwilioVoiceAction);
architectRoutes.post("/connectors/twilio/inbound-sms", handleTwilioInboundSms);
architectRoutes.post("/connectors/twilio/inbound-sms/:workflowId", handleTwilioInboundSms);
architectRoutes.post("/connectors/twilio/missed-call/:workflowId", handleTwilioMissedCall);
architectRoutes.post("/connectors/vapi/webhook", handleVapiWebhook);

architectRoutes.get("/connectors/voice/status", (c) => successResponse(c, getVoiceAnswerStatus()));

async function listCompletedListings(c: Context) {
  const allListings = await prisma.agentListing.findMany({
    where: {
      status: { in: ["APPROVED", "PENDING_REVIEW"] }
    },
    include: {
      workflow: true,
      architect: {
        select: {
          id: true,
          fullName: true,
          email: true,
          architectProfile: {
            select: {
              title: true,
              rating: true,
              completedJobs: true
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const seenWorkflowIds = new Set<string>();
  const listings = allListings.filter((listing) => {
    if (!listing.workflowId) return true;
    if (seenWorkflowIds.has(listing.workflowId)) return false;
    seenWorkflowIds.add(listing.workflowId);
    return true;
  });

  return successResponse(c, { listings });
}

async function getCompletedListingById(c: Context) {
  const id = c.req.param("id");

  if (!id) {
    return errorResponse(c, "Listing id is required", 400);
  }

  const listing = await prisma.agentListing.findFirst({
    where: {
      id,
      status: { in: ["APPROVED", "PENDING_REVIEW"] }
    },
    include: {
      workflow: true,
      architect: {
        select: {
          id: true,
          fullName: true,
          email: true,
          architectProfile: {
            select: {
              title: true,
              bio: true,
              rating: true,
              completedJobs: true
            }
          }
        }
      }
    }
  });

  if (!listing) {
    return errorResponse(c, "Listing not found", 404);
  }

  return successResponse(c, { listing });
}

architectRoutes.get("/listings/completed", requireAuth, listCompletedListings);
architectRoutes.post("/listings/completed", requireAuth, listCompletedListings);
architectRoutes.get("/listings/:id", requireAuth, getCompletedListingById);
architectRoutes.post("/listings/:id", requireAuth, getCompletedListingById);

// Voice catalog + preview — buyer-visible (architect builder AND buyer install
// both render voice cards / play previews), so registered before the ARCHITECT
// role guard. The ElevenLabs key never leaves the backend.
architectRoutes.get("/voices", requireAuth, (c) => successResponse(c, listVoicePresets()));
// Safe, secret-free diagnostics for debugging voice preview wiring.
architectRoutes.get("/voices/debug", requireAuth, (c) => successResponse(c, voicePreviewDiagnostics()));
architectRoutes.post("/voices/preview", requireAuth, async (c) => {
  try {
    const input = voicePreviewSchema.parse(await c.req.json().catch(() => ({})));
    const result = await generateVoicePreview(input);
    return successResponse(c, result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid preview input", 422, "VALIDATION_ERROR");
    }
    // Surface the real status (e.g. 402 paid-plan / 404 unknown voice) + message.
    const status = error instanceof VoicePreviewError ? error.status : 503;
    return errorResponse(
      c,
      error instanceof Error ? error.message : "Voice preview failed",
      status,
      "VOICE_PREVIEW_FAILED"
    );
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

const templateRequestSchema = z.object({
  industry: z.string().trim().min(1, "Industry is required"),
  description: z.string().trim().min(10, "Please describe what you need (at least 10 characters)").max(5000)
});

const proposalSchema = z.object({
  coverLetter: z.string().trim().min(20, "Cover letter must be at least 20 characters"),
  bidAmountCents: z.number().int().nonnegative().optional(),
  etaDays: z.number().int().positive().optional()
});

const workflowRunInputSchema = z.object({
  callerNumber: z.string().trim().optional(),
  callerName: z.string().trim().optional(),
  businessId: z.string().trim().optional(),
  businessOwnerId: z.string().trim().optional(),
  businessName: z.string().trim().optional(),
  businessType: z.string().trim().optional(),
  businessPhoneNumber: z.string().trim().optional(),
  calendarId: z.string().trim().optional(),
  timeZone: z.string().trim().optional(),
  vapiAssistantId: z.string().trim().optional(),
  vapiPhoneNumberId: z.string().trim().optional(),
  callStatus: z.string().trim().optional(),
  callTimestamp: z.string().trim().optional(),
  missedCallReason: z.string().trim().optional(),
  bookingUrl: z.string().trim().optional(),
  teamPhone: z.string().trim().optional(),
  services: z.array(z.string().trim()).optional(),
  faqs: z.array(z.string().trim()).optional(),
  tone: z.string().trim().optional(),
  escalationRules: z.string().trim().optional(),
  knowledge: z.array(z.string().trim()).optional(),
  inboundSmsBody: z.string().trim().optional(),
  appointmentStartAt: z.string().trim().optional(),
  appointmentEndAt: z.string().trim().optional(),
  appointmentService: z.string().trim().optional()
});

const workflowRunTestSchema = z.object({
  input: workflowRunInputSchema.optional()
});

const businessInstallationSchema = z.object({
  workflowId: z.string().trim().min(1),
  listingId: z.string().trim().optional().or(z.literal("")),
  businessName: z.string().trim().min(2),
  businessType: z.string().trim().min(2),
  twilioPhoneNumber: z.string().trim().min(5),
  twilioPhoneNumberSid: z.string().trim().optional().or(z.literal("")),
  forwardToPhone: z.string().trim().optional().or(z.literal("")),
  bookingUrl: z.string().trim().url().optional().or(z.literal("")),
  teamPhone: z.string().trim().optional().or(z.literal("")),
  calendarId: z.string().trim().optional().or(z.literal("")),
  timeZone: z.string().trim().default("America/New_York"),
  vapiAssistantId: z.string().trim().optional().or(z.literal("")),
  vapiPhoneNumberId: z.string().trim().optional().or(z.literal("")),
  services: z.array(z.string().trim().min(1)).default([]),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1)
      })
    )
    .default([]),
  knowledge: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        content: z.string().trim().min(1)
      })
    )
    .default([]),
  tone: z.string().trim().default("friendly"),
  escalationRules: z.string().trim().optional().or(z.literal(""))
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

architectRoutes.post("/connectors/twilio/business-installations", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = businessInstallationSchema.parse(await c.req.json());

    const workflow = await prisma.workflowDefinition.findFirst({
      where: {
        id: input.workflowId,
        architectUserId: authUser.id
      }
    });

    if (!workflow) {
      return errorResponse(c, "Agent workflow not found", 404, "WORKFLOW_NOT_FOUND");
    }

    const business = await prisma.business.create({
      data: {
        ownerId: authUser.id,
        name: input.businessName,
        type: input.businessType,
        profile: {
          create: {
            bookingUrl: input.bookingUrl || null,
            teamPhone: input.teamPhone || null,
            calendarId: input.calendarId || "primary",
            timeZone: input.timeZone,
            vapiAssistantId: input.vapiAssistantId || null,
            vapiPhoneNumberId: input.vapiPhoneNumberId || null,
            services: input.services,
            faqsJson: input.faqs as never,
            tone: input.tone,
            escalationRules: input.escalationRules || null
          }
        },
        knowledgeBases: {
          create: input.knowledge.map((item) => ({
            title: item.title,
            content: item.content
          }))
        }
      },
      include: {
        profile: true,
        knowledgeBases: true
      }
    });

    const installedAgent = await prisma.installedAgent.create({
      data: {
        businessId: business.id,
        workflowId: workflow.id,
        listingId: input.listingId || undefined,
        name: workflow.name,
        status: "ACTIVE",
        configJson: {
          connectors: ["TWILIO", "VAPI", "GOOGLE_CALENDAR"],
          vapiAssistantId: input.vapiAssistantId || null,
          vapiPhoneNumberId: input.vapiPhoneNumberId || null,
          calendarId: input.calendarId || "primary"
        }
      }
    });

    const phoneNumber = await prisma.businessPhoneNumber.create({
      data: {
        businessId: business.id,
        installedAgentId: installedAgent.id,
        phoneNumber: input.twilioPhoneNumber.replace(/[^+\d]/g, ""),
        twilioPhoneNumberSid: input.twilioPhoneNumberSid || null,
        forwardToPhone: input.forwardToPhone || null,
        isActive: true
      }
    });

    return successResponse(
      c,
      {
        business,
        installedAgent,
        phoneNumber,
        webhooks: {
          voice: `${env.BACKEND_URL}/architect/connectors/twilio/voice`,
          sms: `${env.BACKEND_URL}/architect/connectors/twilio/inbound-sms`,
          vapi: `${env.BACKEND_URL}/architect/connectors/vapi/webhook`
        }
      },
      "Business installation created"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid business installation input",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, error instanceof Error ? error.message : "Could not create business installation", 500, "BUSINESS_INSTALLATION_FAILED");
  }
});

architectRoutes.get("/workflows", async (c) => {
  const authUser = c.get("authUser");

  const workflows = await prisma.workflowDefinition.findMany({
    where: {
      architectUserId: authUser.id
    },
    include: {
      listings: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1,
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true
        }
      }
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
    },
    include: {
      listings: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1,
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true
        }
      }
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

  // Safety: only a true draft can be deleted. Never delete a workflow that has a
  // listing (submitted/published) or is deployed as a live agent (installed).
  const listing = await prisma.agentListing.findFirst({ where: { workflowId } });
  if (listing) {
    return errorResponse(
      c,
      "This workflow has been submitted/published and cannot be deleted as a draft.",
      409,
      "WORKFLOW_HAS_LISTING"
    );
  }
  const installed = await prisma.installedAgent.findFirst({ where: { workflowId } });
  if (installed) {
    return errorResponse(
      c,
      "This workflow is deployed as a live agent and cannot be deleted as a draft.",
      409,
      "WORKFLOW_DEPLOYED"
    );
  }

  await prisma.workflowDefinition.delete({
    where: {
      id: workflowId
    }
  });

  return successResponse(c, { workflowId }, "Agent deleted");
});

// Bulk draft cleanup: deletes ONLY the architect's draft workflows that have no
// AgentListing and are not deployed (no InstalledAgent). Never touches
// submitted/published listings or live agents.
architectRoutes.post("/workflows/cleanup-drafts", async (c) => {
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as {
    deleteUntitled?: unknown;
    deleteDuplicateTemplates?: unknown;
  };
  const deleteUntitled = body.deleteUntitled !== false;
  const deleteDuplicateTemplates = body.deleteDuplicateTemplates !== false;

  const workflows = await prisma.workflowDefinition.findMany({
    where: { architectUserId: authUser.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true }
  });

  const listedIds = new Set(
    (
      await prisma.agentListing.findMany({
        where: { architectUserId: authUser.id, workflowId: { not: null } },
        select: { workflowId: true }
      })
    )
      .map((listing) => listing.workflowId)
      .filter((id): id is string => Boolean(id))
  );
  const deployedIds = new Set(
    (
      await prisma.installedAgent.findMany({
        where: { workflowId: { in: workflows.map((workflow) => workflow.id) } },
        select: { workflowId: true }
      })
    ).map((agent) => agent.workflowId)
  );

  // Only undeployed, unlisted workflows are eligible for cleanup.
  const candidates = workflows.filter((workflow) => !listedIds.has(workflow.id) && !deployedIds.has(workflow.id));

  const isUntitled = (name: string) => {
    const normalized = (name ?? "").trim().toLowerCase();
    return !normalized || normalized === "untitled" || normalized === "untitled agent" || normalized === "new agent";
  };

  const toDelete = new Map<string, string>();
  if (deleteUntitled) {
    for (const workflow of candidates) {
      if (isUntitled(workflow.name)) toDelete.set(workflow.id, workflow.name);
    }
  }
  if (deleteDuplicateTemplates) {
    // candidates are newest-first; keep the first per name, delete later duplicates.
    const seenNames = new Set<string>();
    for (const workflow of candidates) {
      const key = (workflow.name ?? "").trim().toLowerCase();
      if (seenNames.has(key)) toDelete.set(workflow.id, workflow.name);
      else seenNames.add(key);
    }
  }

  const ids = Array.from(toDelete.keys());
  if (ids.length > 0) {
    await prisma.workflowDefinition.deleteMany({
      where: { id: { in: ids }, architectUserId: authUser.id }
    });
  }

  return successResponse(
    c,
    { deletedCount: ids.length, deletedNames: Array.from(toDelete.values()) },
    "Draft clutter cleared"
  );
});

/**
 * DEV/DEMO-ONLY — NOT normal architect product behavior. The architect UI no
 * longer calls this; architects only design + publish. Real buyer/business
 * deployment happens through POST /business/setup. Kept solely for local
 * demo/self-test of the live voice path.
 *
 * Deploy the builder's 6-node Dental AI Receptionist as a live voice agent.
 * Full provision: builds the Vapi assistant from the AI Conversation node,
 * provisions Business + InstalledAgent + BusinessProfile, assigns a Twilio
 * number, and binds it so inbound calls are answered by the deployed assistant.
 */
architectRoutes.post("/workflows/:workflowId/deploy", async (c) => {
  const authUser = c.get("authUser");
  const workflowId = c.req.param("workflowId");

  if (!workflowId) {
    return errorResponse(c, "Agent id is required", 422, "WORKFLOW_ID_REQUIRED");
  }

  try {
    const deployment = await deployDentalWorkflow({
      architectUserId: authUser.id,
      workflowId
    });
    return successResponse(c, { deployment }, "Agent deployed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deployment failed";
    return errorResponse(c, message, 503, "DEPLOY_FAILED");
  }
});

/* ---- Phone routing (generic per-business forwarding setup) ---- */

architectRoutes.get("/phone-routing/status", async (c) => {
  const authUser = c.get("authUser");
  return successResponse(c, await getPhoneRoutingStatus(authUser.id));
});

architectRoutes.post("/phone-routing/setup", async (c) => {
  const authUser = c.get("authUser");
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await setupPhoneRouting(authUser.id, body);
    return successResponse(c, result, "Phone routing saved");
  } catch (error) {
    return errorResponse(c, error instanceof Error ? error.message : "Setup failed", 400, "PHONE_ROUTING_SETUP_FAILED");
  }
});

architectRoutes.patch("/phone-routing/mode", async (c) => {
  const authUser = c.get("authUser");
  try {
    const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown };
    const result = await setPhoneRoutingMode(authUser.id, body.mode);
    return successResponse(c, result, "Routing mode updated");
  } catch (error) {
    return errorResponse(c, error instanceof Error ? error.message : "Update failed", 400, "PHONE_ROUTING_MODE_FAILED");
  }
});

architectRoutes.post("/phone-routing/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { called?: unknown; from?: unknown };
  return successResponse(c, await testPhoneRouting(body));
});

/* ---- Template gallery (static seed, served by API; frontend never hardcodes) ---- */

architectRoutes.get("/templates", (c) => {
  return successResponse(c, { templates: listTemplateCards() });
});

architectRoutes.get("/templates/:slug", (c) => {
  const template = getTemplateBySlug(c.req.param("slug"));
  if (!template) {
    return errorResponse(c, "Template not found", 404, "TEMPLATE_NOT_FOUND");
  }
  return successResponse(c, { template });
});

/**
 * Import a template: clone its workflowJson into a workflow for this architect —
 * the existing one when `workflowId` is supplied, otherwise a new one. Returns the
 * workflowId + workflowJson. Pure data import: no template flags are persisted.
 */
architectRoutes.post("/templates/:slug/use", async (c) => {
  const authUser = c.get("authUser");
  const template = getTemplateBySlug(c.req.param("slug"));
  if (!template) {
    return errorResponse(c, "Template not found", 404, "TEMPLATE_NOT_FOUND");
  }

  const body = (await c.req.json().catch(() => ({}))) as { workflowId?: unknown };
  const targetWorkflowId = typeof body.workflowId === "string" ? body.workflowId : undefined;
  const workflowJson = cloneTemplateWorkflow(template);

  let workflow = null;
  if (targetWorkflowId) {
    const existing = await prisma.workflowDefinition.findFirst({
      where: { id: targetWorkflowId, architectUserId: authUser.id }
    });
    if (existing) {
      workflow = await prisma.workflowDefinition.update({
        where: { id: existing.id },
        data: {
          name: template.title,
          description: template.description,
          workflowJson: workflowJson as never
        }
      });
    }
  }

  if (!workflow) {
    workflow = await prisma.workflowDefinition.create({
      data: {
        architectUserId: authUser.id,
        name: template.title,
        description: template.description,
        workflowJson: workflowJson as never
      }
    });
  }

  return successResponse(
    c,
    {
      workflowId: workflow.id,
      name: workflow.name,
      description: workflow.description,
      workflowJson
    },
    "Template imported"
  );
});

architectRoutes.post("/template-requests", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = templateRequestSchema.parse(await c.req.json());

    const request = await prisma.templateRequest.create({
      data: {
        architectUserId: authUser.id,
        industry: input.industry,
        description: input.description
      },
      select: {
        id: true,
        industry: true,
        description: true,
        createdAt: true
      }
    });

    return successResponse(c, { request }, "Template request submitted", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid template request",
        422,
        "VALIDATION_ERROR"
      );
    }
    return errorResponse(c, "Could not submit template request", 500, "TEMPLATE_REQUEST_FAILED");
  }
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

  if (!workflowId) {
    return errorResponse(c, "Agent id is required", 422, "WORKFLOW_ID_REQUIRED");
  }

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

// The architect's OWN agent dashboard (My Agents) — not the public marketplace
// and not the admin review queue. Returns ALL owned agents across every status:
// published listings (DRAFT/PENDING_REVIEW/APPROVED/REJECTED/SUSPENDED) PLUS
// saved/imported workflows that have no listing yet, surfaced as DRAFT agents.
// Pass ?status=DRAFT|PENDING_REVIEW|... to filter; omit it to return everything owned.
architectRoutes.get("/listings", async (c) => {
  const authUser = c.get("authUser");
  const statusFilter = c.req.query("status");

  const allListings = await prisma.agentListing.findMany({
    where: {
      architectUserId: authUser.id
    },
    include: {
      workflow: true,
      _count: {
        select: { installedAgents: true }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const seenWorkflowIds = new Set<string>();
  const listings = allListings
    .filter((listing) => {
      if (!listing.workflowId) return true;
      if (seenWorkflowIds.has(listing.workflowId)) return false;
      seenWorkflowIds.add(listing.workflowId);
      return true;
    })
    .map(({ _count, ...listing }) => ({
      ...listing,
      installCount: _count.installedAgents
    }));

  // Workflows the architect saved or imported (builder/template) but hasn't
  // published yet → their DRAFT agents. Never hidden.
  const workflows = await prisma.workflowDefinition.findMany({
    where: { architectUserId: authUser.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, description: true, createdAt: true }
  });
  const drafts = workflows
    .filter((workflow) => !seenWorkflowIds.has(workflow.id))
    .map((workflow) => ({
      id: `draft-${workflow.id}`,
      workflowId: workflow.id,
      name: workflow.name,
      shortDescription: workflow.description ?? "",
      description: workflow.description ?? null,
      priceCents: 0,
      status: "DRAFT" as const,
      tags: [] as string[],
      requiredConnectors: [] as string[],
      supportedLlms: [] as string[],
      installCount: 0,
      createdAt: workflow.createdAt,
      workflow: null
    }));

  const combined = [...listings, ...drafts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const result = statusFilter ? combined.filter((agent) => agent.status === statusFilter) : combined;

  return successResponse(c, {
    listings: result
  });
});

architectRoutes.post("/listings", async (c) => {
  try {
    const authUser = c.get("authUser");
    const input = listingSchema.parse(await c.req.json());
    const workflowId = input.workflowId || undefined;

    const workflow = workflowId
      ? await prisma.workflowDefinition.findFirst({
          where: {
            id: workflowId,
            architectUserId: authUser.id
          }
        })
      : null;

    if (workflowId && !workflow) {
      return errorResponse(c, "Agent workflow not found", 404, "WORKFLOW_NOT_FOUND");
    }

    // Connectors the BUYER must set up to run this agent live — derived from the
    // workflow's nodes and merged with any explicitly provided. Architect publish
    // only DECLARES these for the buyer; it never connects them.
    const requiredConnectors = Array.from(
      new Set([
        ...input.requiredConnectors,
        ...(workflow ? requiredConnectorKeys(workflow.workflowJson) : [])
      ])
    );

    const existingListing = workflowId
      ? await prisma.agentListing.findFirst({
        where: {
          architectUserId: authUser.id,
          workflowId
        },
        orderBy: {
          createdAt: "desc"
        }
      })
      : null;

    const listingData = {
      name: input.name,
      shortDescription: input.shortDescription,
      description: input.description || null,
      priceCents: input.priceCents,
      tags: input.tags,
      requiredConnectors,
      supportedLlms: input.supportedLlms,
      status: "PENDING_REVIEW" as const
    };

    if (existingListing) {
      const listing = await prisma.agentListing.update({
        where: { id: existingListing.id },
        data: listingData
      });

      return successResponse(c, { listing }, "Agent listing updated and resubmitted for review");
    }

    const listing = await prisma.agentListing.create({
      data: {
        architectUserId: authUser.id,
        workflowId,
        ...listingData
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