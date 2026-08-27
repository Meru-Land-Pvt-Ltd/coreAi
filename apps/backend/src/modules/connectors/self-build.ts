/**
 * THE SELF-BUILDING FRAME — the factory gets its brain.
 *
 * The founder's fantasy, ordered on 2026-08-26: type a service's name and a
 * key, press Build, and minutes later a working card sits in your toolkit.
 * The Notion factory test proved an AI can write a frame from our standard
 * alone; this module makes that test a button.
 *
 * The shape is the composer's proven loop: the model PROPOSES a declaration,
 * the machine CHECKS it (problemsWith — the same validator every hand-written
 * connector passes, SSRF guards included), and the exact problems go straight
 * back for another attempt. Nothing reaches the toolkit because it read well
 * — it reaches the toolkit because the validator passed it, and where a key
 * was given and the recipe only READS, one real rehearsal fires through the
 * same engine a business would use.
 *
 * What the AI never touches: the guards. Its draft is data; the validator,
 * the URL checker, the engine's ceilings and the encrypted secret store rule
 * exactly as they do for a frame typed by hand.
 */

import type { NodeFrameDeclaration } from "@coreai/shared";
import { askPlatformBrain } from "../architect/platform-brain";
import { problemsWith, saveArchitectFrame, frameFromDeclaration, listArchitectFrames } from "./architect-frames";
import { runConnector } from "./engine";

const DRAFT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

const EXAMPLE_DECLARATION = `{
  "id": "acme.search_things",
  "version": "1.0.0",
  "job": "custom",
  "label": "Search things in Acme",
  "shortLabel": "Acme",
  "description": "Looks things up in Acme and hands back the matches.",
  "provider": { "name": "Acme", "docsUrl": "https://acme.example/docs", "apiVersion": "v1", "lastVerified": "2026-08-26" },
  "needs": {
    "platform": [{ "key": "ACME_API_KEY", "label": "Acme API key", "kind": "api_key", "help": "From Acme's dashboard.", "required": true }],
    "architect": [],
    "business": [{ "key": "topic", "label": "What to look for", "help": "A word or two.", "kind": "text", "required": true }],
    "accounts": []
  },
  "produces": [{ "key": "results", "label": "What came back", "kind": "list", "required": true, "sample": [{ "name": "Example" }] }],
  "cost": { "style": "per_call", "estimateCents": 1, "unit": "per call", "billedTo": "business" },
  "failure": { "onError": "retry", "maxRetries": 1, "backoffMs": 500, "neverRetry": [401, 403], "humanMessage": "Acme could not be reached." },
  "limits": { "callsPerMinute": 30, "callsPerDay": 500, "concurrent": 2, "pageSize": 25, "maxPages": 3 },
  "rules": {},
  "health": { "everyHours": 24, "expectKeys": ["results"], "severity": "degrades" },
  "execution": "immediate",
  "rollout": "canary",
  "recipe": {
    "method": "GET",
    "url": "https://api.acme.example/v1/search",
    "headers": { "Authorization": "Bearer {{credentials.ACME_API_KEY}}" },
    "query": { "q": "{{config.topic}}" },
    "resultsAt": "items"
  }
}`;

const DRAFT_INSTRUCTION = [
  "You write CONNECTOR DECLARATIONS for the Triven platform — a JSON description that becomes a",
  "working node. You are given a service's name, what the architect wants it to do, and sometimes",
  "a documentation address. Write ONE declaration, as JSON and nothing else.",
  "",
  "THE FORM (copy this shape exactly — every field shown is required):",
  EXAMPLE_DECLARATION,
  "",
  "THE RULES:",
  '- id: "<company>.<job>", lowercase, like "notion.query_database". Never rename an id.',
  "- shortLabel: THE COMPANY'S NAME and nothing else — that is the sidebar card.",
  "- recipe.url: the service's REAL https:// API address from its public documentation. Never invent",
  "  a domain. Placeholders: {{credentials.KEY_NAME}} for secrets, {{config.fieldKey}} for values the",
  "  business types (every {{config.x}} must have a matching needs.business field with key x).",
  "- The API key goes in needs.platform as kind api_key with an UPPER_SNAKE key, and is referenced",
  "  in the recipe as {{credentials.THAT_KEY}}. Nothing secret ever appears in plain text.",
  "- needs.business: the honest per-business inputs (search terms, ids) — plain labels, short help.",
  "- produces: what genuinely comes back, with a realistic sample. resultsAt: the dot-path to the",
  "  useful part of the reply, from the documentation.",
  "- Prefer a READ (GET) job unless the architect explicitly asked to send or write.",
  "- estimateCents: your honest guess; limits: conservative numbers like the example.",
  "",
  "THE SORTING LAW — every parameter the service offers goes to exactly one of four places:",
  "  needs.platform  → costs money or carries risk (rate limits, spend, quotas)",
  "  needs.business  → THEIR own fact (their key, their account, their campaign)",
  "  needs.architect → the shape of the job (which action, which field feeds which)",
  "  notShown        → everything else. Hiding is the skill: a form with fifty boxes is",
  "                    unusable, and this platform's law is that a node shows the few",
  "                    that matter. But say WHAT you hid — a silent omission is a trap",
  "                    for whoever needs that parameter in six months.",
  "",
  'Add one extra field to the JSON: "notShown": [{ "name": string, "why": string }] — the',
  "parameters you deliberately left out and the one-line reason for each. It is not part of",
  "the running node; it is the record of your judgement.",
  "",
  "Return ONLY the JSON declaration. No markdown fences, no commentary."
].join("\n");

function parseDeclaration(raw: string | null): NodeFrameDeclaration | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as NodeFrameDeclaration;
  } catch {
    return null;
  }
}

export type SelfBuildResult = {
  ok: boolean;
  frameId?: string;
  label?: string;
  status?: string;
  problems: string[];
  attempts: number;
  /** What the drafter deliberately left out, and why — never a silence. */
  notShown?: Array<{ name: string; why: string }>;
  /** The one real rehearsal, when a key was given and the recipe only reads. */
  tried?: { ok: boolean; message: string };
  message: string;
};

/**
 * #5 — THE MAINTENANCE LOOP (the founder's ruling, 2026-08-26).
 *
 * A card is a photograph of a service on the day it was drafted. Services
 * change: a field is renamed, a version retires, an endpoint moves. The daily
 * probe already NOTICES (the card goes degraded); nothing until now could
 * FIX it. This re-reads the service and drafts the card again, keeping the id
 * — so every agent already using it keeps working — and hands back what
 * changed so an architect approves rather than discovers.
 */
export async function redraftFrame(input: {
  architectUserId: string;
  frameId: string;
  apiKey?: string;
}): Promise<SelfBuildResult & { changed?: string[] }> {
  const owned = (await listArchitectFrames(input.architectUserId)).find(
    (entry) => entry.frameId === input.frameId
  );
  if (!owned?.declaration) {
    return { ok: false, problems: ["No such connection."], attempts: 0, message: "No such connection." };
  }

  const previous = owned.declaration as NodeFrameDeclaration & { draftedAt?: string };
  const result = await selfBuildFrame({
    architectUserId: input.architectUserId,
    serviceName: previous.provider?.name ?? previous.shortLabel ?? input.frameId,
    goal: previous.description ?? previous.label ?? "the same job as before",
    ...(previous.provider?.docsUrl ? { docsUrl: previous.provider.docsUrl } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    keepId: input.frameId
  });

  /* What actually moved — an architect approves a diff, never a mystery. */
  const changed: string[] = [];
  const after = result.ok ? (await listArchitectFrames(input.architectUserId)).find((e) => e.frameId === input.frameId)?.declaration as NodeFrameDeclaration | undefined : undefined;
  if (after) {
    if (after.recipe?.url !== previous.recipe?.url) changed.push(`address: ${previous.recipe?.url} → ${after.recipe?.url}`);
    if (after.recipe?.method !== previous.recipe?.method) changed.push(`kind of request: ${previous.recipe?.method} → ${after.recipe?.method}`);
    const before = new Set((previous.needs?.business ?? []).map((f) => f.key));
    const now = new Set((after.needs?.business ?? []).map((f) => f.key));
    for (const key of now) if (!before.has(key)) changed.push(`new question for the business: ${key}`);
    for (const key of before) if (!now.has(key)) changed.push(`question no longer asked: ${key}`);
    if (previous.draftedAt) changed.push(`last read: ${previous.draftedAt.slice(0, 10)}`);
  }

  return {
    ...result,
    ...(changed.length > 0 ? { changed } : {}),
    message: result.ok
      ? changed.length > 0
        ? `Re-read the service and updated the card. What changed: ${changed.join("; ")}.`
        : "Re-read the service — nothing had changed. The card is current."
      : result.message
  };
}

export async function selfBuildFrame(input: {
  architectUserId: string;
  serviceName: string;
  goal: string;
  docsUrl?: string;
  apiKey?: string;
  /** Re-drafting an existing card keeps its id, so live agents keep working. */
  keepId?: string;
}): Promise<SelfBuildResult> {
  const ask = [
    `SERVICE: ${input.serviceName}`,
    `WHAT THE ARCHITECT WANTS IT TO DO: ${input.goal}`,
    input.docsUrl ? `DOCUMENTATION: ${input.docsUrl}` : "DOCUMENTATION: not given — use the service's well-known public API.",
    input.apiKey ? "AN API KEY WILL BE PROVIDED — declare it in needs.platform." : "No key was given — declare the key the service will need anyway."
  ].join("\n");

  let declaration: NodeFrameDeclaration | null = null;
  let problems: string[] = ["not drafted yet"];
  let attempts = 0;
  let feedback = "";

  while (attempts < MAX_ATTEMPTS && problems.length > 0) {
    attempts += 1;
    const raw = await askPlatformBrain({
      instruction: DRAFT_INSTRUCTION,
      message: feedback ? `${ask}\n\nYOUR LAST DRAFT HAD THESE PROBLEMS — fix exactly these and return the whole declaration again:\n${feedback}` : ask,
      maxTokens: 3000,
      timeoutMs: DRAFT_TIMEOUT_MS,
      task: "frame-self-build"
    });
    const parsed = parseDeclaration(raw);
    if (!parsed) {
      feedback = "The answer was not valid JSON. Return only the JSON declaration.";
      continue;
    }
    declaration = parsed;
    /* A re-draft never renames the card: agents point at the id. */
    if (input.keepId) (declaration as Record<string, unknown>).id = input.keepId;
    problems = problemsWith(declaration);
    feedback = problems.map((problem) => `- ${problem}`).join("\n");
  }

  if (!declaration) {
    return { ok: false, problems: ["The draft never became valid JSON."], attempts, message: "The builder could not draft this service. Try adding the documentation address." };
  }

  /* RE-READING A SERVICE COULD DESTROY THE WORKING CARD BEHIND IT.
     A re-draft keeps the id on purpose, because agents point at it — and it
     then saved over the stored card whether or not the new draft was any
     good. So an architect pressing "re-read this service" on a card that had
     worked for months could be left with a broken one, and every live agent
     using it started failing with "not installed". There is no history to
     restore from: one row per card.

     A first draft with problems is still saved, because there is nothing to
     lose and the architect can see what is wrong. A RE-draft with problems is
     refused, and the card that works stays exactly as it is. */
  if (input.keepId && problems.length > 0) {
    return {
      ok: false,
      problems,
      attempts,
      message:
        "I read the service again and what came back is not usable, so I have left your card exactly as it was. Nothing changed."
    };
  }

  /* #4 — WHAT WAS HIDDEN, WRITTEN DOWN (the founder's ruling, 2026-08-26).
     The AI curates fifty parameters down to a usable few. That judgement is
     now a record on the card, not a silence: whoever needs the fifty-first
     parameter in six months can see it was considered and why it was left. */
  const notShown = Array.isArray((declaration as { notShown?: unknown }).notShown)
    ? ((declaration as { notShown?: Array<{ name?: string; why?: string }> }).notShown ?? [])
        .map((entry) => ({ name: String(entry?.name ?? ""), why: String(entry?.why ?? "") }))
        .filter((entry) => entry.name)
    : [];
  delete (declaration as { notShown?: unknown }).notShown;

  /* #5 — THE VERSION STAMP. A service changes; a card drafted today is a
     photograph of today's API. Stamping what it was read from is what lets
     the daily probe's failure become "re-read Instantly" instead of a
     mystery. */
  (declaration as Record<string, unknown>).draftedAt = new Date().toISOString();
  (declaration as Record<string, unknown>).draftedFrom = input.docsUrl ?? "the service's public API";
  if (notShown.length > 0) (declaration as Record<string, unknown>).notShown = notShown;

  /* The key is stored encrypted against the frame — never in the declaration. */
  const secrets: Record<string, string> = {};
  if (input.apiKey) {
    const keyField = declaration.needs?.platform?.find((field) => field.kind === "api_key");
    if (keyField) secrets[keyField.key] = input.apiKey;
  }

  const saved = await saveArchitectFrame({
    architectUserId: input.architectUserId,
    declaration,
    secrets
  });

  /* One honest rehearsal — only when a key exists and the recipe only READS.
     A drafted POST is never test-fired at a real service without the
     architect's own hand on the button. */
  let tried: { ok: boolean; message: string } | undefined;
  if (saved.status === "READY" && input.apiKey && declaration.recipe?.method === "GET") {
    try {
      const sampleConfig: Record<string, unknown> = {};
      for (const field of declaration.needs?.business ?? []) {
        sampleConfig[field.key] = field.kind === "number" ? 1 : "test";
      }
      const result = await runConnector({
        contract: frameFromDeclaration(declaration),
        businessId: `architect:${input.architectUserId}`,
        config: { ...secrets, ...sampleConfig }
      });
      tried = { ok: result.ok, message: result.message ?? (result.ok ? "The service answered." : "The service refused.") };
    } catch (error) {
      tried = { ok: false, message: error instanceof Error ? error.message : "The rehearsal could not run." };
    }
  }

  return {
    ok: saved.status === "READY",
    frameId: declaration.id,
    label: declaration.label,
    status: saved.status,
    problems: saved.problems ?? [],
    attempts,
    ...(notShown.length > 0 ? { notShown } : {}),
    ...(tried ? { tried } : {}),
    message:
      saved.status === "READY"
        ? tried
          ? tried.ok
            ? `Built, checked, and rehearsed against the real service — "${declaration.label}" is in your toolkit.`
            : `Built and checked — but the rehearsal failed: ${tried.message}. The card is in your toolkit; open it to adjust.`
          : `Built and checked — "${declaration.label}" is in your toolkit. Add a key to rehearse it for real.`
        : `Drafted with ${saved.problems.length} thing${saved.problems.length === 1 ? "" : "s"} still to sort out — open the card to finish it.`
  };
}
