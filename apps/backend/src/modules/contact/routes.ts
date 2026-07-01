import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";

export const contactRoutes = new Hono();

const contactSubmissionSchema = z.object({
  name: z.string().trim().min(1, "Please enter your full name.").max(200),
  email: z.string().trim().email("Please enter a valid email address."),
  subject: z.enum(["general", "business-support", "architect-support", "partnership", "bug-report"]),
  message: z.string().trim().min(1, "Please enter a message.").max(5000)
});

contactRoutes.post("/submissions", async (c) => {
  try {
    const input = contactSubmissionSchema.parse(await c.req.json());

    const submission = await prisma.contactSubmission.create({
      data: {
        name: input.name,
        email: input.email,
        subject: input.subject,
        message: input.message
      },
      select: {
        id: true,
        createdAt: true
      }
    });

    return successResponse(c, { submission }, "Message sent", 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid contact submission",
        422,
        "VALIDATION_ERROR"
      );
    }

    return errorResponse(c, "Could not submit contact message", 500, "CONTACT_SUBMISSION_FAILED");
  }
});
