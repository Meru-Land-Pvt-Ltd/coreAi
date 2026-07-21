import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { processMessage, type ChatbotContext, type AgentListingSummary } from "./chatbot-engine";

export const chatbotRoutes = new Hono();

const messageSchema = z.object({
  message: z.string().trim().min(1, "Message cannot be empty").max(1000, "Message too long"),
  context: z.object({
    lastIntent: z.string().optional(),
    lastMentionedAgentId: z.string().optional(),
    awaitingInput: z.enum([
      "calculator_usage",
      "calculator_agent",
      "fallback_email",
      "fallback_phone",
      "fallback_feedback",
      "general_feedback"
    ]).nullable().optional(),
    fallbackQuery: z.string().optional(),
    fallbackEmail: z.string().optional(),
    fallbackPhone: z.string().optional(),
    queryCount: z.number().optional()
  }).optional()
});

chatbotRoutes.post("/message", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parseResult = messageSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse(
        c, 
        parseResult.error.issues[0]?.message ?? "Invalid request body", 
        400, 
        "VALIDATION_ERROR"
      );
    }

    const { message, context } = parseResult.data;

    // Fetch approved listings dynamically from the PostgreSQL database
    const listings = await prisma.agentListing.findMany({
      where: {
        status: "APPROVED"
      },
      select: {
        id: true,
        name: true,
        shortDescription: true,
        tagline: true,
        priceCents: true,
        pricingModel: true,
        requiredConnectors: true,
        includedFeatures: true,
        category: true,
        industryTags: true,
        tags: true
      }
    });

    // Map database listings to chatbot summary structure
    const mappedListings: AgentListingSummary[] = listings.map((l) => ({
      id: l.id,
      name: l.name,
      shortDescription: l.shortDescription,
      tagline: l.tagline,
      priceCents: l.priceCents,
      pricingModel: l.pricingModel,
      requiredConnectors: l.requiredConnectors,
      includedFeatures: l.includedFeatures,
      category: l.category,
      industryTags: l.industryTags,
      tags: l.tags
    }));

    // Process the message using our rule-based engine
    const chatbotContext: ChatbotContext = {
      lastIntent: context?.lastIntent,
      lastMentionedAgentId: context?.lastMentionedAgentId,
      awaitingInput: context?.awaitingInput as any,
      fallbackQuery: context?.fallbackQuery,
      fallbackEmail: context?.fallbackEmail,
      fallbackPhone: context?.fallbackPhone,
      queryCount: context?.queryCount
    };

    const result = processMessage(message, chatbotContext, mappedListings);

    // Save fallback submission to database asynchronously if chatbot gathered email/phone/feedback
    if (result.saveFeedback) {
      await prisma.contactSubmission.create({
        data: {
          name: `Chatbot User (Phone: ${result.saveFeedback.phone})`,
          email: result.saveFeedback.email,
          subject: `Chatbot Fallback: ${result.saveFeedback.query}`,
          message: `Feedback: ${result.saveFeedback.feedback}\n\nOriginal Query: ${result.saveFeedback.query}`
        }
      });
    }

    return successResponse(c, {
      reply: result.reply,
      context: result.context,
      suggestions: result.suggestions
    });
  } catch (error) {
    console.error("Chatbot processing error:", error);
    return errorResponse(
      c, 
      "An error occurred while processing your message", 
      500, 
      "CHATBOT_ERROR"
    );
  }
});
