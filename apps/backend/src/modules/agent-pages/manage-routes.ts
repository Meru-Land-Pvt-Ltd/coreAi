import type { Hono } from "hono";
import type { PublishedAgentPage } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { inferAgentPageTemplate, ensurePublishedAgentPage, type AgentPageTemplate } from "./slug";

/**
 * Architect manage endpoints for published agent pages. Ownership is the
 * workflow: only the architect who owns workflowId may read or edit the page.
 * The page row is created lazily on first GET once the workflow has a listing.
 */

const agentPageUpdateSchema = z.object({
  template: z.enum(["chat", "voice", "media", "form"]).optional(),
  headline: z
    .string()
    .trim()
    .max(120, "Headline must be 120 characters or fewer")
    .nullable()
    .transform((value) => (value === "" ? null : value))
    .optional(),
  welcomeMessage: z
    .string()
    .trim()
    .max(500, "Welcome message must be 500 characters or fewer")
    .nullable()
    .transform((value) => (value === "" ? null : value))
    .optional(),
  suggestedPrompts: z
    .array(z.string().trim().max(80, "Each suggested prompt must be 80 characters or fewer"))
    .max(4, "Up to 4 suggested prompts are allowed")
    .transform((prompts) => prompts.filter((prompt) => prompt.length > 0))
    .optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Accent color must be a hex color like #f59e0b")
    .nullable()
    .optional()
});

/** Public-contract page shape (same as GET /agent-pages/:slug). */
function serializeAgentPage(page: PublishedAgentPage) {
  return {
    slug: page.slug,
    template: page.template as AgentPageTemplate,
    headline: page.headline,
    welcomeMessage: page.welcomeMessage,
    suggestedPrompts: page.suggestedPrompts,
    accentColor: page.accentColor,
    status: page.status
  };
}

function agentPageUrl(slug: string): string {
  return `${env.FRONTEND_URL.replace(/\/+$/, "")}/a/${slug}`;
}

export function registerAgentPageManageRoutes(routes: Hono) {
  /** Page (auto-created when the workflow has a listing) + public URL. */
  routes.get("/manage/:workflowId", requireAuth, requireRole(["ARCHITECT"]), async (c) => {
    const authUser = c.get("authUser");
    const workflowId = c.req.param("workflowId");

    const workflow = await prisma.workflowDefinition.findFirst({
      where: { id: workflowId, architectUserId: authUser.id }
    });
    if (!workflow) {
      return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
    }

    const defaultTemplate = inferAgentPageTemplate(workflow.workflowJson);

    const listing = await prisma.agentListing.findFirst({ where: { workflowId } });
    if (!listing) {
      // No listing yet — nothing to publish a page for.
      return successResponse(c, { page: null, url: null, defaultTemplate });
    }

    const page = await ensurePublishedAgentPage({
      listing: {
        id: listing.id,
        name: listing.name,
        architectUserId: listing.architectUserId,
        workflowId: listing.workflowId,
        workflow: { workflowJson: workflow.workflowJson }
      }
    });
    if (!page) {
      return successResponse(c, { page: null, url: null, defaultTemplate });
    }

    return successResponse(c, {
      page: serializeAgentPage(page),
      url: agentPageUrl(page.slug),
      defaultTemplate
    });
  });

  /** Update template/headline/welcome/prompts/accent color. */
  routes.patch("/manage/:workflowId", requireAuth, requireRole(["ARCHITECT"]), async (c) => {
    const authUser = c.get("authUser");
    const workflowId = c.req.param("workflowId");

    const workflow = await prisma.workflowDefinition.findFirst({
      where: { id: workflowId, architectUserId: authUser.id },
      select: { id: true }
    });
    if (!workflow) {
      return errorResponse(c, "Agent not found", 404, "WORKFLOW_NOT_FOUND");
    }

    let input: z.infer<typeof agentPageUpdateSchema>;
    try {
      input = agentPageUpdateSchema.parse(await c.req.json().catch(() => ({})));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse(c, error.issues[0]?.message ?? "Invalid request", 422, "VALIDATION_ERROR");
      }
      throw error;
    }

    const page = await prisma.publishedAgentPage.findFirst({ where: { workflowId } });
    if (!page) {
      return errorResponse(c, "Agent page not found", 404, "AGENT_PAGE_NOT_FOUND");
    }

    const updated = await prisma.publishedAgentPage.update({
      where: { id: page.id },
      data: {
        template: input.template,
        headline: input.headline,
        welcomeMessage: input.welcomeMessage,
        suggestedPrompts: input.suggestedPrompts,
        accentColor: input.accentColor
      }
    });

    return successResponse(c, {
      page: serializeAgentPage(updated),
      url: agentPageUrl(updated.slug)
    });
  });
}
