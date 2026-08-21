/**
 * FRAMES AN ARCHITECT FILLED IN THEMSELVES.
 *
 * The Node Frame node in the builder lets an architect describe a service they
 * need — the address, the key, what comes back — and get a working node out of
 * it. This is where that description is checked, stored, and turned into
 * something the engine can run.
 *
 * The rule that matters: a frame built in the builder clears the SAME bar as
 * one we wrote ourselves. It is assembled into a real NodeFrame, heart and all,
 * and put through the same `validateNodeFrame` every catalogue connector goes
 * through. There is deliberately no gentler check for architect work — a node
 * that could pretend it worked, or spend without a ceiling, is exactly as
 * dangerous whoever wrote it.
 */

import {
  validateNodeFrame,
  type NodeFrame,
  type NodeFrameDeclaration
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import {
  checkRecipeUrl,
  credentialProblems,
  heartFromRecipe,
  probeFromDeclaration
} from "./recipe-heart";

/* -------------------------------------------------------------------------- */
/* Assembling                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Turn a description into a runnable frame.
 *
 * The heart is built from the recipe, the self-test from the probe recipe (or
 * an honest refusal when the provider has no call that works without a
 * customer's own details), and `source` is stamped so the engine knows never to
 * hand this one a platform credential.
 */
export function frameFromDeclaration(declaration: NodeFrameDeclaration): NodeFrame {
  const { recipe: _recipe, probeRecipe: _probe, cannotSelfTest: _cannot, ...rest } = declaration;
  return {
    ...rest,
    source: "architect",
    heart: heartFromRecipe(declaration),
    probe: probeFromDeclaration(declaration)
  } as NodeFrame;
}

/**
 * Everything wrong with a description, in the architect's own words.
 *
 * Three passes, because they catch different things: the address guard (can we
 * even reach it), the credential guard (is it reading a key it never asked
 * for), and then the full frame validation every connector faces.
 */
export function problemsWith(declaration: NodeFrameDeclaration): string[] {
  const problems: string[] = [];

  if (!declaration.recipe?.url) {
    problems.push("Tell it which web address to call. It is in the service's documentation, and starts with https://");
  } else {
    const urlProblem = checkRecipeUrl(declaration.recipe.url.replace(/\{\{[^}]+\}\}/g, "x"));
    if (urlProblem) problems.push(urlProblem);
  }

  if (declaration.probeRecipe?.url) {
    const probeProblem = checkRecipeUrl(declaration.probeRecipe.url.replace(/\{\{[^}]+\}\}/g, "x"));
    if (probeProblem) problems.push(`Daily check: ${probeProblem}`);
  }

  problems.push(...credentialProblems(declaration));

  // The same validation a connector we wrote ourselves has to pass.
  try {
    problems.push(...validateNodeFrame(frameFromDeclaration(declaration)));
  } catch (error) {
    problems.push(
      `This description could not be turned into a working node: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return [...new Set(problems)];
}

/* -------------------------------------------------------------------------- */
/* Storing                                                                     */
/* -------------------------------------------------------------------------- */

type StoredRow = {
  frameId: string;
  status: string;
  declarationJson: unknown;
  secretsJson: unknown;
  problems: string[];
  updatedAt: Date;
};

/** Save a description, check it, and say what is still wrong. */
export async function saveArchitectFrame(input: {
  architectUserId: string;
  declaration: NodeFrameDeclaration;
  /** Keys the architect typed. Encrypted before they touch the database. */
  secrets?: Record<string, string>;
}): Promise<{ frameId: string; status: string; problems: string[] }> {
  const problems = problemsWith(input.declaration);
  const status = problems.length === 0 ? "READY" : "DRAFT";

  const sealed: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.secrets ?? {})) {
    if (typeof value === "string" && value.trim()) sealed[key] = encryptSecret(value);
  }

  const existing = await prisma.architectNodeFrame.findUnique({
    where: {
      architectUserId_frameId: {
        architectUserId: input.architectUserId,
        frameId: input.declaration.id
      }
    },
    select: { secretsJson: true }
  });

  // A key the architect did not retype is a key they meant to keep.
  const keptSecrets = {
    ...((existing?.secretsJson as Record<string, string> | null) ?? {}),
    ...sealed
  };

  await prisma.architectNodeFrame.upsert({
    where: {
      architectUserId_frameId: {
        architectUserId: input.architectUserId,
        frameId: input.declaration.id
      }
    },
    create: {
      architectUserId: input.architectUserId,
      frameId: input.declaration.id,
      status,
      declarationJson: input.declaration as never,
      secretsJson: keptSecrets as never,
      problems
    },
    update: {
      status,
      declarationJson: input.declaration as never,
      secretsJson: keptSecrets as never,
      problems
    }
  });

  // Their own change must never be the one they wait a minute for.
  await refreshArchitectFrames(true);

  return { frameId: input.declaration.id, status, problems };
}

function declarationOf(row: StoredRow): NodeFrameDeclaration | null {
  const value = row.declarationJson;
  return value && typeof value === "object" ? (value as NodeFrameDeclaration) : null;
}

/** Everything one architect has built, ready or not. */
export async function listArchitectFrames(architectUserId: string): Promise<
  Array<{
    frameId: string;
    label: string;
    shortLabel: string;
    provider: string;
    status: string;
    problems: string[];
    updatedAt: string;
    declaration: NodeFrameDeclaration | null;
  }>
> {
  const rows = await prisma.architectNodeFrame.findMany({
    where: { architectUserId },
    orderBy: { updatedAt: "desc" }
  });

  return rows.map((row) => {
    const declaration = declarationOf(row);
    return {
      frameId: row.frameId,
      label: declaration?.label ?? row.frameId,
      shortLabel: declaration?.shortLabel ?? declaration?.provider?.name ?? row.frameId,
      provider: declaration?.provider?.name ?? "",
      status: row.status,
      problems: row.problems,
      updatedAt: row.updatedAt.toISOString(),
      declaration
    };
  });
}

/**
 * The runnable frames one architect owns.
 *
 * Only the ready ones. A draft is a description with known problems, and
 * running it would produce exactly the kind of quiet half-failure the whole
 * standard exists to prevent.
 */
export async function readyFramesFor(architectUserId: string): Promise<NodeFrame[]> {
  const rows = await prisma.architectNodeFrame.findMany({
    where: { architectUserId, status: "READY" }
  });

  const frames: NodeFrame[] = [];
  for (const row of rows) {
    const declaration = declarationOf(row);
    if (!declaration) continue;
    try {
      frames.push(frameFromDeclaration(declaration));
    } catch {
      // A stored description that no longer assembles — a field renamed under
      // it, say. Skipping is right: the architect sees it as a draft again the
      // next time they open it, rather than a node that fails at run time.
      continue;
    }
  }
  return frames;
}

/** One frame by id, for the runner. Includes the architect's own keys. */
export async function architectFrameById(
  frameId: string
): Promise<{ frame: NodeFrame; secrets: Record<string, string> } | null> {
  const row = await prisma.architectNodeFrame.findFirst({
    where: { frameId, status: "READY" },
    orderBy: { updatedAt: "desc" }
  });
  if (!row) return null;

  const declaration = declarationOf(row);
  if (!declaration) return null;

  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries((row.secretsJson as Record<string, string> | null) ?? {})) {
    try {
      secrets[key] = decryptSecret(value);
    } catch {
      // A key we can no longer read is the same as no key: the engine says
      // plainly that the connection is not set up yet.
    }
  }

  try {
    return { frame: frameFromDeclaration(declaration), secrets };
  } catch {
    return null;
  }
}

export async function deleteArchitectFrame(architectUserId: string, frameId: string): Promise<void> {
  await prisma.architectNodeFrame.deleteMany({ where: { architectUserId, frameId } });
  await refreshArchitectFrames(true);
}

/* -------------------------------------------------------------------------- */
/* Keeping them to hand                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Ready architect frames, held in memory.
 *
 * The runner and the door builder both need to look a frame up by id while
 * doing something synchronous. Reading the database on every node of every run
 * would be a query per step; holding them costs a few kilobytes and one refresh
 * a minute.
 *
 * The cache is refreshed the moment an architect saves, so their own change is
 * never the one they have to wait for — the delay only ever applies to another
 * process on another container, and a minute of that is invisible.
 */
const cache = new Map<string, NodeFrame>();
const secretsCache = new Map<string, Record<string, string>>();
let refreshedAt = 0;
const REFRESH_MS = 60_000;

export function cachedArchitectFrame(frameId: string): NodeFrame | undefined {
  return cache.get(frameId);
}

export function cachedArchitectSecrets(frameId: string): Record<string, string> {
  return secretsCache.get(frameId) ?? {};
}

export function allCachedArchitectFrames(): NodeFrame[] {
  return [...cache.values()];
}

export async function refreshArchitectFrames(force = false): Promise<void> {
  if (!force && Date.now() - refreshedAt < REFRESH_MS) return;
  refreshedAt = Date.now();

  try {
    const rows = await prisma.architectNodeFrame.findMany({ where: { status: "READY" } });
    cache.clear();
    secretsCache.clear();

    for (const row of rows) {
      const declaration = declarationOf(row);
      if (!declaration) continue;
      try {
        cache.set(row.frameId, frameFromDeclaration(declaration));
      } catch {
        continue;
      }

      const secrets: Record<string, string> = {};
      for (const [key, value] of Object.entries((row.secretsJson as Record<string, string> | null) ?? {})) {
        try {
          secrets[key] = decryptSecret(value);
        } catch {
          // Unreadable key: the engine will say the connection is not set up.
        }
      }
      secretsCache.set(row.frameId, secrets);
    }
  } catch (error) {
    // A database blip must not empty the cache and take every architect's own
    // nodes off their canvas mid-run.
    console.warn("[node-frames] could not refresh", (error as Error).message);
  }
}

/** Start the refresh loop. Called once at boot. */
export function startArchitectFrameRefresh(): NodeJS.Timeout {
  void refreshArchitectFrames(true);
  const timer = setInterval(() => void refreshArchitectFrames(true), REFRESH_MS);
  timer.unref();
  return timer;
}
