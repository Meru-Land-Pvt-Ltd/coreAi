import { Hono } from "hono";
import type { Context } from "hono";
import { errorResponse, successResponse } from "../../../lib/api-response";
import { requireBusinessPermission } from "../team/membership";
import { detectInjectionAttempt } from "./injection-guard";
import {
  compileRulesPromptSection,
  createRule,
  deleteRule,
  getEffectiveRules,
  listRules,
  listRuleVersions,
  rollbackRule,
  RuleServiceError,
  traceRuleUsage,
  updateRule,
  type UpdateRulePatch
} from "./rules-service";

/**
 * Business rules routes (plan Part 4). Mount under /business/rules.
 * Authorization is server-side per request via requireBusinessPermission;
 * every service call is additionally tenant-guarded by businessId.
 */
export const businessRulesRoutes = new Hono();

function handleServiceError(c: Context, error: unknown) {
  if (error instanceof RuleServiceError) {
    if (error.code === "RULE_CONFLICT") {
      // Conflict responses carry the warnings so the UI can show what clashed
      // and offer "save anyway" (acknowledgeConflicts).
      return c.json(
        { success: false as const, error: error.message, code: error.code, warnings: error.warnings },
        409
      );
    }
    return errorResponse(c, error.message, error.httpStatus, error.code);
  }
  console.error("[rules-routes] unexpected error", error);
  return errorResponse(c, "Something went wrong", 500, "RULES_ERROR");
}

/** undefined = absent, null = clear, Date = set; "invalid" = reject with 422. */
function parseDateField(value: unknown): Date | null | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "invalid" : date;
  }
  return "invalid";
}

businessRulesRoutes.get("/", requireBusinessPermission("view_calls"), async (c) => {
  const membership = c.get("businessMembership");
  try {
    const installedAgentId = c.req.query("installedAgentId") || null;
    const rules = await listRules(membership.businessId, { installedAgentId });
    return successResponse(c, { rules });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

businessRulesRoutes.post("/", requireBusinessPermission("manage_rules"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const startsAt = parseDateField(body.startsAt);
  const endsAt = parseDateField(body.endsAt);
  if (startsAt === "invalid" || endsAt === "invalid") {
    return errorResponse(c, "startsAt/endsAt must be valid dates", 422, "RULE_WINDOW_INVALID");
  }

  try {
    const result = await createRule({
      businessId: membership.businessId,
      actorUserId: authUser.id,
      installedAgentId: typeof body.installedAgentId === "string" ? body.installedAgentId : null,
      title: typeof body.title === "string" ? body.title : "",
      instruction: typeof body.instruction === "string" ? body.instruction : "",
      category: typeof body.category === "string" ? body.category : "",
      priority: typeof body.priority === "number" ? body.priority : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      acknowledgeConflicts: body.acknowledgeConflicts === true,
      changeNote: typeof body.changeNote === "string" ? body.changeNote : undefined
    });
    return successResponse(c, result, "Rule created", 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

businessRulesRoutes.patch("/:ruleId", requireBusinessPermission("manage_rules"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const startsAt = parseDateField(body.startsAt);
  const endsAt = parseDateField(body.endsAt);
  if (startsAt === "invalid" || endsAt === "invalid") {
    return errorResponse(c, "startsAt/endsAt must be valid dates", 422, "RULE_WINDOW_INVALID");
  }

  const patch: UpdateRulePatch = {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.instruction === "string" ? { instruction: body.instruction } : {}),
    ...(typeof body.category === "string" ? { category: body.category } : {}),
    ...(typeof body.priority === "number" ? { priority: body.priority } : {}),
    ...(typeof body.active === "boolean" ? { active: body.active } : {}),
    ...(startsAt !== undefined ? { startsAt } : {}),
    ...(endsAt !== undefined ? { endsAt } : {}),
    ...(body.installedAgentId === null || typeof body.installedAgentId === "string"
      ? { installedAgentId: body.installedAgentId as string | null }
      : {})
  };

  try {
    const result = await updateRule({
      businessId: membership.businessId,
      actorUserId: authUser.id,
      ruleId: c.req.param("ruleId") ?? "",
      patch,
      acknowledgeConflicts: body.acknowledgeConflicts === true,
      changeNote: typeof body.changeNote === "string" ? body.changeNote : undefined
    });
    return successResponse(c, result, "Rule updated");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

businessRulesRoutes.delete("/:ruleId", requireBusinessPermission("manage_rules"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  try {
    await deleteRule({
      businessId: membership.businessId,
      actorUserId: authUser.id,
      ruleId: c.req.param("ruleId") ?? ""
    });
    return successResponse(c, { deleted: true }, "Rule deleted");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

businessRulesRoutes.post("/:ruleId/rollback", requireBusinessPermission("manage_rules"), async (c) => {
  const membership = c.get("businessMembership");
  const authUser = c.get("authUser");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const toVersion = typeof body.toVersion === "number" ? body.toVersion : Number.NaN;
  if (!Number.isInteger(toVersion) || toVersion < 1) {
    return errorResponse(c, "toVersion must be a positive integer", 422, "RULE_VERSION_INVALID");
  }

  try {
    const result = await rollbackRule({
      businessId: membership.businessId,
      actorUserId: authUser.id,
      ruleId: c.req.param("ruleId") ?? "",
      toVersion
    });
    return successResponse(c, result, "Rule rolled back");
  } catch (error) {
    return handleServiceError(c, error);
  }
});

businessRulesRoutes.get("/:ruleId/versions", requireBusinessPermission("manage_rules"), async (c) => {
  const membership = c.get("businessMembership");
  try {
    const versions = await listRuleVersions({
      businessId: membership.businessId,
      ruleId: c.req.param("ruleId") ?? ""
    });
    return successResponse(c, { versions });
  } catch (error) {
    return handleServiceError(c, error);
  }
});

/**
 * Sandbox: shows exactly what the rules engine would contribute for a message
 * WITHOUT calling any LLM — the compiled prompt section, injection screening
 * of the message, and a heuristic keyword trace of which rules are in play.
 */
businessRulesRoutes.post("/test", requireBusinessPermission("manage_rules"), async (c) => {
  const membership = c.get("businessMembership");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return errorResponse(c, "message is required", 422, "MESSAGE_REQUIRED");
  }
  const installedAgentId =
    typeof body.installedAgentId === "string" && body.installedAgentId ? body.installedAgentId : null;

  try {
    const rules = await getEffectiveRules({
      businessId: membership.businessId,
      installedAgentId,
      now: new Date()
    });
    return successResponse(c, {
      compiledSection: compileRulesPromptSection(rules),
      injection: detectInjectionAttempt(message),
      rulesInPlay: traceRuleUsage(rules, message),
      effectiveRuleIds: rules.map((rule) => rule.id),
      note: "Heuristic sandbox: rulesInPlay is keyword overlap only — no LLM was called."
    });
  } catch (error) {
    return handleServiceError(c, error);
  }
});
