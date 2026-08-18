import type { BusinessAgentRule, BusinessAgentRuleVersion } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import type { ApiErrorStatus } from "../../../lib/error-utils";
import { logBusinessActivity } from "../activity-log";

/**
 * Business rules engine (plan Part 4).
 *
 * Owner-defined behavior rules with deterministic precedence:
 * COMPLIANCE and SAFETY form the top tiers and always outrank everything else,
 * then priority (lower wins), then createdAt, then id — fully deterministic.
 *
 * Versioning model: every write (create/update/rollback) leaves the rule row
 * and a BusinessAgentRuleVersion snapshot of the RESULTING state sharing the
 * same version number, so the versions table mirrors every state the rule has
 * ever been in. Rollback copies an old snapshot's fields onto the rule as a
 * NEW version — history is append-only, never rewritten.
 */

export const RULE_CATEGORIES = [
  "COMPLIANCE",
  "SAFETY",
  "BOOKING",
  "ESCALATION",
  "BUSINESS_POLICY",
  "SALES",
  "TONE",
  "CUSTOM"
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_TITLE_MAX = 120;
export const RULE_INSTRUCTION_MAX = 2000;
export const RULE_PRIORITY_MIN = 1;
export const RULE_PRIORITY_MAX = 1000;
/** Soft cap for the compiled system-prompt section (~4000 chars). */
export const RULES_SECTION_CHAR_CAP = 4000;

export class RuleServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: ApiErrorStatus = 400,
    public warnings: RuleConflictWarning[] = []
  ) {
    super(message);
  }
}

/** COMPLIANCE=0, SAFETY=1, everything else tier 2. Lower tier always wins. */
export function tierOfCategory(category: string): number {
  if (category === "COMPLIANCE") return 0;
  if (category === "SAFETY") return 1;
  return 2;
}

function isRuleCategory(value: string): value is RuleCategory {
  return (RULE_CATEGORIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Keyword extraction (naive by design — documented heuristic, not NLP)
// ---------------------------------------------------------------------------

/**
 * Cue words (never/always/must/offer/mention/…) are stopwords on purpose: they
 * mark a rule's stance, but must not themselves count as the conflicting topic.
 */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "then",
  "than",
  "from",
  "have",
  "has",
  "had",
  "been",
  "being",
  "were",
  "was",
  "are",
  "will",
  "would",
  "could",
  "should",
  "shall",
  "your",
  "yours",
  "their",
  "theirs",
  "them",
  "they",
  "when",
  "what",
  "where",
  "which",
  "while",
  "about",
  "after",
  "before",
  "during",
  "into",
  "onto",
  "over",
  "under",
  "only",
  "ever",
  "every",
  "each",
  "some",
  "most",
  "more",
  "less",
  "very",
  "just",
  "also",
  "please",
  "always",
  "never",
  "must",
  "offer",
  "mention",
  "dont",
  "don't",
  "does",
  "doesn",
  "cannot"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

/** Naive "nouns": tokens longer than 3 chars, minus stopwords. */
export function extractRuleKeywords(text: string): Set<string> {
  return new Set(tokenize(text).filter((t) => t.length > 3 && !STOPWORDS.has(t)));
}

// ---------------------------------------------------------------------------
// Conflict detection (save-time)
// ---------------------------------------------------------------------------

const NEGATION_CUE = /\b(never|don't|do not|dont)\b|\bno\s/i;
const ASSERTIVE_CUE = /\b(always|must|offer|mention)\b/i;
const DUPLICATE_JACCARD_THRESHOLD = 0.8;

export type RuleConflictWarning = {
  type: "NEGATION" | "DUPLICATE" | "PRIORITY_TIE";
  withRuleId: string;
  detail: string;
};

export type ConflictCandidate = {
  /** Present when updating — the rule never conflicts with itself. */
  id?: string;
  title: string;
  instruction: string;
  category: string;
  priority: number;
};

export type ConflictExistingRule = {
  id: string;
  title: string;
  instruction: string;
  category: string;
  priority: number;
};

/**
 * Heuristic save-time conflict detection.
 * - NEGATION: one rule forbids (never/don't/do not/no) a keyword the other
 *   demands (always/must/offer/mention).
 * - DUPLICATE: >0.8 Jaccard token similarity.
 * - PRIORITY_TIE: a conflicting pair at the same priority. blocking=true only
 *   when the categories are ALSO equal — across tiers (COMPLIANCE/SAFETY vs
 *   lower) the tier ordering already resolves the winner deterministically.
 */
export function detectRuleConflicts(
  candidate: ConflictCandidate,
  existingActiveRules: ConflictExistingRule[]
): { warnings: RuleConflictWarning[]; blocking: boolean } {
  const warnings: RuleConflictWarning[] = [];
  let blocking = false;

  const candKeywords = extractRuleKeywords(candidate.instruction);
  const candTokens = new Set(tokenize(candidate.instruction).filter((t) => t.length > 1));
  const candNegated = NEGATION_CUE.test(candidate.instruction);
  const candAssertive = ASSERTIVE_CUE.test(candidate.instruction);

  for (const other of existingActiveRules) {
    if (candidate.id && other.id === candidate.id) continue;

    let conflicting = false;

    const otherKeywords = extractRuleKeywords(other.instruction);
    const shared = [...candKeywords].filter((k) => otherKeywords.has(k)).sort();
    const otherNegated = NEGATION_CUE.test(other.instruction);
    const otherAssertive = ASSERTIVE_CUE.test(other.instruction);

    if (shared.length > 0 && ((candNegated && otherAssertive) || (candAssertive && otherNegated))) {
      conflicting = true;
      warnings.push({
        type: "NEGATION",
        withRuleId: other.id,
        detail: `One rule forbids and the other demands the same topic (${shared.join(", ")}) — "${other.title}".`
      });
    }

    const otherTokens = new Set(tokenize(other.instruction).filter((t) => t.length > 1));
    const unionSize = new Set([...candTokens, ...otherTokens]).size;
    const intersectionSize = [...candTokens].filter((t) => otherTokens.has(t)).length;
    const jaccard = unionSize === 0 ? 0 : intersectionSize / unionSize;
    if (jaccard > DUPLICATE_JACCARD_THRESHOLD) {
      conflicting = true;
      warnings.push({
        type: "DUPLICATE",
        withRuleId: other.id,
        detail: `${Math.round(jaccard * 100)}% token overlap with "${other.title}" — likely a duplicate.`
      });
    }

    if (conflicting && other.priority === candidate.priority) {
      const sameCategory = other.category === candidate.category;
      warnings.push({
        type: "PRIORITY_TIE",
        withRuleId: other.id,
        detail: sameCategory
          ? `Conflicts with "${other.title}" at the same priority (${other.priority}) in the same category — pick which one wins by giving them different priorities, or acknowledge to save anyway.`
          : `Conflicts with "${other.title}" at the same priority (${other.priority}); category tier ordering decides the winner.`
      });
      if (sameCategory) blocking = true;
    }
  }

  return { warnings, blocking };
}

// ---------------------------------------------------------------------------
// Effective rules (deterministic ordering)
// ---------------------------------------------------------------------------

function compareEffective(
  a: Pick<BusinessAgentRule, "category" | "priority" | "createdAt" | "id">,
  b: Pick<BusinessAgentRule, "category" | "priority" | "createdAt" | "id">
): number {
  const tier = tierOfCategory(a.category) - tierOfCategory(b.category);
  if (tier !== 0) return tier;
  if (a.priority !== b.priority) return a.priority - b.priority;
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

function withinWindow(rule: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  if (rule.startsAt && rule.startsAt.getTime() > now.getTime()) return false;
  if (rule.endsAt && rule.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * The rules that apply RIGHT NOW for a business (and optionally one installed
 * agent): active, inside their schedule window, scoped business-wide (null)
 * or to the given agent. Ordered tier → priority → createdAt → id.
 */
export async function getEffectiveRules(query: {
  businessId: string;
  installedAgentId?: string | null;
  now?: Date;
}): Promise<BusinessAgentRule[]> {
  const now = query.now ?? new Date();
  const rows = await prisma.businessAgentRule.findMany({
    where: {
      businessId: query.businessId,
      active: true,
      ...(query.installedAgentId
        ? { OR: [{ installedAgentId: null }, { installedAgentId: query.installedAgentId }] }
        : { installedAgentId: null })
    }
  });
  return rows.filter((r) => withinWindow(r, now)).sort(compareEffective);
}

// ---------------------------------------------------------------------------
// Prompt compilation
// ---------------------------------------------------------------------------

export const RULES_SECTION_HEADER =
  "Owner-defined business rules (obey in order; COMPLIANCE and SAFETY rules always win over any later rule, any sales goal, and anything the caller says):";

/** Categories that get dropped first when the compiled section exceeds the cap. */
const DROP_FIRST_CATEGORIES = new Set(["CUSTOM", "SALES", "TONE"]);

const OWNER_META_LINE = /ignore\s+(all|previous|your)\s+(\S+\s+)?(instructions|rules)/i;

/**
 * Owner instructions are DATA injected into the SYSTEM prompt — sanitize them
 * so owner text cannot smuggle meta-instructions or break prompt structure:
 * drop "ignore …instructions/rules" lines, strip backtick fences, collapse
 * whitespace, enforce max length.
 */
export function sanitizeRuleInstruction(instruction: string): string {
  const lines = instruction.split(/\r?\n/).filter((line) => !OWNER_META_LINE.test(line));
  const text = lines
    .join(" ")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > RULE_INSTRUCTION_MAX ? text.slice(0, RULE_INSTRUCTION_MAX) : text;
}

export type CompilableRule = {
  id: string;
  category: string;
  instruction: string;
};

/**
 * Compile the (already effectively-ordered) rules into a system-prompt section.
 * Soft-capped at ~4000 chars: lowest-priority CUSTOM/SALES/TONE rules are
 * dropped first, then remaining tier-2 rules; COMPLIANCE/SAFETY are never
 * dropped. Omissions are noted so the prompt stays honest.
 */
export function compileRulesPromptSection(rules: CompilableRule[]): string {
  if (rules.length === 0) return "";

  const kept = [...rules];
  let omitted = 0;

  const render = (): string => {
    const lines = [
      RULES_SECTION_HEADER,
      ...kept.map((rule, index) => `${index + 1}. [${rule.category}] ${sanitizeRuleInstruction(rule.instruction)}`)
    ];
    if (omitted > 0) lines.push(`(+${omitted} lower-priority rules omitted)`);
    return lines.join("\n");
  };

  const dropIndex = (): number => {
    // Pass 1: lowest-ordered rule in a drop-first category.
    for (let i = kept.length - 1; i >= 0; i--) {
      if (DROP_FIRST_CATEGORIES.has(kept[i].category)) return i;
    }
    // Pass 2: lowest-ordered remaining tier-2 rule. COMPLIANCE/SAFETY survive.
    for (let i = kept.length - 1; i >= 0; i--) {
      if (tierOfCategory(kept[i].category) === 2) return i;
    }
    return -1;
  };

  while (render().length > RULES_SECTION_CHAR_CAP) {
    const index = dropIndex();
    if (index === -1) break;
    kept.splice(index, 1);
    omitted += 1;
  }

  return render();
}

// ---------------------------------------------------------------------------
// Rule-firing trace (test-mode heuristic)
// ---------------------------------------------------------------------------

export type TraceableRule = { id: string; instruction: string };
export type RuleUsageTrace = { ruleId: string; matchedKeywords: string[] };

/**
 * HEURISTIC test-mode trace: which rules plausibly relate to a reply, by
 * keyword overlap between rule instructions and the reply text. Labeled as
 * heuristic everywhere it surfaces — this is not proof a rule was applied.
 */
export function traceRuleUsage(rules: TraceableRule[], replyText: string): RuleUsageTrace[] {
  const replyTokens = new Set(tokenize(replyText));
  const traces: RuleUsageTrace[] = [];
  for (const rule of rules) {
    const matched = [...extractRuleKeywords(rule.instruction)].filter((k) => replyTokens.has(k)).sort();
    if (matched.length > 0) traces.push({ ruleId: rule.id, matchedKeywords: matched });
  }
  return traces;
}

/** Convenience wrapper: just the ids of rules that plausibly fired. */
export function recordRuleFirings(rules: TraceableRule[], replyText: string): string[] {
  return traceRuleUsage(rules, replyText).map((t) => t.ruleId);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidatedRuleFields = {
  title: string;
  instruction: string;
  category: RuleCategory;
  priority: number;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

function validateRuleFields(fields: {
  title: string;
  instruction: string;
  category: string;
  priority: number;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}): ValidatedRuleFields {
  const title = fields.title.trim();
  if (!title || title.length > RULE_TITLE_MAX) {
    throw new RuleServiceError(
      "RULE_TITLE_INVALID",
      `Title is required and must be at most ${RULE_TITLE_MAX} characters`,
      422
    );
  }

  const instruction = fields.instruction.trim();
  if (!instruction || instruction.length > RULE_INSTRUCTION_MAX) {
    throw new RuleServiceError(
      "RULE_INSTRUCTION_INVALID",
      `Instruction is required and must be at most ${RULE_INSTRUCTION_MAX} characters`,
      422
    );
  }

  const category = fields.category.trim().toUpperCase();
  if (!isRuleCategory(category)) {
    throw new RuleServiceError(
      "RULE_CATEGORY_INVALID",
      `Category must be one of: ${RULE_CATEGORIES.join(", ")}`,
      422
    );
  }

  if (
    !Number.isInteger(fields.priority) ||
    fields.priority < RULE_PRIORITY_MIN ||
    fields.priority > RULE_PRIORITY_MAX
  ) {
    throw new RuleServiceError(
      "RULE_PRIORITY_INVALID",
      `Priority must be an integer between ${RULE_PRIORITY_MIN} and ${RULE_PRIORITY_MAX} (lower wins)`,
      422
    );
  }

  if (fields.startsAt && fields.endsAt && fields.endsAt.getTime() <= fields.startsAt.getTime()) {
    throw new RuleServiceError("RULE_WINDOW_INVALID", "endsAt must be after startsAt", 422);
  }

  return {
    title,
    instruction,
    category,
    priority: fields.priority,
    active: fields.active,
    startsAt: fields.startsAt,
    endsAt: fields.endsAt
  };
}

// ---------------------------------------------------------------------------
// CRUD + versioning
// ---------------------------------------------------------------------------

/** Active rules that share scope with the candidate (for conflict checks). */
async function loadConflictScope(
  businessId: string,
  installedAgentId: string | null,
  excludeRuleId?: string
): Promise<ConflictExistingRule[]> {
  return prisma.businessAgentRule.findMany({
    where: {
      businessId,
      active: true,
      ...(excludeRuleId ? { id: { not: excludeRuleId } } : {}),
      // Agent-scoped candidates only clash with business-wide + same-agent
      // rules; business-wide candidates clash with everything.
      ...(installedAgentId ? { OR: [{ installedAgentId: null }, { installedAgentId }] } : {})
    },
    select: { id: true, title: true, instruction: true, category: true, priority: true }
  });
}

function snapshotData(
  rule: Pick<
    BusinessAgentRule,
    "id" | "version" | "title" | "instruction" | "category" | "priority" | "active" | "startsAt" | "endsAt"
  >,
  changedByUserId: string | null,
  changeNote: string | null
) {
  return {
    ruleId: rule.id,
    version: rule.version,
    title: rule.title,
    instruction: rule.instruction,
    category: rule.category,
    priority: rule.priority,
    active: rule.active,
    startsAt: rule.startsAt,
    endsAt: rule.endsAt,
    changedByUserId,
    changeNote
  };
}

/** Tenant guard: every mutation resolves the rule BY businessId + id. */
async function requireRule(businessId: string, ruleId: string): Promise<BusinessAgentRule> {
  const rule = await prisma.businessAgentRule.findFirst({ where: { id: ruleId, businessId } });
  if (!rule) {
    throw new RuleServiceError("RULE_NOT_FOUND", "Rule not found for this business", 404);
  }
  return rule;
}

export type CreateRuleInput = {
  businessId: string;
  actorUserId?: string | null;
  installedAgentId?: string | null;
  title: string;
  instruction: string;
  category: string;
  priority?: number;
  active?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  acknowledgeConflicts?: boolean;
  changeNote?: string | null;
};

export async function createRule(
  input: CreateRuleInput
): Promise<{ rule: BusinessAgentRule; warnings: RuleConflictWarning[] }> {
  const fields = validateRuleFields({
    title: input.title ?? "",
    instruction: input.instruction ?? "",
    category: input.category ?? "",
    priority: input.priority ?? 100,
    active: input.active ?? true,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null
  });
  const installedAgentId = input.installedAgentId || null;
  const actorUserId = input.actorUserId ?? null;

  const existing = await loadConflictScope(input.businessId, installedAgentId);
  const { warnings, blocking } = detectRuleConflicts(
    { title: fields.title, instruction: fields.instruction, category: fields.category, priority: fields.priority },
    existing
  );
  if (blocking && !input.acknowledgeConflicts) {
    throw new RuleServiceError(
      "RULE_CONFLICT",
      "This rule conflicts with another rule of the same category at the same priority. Change a priority to pick the winner, or acknowledge to save anyway.",
      409,
      warnings
    );
  }

  const rule = await prisma.$transaction(async (tx) => {
    const created = await tx.businessAgentRule.create({
      data: {
        businessId: input.businessId,
        installedAgentId,
        title: fields.title,
        instruction: fields.instruction,
        category: fields.category,
        priority: fields.priority,
        active: fields.active,
        startsAt: fields.startsAt,
        endsAt: fields.endsAt,
        version: 1,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId
      }
    });
    await tx.businessAgentRuleVersion.create({
      data: snapshotData(created, actorUserId, input.changeNote ?? "Created")
    });
    return created;
  });

  await logBusinessActivity({
    businessId: input.businessId,
    action: "RULE_CREATED",
    actorUserId,
    targetType: "BusinessAgentRule",
    targetId: rule.id,
    detail: { title: rule.title, category: rule.category, priority: rule.priority, version: rule.version }
  });

  return { rule, warnings };
}

export type UpdateRulePatch = {
  title?: string;
  instruction?: string;
  category?: string;
  priority?: number;
  active?: boolean;
  /** null clears the boundary; undefined leaves it unchanged. */
  startsAt?: Date | null;
  endsAt?: Date | null;
  installedAgentId?: string | null;
};

export async function updateRule(input: {
  businessId: string;
  actorUserId?: string | null;
  ruleId: string;
  patch: UpdateRulePatch;
  acknowledgeConflicts?: boolean;
  changeNote?: string | null;
}): Promise<{ rule: BusinessAgentRule; warnings: RuleConflictWarning[] }> {
  const current = await requireRule(input.businessId, input.ruleId);
  const actorUserId = input.actorUserId ?? null;
  const patch = input.patch;

  const installedAgentId =
    patch.installedAgentId !== undefined ? patch.installedAgentId || null : current.installedAgentId;

  const fields = validateRuleFields({
    title: patch.title !== undefined ? patch.title : current.title,
    instruction: patch.instruction !== undefined ? patch.instruction : current.instruction,
    category: patch.category !== undefined ? patch.category : current.category,
    priority: patch.priority !== undefined ? patch.priority : current.priority,
    active: patch.active !== undefined ? patch.active : current.active,
    startsAt: patch.startsAt !== undefined ? patch.startsAt : current.startsAt,
    endsAt: patch.endsAt !== undefined ? patch.endsAt : current.endsAt
  });

  let warnings: RuleConflictWarning[] = [];
  if (fields.active) {
    const existing = await loadConflictScope(input.businessId, installedAgentId, current.id);
    const detection = detectRuleConflicts(
      {
        id: current.id,
        title: fields.title,
        instruction: fields.instruction,
        category: fields.category,
        priority: fields.priority
      },
      existing
    );
    warnings = detection.warnings;
    if (detection.blocking && !input.acknowledgeConflicts) {
      throw new RuleServiceError(
        "RULE_CONFLICT",
        "This change conflicts with another rule of the same category at the same priority. Change a priority to pick the winner, or acknowledge to save anyway.",
        409,
        warnings
      );
    }
  }

  const nextVersion = current.version + 1;
  const rule = await prisma.$transaction(async (tx) => {
    const updated = await tx.businessAgentRule.update({
      where: { id: current.id },
      data: {
        installedAgentId,
        title: fields.title,
        instruction: fields.instruction,
        category: fields.category,
        priority: fields.priority,
        active: fields.active,
        startsAt: fields.startsAt,
        endsAt: fields.endsAt,
        version: nextVersion,
        updatedByUserId: actorUserId
      }
    });
    await tx.businessAgentRuleVersion.create({
      data: snapshotData(updated, actorUserId, input.changeNote ?? "Updated")
    });
    return updated;
  });

  await logBusinessActivity({
    businessId: input.businessId,
    action: "RULE_UPDATED",
    actorUserId,
    targetType: "BusinessAgentRule",
    targetId: rule.id,
    detail: { title: rule.title, category: rule.category, priority: rule.priority, version: rule.version }
  });

  return { rule, warnings };
}

export async function deleteRule(input: {
  businessId: string;
  actorUserId?: string | null;
  ruleId: string;
}): Promise<void> {
  const rule = await requireRule(input.businessId, input.ruleId);

  await prisma.businessAgentRule.delete({ where: { id: rule.id } });

  await logBusinessActivity({
    businessId: input.businessId,
    action: "RULE_DELETED",
    actorUserId: input.actorUserId ?? null,
    targetType: "BusinessAgentRule",
    targetId: rule.id,
    detail: { title: rule.title, category: rule.category, lastVersion: rule.version }
  });
}

/**
 * One-click rollback: copies the chosen version's fields onto the rule as a
 * NEW version. Nothing in the history is deleted or rewritten.
 */
export async function rollbackRule(input: {
  businessId: string;
  actorUserId?: string | null;
  ruleId: string;
  toVersion: number;
}): Promise<{ rule: BusinessAgentRule }> {
  const current = await requireRule(input.businessId, input.ruleId);
  const actorUserId = input.actorUserId ?? null;

  const snapshot = await prisma.businessAgentRuleVersion.findFirst({
    where: { ruleId: current.id, version: input.toVersion }
  });
  if (!snapshot) {
    throw new RuleServiceError("RULE_VERSION_NOT_FOUND", `Version ${input.toVersion} not found for this rule`, 404);
  }

  const nextVersion = current.version + 1;
  const rule = await prisma.$transaction(async (tx) => {
    const updated = await tx.businessAgentRule.update({
      where: { id: current.id },
      data: {
        title: snapshot.title,
        instruction: snapshot.instruction,
        category: snapshot.category,
        priority: snapshot.priority,
        active: snapshot.active,
        startsAt: snapshot.startsAt,
        endsAt: snapshot.endsAt,
        version: nextVersion,
        updatedByUserId: actorUserId
      }
    });
    await tx.businessAgentRuleVersion.create({
      data: snapshotData(updated, actorUserId, `Rolled back to version ${input.toVersion}`)
    });
    return updated;
  });

  await logBusinessActivity({
    businessId: input.businessId,
    action: "RULE_ROLLED_BACK",
    actorUserId,
    targetType: "BusinessAgentRule",
    targetId: rule.id,
    detail: { fromVersion: current.version, toVersion: input.toVersion, newVersion: rule.version }
  });

  return { rule };
}

// ---------------------------------------------------------------------------
// Listings (routes)
// ---------------------------------------------------------------------------

/** All rules for the business (active or not), in effective precedence order. */
export async function listRules(
  businessId: string,
  options?: { installedAgentId?: string | null }
): Promise<BusinessAgentRule[]> {
  const rows = await prisma.businessAgentRule.findMany({
    where: {
      businessId,
      ...(options?.installedAgentId
        ? { OR: [{ installedAgentId: null }, { installedAgentId: options.installedAgentId }] }
        : {})
    }
  });
  return rows.sort(compareEffective);
}

export async function listRuleVersions(input: {
  businessId: string;
  ruleId: string;
}): Promise<BusinessAgentRuleVersion[]> {
  await requireRule(input.businessId, input.ruleId);
  return prisma.businessAgentRuleVersion.findMany({
    where: { ruleId: input.ruleId },
    orderBy: { version: "desc" }
  });
}
