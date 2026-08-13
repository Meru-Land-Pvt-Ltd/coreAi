import { Hono } from "hono";
import type { Context } from "hono";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { apiErrorStatus } from "../../../lib/error-utils";
import { logBusinessActivity } from "../activity-log";
import { requireBusinessPermission } from "../team/membership";
import {
  archiveFile,
  KnowledgeVersioningError,
  linkReplacement,
  restoreFile,
  setVisibility
} from "./knowledge-versioning";
import { csvSourceAdapter } from "./source-adapters/csv-adapter";
import { ingestExtractedText, type IngestedKnowledgeFile } from "./source-adapters/ingest";
import { SourceAdapterError } from "./source-adapters/types";
import { urlSourceAdapter } from "./source-adapters/url-adapter";
import {
  listQuestions,
  resolveQuestion,
  UnansweredQuestionError
} from "./unanswered-questions";

/**
 * Knowledge v2 routes (plan Part 3): URL/CSV sources, lifecycle + visibility
 * management, and the unanswered-question ("knowledge gaps") dashboard.
 *
 * Mounted under /business/knowledge-v2 (after businessRoutes' requireAuth +
 * requireRole middlewares); each route additionally authorizes through
 * requireBusinessPermission, so team-member permissions are enforced
 * server-side per request.
 */
export const knowledgeV2Routes = new Hono();

function knowledgeV2ErrorResponse(c: Context, error: unknown) {
  if (
    error instanceof KnowledgeVersioningError ||
    error instanceof SourceAdapterError ||
    error instanceof UnansweredQuestionError
  ) {
    return errorResponse(c, error.message, apiErrorStatus(error.status, 422), error.code);
  }
  console.error("[knowledge-v2] unexpected error", error);
  return errorResponse(c, "Something went wrong", 500, "KNOWLEDGE_V2_ERROR");
}

async function logIngestActivity(
  c: Context,
  file: IngestedKnowledgeFile,
  detail: Record<string, unknown>
) {
  if (file.alreadyExisted) return;
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  await logBusinessActivity({
    businessId: membership.businessId,
    action: "KNOWLEDGE_UPLOADED",
    actorUserId: authUser?.id ?? null,
    targetType: "BusinessKnowledgeFile",
    targetId: file.id,
    detail: { filename: file.filename, chunkCount: file.chunkCount, ...detail }
  });
}

/* ------------------------------ source imports ----------------------------- */

knowledgeV2Routes.post(
  "/sources/url",
  requireBusinessPermission("manage_knowledge"),
  async (c) => {
    const membership = c.get("businessMembership");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return errorResponse(c, "Provide the page URL to import.", 400, "URL_REQUIRED");
    const installedAgentId =
      typeof body.installedAgentId === "string" && body.installedAgentId
        ? body.installedAgentId
        : null;

    try {
      const content = await urlSourceAdapter.fetchContent({ url });
      const file = await ingestExtractedText({
        businessId: membership.businessId,
        installedAgentId,
        sourceType: "URL",
        sourceUrl: url,
        content
      });
      await logIngestActivity(c, file, { sourceType: "URL", sourceUrl: url });
      return successResponse(
        c,
        { file },
        file.alreadyExisted
          ? "This page was already imported."
          : "Page imported into the knowledge base.",
        file.alreadyExisted ? 200 : 201
      );
    } catch (error) {
      return knowledgeV2ErrorResponse(c, error);
    }
  }
);

knowledgeV2Routes.post(
  "/sources/csv",
  requireBusinessPermission("manage_knowledge"),
  async (c) => {
    const membership = c.get("businessMembership");
    const contentType = c.req.header("content-type") ?? "";

    let filename = "data.csv";
    let contentText = "";
    let installedAgentId: string | null = null;

    try {
      if (contentType.includes("multipart/form-data")) {
        const body = await c.req.parseBody();
        const file = body.file ?? body.document ?? body.csv;
        if (!(file instanceof File)) {
          return errorResponse(c, 'Attach a CSV file under the "file" field.', 400, "CSV_FILE_REQUIRED");
        }
        filename = file.name || filename;
        contentText = Buffer.from(await file.arrayBuffer()).toString("utf8");
        if (typeof body.installedAgentId === "string" && body.installedAgentId) {
          installedAgentId = body.installedAgentId;
        }
      } else {
        const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
        if (typeof body.filename === "string" && body.filename) filename = body.filename;
        const rawContent = typeof body.content === "string" ? body.content : "";
        contentText =
          body.encoding === "base64"
            ? Buffer.from(rawContent, "base64").toString("utf8")
            : rawContent;
        if (typeof body.installedAgentId === "string" && body.installedAgentId) {
          installedAgentId = body.installedAgentId;
        }
      }

      if (!contentText.trim()) {
        return errorResponse(c, "Provide the CSV content to import.", 400, "CSV_CONTENT_REQUIRED");
      }

      const content = await csvSourceAdapter.fetchContent({ filename, content: contentText });
      const file = await ingestExtractedText({
        businessId: membership.businessId,
        installedAgentId,
        sourceType: "CSV",
        content
      });
      await logIngestActivity(c, file, { sourceType: "CSV" });
      return successResponse(
        c,
        { file },
        file.alreadyExisted
          ? "This file was already imported."
          : "CSV imported into the knowledge base.",
        file.alreadyExisted ? 200 : 201
      );
    } catch (error) {
      return knowledgeV2ErrorResponse(c, error);
    }
  }
);

/* -------------------------- lifecycle + visibility ------------------------- */

knowledgeV2Routes.patch(
  "/files/:fileId/visibility",
  requireBusinessPermission("manage_knowledge"),
  async (c) => {
    const membership = c.get("businessMembership");
    const authUser = c.get("authUser");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const file = await setVisibility({
        businessId: membership.businessId,
        fileId: c.req.param("fileId") ?? "",
        visibility: String(body.visibility ?? ""),
        actorUserId: authUser?.id ?? null
      });
      return successResponse(c, { file }, "Visibility updated.");
    } catch (error) {
      return knowledgeV2ErrorResponse(c, error);
    }
  }
);

knowledgeV2Routes.post(
  "/files/:fileId/archive",
  requireBusinessPermission("manage_knowledge"),
  async (c) => {
    const membership = c.get("businessMembership");
    const authUser = c.get("authUser");
    try {
      const file = await archiveFile({
        businessId: membership.businessId,
        fileId: c.req.param("fileId") ?? "",
        actorUserId: authUser?.id ?? null
      });
      return successResponse(c, { file }, "Document archived.");
    } catch (error) {
      return knowledgeV2ErrorResponse(c, error);
    }
  }
);

knowledgeV2Routes.post(
  "/files/:fileId/restore",
  requireBusinessPermission("manage_knowledge"),
  async (c) => {
    const membership = c.get("businessMembership");
    const authUser = c.get("authUser");
    try {
      const file = await restoreFile({
        businessId: membership.businessId,
        fileId: c.req.param("fileId") ?? "",
        actorUserId: authUser?.id ?? null
      });
      return successResponse(c, { file }, "Document restored.");
    } catch (error) {
      return knowledgeV2ErrorResponse(c, error);
    }
  }
);

knowledgeV2Routes.post(
  "/files/:newFileId/replaces/:oldFileId",
  requireBusinessPermission("manage_knowledge"),
  async (c) => {
    const membership = c.get("businessMembership");
    const authUser = c.get("authUser");
    try {
      const result = await linkReplacement({
        businessId: membership.businessId,
        newFileId: c.req.param("newFileId") ?? "",
        oldFileId: c.req.param("oldFileId") ?? "",
        actorUserId: authUser?.id ?? null
      });
      return successResponse(c, result, "Replacement linked; the old document was archived.");
    } catch (error) {
      return knowledgeV2ErrorResponse(c, error);
    }
  }
);

/* ------------------------------ knowledge gaps ----------------------------- */

knowledgeV2Routes.get("/gaps", requireBusinessPermission("view_calls"), async (c) => {
  const membership = c.get("businessMembership");
  const statusRaw = c.req.query("status");
  if (statusRaw && statusRaw !== "OPEN" && statusRaw !== "RESOLVED") {
    return errorResponse(c, 'Status must be "OPEN" or "RESOLVED".', 422, "INVALID_STATUS");
  }
  try {
    const questions = await listQuestions({
      businessId: membership.businessId,
      status: statusRaw as "OPEN" | "RESOLVED" | undefined
    });
    return successResponse(c, { questions });
  } catch (error) {
    return knowledgeV2ErrorResponse(c, error);
  }
});

knowledgeV2Routes.post(
  "/gaps/:id/resolve",
  requireBusinessPermission("manage_knowledge"),
  async (c) => {
    const membership = c.get("businessMembership");
    const authUser = c.get("authUser");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const question = await resolveQuestion({
        businessId: membership.businessId,
        id: c.req.param("id") ?? "",
        resolvedByFileId:
          typeof body.resolvedByFileId === "string" && body.resolvedByFileId
            ? body.resolvedByFileId
            : null,
        actorUserId: authUser?.id ?? null
      });
      return successResponse(c, { question }, "Question marked as resolved.");
    } catch (error) {
      return knowledgeV2ErrorResponse(c, error);
    }
  }
);
