import { isArchitectNodeType, ARCHITECT_NODE_CATALOG, getNodeDefinition } from "@coreai/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { errorResponse, successResponse } from "../../lib/api-response";
import { requireAuth, requireRole } from "../../middleware/auth";
import { adminPhoneNumberRoutes } from "./phone-numbers";
import { adminPayoutRoutes } from "./payout-routes";
import { adminPricingRoutes } from "./pricing-routes";
import { adminConnectorRoutes } from "../connectors/admin-routes";
import { honestyReport } from "../architect/honesty-report";
import {
  nodeControls,
  setNodeExecution,
  setNodeVisibility,
  whoIsAffectedBy
} from "./node-controls";
import { forgetProvider, llmControlPanel, patchModel, setProviderSwitches } from "./llm-control";
import { diagnoseUnknownFailures, knownFailures } from "../architect/self-healing/diagnose";
import { sendBusinessEmail } from "../email/ses-mail-service";
import { listRegisteredBusinessAccounts } from "./registered-business-accounts";
import { getAdminLiveSummaryData } from "./admin-summary";
import { pseudonymizeDisclosureConsentsForUser } from "../compliance/disclosure-consent";
import { deleteUserWorkspace } from "../auth/workspace-deletion";
import { logAdminAction } from "./audit";
import {
  isManagedPlatformApiKey,
  listPlatformApiSettings,
  savePlatformApiSettings
} from "./platform-api-settings";
import {
  DEFAULT_DESIGN_BRAIN_RULES,
  DESIGN_BRAIN_RULES_MAX_LENGTH,
  getDesignBrainRulesSetting,
  saveDesignBrainRules
} from "./design-brain-rules";
import {
  defaultMemoryLimits,
  getMemoryLimits,
  saveMemoryLimits,
  MEMORY_LIMIT_BOUNDS
} from "./memory-limits";
import {
  CONDITION_ROADS_BOUNDS,
  DEFAULT_CONDITION_ROADS,
  DEFAULT_LOOP_ROUNDS,
  LOOP_ROUNDS_BOUNDS,
  getConditionRoadLimit,
  getFileUploadImagesAllowed,
  getLoopRoundLimit,
  getTimerFloorMinutes,
  saveTimerFloorMinutes,
  DEFAULT_TIMER_FLOOR_MINUTES,
  TIMER_FLOOR_BOUNDS,
  getEmailPerRunLimit,
  saveEmailPerRunLimit,
  DEFAULT_EMAIL_PER_RUN,
  EMAIL_PER_RUN_BOUNDS,
  saveConditionRoadLimit,
  saveFileUploadImagesAllowed,
  saveLoopRoundLimit
} from "./node-limits";
import {
  DEFAULT_DOOR_BRAIN_PROVIDER,
  DOOR_BRAIN_MODEL_MAX_LENGTH,
  doorBrainModelMismatch,
  doorBrainModelOptions,
  doorBrainProviderOptions,
  getDoorBrainSetting,
  isSupportedDoorBrainProvider,
  saveDoorBrainConfig
} from "./door-brain-settings";
import {
  DEFAULT_SMART_DESIGNER_BRAIN_PROVIDER,
  DEFAULT_SMART_DESIGNER_BRAIN_MODEL,
  SMART_DESIGNER_BRAIN_MODEL_MAX_LENGTH,
  smartDesignerBrainModelMismatch,
  smartDesignerBrainModelOptions,
  smartDesignerBrainProviderOptions,
  getSmartDesignerBrainSetting,
  isSupportedSmartDesignerBrainProvider,
  saveSmartDesignerBrainConfig
} from "./smart-designer-brain-settings";
import {
  listArchitectNodeGroups,
  listArchitectNodeVisibility,
  createArchitectNodeGroup,
  deleteArchitectNodeGroup,
  saveArchitectNodeVisibility
} from "./node-visibility";

export const adminRoutes = new Hono();

adminRoutes.use("*", requireAuth);
adminRoutes.use("*", requireRole(["ADMIN"]));

// Platform Twilio phone-number management (inherits the guards above).
adminRoutes.route("/phone-numbers", adminPhoneNumberRoutes);
adminRoutes.route("/payouts", adminPayoutRoutes);
adminRoutes.route("/pricing", adminPricingRoutes);
// The connector catalogue and its daily self-test results.
adminRoutes.route("/connectors", adminConnectorRoutes);

/* ------------------------------- Nodes ---------------------------------- */

/**
 * Every node, with both switches and what each one currently costs.
 *
 * `affects` is the number of live agents that would stop using a step if it
 * were paused. It is here rather than behind a second click because pausing a
 * node that fourteen businesses depend on is a different decision from pausing
 * one nobody uses, and an admin should never have to guess which they are
 * making.
 */
adminRoutes.get("/nodes", async (c) => {
  const controls = await nodeControls();

  const nodes = await Promise.all(
    ARCHITECT_NODE_CATALOG.map(async (item) => {
      const definition = getNodeDefinition(item.type);
      const control = controls.get(item.type);
      const affected = await whoIsAffectedBy(item.type).catch(() => ({
        installedAgents: 0,
        businesses: 0,
        agentNames: [] as string[]
      }));

      return {
        type: item.type,
        label: control?.nodeType ? definition?.label ?? item.label : definition?.label ?? item.label,
        group: item.group,
        description: definition?.description ?? "",
        visible: control ? control.visible : item.defaultVisible,
        executionEnabled: control ? control.executionEnabled : true,
        pausedReason: control?.pausedReason ?? null,
        pausedAt: control?.pausedAt ?? null,
        liveAgents: affected.installedAgents,
        businesses: affected.businesses,
        agentNames: affected.agentNames
      };
    })
  );

  return successResponse(c, { nodes });
});

/** Toggle one: may an architect build something new with this? */
adminRoutes.put("/nodes/:nodeType/visibility", async (c) => {
  const authUser = c.get("authUser");
  const nodeType = c.req.param("nodeType");
  const body = (await c.req.json().catch(() => ({}))) as { visible?: boolean };

  try {
    await setNodeVisibility(nodeType, body.visible !== false);
  } catch (error) {
    return errorResponse(c, (error as Error).message, 422, "VALIDATION_ERROR");
  }

  await logAdminAction({
    adminUserId: authUser.id,
    action: body.visible !== false ? "NODE_SHOWN" : "NODE_HIDDEN",
    targetType: "NODE",
    targetId: nodeType
  });

  return successResponse(
    c,
    { nodeType, visible: body.visible !== false },
    body.visible !== false
      ? "Architects can use it in new agents again."
      : "Hidden from new agents. Everything already running is untouched."
  );
});

/**
 * Toggle two: may it run at all, anywhere?
 *
 * This one reaches into agents businesses have already bought, so it demands a
 * written reason — which is what those businesses will read — and it is written
 * to the admin audit log with who did it.
 */
/* ---------------------------- The AI Brain ------------------------------- */

/**
 * Everything an admin needs to decide about an LLM, in one answer: whether the
 * key works, whether the provider is on, which models it actually has, which
 * of those architects may use, and what each costs.
 *
 * Models are FETCHED from each provider, never typed. The first version of this
 * made an admin copy a model id out of documentation — work we invented, where
 * one typo produced a model that looked real in a dropdown and failed on the
 * first customer.
 */
adminRoutes.get("/llm-control", async (c) => {
  const refresh = c.req.query("refresh") === "1";
  return successResponse(c, { providers: await llmControlPanel(refresh) });
});

/** The key for one provider, saved where the engine already looks for it. */
adminRoutes.put("/llm-control/:providerId/key", async (c) => {
  const authUser = c.get("authUser");
  const providerId = c.req.param("providerId");
  const body = (await c.req.json().catch(() => ({}))) as { envKey?: unknown; apiKey?: unknown };

  const envKey = String(body.envKey ?? "");
  const apiKey = String(body.apiKey ?? "").trim();

  if (!envKey) return errorResponse(c, "Which key is this?", 422, "VALIDATION_ERROR");
  if (!apiKey) return errorResponse(c, "Paste the key before saving.", 422, "VALIDATION_ERROR");

  await savePlatformApiSettings([{ key: envKey, value: apiKey }], authUser.id);
  forgetProvider(providerId);

  await logAdminAction({
    adminUserId: authUser.id,
    action: "LLM_KEY_SAVED",
    targetType: "LlmProvider",
    targetId: providerId
    /* Never the key itself. An audit row is read by more people than the
       screen it came from. */
  }).catch(() => null);

  return successResponse(c, { providers: await llmControlPanel(true) });
});

/** A whole provider's two switches, the same pair as the node and the model. */
adminRoutes.put("/llm-control/:providerId", async (c) => {
  const authUser = c.get("authUser");
  const providerId = c.req.param("providerId");
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown; runningEnabled?: unknown };

  const patch = {
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(typeof body.runningEnabled === "boolean" ? { runningEnabled: body.runningEnabled } : {})
  };

  await setProviderSwitches(providerId, patch);
  await logAdminAction({
    adminUserId: authUser.id,
    action: "LLM_PROVIDER_SWITCHED",
    targetType: "LlmProvider",
    targetId: providerId,
    meta: patch
  }).catch(() => null);

  return successResponse(c, { providers: await llmControlPanel() });
});

/** One model: its name, its two switches, its price. */
adminRoutes.put("/llm-control/:providerId/models/:modelId", async (c) => {
  const authUser = c.get("authUser");
  const providerId = c.req.param("providerId");
  const modelId = decodeURIComponent(c.req.param("modelId"));
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const price = (value: unknown): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };

  const saved = await patchModel(modelId, providerId, {
    ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(typeof body.runningEnabled === "boolean" ? { runningEnabled: body.runningEnabled } : {}),
    ...(price(body.inputPricePer1M) !== undefined ? { inputPricePer1M: price(body.inputPricePer1M)! } : {}),
    ...(price(body.outputPricePer1M) !== undefined ? { outputPricePer1M: price(body.outputPricePer1M)! } : {})
  });

  await logAdminAction({
    adminUserId: authUser.id,
    action: "LLM_MODEL_UPDATED",
    targetType: "LlmModel",
    targetId: modelId,
    meta: { providerId, enabled: saved.enabled, runningEnabled: saved.runningEnabled }
  }).catch(() => null);

  return successResponse(c, { model: saved });
});

adminRoutes.put("/nodes/:nodeType/execution", async (c) => {
  const authUser = c.get("authUser");
  const nodeType = c.req.param("nodeType");
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean; reason?: string };
  const enabled = body.enabled !== false;

  const affected = await whoIsAffectedBy(nodeType).catch(() => ({ installedAgents: 0, businesses: 0, agentNames: [] }));

  try {
    await setNodeExecution({ nodeType, enabled, reason: body.reason, adminUserId: authUser.id });
  } catch (error) {
    return errorResponse(c, (error as Error).message, 422, "VALIDATION_ERROR");
  }

  await logAdminAction({
    adminUserId: authUser.id,
    action: enabled ? "NODE_RESUMED" : "NODE_PAUSED",
    targetType: "NODE",
    targetId: nodeType,
    meta: { reason: body.reason ?? null, liveAgents: affected.installedAgents }
  });

  return successResponse(
    c,
    { nodeType, executionEnabled: enabled, affected },
    enabled
      ? `Running again in ${affected.installedAgents} live agent${affected.installedAgents === 1 ? "" : "s"}.`
      : `Paused everywhere. ${affected.installedAgents} live agent${affected.installedAgents === 1 ? "" : "s"} across ${affected.businesses} business${affected.businesses === 1 ? "" : "es"} will skip this step and be told why.`
  );
});

/**
 * What turned red: steps that reported success without returning what their
 * node type says they produce, grouped by cause rather than by occurrence.
 */
/** Everything the platform has learned about why things break. */
adminRoutes.get("/failures", async (c) => {
  return successResponse(c, await knownFailures());
});

/** Explain what is still unexplained, now rather than on the next sweep. */
adminRoutes.post("/failures/diagnose", async (c) => {
  const limit = Number.parseInt(c.req.query("limit") ?? "5", 10);
  return successResponse(c, await diagnoseUnknownFailures(Number.isFinite(limit) ? limit : 5));
});

adminRoutes.get("/honesty", async (c) => {
  const days = Number.parseInt(c.req.query("days") ?? "30", 10);
  return successResponse(c, await honestyReport(Number.isFinite(days) ? days : 30));
});

/* -------------------- Manage API (platform credentials) ------------------- */

adminRoutes.get("/api-settings", async (c) => {
  // Secrets come back masked — the plaintext never leaves the server.
  return successResponse(c, { groups: await listPlatformApiSettings() });
});

const apiSettingsUpdateSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(120),
        // Empty clears the override and restores the .env fallback.
        value: z.string().max(4000)
      })
    )
    .min(1)
    .max(60)
});

adminRoutes.put("/api-settings", async (c) => {
  const authUser = c.get("authUser");
  const parsed = apiSettingsUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid settings payload", 422, "VALIDATION_ERROR");
  }

  const unknown = parsed.data.settings.filter((setting) => !isManagedPlatformApiKey(setting.key));
  if (unknown.length > 0) {
    return errorResponse(
      c,
      `Not managed from this page: ${unknown.map((setting) => setting.key).join(", ")}`,
      422,
      "UNSUPPORTED_SETTING_KEY"
    );
  }

  const result = await savePlatformApiSettings(parsed.data.settings, authUser.id);

  // Values are never logged — only which keys changed.
  await logAdminAction({
    adminUserId: authUser.id,
    action: "PLATFORM_API_SETTINGS_UPDATED",
    targetType: "PlatformApiSetting",
    meta: { keys: parsed.data.settings.map((setting) => setting.key), ...result }
  }).catch(() => undefined);

  return successResponse(c, { groups: await listPlatformApiSettings(), ...result }, "API settings saved");
});

/* ------------------ Design Brain rules (platform constitution) ------------------ */

adminRoutes.get("/design-rules", async (c) => {
  const rules = await getDesignBrainRulesSetting();
  return successResponse(c, { rules: { ...rules, defaultValue: DEFAULT_DESIGN_BRAIN_RULES } });
});

const designRulesUpdateSchema = z.object({
  // Blank restores the platform default rather than storing an empty constitution.
  value: z.string().max(DESIGN_BRAIN_RULES_MAX_LENGTH)
});

adminRoutes.patch("/design-rules", async (c) => {
  const authUser = c.get("authUser");
  const parsed = designRulesUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid rules payload", 422, "VALIDATION_ERROR");
  }

  const result = await saveDesignBrainRules(parsed.data.value, authUser.id);

  // The rules text itself is not logged — only that it changed, and how.
  await logAdminAction({
    adminUserId: authUser.id,
    action: "DESIGN_BRAIN_RULES_UPDATED",
    targetType: "PlatformApiSetting",
    meta: { restoredDefault: result.restoredDefault, length: parsed.data.value.trim().length }
  }).catch(() => undefined);

  const rules = await getDesignBrainRulesSetting();
  return successResponse(
    c,
    { rules: { ...rules, defaultValue: DEFAULT_DESIGN_BRAIN_RULES }, ...result },
    result.restoredDefault ? "Default rules restored" : "Design Brain rules saved"
  );
});

/* ------------------------- Send email: the cannon guard -------------------- */

adminRoutes.get("/email-limits", async (c) => {
  return successResponse(c, {
    maxPerRun: await getEmailPerRunLimit(),
    default: DEFAULT_EMAIL_PER_RUN,
    bounds: EMAIL_PER_RUN_BOUNDS
  });
});

adminRoutes.patch("/email-limits", async (c) => {
  const authUser = c.get("authUser");
  const parsed = z
    .object({ maxPerRun: z.coerce.number().int().min(EMAIL_PER_RUN_BOUNDS.min).max(EMAIL_PER_RUN_BOUNDS.max) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, `Pick between ${EMAIL_PER_RUN_BOUNDS.min} and ${EMAIL_PER_RUN_BOUNDS.max}.`, 422, "VALIDATION_ERROR");
  }
  const saved = await saveEmailPerRunLimit(parsed.data.maxPerRun, authUser.id);
  await logAdminAction({
    adminUserId: authUser.id,
    action: "EMAIL_PER_RUN_LIMIT_UPDATED",
    targetType: "NODE",
    targetId: "communication.send_email",
    meta: { maxPerRun: saved }
  });
  return successResponse(c, { maxPerRun: saved });
});

/* ------------------------------ Timer: the floor --------------------------- */

/** The fastest any agent may wake itself — the platform-wide floor. */
adminRoutes.get("/timer-limits", async (c) => {
  return successResponse(c, {
    floorMinutes: await getTimerFloorMinutes(),
    default: DEFAULT_TIMER_FLOOR_MINUTES,
    bounds: TIMER_FLOOR_BOUNDS
  });
});

adminRoutes.patch("/timer-limits", async (c) => {
  const authUser = c.get("authUser");
  const parsed = z
    .object({ floorMinutes: z.coerce.number().int().min(TIMER_FLOOR_BOUNDS.min).max(TIMER_FLOOR_BOUNDS.max) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, `Pick between ${TIMER_FLOOR_BOUNDS.min} minutes and a day.`, 422, "VALIDATION_ERROR");
  }
  const saved = await saveTimerFloorMinutes(parsed.data.floorMinutes, authUser.id);
  await logAdminAction({
    adminUserId: authUser.id,
    action: "TIMER_FLOOR_UPDATED",
    targetType: "NODE",
    targetId: "trigger.schedule",
    meta: { floorMinutes: saved }
  });
  return successResponse(c, { floorMinutes: saved });
});

/* ------------------------------ Loop: the rounds --------------------------- */

/** The most rounds one Loop may run — the platform's runaway-bill guard. */
adminRoutes.get("/loop-limits", async (c) => {
  return successResponse(c, {
    maxRounds: await getLoopRoundLimit(),
    default: DEFAULT_LOOP_ROUNDS,
    bounds: LOOP_ROUNDS_BOUNDS
  });
});

adminRoutes.patch("/loop-limits", async (c) => {
  const authUser = c.get("authUser");
  const parsed = z
    .object({ maxRounds: z.coerce.number().int().min(LOOP_ROUNDS_BOUNDS.min).max(LOOP_ROUNDS_BOUNDS.max) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, `Pick a number between ${LOOP_ROUNDS_BOUNDS.min} and ${LOOP_ROUNDS_BOUNDS.max}.`, 422, "VALIDATION_ERROR");
  }
  const saved = await saveLoopRoundLimit(parsed.data.maxRounds, authUser.id);
  await logAdminAction({
    adminUserId: authUser.id,
    action: "LOOP_ROUND_LIMIT_UPDATED",
    targetType: "NODE",
    targetId: "logic.loop",
    meta: { maxRounds: saved }
  });
  return successResponse(c, { maxRounds: saved });
});

/* --------------------------- File Upload: pictures ------------------------- */

adminRoutes.get("/file-upload-limits", async (c) => {
  const { biggestFileMb } = await getMemoryLimits();
  return successResponse(c, {
    imagesAllowed: await getFileUploadImagesAllowed(),
    /* The size dial is Memory's — one fact, one home. Shown here read-only
       with a pointer, never as a second control that could drift. */
    biggestFileMb
  });
});

adminRoutes.patch("/file-upload-limits", async (c) => {
  const authUser = c.get("authUser");
  const parsed = z
    .object({ imagesAllowed: z.boolean() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse(c, "Send imagesAllowed as true or false.", 422, "VALIDATION_ERROR");
  const saved = await saveFileUploadImagesAllowed(parsed.data.imagesAllowed, authUser.id);
  await logAdminAction({
    adminUserId: authUser.id,
    action: "FILE_UPLOAD_IMAGES_UPDATED",
    targetType: "NODE",
    targetId: "block.file_upload",
    meta: { imagesAllowed: saved }
  });
  return successResponse(c, { imagesAllowed: saved });
});

/* ------------------------- Condition: the roads out ------------------------ */

/** The most ways out one Condition may have. */
adminRoutes.get("/condition-limits", async (c) => {
  return successResponse(c, {
    maxRoads: await getConditionRoadLimit(),
    default: DEFAULT_CONDITION_ROADS,
    bounds: CONDITION_ROADS_BOUNDS
  });
});

adminRoutes.patch("/condition-limits", async (c) => {
  const authUser = c.get("authUser");
  const parsed = z
    .object({ maxRoads: z.coerce.number().int().min(CONDITION_ROADS_BOUNDS.min).max(CONDITION_ROADS_BOUNDS.max) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      `Pick a number between ${CONDITION_ROADS_BOUNDS.min} and ${CONDITION_ROADS_BOUNDS.max}.`,
      422,
      "VALIDATION_ERROR"
    );
  }

  const saved = await saveConditionRoadLimit(parsed.data.maxRoads, authUser.id);
  await logAdminAction({
    adminUserId: authUser.id,
    action: "CONDITION_ROAD_LIMIT_UPDATED",
    targetType: "NODE",
    targetId: "logic.condition",
    meta: { maxRoads: saved }
  });
  return successResponse(c, { maxRoads: saved });
});

/* --------------------------- Memory: the limits --------------------------- */

/**
 * What the platform allows Memory to do.
 *
 * The architect owns the meaning — what to always remember, how much to keep.
 * These four are the admin's: the legal one, the two that cost money, and the
 * switch for when search by meaning is unavailable.
 */
adminRoutes.get("/memory-limits", async (c) => {
  return successResponse(c, {
    memoryLimits: await getMemoryLimits(),
    defaults: defaultMemoryLimits(),
    bounds: MEMORY_LIMIT_BOUNDS
  });
});

const memoryLimitsSchema = z.object({
  keepForDays: z.coerce.number().int().min(0).max(3650),
  biggestFileMb: z.coerce.number().int().min(1).max(50),
  piecesPerAnswer: z.coerce.number().int().min(1).max(50),
  searchByMeaning: z.boolean()
});

adminRoutes.patch("/memory-limits", async (c) => {
  const authUser = c.get("authUser");
  const parsed = memoryLimitsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message ?? "Those memory limits are not valid",
      422,
      "VALIDATION_ERROR"
    );
  }

  const saved = await saveMemoryLimits(parsed.data, authUser.id);
  await logAdminAction({
    adminUserId: authUser.id,
    action: "MEMORY_LIMITS_UPDATED",
    targetType: "NODE",
    targetId: "ai.memory",
    // Written down because "how long we keep a customer's words" is a question
    // somebody will one day have to answer with a date and a name.
    meta: saved as unknown as Record<string, unknown>
  });
  return successResponse(c, { memoryLimits: saved });
});

/* ------------------- Door model (the one swappable battery) ------------------ */

/**
 * The provider/model every AI door inside every node runs on. One setting for
 * the whole platform on purpose — changing it here changes every door instantly.
 */
adminRoutes.get("/door-brain", async (c) => {
  const setting = await getDoorBrainSetting();
  return successResponse(c, {
    doorBrain: {
      ...setting,
      defaultProviderId: DEFAULT_DOOR_BRAIN_PROVIDER,
      providers: doorBrainProviderOptions(),
      models: doorBrainModelOptions(setting.providerId)
    }
  });
});

const doorBrainUpdateSchema = z
  .object({
    // Blank clears the override and restores the platform default.
    provider: z.string().trim().max(60).optional(),
    model: z.string().trim().max(DOOR_BRAIN_MODEL_MAX_LENGTH).optional()
  })
  .refine((body) => body.provider !== undefined || body.model !== undefined, {
    message: "Send a provider, a model, or both"
  });

adminRoutes.patch("/door-brain", async (c) => {
  const authUser = c.get("authUser");
  const parsed = doorBrainUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message ?? "Invalid door model payload",
      422,
      "VALIDATION_ERROR"
    );
  }

  const provider = parsed.data.provider;
  if (provider && !isSupportedDoorBrainProvider(provider)) {
    return errorResponse(c, "That AI service is not one we can run doors on.", 422, "UNSUPPORTED_PROVIDER");
  }

  // A model from a different service would be rejected by every door call.
  const model = parsed.data.model;
  const targetProvider = provider || (await getDoorBrainSetting()).providerId;
  if (model && doorBrainModelMismatch(targetProvider, model)) {
    return errorResponse(c, "That model belongs to a different AI service.", 422, "PROVIDER_MODEL_MISMATCH");
  }

  const result = await saveDoorBrainConfig(
    { ...(provider !== undefined ? { provider } : {}), ...(model !== undefined ? { model } : {}) },
    authUser.id
  );

  // Which keys changed is audited; the chosen values are not written to the log.
  await logAdminAction({
    adminUserId: authUser.id,
    action: "DOOR_BRAIN_MODEL_UPDATED",
    targetType: "PlatformApiSetting",
    meta: {
      providerChanged: provider !== undefined,
      modelChanged: model !== undefined,
      restoredDefault: result.restoredDefault
    }
  }).catch(() => undefined);

  const setting = await getDoorBrainSetting();
  return successResponse(
    c,
    {
      doorBrain: {
        ...setting,
        defaultProviderId: DEFAULT_DOOR_BRAIN_PROVIDER,
        providers: doorBrainProviderOptions(),
        models: doorBrainModelOptions(setting.providerId)
      },
      restoredDefault: result.restoredDefault
    },
    result.restoredDefault ? "Default door model restored" : "Door model saved"
  );
});

/* ------------- Smart Designer brain (the composer's battery) ------------- */

/**
 * The provider/model the AI Composer and Smart Designer chat run on. One
 * setting for the whole platform on purpose — architects never pick a model,
 * and swapping it here changes every composition instantly.
 */
adminRoutes.get("/smart-designer-brain", async (c) => {
  const setting = await getSmartDesignerBrainSetting();
  return successResponse(c, {
    smartDesignerBrain: {
      ...setting,
      defaultProviderId: DEFAULT_SMART_DESIGNER_BRAIN_PROVIDER,
      defaultModelId: DEFAULT_SMART_DESIGNER_BRAIN_MODEL,
      providers: smartDesignerBrainProviderOptions(),
      models: smartDesignerBrainModelOptions(setting.providerId)
    }
  });
});

const smartDesignerBrainUpdateSchema = z
  .object({
    // Blank clears the override and restores the platform default.
    provider: z.string().trim().max(60).optional(),
    model: z.string().trim().max(SMART_DESIGNER_BRAIN_MODEL_MAX_LENGTH).optional()
  })
  .refine((body) => body.provider !== undefined || body.model !== undefined, {
    message: "Send a provider, a model, or both"
  });

adminRoutes.patch("/smart-designer-brain", async (c) => {
  const authUser = c.get("authUser");
  const parsed = smartDesignerBrainUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      parsed.error.issues[0]?.message ?? "Invalid Smart Designer model payload",
      422,
      "VALIDATION_ERROR"
    );
  }

  const provider = parsed.data.provider;
  if (provider && !isSupportedSmartDesignerBrainProvider(provider)) {
    return errorResponse(c, "That AI service is not one we can run the designer on.", 422, "UNSUPPORTED_PROVIDER");
  }

  // A model from a different service would be rejected by every composition.
  const model = parsed.data.model;
  const targetProvider = provider || (await getSmartDesignerBrainSetting()).providerId;
  if (model && smartDesignerBrainModelMismatch(targetProvider, model)) {
    return errorResponse(c, "That model belongs to a different AI service.", 422, "PROVIDER_MODEL_MISMATCH");
  }

  const result = await saveSmartDesignerBrainConfig(
    { ...(provider !== undefined ? { provider } : {}), ...(model !== undefined ? { model } : {}) },
    authUser.id
  );

  // Which keys changed is audited; the chosen values are not written to the log.
  await logAdminAction({
    adminUserId: authUser.id,
    action: "SMART_DESIGNER_BRAIN_MODEL_UPDATED",
    targetType: "PlatformApiSetting",
    meta: {
      providerChanged: provider !== undefined,
      modelChanged: model !== undefined,
      restoredDefault: result.restoredDefault
    }
  }).catch(() => undefined);

  const setting = await getSmartDesignerBrainSetting();
  return successResponse(
    c,
    {
      smartDesignerBrain: {
        ...setting,
        defaultProviderId: DEFAULT_SMART_DESIGNER_BRAIN_PROVIDER,
        defaultModelId: DEFAULT_SMART_DESIGNER_BRAIN_MODEL,
        providers: smartDesignerBrainProviderOptions(),
        models: smartDesignerBrainModelOptions(setting.providerId)
      },
      restoredDefault: result.restoredDefault
    },
    result.restoredDefault ? "Default Smart Designer model restored" : "Smart Designer model saved"
  );
});

/* ---------------- Architect builder node visibility ---------------------- */

adminRoutes.get("/builder-nodes", async (c) => {
  const [nodes, groups] = await Promise.all([listArchitectNodeVisibility(), listArchitectNodeGroups()]);
  return successResponse(c, { nodes, groups });
});

const builderNodesUpdateSchema = z.object({
  nodes: z
    .array(
      z
        .object({
          type: z.string().trim().min(1).max(120),
          visible: z.boolean().optional(),
          label: z.string().max(80).optional(),
          group: z.string().max(80).optional()
        })
        .refine(
          (node) => node.visible !== undefined || node.label !== undefined || node.group !== undefined,
          { message: "Each node update needs visible, label, or group" }
        )
    )
    .min(1)
    .max(80)
});

adminRoutes.put("/builder-nodes", async (c) => {
  const authUser = c.get("authUser");
  const parsed = builderNodesUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid node visibility payload", 422, "VALIDATION_ERROR");
  }

  const unknown = parsed.data.nodes.filter((node) => !isArchitectNodeType(node.type));
  if (unknown.length > 0) {
    return errorResponse(
      c,
      `Unknown builder node: ${unknown.map((node) => node.type).join(", ")}`,
      422,
      "UNKNOWN_NODE_TYPE"
    );
  }

  const result = await saveArchitectNodeVisibility(parsed.data.nodes);

  await logAdminAction({
    adminUserId: authUser.id,
    action: "ARCHITECT_NODE_VISIBILITY_UPDATED",
    targetType: "ArchitectNodeVisibility",
    meta: { nodes: parsed.data.nodes, ...result }
  }).catch(() => undefined);

  return successResponse(
    c,
    { nodes: await listArchitectNodeVisibility(), groups: await listArchitectNodeGroups(), ...result },
    "Builder nodes saved"
  );
});

const builderGroupCreateSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

adminRoutes.post("/builder-nodes/groups", async (c) => {
  const authUser = c.get("authUser");
  const parsed = builderGroupCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Enter a group name", 422, "VALIDATION_ERROR");
  }

  const result = await createArchitectNodeGroup(parsed.data.name);
  if (!result.created) {
    return errorResponse(c, "That group already exists", 422, "GROUP_EXISTS");
  }

  await logAdminAction({
    adminUserId: authUser.id,
    action: "ARCHITECT_NODE_GROUP_CREATED",
    targetType: "ArchitectNodeGroup",
    meta: { name: parsed.data.name }
  }).catch(() => undefined);

  return successResponse(c, { groups: result.groups }, "Group created", 201);
});

adminRoutes.delete("/builder-nodes/groups", async (c) => {
  const authUser = c.get("authUser");
  const parsed = builderGroupCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Enter a group name", 422, "VALIDATION_ERROR");
  }

  const result = await deleteArchitectNodeGroup(parsed.data.name);
  if (!result.deleted) {
    return errorResponse(c, "That group cannot be deleted", 422, "GROUP_NOT_DELETABLE");
  }

  await logAdminAction({
    adminUserId: authUser.id,
    action: "ARCHITECT_NODE_GROUP_DELETED",
    targetType: "ArchitectNodeGroup",
    meta: { name: parsed.data.name, moved: result.moved }
  }).catch(() => undefined);

  return successResponse(c, {
    nodes: await listArchitectNodeVisibility(),
    groups: result.groups,
    moved: result.moved
  }, "Group deleted");
});

function parsePagination(c: { req: { query: (k: string) => string | undefined } }) {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limitRaw = Number(c.req.query("limit")) || 20;
  const limit = Math.min(100, Math.max(1, limitRaw));
  return { page, limit, skip: (page - 1) * limit };
}

const listingStatusSchema = z.object({
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"]),
  reason: z.string().trim().max(2000).optional()
});

const architectStatusSchema = z.object({
  approvalStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"])
});

const suspensionSchema = z.object({
  isSuspended: z.boolean()
});

const deleteArchitectSchema = z.object({
  confirmation: z.literal("DELETE")
});

// 1. GET /admin/summary
adminRoutes.get("/summary", async (c) => {
  const [
    totalBusinesses,
    totalAgentListings,
    pendingAgentListings,
    approvedAgentListings,
    rejectedAgentListings,
    suspendedAgentListings,
    activeInstalledAgents,
    totalAppointments,
    totalLeads,
    liveSummary
  ] = await Promise.all([
    listRegisteredBusinessAccounts().then((accounts) => accounts.length),
    prisma.agentListing.count(),
    prisma.agentListing.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.agentListing.count({ where: { status: "APPROVED" } }),
    prisma.agentListing.count({ where: { status: "REJECTED" } }),
    prisma.agentListing.count({ where: { status: "SUSPENDED" } }),
    prisma.installedAgent.count({ where: { status: "ACTIVE" } }),
    prisma.appointment.count(),
    prisma.lead.count(),
    getAdminLiveSummaryData()
  ]);

  return successResponse(c, {
    totalBusinesses,
    totalAgentListings,
    pendingAgentListings,
    approvedAgentListings,
    rejectedAgentListings,
    suspendedAgentListings,
    activeInstalledAgents,
    totalAppointments,
    totalLeads,
    ...liveSummary
  });
});

// 2. GET /admin/businesses
adminRoutes.get("/businesses", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { type: { contains: search, mode: "insensitive" as const } },
          { owner: { email: { contains: search, mode: "insensitive" as const } } }
        ]
      }
    : {};

  const [total, businesses] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        type: true,
        createdAt: true,
        subscriptionStatus: true,
        owner: { select: { id: true, email: true, fullName: true, role: true } },
        phoneNumbers: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { phoneNumber: true }
        },
        _count: { select: { installedAgents: true, phoneNumbers: true, appointments: true, leads: true } }
      }
    })
  ]);

  const items = businesses.map((b) => ({
    id: b.id,
    name: b.name,
    type: b.type,
    createdAt: b.createdAt,
    subscriptionStatus: b.subscriptionStatus ?? "inactive",
    owner: b.owner,
    activePhoneNumber: b.phoneNumbers[0]?.phoneNumber ?? null,
    installedAgentsCount: b._count.installedAgents,
    phoneNumbersCount: b._count.phoneNumbers,
    appointmentsCount: b._count.appointments,
    leadsCount: b._count.leads
  }));

  return successResponse(c, { items, total, page, limit });
});

// Registered buyer identities — unlike /businesses, this endpoint is based on
// signup accounts, not setup-created Business rows. One normalized email is
// returned once even when legacy role rows share that email.
adminRoutes.get("/business-accounts", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();
  const includeAll = c.req.query("all") === "true";
  const accounts = await listRegisteredBusinessAccounts(search, { includePurchasedAgents: true });

  return successResponse(c, {
    items: includeAll ? accounts : accounts.slice(skip, skip + limit),
    total: accounts.length,
    page,
    limit: includeAll ? accounts.length : limit
  });
});

// 3. GET /admin/architects
adminRoutes.get("/architects", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();
  const status = (c.req.query("status") ?? "").trim();

  const where: Record<string, unknown> = { role: "ARCHITECT" };
  if (search) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" as const } },
      { fullName: { contains: search, mode: "insensitive" as const } }
    ];
  }
  if (["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].includes(status)) {
    where.architectProfile = { approvalStatus: status };
  }

  const [total, architects] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        isSuspended: true,
        architectProfile: {
          select: { title: true, approvalStatus: true, rating: true, completedJobs: true }
        },
        _count: { select: { listings: true, workflows: true } }
      }
    })
  ]);

  const items = architects.map((a) => ({
    id: a.id,
    email: a.email,
    fullName: a.fullName,
    createdAt: a.createdAt,
    isSuspended: a.isSuspended,
    architectProfile: a.architectProfile,
    listingCount: a._count.listings,
    workflowCount: a._count.workflows
  }));

  return successResponse(c, { items, total, page, limit });
});

// 4. GET /admin/agents
adminRoutes.get("/agents", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();
  const status = (c.req.query("status") ?? "").trim();

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" as const } },
      { shortDescription: { contains: search, mode: "insensitive" as const } }
    ];
  }
  if (["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"].includes(status)) {
    where.status = status;
  }

  const [total, listings] = await Promise.all([
    prisma.agentListing.count({ where }),
    prisma.agentListing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        shortDescription: true,
        description: true,
        category: true,
        priceCents: true,
        status: true,
        featuredAt: true,
        tags: true,
        requiredConnectors: true,
        supportedLlms: true,
        createdAt: true,
        submittedAt: true,
        updatedAt: true,
        workflowId: true,
        workflow: { select: { name: true } },
        architect: { select: { id: true, email: true, fullName: true } },
        _count: { select: { installedAgents: true } }
      }
    })
  ]);

  const architectIds = [...new Set(listings.map((listing) => listing.architect.id))];
  const architectListings = architectIds.length
    ? await prisma.agentListing.findMany({
        where: { architectUserId: { in: architectIds } },
        select: {
          architectUserId: true,
          _count: { select: { installedAgents: true } }
        }
      })
    : [];
  const architectTotalInstalls = new Map<string, number>();
  for (const listing of architectListings) {
    architectTotalInstalls.set(
      listing.architectUserId,
      (architectTotalInstalls.get(listing.architectUserId) ?? 0) + listing._count.installedAgents
    );
  }

  const items = listings.map((l) => ({
    id: l.id,
    name: l.name,
    shortDescription: l.shortDescription,
    description: l.description,
    category: l.category,
    priceCents: l.priceCents,
    status: l.status,
    featuredAt: l.featuredAt,
    tags: l.tags,
    requiredConnectors: l.requiredConnectors,
    supportedLlms: l.supportedLlms,
    createdAt: l.createdAt,
    submittedAt: l.submittedAt,
    updatedAt: l.updatedAt,
    workflowId: l.workflowId,
    workflowName: l.workflow?.name ?? null,
    architect: l.architect,
    installedAgentsCount: l._count.installedAgents,
    architectTotalInstalls: architectTotalInstalls.get(l.architect.id) ?? 0,
    architectTier: null,
    priority: null
  }));

  return successResponse(c, { items, total, page, limit });
});

// 5. PATCH /admin/agents/:listingId/status
adminRoutes.patch("/agents/:listingId/status", async (c) => {
  try {
    const listingId = c.req.param("listingId");
    const input = listingStatusSchema.parse(await c.req.json());

    const existing = await prisma.agentListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        workflowId: true,
        submittedAt: true,
        approvedAt: true,
        publishedAt: true,
        reviewStatus: true,
        rejectionReason: true
      }
    });
    if (!existing) {
      return errorResponse(c, "Agent listing not found", 404, "LISTING_NOT_FOUND");
    }

    const now = new Date();
    let listingData: Prisma.AgentListingUpdateInput;
    let workflowData: Prisma.WorkflowDefinitionUpdateInput;

    if (input.status === "APPROVED") {
      listingData = {
        status: "APPROVED",
        reviewStatus: "APPROVED",
        publishStatus: "PUBLISHED",
        rejectionReason: null,
        approvedAt: existing.approvedAt ?? now,
        publishedAt: existing.publishedAt ?? now
      };
      workflowData = { reviewStatus: "APPROVED", publishStatus: "PUBLISHED" };
    } else if (input.status === "REJECTED") {
      listingData = {
        status: "REJECTED",
        reviewStatus: "REJECTED",
        publishStatus: "UNPUBLISHED",
        rejectionReason: input.reason?.trim() || null
      };
      workflowData = { reviewStatus: "REJECTED", publishStatus: "UNPUBLISHED" };
    } else if (input.status === "PENDING_REVIEW") {
      // The admin moderation UI uses PENDING_REVIEW for its "Request Changes"
      // decision. Legacy PENDING_REVIEW locks architect editing, so move the
      // legacy status to REJECTED while the canonical review status records
      // the distinct changes-requested decision and its notes.
      listingData = {
        status: "REJECTED",
        reviewStatus: "CHANGES_REQUESTED",
        publishStatus: "UNPUBLISHED",
        rejectionReason: input.reason?.trim() || null,
        submittedAt: existing.submittedAt ?? now
      };
      workflowData = { reviewStatus: "CHANGES_REQUESTED", publishStatus: "UNPUBLISHED" };
    } else {
      listingData = {
        status: "SUSPENDED",
        reviewStatus: existing.reviewStatus,
        publishStatus: "UNPUBLISHED",
        rejectionReason: input.reason?.trim() || existing.rejectionReason
      };
      workflowData = { reviewStatus: existing.reviewStatus, publishStatus: "UNPUBLISHED" };
    }

    const listing = await prisma.$transaction(async (tx) => {
      const updated = await tx.agentListing.update({
        where: { id: listingId },
        data: listingData,
        select: {
          id: true,
          name: true,
          status: true,
          reviewStatus: true,
          publishStatus: true,
          priceCents: true,
          workflowId: true,
          rejectionReason: true,
          submittedAt: true,
          approvedAt: true,
          publishedAt: true,
          updatedAt: true,
          architect: { select: { id: true, email: true, fullName: true } }
        }
      });

      if (existing.workflowId) {
        await tx.workflowDefinition.update({
          where: { id: existing.workflowId },
          data: workflowData
        });
      }

      return updated;
    });

    return successResponse(c, { listing }, "Listing status updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid status", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not update listing status", 500, "LISTING_STATUS_FAILED");
  }
});

adminRoutes.patch("/agents/:listingId/featured", async (c) => {
  try {
    const listingId = c.req.param("listingId");
    const { featured } = z.object({ featured: z.boolean() }).parse(await c.req.json());

    const existing = await prisma.agentListing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, name: true }
    });
    if (!existing) {
      return errorResponse(c, "Listing not found", 404, "LISTING_NOT_FOUND");
    }

    if (featured && existing.status !== "APPROVED") {
      return errorResponse(
        c,
        `Only an APPROVED listing can be featured. "${existing.name}" is ${existing.status}.`,
        409,
        "LISTING_NOT_APPROVED"
      );
    }

    const { listing, replaced } = await prisma.$transaction(async (tx) => {
      const previouslyFeatured = featured
        ? await tx.agentListing.findMany({
            where: { featuredAt: { not: null }, NOT: { id: listingId } },
            select: { id: true, name: true }
          })
        : [];

      if (previouslyFeatured.length > 0) {
        await tx.agentListing.updateMany({
          where: { id: { in: previouslyFeatured.map((row) => row.id) } },
          data: { featuredAt: null }
        });
      }

      const updated = await tx.agentListing.update({
        where: { id: listingId },
        data: { featuredAt: featured ? new Date() : null },
        select: { id: true, name: true, status: true, featuredAt: true }
      });

      return { listing: updated, replaced: previouslyFeatured };
    });

    await logAdminAction({
      adminUserId: c.get("authUser").id,
      action: featured ? "LISTING_FEATURED" : "LISTING_UNFEATURED",
      targetType: "AGENT_LISTING",
      targetId: listing.id,
      meta: { name: listing.name, replaced: replaced.map((row) => row.name) }
    });

    return successResponse(
      c,
      // The caller needs to know which listing lost the slot so the admin table
      // can clear its star without a refetch.
      { listing, replacedListingIds: replaced.map((row) => row.id) },
      featured
        ? replaced.length > 0
          ? `Listing featured — replaced "${replaced[0]!.name}"`
          : "Listing featured"
        : "Listing no longer featured"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, "featured must be true or false", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not update the featured flag", 500, "LISTING_FEATURED_FAILED");
  }
});

adminRoutes.delete("/agents/:listingId", async (c) => {
  try {
    const authUser = c.get("authUser");
    const listingId = c.req.param("listingId");

    const listing = await prisma.agentListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        name: true,
        workflowId: true,
        architectUserId: true
      }
    });

    if (!listing) {
      return errorResponse(c, "Agent listing not found", 404, "LISTING_NOT_FOUND");
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const otherListing = listing.workflowId
        ? await tx.agentListing.findFirst({
            where: { workflowId: listing.workflowId, id: { not: listing.id } },
            select: { id: true }
          })
        : null;
      const deleteWorkflow = Boolean(listing.workflowId && !otherListing);

      const installations = await tx.installedAgent.findMany({
        where: deleteWorkflow && listing.workflowId
          ? { OR: [{ listingId: listing.id }, { workflowId: listing.workflowId }] }
          : { listingId: listing.id },
        select: { id: true, businessId: true, configJson: true }
      });
      const installedAgentIds = installations.map((agent) => agent.id);
      const businessIds = [...new Set(installations.map((agent) => agent.businessId))];
      const assistantIds = [...new Set(installations.flatMap((agent) => {
        const config = agent.configJson && typeof agent.configJson === "object" && !Array.isArray(agent.configJson)
          ? agent.configJson as Record<string, unknown>
          : {};
        return [config.vapiAssistantId, config.previewAssistantId]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim());
      }))];

      let phoneNumbersReleased = 0;
      if (installedAgentIds.length > 0) {
        const platformPhones = await tx.platformPhoneNumber.updateMany({
          where: {
            installedAgentId: { in: installedAgentIds },
            isPlatformSmsSender: false
          },
          data: {
            status: "AVAILABLE",
            businessId: null,
            buyerUserId: null,
            installedAgentId: null,
            assignedAt: null,
            feeBilledAt: null
          }
        });
        phoneNumbersReleased = platformPhones.count;

        await tx.businessPhoneNumber.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null, isActive: false }
        });
        await tx.payment.updateMany({
          where: { OR: [{ listingId: listing.id }, { installedAgentId: { in: installedAgentIds } }] },
          data: { listingId: null, installedAgentId: null }
        });
        await tx.businessUsageInvoice.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.appointment.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.businessKnowledgeFile.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.businessKnowledgeBase.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.vapiCall.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.testCalendarEvent.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.emailMessage.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.businessEmailAlias.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null, status: "ARCHIVED" }
        });
        await tx.smsExecution.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.smsConsent.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });
        await tx.phoneProvisioningRequest.updateMany({
          where: { installedAgentId: { in: installedAgentIds } },
          data: { installedAgentId: null }
        });

        // Older deployed databases retain a restrictive FK for execution
        // usage even though newer schemas cascade it. Remove those children
        // explicitly so an admin deletion works consistently everywhere.
        await tx.agentUsageExecution.deleteMany({
          where: { installedAgentId: { in: installedAgentIds } }
        });

        if (assistantIds.length > 0) {
          await tx.businessProfile.updateMany({
            where: {
              businessId: { in: businessIds },
              vapiAssistantId: { in: assistantIds }
            },
            data: { vapiAssistantId: null }
          });
        }

        await tx.installedAgent.deleteMany({ where: { id: { in: installedAgentIds } } });

        if (businessIds.length > 0) {
          const businessesWithAgents = await tx.installedAgent.findMany({
            where: { businessId: { in: businessIds } },
            select: { businessId: true },
            distinct: ["businessId"]
          });
          const remainingBusinessIds = new Set(businessesWithAgents.map((agent) => agent.businessId));
          const businessesWithoutAgents = businessIds.filter((businessId) => !remainingBusinessIds.has(businessId));
          if (businessesWithoutAgents.length > 0) {
            await tx.businessProfile.updateMany({
              where: { businessId: { in: businessesWithoutAgents } },
              data: { vapiAssistantId: null }
            });
          }
        }
      } else {
        await tx.payment.updateMany({
          where: { listingId: listing.id },
          data: { listingId: null }
        });
      }

      // Architect earnings are immutable history but listingId is a denormalized
      // lookup key, so detach it before the listing disappears.
      await tx.architectEarning.updateMany({
        where: { listingId: listing.id },
        data: { listingId: null }
      });
      await tx.agentListing.delete({ where: { id: listing.id } });

      if (deleteWorkflow && listing.workflowId) {
        await tx.testCalendarEvent.updateMany({
          where: { workflowId: listing.workflowId },
          data: { workflowId: null }
        });
        await tx.workflowDefinition.deleteMany({ where: { id: listing.workflowId } });
      }

      return {
        workflowDeleted: deleteWorkflow,
        installedAgentsDeleted: installedAgentIds.length,
        phoneNumbersReleased
      };
    });

    await logAdminAction({
      adminUserId: authUser.id,
      action: "AGENT_DELETED",
      targetType: "AgentListing",
      targetId: listing.id,
      meta: {
        name: listing.name,
        architectUserId: listing.architectUserId,
        workflowId: listing.workflowId,
        ...deleted
      }
    }).catch(() => undefined);

    return successResponse(
      c,
      {
        deleted: true,
        listingId: listing.id,
        workflowId: listing.workflowId,
        ...deleted
      },
      "Agent deleted permanently"
    );
  } catch (error) {
    console.error("[admin] agent deletion failed", error);
    return errorResponse(c, "Could not delete agent", 500, "AGENT_DELETE_FAILED");
  }
});

// 7. DELETE /admin/architects/:userId
adminRoutes.delete("/architects/:userId", async (c) => {
  try {
    const authUser = c.get("authUser");
    const userId = c.req.param("userId");
    deleteArchitectSchema.parse(await c.req.json().catch(() => ({})));

    if (userId === authUser.id) {
      return errorResponse(c, "You cannot delete your own admin account", 409, "SELF_DELETE_FORBIDDEN");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        roleMemberships: { select: { role: true } },
        _count: { select: { businesses: true } }
      }
    });

    const roles = new Set(user ? [user.role, ...user.roleMemberships.map((membership) => membership.role)] : []);
    if (user?._count.businesses) roles.add("BUSINESS");
    if (!user || !roles.has("ARCHITECT")) {
      return errorResponse(c, "Architect not found", 404, "ARCHITECT_NOT_FOUND");
    }
    if (roles.has("ADMIN")) {
      return errorResponse(c, "Admin accounts cannot be deleted here", 409, "ADMIN_DELETE_FORBIDDEN");
    }

    // Consent evidence is pseudonymized only when the shared User row will be
    // removed. A surviving business workspace still owns that consent.
    if ([...roles].every((role) => role === "ARCHITECT")) {
      await pseudonymizeDisclosureConsentsForUser(userId);
    }

    const deletion = await deleteUserWorkspace(userId, "ARCHITECT");

    await logAdminAction({
      adminUserId: authUser.id,
      action: deletion.accountRemoved ? "ARCHITECT_ACCOUNT_DELETED" : "ARCHITECT_WORKSPACE_DELETED",
      targetType: "USER",
      targetId: userId,
      meta: { roles: [...roles] }
    });

    return successResponse(
      c,
      {
        deleted: true,
        userId,
        accountRemoved: deletion.accountRemoved,
        remainingRoles: deletion.remainingRoles
      },
      deletion.accountRemoved ? "Architect account and associated data deleted" : "Architect workspace and associated data deleted"
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, "Type DELETE to confirm account deletion", 422, "CONFIRMATION_REQUIRED");
    }
    return errorResponse(c, "Could not delete architect account", 500, "ARCHITECT_DELETE_FAILED");
  }
});

// 7. PATCH /admin/architects/:userId/status
adminRoutes.patch("/architects/:userId/status", async (c) => {
  try {
    const userId = c.req.param("userId");
    const input = architectStatusSchema.parse(await c.req.json());

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        architectProfile: { select: { id: true } },
        roleMemberships: { select: { role: true } }
      }
    });

    const isArchitect =
      user?.role === "ARCHITECT" ||
      user?.roleMemberships.some((membership) => membership.role === "ARCHITECT");

    if (!user || !isArchitect) {
      return errorResponse(c, "Architect not found", 404, "ARCHITECT_NOT_FOUND");
    }
    if (!user.architectProfile) {
      return errorResponse(
        c,
        "This architect has no profile yet and cannot be approved.",
        409,
        "ARCHITECT_PROFILE_MISSING"
      );
    }

    const profile = await prisma.architectProfile.update({
      where: { userId },
      data: { approvalStatus: input.approvalStatus },
      select: { id: true, userId: true, title: true, approvalStatus: true, rating: true, completedJobs: true }
    });

    return successResponse(c, { architectProfile: profile }, "Architect status updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid status", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not update architect status", 500, "ARCHITECT_STATUS_FAILED");
  }
});

// 8. PATCH /admin/users/:userId/suspension
adminRoutes.patch("/users/:userId/suspension", async (c) => {
  try {
    const authUser = c.get("authUser");
    const userId = c.req.param("userId");
    const input = suspensionSchema.parse(await c.req.json());

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true }
    });
    if (!existing) {
      return errorResponse(c, "User not found", 404, "USER_NOT_FOUND");
    }

    if (
      userId === authUser.id ||
      existing.email.trim().toLowerCase() === authUser.email.trim().toLowerCase()
    ) {
      return errorResponse(c, "You cannot change your own suspension state.", 409, "CANNOT_SUSPEND_SELF");
    }

    // The admin business table is identity-based and deduplicates legacy role
    // rows by email. Keep every row for that registered identity in sync.
    await prisma.user.updateMany({
      where: { email: { equals: existing.email, mode: "insensitive" } },
      data: { isSuspended: input.isSuspended },
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, isSuspended: true }
    });

    return successResponse(c, { user }, "User suspension updated");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(c, error.issues[0]?.message ?? "Invalid input", 422, "VALIDATION_ERROR");
    }
    return errorResponse(c, "Could not update suspension", 500, "SUSPENSION_FAILED");
  }
});

const templateRequestListQuerySchema = z.object({
  search: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

// 8. GET /admin/template-requests — list architect template requests
adminRoutes.get("/template-requests", async (c) => {
  const parsed = templateRequestListQuerySchema.safeParse({
    search: c.req.query("search"),
    industry: c.req.query("industry"),
    page: c.req.query("page"),
    limit: c.req.query("limit")
  });

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid query", 422, "VALIDATION_ERROR");
  }

  const { page, limit, skip } = parsePagination(c);
  const search = (parsed.data.search ?? "").trim();
  const industry = (parsed.data.industry ?? "").trim();

  const where: Record<string, unknown> = {};
  if (industry) {
    where.industry = { equals: industry, mode: "insensitive" };
  }
  if (search) {
    where.OR = [
      { industry: { contains: search, mode: "insensitive" as const } },
      { description: { contains: search, mode: "insensitive" as const } },
      { architect: { email: { contains: search, mode: "insensitive" as const } } },
      { architect: { fullName: { contains: search, mode: "insensitive" as const } } }
    ];
  }

  const [total, requests] = await Promise.all([
    prisma.templateRequest.count({ where }),
    prisma.templateRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        industry: true,
        description: true,
        createdAt: true,
        architect: {
          select: {
            id: true,
            email: true,
            fullName: true
          }
        }
      }
    })
  ]);

  return successResponse(c, { items: requests, total, page, limit });
});

const contactSubmissionListQuerySchema = z.object({
  search: z.string().trim().optional(),
  subject: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

// 9. GET /admin/contact-submissions — list public contact form submissions
adminRoutes.get("/contact-submissions", async (c) => {
  const parsed = contactSubmissionListQuerySchema.safeParse({
    search: c.req.query("search"),
    subject: c.req.query("subject"),
    page: c.req.query("page"),
    limit: c.req.query("limit")
  });

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid query", 422, "VALIDATION_ERROR");
  }

  const { page, limit, skip } = parsePagination(c);
  const search = (parsed.data.search ?? "").trim();
  const subject = (parsed.data.subject ?? "").trim();

  const where: Record<string, unknown> = {};
  if (subject) {
    where.subject = { equals: subject, mode: "insensitive" };
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" as const } },
      { email: { contains: search, mode: "insensitive" as const } },
      { subject: { contains: search, mode: "insensitive" as const } },
      { message: { contains: search, mode: "insensitive" as const } }
    ];
  }

  const [total, submissions] = await Promise.all([
    prisma.contactSubmission.count({ where }),
    prisma.contactSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        message: true,
        createdAt: true
      }
    })
  ]);

  return successResponse(c, { items: submissions, total, page, limit });
});

/* ---- "Need Help" support issues (public landing-page submissions) ---- */

const supportIssueListQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

// GET /admin/support-issues — list "Need Help" submissions (metadata only, no file bytes)
adminRoutes.get("/support-issues", async (c) => {
  const parsed = supportIssueListQuerySchema.safeParse({
    search: c.req.query("search"),
    status: c.req.query("status"),
    page: c.req.query("page"),
    limit: c.req.query("limit")
  });

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid query", 422, "VALIDATION_ERROR");
  }

  const { page, limit, skip } = parsePagination(c);
  const search = (parsed.data.search ?? "").trim();
  const status = (parsed.data.status ?? "").trim().toUpperCase();

  const where: Prisma.SupportIssueWhereInput = {};
  if (status) {
    where.status = status;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { issue: { contains: search, mode: "insensitive" } }
    ];
  }

  const [total, issues] = await Promise.all([
    prisma.supportIssue.count({ where }),
    prisma.supportIssue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        issue: true,
        status: true,
        documentName: true,
        documentMimeType: true,
        documentSizeBytes: true,
        voiceName: true,
        voiceMimeType: true,
        voiceDurationSec: true,
        voiceSizeBytes: true,
        createdAt: true
      }
    })
  ]);

  return successResponse(c, { items: issues, total, page, limit });
});

// GET /admin/support-issues/:id/document — stream the uploaded document bytes
adminRoutes.get("/support-issues/:id/document", async (c) => {
  const id = c.req.param("id");
  const row = await prisma.supportIssue.findUnique({
    where: { id },
    select: { documentBytes: true, documentMimeType: true, documentName: true }
  });

  if (!row?.documentBytes) {
    return errorResponse(c, "Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  const bytes = new Uint8Array(row.documentBytes);
  const filename = (row.documentName ?? "document").replace(/"/g, "");
  return new Response(bytes, {
    headers: {
      "Content-Type": row.documentMimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength)
    }
  });
});

// GET /admin/support-issues/:id/voice — stream the recorded voice message for playback
adminRoutes.get("/support-issues/:id/voice", async (c) => {
  const id = c.req.param("id");
  const row = await prisma.supportIssue.findUnique({
    where: { id },
    select: { voiceBytes: true, voiceMimeType: true }
  });

  if (!row?.voiceBytes) {
    return errorResponse(c, "Voice message not found", 404, "VOICE_NOT_FOUND");
  }

  const bytes = new Uint8Array(row.voiceBytes);
  return new Response(bytes, {
    headers: {
      "Content-Type": row.voiceMimeType ?? "audio/webm",
      "Content-Length": String(bytes.byteLength)
    }
  });
});

const supportIssueStatusSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED"])
});

// PATCH /admin/support-issues/:id — update the triage status (OPEN | RESOLVED)
adminRoutes.patch("/support-issues/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = supportIssueStatusSchema.safeParse(await c.req.json().catch(() => ({})));

  if (!parsed.success) {
    return errorResponse(c, parsed.error.issues[0]?.message ?? "Invalid status", 422, "VALIDATION_ERROR");
  }

  const existing = await prisma.supportIssue.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return errorResponse(c, "Support issue not found", 404, "SUPPORT_ISSUE_NOT_FOUND");
  }

  const updated = await prisma.supportIssue.update({
    where: { id },
    data: { status: parsed.data.status },
    select: { id: true, status: true }
  });

  return successResponse(c, { issue: updated });
});

/* ---- Proxy email alias administration (reply.triven.ai) ---- */

adminRoutes.get("/email-aliases", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const search = (c.req.query("search") ?? "").trim();

  const where = search
    ? {
        OR: [
          { emailAddress: { contains: search, mode: "insensitive" as const } },
          { displayName: { contains: search, mode: "insensitive" as const } },
          { business: { name: { contains: search, mode: "insensitive" as const } } }
        ]
      }
    : {};

  const [aliases, total] = await Promise.all([
    prisma.businessEmailAlias.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { business: { select: { id: true, name: true } } }
    }),
    prisma.businessEmailAlias.count({ where })
  ]);

  const aliasIds = aliases.map((alias) => alias.id);
  const [statusRows, lastMessages] = await Promise.all([
    aliasIds.length
      ? prisma.emailMessage.groupBy({
          by: ["aliasId", "status"],
          where: { aliasId: { in: aliasIds } },
          _count: { _all: true }
        })
      : Promise.resolve([]),
    aliasIds.length
      ? prisma.emailMessage.findMany({
          where: { aliasId: { in: aliasIds } },
          orderBy: { createdAt: "desc" },
          distinct: ["aliasId"],
          select: {
            id: true,
            aliasId: true,
            subject: true,
            status: true,
            purpose: true,
            toEmail: true,
            createdAt: true
          }
        })
      : Promise.resolve([])
  ]);

  const countsByAlias = new Map<string, Record<string, number>>();
  for (const row of statusRows) {
    if (!row.aliasId) continue;
    const bucket = countsByAlias.get(row.aliasId) ?? {};
    bucket[row.status] = row._count._all;
    countsByAlias.set(row.aliasId, bucket);
  }
  const lastByAlias = new Map(lastMessages.map((message) => [message.aliasId, message]));

  const items = aliases.map((alias) => ({
    ...alias,
    counts: countsByAlias.get(alias.id) ?? {},
    lastMessage: lastByAlias.get(alias.id) ?? null
  }));

  return successResponse(c, { items, total, page, limit });
});

function registerAliasStatusRoute(path: string, status: "DISABLED" | "ARCHIVED") {
  adminRoutes.post(path, async (c) => {
    const id = c.req.param("id");
    const alias = await prisma.businessEmailAlias.findUnique({ where: { id } });
    if (!alias) return errorResponse(c, "Alias not found", 404, "ALIAS_NOT_FOUND");

    const updated = await prisma.businessEmailAlias.update({ where: { id }, data: { status } });
    console.log(`[email] admin set alias ${updated.emailAddress} -> ${status}`);
    return successResponse(c, { alias: updated }, `Alias ${status.toLowerCase()}`);
  });
}

registerAliasStatusRoute("/email-aliases/:id/disable", "DISABLED");
registerAliasStatusRoute("/email-aliases/:id/archive", "ARCHIVED");

adminRoutes.post("/email-aliases/:id/resend-test", async (c) => {
  const id = c.req.param("id");
  const alias = await prisma.businessEmailAlias.findUnique({ where: { id } });
  if (!alias) return errorResponse(c, "Alias not found", 404, "ALIAS_NOT_FOUND");
  if (!alias.forwardToEmail) return errorResponse(c, "Alias has no forward-to email", 422, "NO_FORWARD_EMAIL");

  const result = await sendBusinessEmail({
    businessId: alias.businessId,
    to: alias.forwardToEmail,
    subject: `Test email from ${alias.displayName} via Triven`,
    textBody: `Admin-triggered test for ${alias.emailAddress}.`,
    purpose: "TEST"
  });

  if (!result.ok) return errorResponse(c, result.error, 422, "TEST_EMAIL_FAILED");
  return successResponse(c, { messageId: result.messageId, dryRun: result.dryRun }, "Test email sent");
});

/** Delivery/bounce/complaint counts for one alias — admin diagnostics. */
adminRoutes.get("/email-aliases/:id/activity", async (c) => {
  const id = c.req.param("id");
  const alias = await prisma.businessEmailAlias.findUnique({ where: { id } });
  if (!alias) return errorResponse(c, "Alias not found", 404, "ALIAS_NOT_FOUND");

  const [byStatus, lastMessage] = await Promise.all([
    prisma.emailMessage.groupBy({
      by: ["status"],
      where: { aliasId: id },
      _count: { _all: true }
    }),
    prisma.emailMessage.findFirst({
      where: { aliasId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, subject: true, status: true, purpose: true, toEmail: true, createdAt: true }
    })
  ]);

  const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
  return successResponse(c, { alias: { id: alias.id, emailAddress: alias.emailAddress }, counts, lastMessage });
});

/* ---- Suppression list (permanent bounces / complaints) ---- */

adminRoutes.get("/email-suppressions", async (c) => {
  const { page, limit, skip } = parsePagination(c);
  const [items, total] = await Promise.all([
    prisma.emailSuppression.findMany({ orderBy: { updatedAt: "desc" }, skip, take: limit }),
    prisma.emailSuppression.count()
  ]);
  return successResponse(c, { items, total, page, limit });
});

/**
 * Reactivation only deactivates the local block. Complaints stay suppressed —
 * emailing someone who marked mail as spam again risks the whole domain.
 */
adminRoutes.post("/email-suppressions/:id/reactivate", async (c) => {
  const id = c.req.param("id");
  const entry = await prisma.emailSuppression.findUnique({ where: { id } });
  if (!entry) return errorResponse(c, "Suppression not found", 404, "SUPPRESSION_NOT_FOUND");
  if (/complain/i.test(entry.reason)) {
    return errorResponse(c, "Complaint suppressions cannot be reactivated.", 422, "COMPLAINT_LOCKED");
  }

  const updated = await prisma.emailSuppression.update({ where: { id }, data: { active: false } });
  console.log(`[email] admin reactivated recipient ${updated.emailAddress}`);
  return successResponse(c, { suppression: updated }, "Recipient reactivated");
});
