import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { app } from "./app";

/**
 * EVERY SCREEN'S REQUEST MUST REACH SOMETHING (2026-08-27).
 *
 * The audit found the Settings → Integrations tab asking a service that had
 * been switched off months earlier. Nothing crashed: the request 404'd, the
 * error was swallowed, and a paying business saw a heading, a paragraph
 * promising what the feature does, and then nothing at all, forever. Nobody
 * noticed because nothing ever went red.
 *
 * That is the quietest way this platform can lie, and no unit test catches it
 * — the screen renders, the route file compiles, and the two never meet. So
 * they are introduced here: every address the frontend asks for is checked
 * against the addresses the server actually answers on.
 *
 * The server's list is the real one — read from the running app, not guessed
 * from the source — so a route that stops being mounted fails this the same
 * day, whatever the reason it stopped.
 */

const FRONTEND_SRC = join(__dirname, "../../frontend/src");
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage", "__snapshots__"]);

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Every address the frontend asks for, as written in the source.
 *
 * It reads the first argument of apiGet/apiPost/apiPatch/apiPut/apiDelete —
 * plain strings and template literals alike. A template's `${...}` holes
 * become a single wildcard segment, because that is exactly what they are:
 * an id the server declares as `:something`.
 */
function frontendPaths(): Map<string, string[]> {
  const calls =
    /\bapi(?:Get|Post|Patch|Put|Delete)\s*(?:<[^>]*>)?\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
  const found = new Map<string, string[]>();

  for (const file of sourceFiles(FRONTEND_SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(calls)) {
      const path = normalize(match[1]!.slice(1, -1));
      if (!path) continue;
      const where = file.slice(file.indexOf("/apps/") + 1);
      found.set(path, [...(found.get(path) ?? []), where]);
    }
  }
  return found;
}

/**
 * One written call turned into the address it really asks for.
 *
 * A hole that fills a whole segment — `/agents/${id}/run` — is an id, and the
 * server declares it as `:id`, so it becomes a wildcard. A hole glued to the
 * end of a word is a query string being appended; the address stops there.
 * Anything built entirely from a variable is unknowable and is skipped rather
 * than guessed at.
 */
function normalize(written: string): string | null {
  if (!written.startsWith("/")) return null;

  let path = written.split("?")[0]!;
  path = path.replace(/\/\$\{[^}]*\}(?=\/|$)/g, "/*");

  const glued = path.indexOf("${");
  if (glued !== -1) path = path.slice(0, glued);

  path = path.replace(/\/+$/, "");
  return path.length > 1 ? path : null;
}

/**
 * The addresses the server really answers on, from the app itself.
 *
 * Middleware is not an answer. Every `*` in this table belongs to an
 * `app.use("*", …)` — an auth gate, a body limit, a logger — registered under
 * method ALL. Counting those as endpoints would make this guard say yes to
 * every address ever asked for, which is how it first "passed": /crm/providers
 * matched a login gate and looked alive.
 */
function serverPaths(): string[] {
  const routes = (app as unknown as { routes?: Array<{ method: string; path: string }> }).routes ?? [];
  const endpoints = routes.filter((route) => route.method !== "ALL");
  return [...new Set(endpoints.map((route) => route.path))];
}

/**
 * Does the server answer here?
 *
 * Segment by segment, because both sides carry holes: the server's `:id` and
 * the screen's `${id}` match anything, and a trailing `*` mount answers for
 * everything beneath it.
 */
function answered(path: string, routes: string[]): boolean {
  const asked = path.split("/").filter(Boolean);

  return routes.some((route) => {
    const offered = route.split("/").filter(Boolean);

    for (let i = 0; i < offered.length; i += 1) {
      const segment = offered[i]!;
      if (segment === "*") return true;
      if (i >= asked.length) return false;
      if (segment.startsWith(":") || asked[i] === "*") continue;
      if (segment !== asked[i]) return false;
    }
    return offered.length === asked.length;
  });
}

describe("every screen's request reaches something", () => {
  const routes = serverPaths();
  const asked = frontendPaths();

  it("reads both sides at all", () => {
    /* A guard that finds nothing to compare passes forever and proves nothing. */
    /* Today: 930 server endpoints, 262 distinct addresses across 320 call
       sites. The floors are set well under those so ordinary work never trips
       them, but a collector that quietly stops matching fails here loudly
       instead of passing on an empty list. */
    expect(routes.length, "server routes").toBeGreaterThan(500);
    expect(asked.size, "distinct addresses the frontend asks for").toBeGreaterThan(200);
  });

  it("actually says no to an address nobody answers", () => {
    /* The check above only means something if this one fails to match. The
       CRM section asked /crm/providers for months after that service stopped
       being mounted, and nothing anywhere said a word. */
    expect(answered("/crm/providers", routes)).toBe(false);
    expect(answered("/business/inbox", routes)).toBe(false);
    expect(answered("/a-service-that-was-never-built", routes)).toBe(false);
    /* And it must still say yes to real ones, holes and all. */
    expect(answered("/business/analytics/overview", routes)).toBe(true);
    expect(answered("/agent-pages/*/run", routes)).toBe(true);
  });

  it("has a live route behind every address a screen asks for", () => {
    const unanswered: string[] = [];
    for (const [path, files] of asked) {
      if (!answered(path, routes)) {
        unanswered.push(`${path}   ← ${[...new Set(files)].join(", ")}`);
      }
    }
    expect(
      unanswered,
      "these screens ask the server for something it does not answer — either mount the route or delete the screen"
    ).toEqual([]);
  });
});
