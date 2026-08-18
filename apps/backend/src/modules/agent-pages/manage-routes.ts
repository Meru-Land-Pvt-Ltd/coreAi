import type { Hono } from "hono";
import type { Prisma, PublishedAgentPage } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import { errorResponse, successResponse } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { deriveFaceBlueprint } from "./blueprint";
import { agentPageLayoutSchema, contentWidthSchema, resolveDesign } from "./design";
import { registerAgentPageDesignChatRoute } from "./design-chat";
import { registerAgentPageProductChatRoute } from "./product-chat";
import { registerAgentPageProductRoutes } from "./product-routes";
import { ensureDraftAgentListingAndPage, inferAgentPageTemplate, type AgentPageTemplate } from "./slug";

/**
 * Architect manage endpoints for published agent pages. Ownership is the
 * workflow: only the architect who owns workflowId may read or edit the page.
 * The listing (DRAFT) and page rows are created lazily on first GET — draft
 * workflows without a listing get bootstrapped automatically.
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
    .optional(),
  /**
   * Design dials the builder writes directly (everything else is the Design
   * Brain's job). Each key present replaces just that key; every other stored
   * design key — dials from the chat included — rides along untouched.
   *
   *   layout       — the COMPLETE arrangement from Arrange mode; it replaces
   *                  the stored one wholesale ({} resets to the stacked flow).
   *                  Entries are sanitized individually, so a corrupt one is
   *                  dropped without rejecting the request.
   *   contentWidth — the Preview toolbar's width control.
   */
  design: z
    .object({
      layout: agentPageLayoutSchema.optional(),
      contentWidth: contentWidthSchema.optional()
    })
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
  /** Page (listing + page auto-created for draft workflows) + public URL. */
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
    // Non-null only when the graph contains product blocks — the builder's
    // Test preview then assembles the page from those blocks.
    const blueprint = deriveFaceBlueprint(workflow.workflowJson);

    // Universal bootstrap: a draft workflow with no listing gets a minimal
    // DRAFT one plus its page row, so the Test preview always renders the
    // real page + design (never a placeholder). Public visibility is still
    // gated on listing approval, so nothing leaks.
    const page = await ensureDraftAgentListingAndPage({
      id: workflow.id,
      name: workflow.name,
      architectUserId: workflow.architectUserId,
      workflowJson: workflow.workflowJson
    });

    return successResponse(c, {
      page: serializeAgentPage(page),
      url: agentPageUrl(page.slug),
      defaultTemplate,
      blueprint,
      // Full Design Brain config (defaults filled in) — additive field, the
      // builder's Test preview renders every dial from it.
      design: resolveDesign(page.designJson)
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

    // Design dials merge key by key over what is stored: Arrange mode sends
    // the complete arrangement (layout replaces the stored one wholesale,
    // {} = reset), the Preview toolbar sends contentWidth, and every other
    // stored key — dials from the Design Brain included — rides along
    // untouched. designJson is only written when a dial is actually present.
    const layoutPatch = input.design?.layout;
    const contentWidthPatch = input.design?.contentWidth;
    let designJsonPatch: Prisma.InputJsonValue | undefined;
    if (layoutPatch !== undefined || contentWidthPatch !== undefined) {
      const storedDesign =
        typeof page.designJson === "object" && page.designJson !== null && !Array.isArray(page.designJson)
          ? (page.designJson as Record<string, unknown>)
          : {};
      designJsonPatch = {
        ...storedDesign,
        ...(layoutPatch !== undefined ? { layout: layoutPatch } : {}),
        ...(contentWidthPatch !== undefined ? { contentWidth: contentWidthPatch } : {})
      } as Prisma.InputJsonValue;
    }

    const updated = await prisma.publishedAgentPage.update({
      where: { id: page.id },
      data: {
        template: input.template,
        headline: input.headline,
        welcomeMessage: input.welcomeMessage,
        suggestedPrompts: input.suggestedPrompts,
        accentColor: input.accentColor,
        ...(designJsonPatch !== undefined ? { designJson: designJsonPatch } : {})
      }
    });

    return successResponse(c, {
      page: serializeAgentPage(updated),
      url: agentPageUrl(updated.slug),
      // Additive: the design rides along so callers holding the manage
      // payload never lose the dials after a copy/template save.
      design: resolveDesign(updated.designJson)
    });
  });

  /** Design Brain chat: natural language in, validated DesignPatch applied. */
  registerAgentPageDesignChatRoute(routes);

  registerAgentPageProductRoutes(routes);

  registerAgentPageProductChatRoute(routes);
}
