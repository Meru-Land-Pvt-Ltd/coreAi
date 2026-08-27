import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE LAWS THAT KEEP A CODEBASE HONEST (2026-08-27).
 *
 * The platform audit found roughly twenty-four thousand lines of code that
 * could not run: whole features commented out, screens whose backend was
 * switched off, files nothing imported, and a literal "copy" of a workspace.
 *
 * Commented-out code is the worst lie a codebase tells. It reads as "this
 * exists, it is just turned off", so the next person plans around it, and
 * every search for how something works finds the dead copy first. Twice today
 * a switched-off block turned out to be hiding something real: a customer who
 * asked for a person was answered by nobody, and a card number said out loud
 * was being written to our database in plain text.
 *
 * So the rule is: DELETE, NEVER COMMENT. Git remembers. These tests hold that
 * line for every file we write from here, in this app and the other two.
 */

const ROOTS = [
  join(__dirname, "."),
  join(__dirname, "../../frontend/src"),
  join(__dirname, "../../../packages/shared/src")
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage", "__snapshots__"]);
const SOURCE = /\.(ts|tsx)$/;

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
    else if (SOURCE.test(entry)) found.push(full);
  }
  return found;
}

/* This file names the patterns it bans, so it exempts itself — otherwise the
   guard is its own only offender, forever. */
const FILES = ROOTS.flatMap(sourceFiles).filter((path) => !path.endsWith("platform-hygiene.test.ts"));
const short = (path: string) => path.slice(path.indexOf("/apps/") + 1 || 0);

describe("delete, never comment", () => {
  it("finds source files to check at all", () => {
    /* A guard that silently checks nothing is worse than no guard. */
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("carries no switched-off code", () => {
    const offenders: string[] = [];
    for (const path of FILES) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/\[DISABLED/.test(line)) offenders.push(`${short(path)}:${index + 1}`);
      });
    }
    expect(offenders, "delete it — git remembers what it was").toEqual([]);
  });

  it("carries no commented-out imports or route mounts", () => {
    const offenders: string[] = [];
    /* A commented import is a feature someone means to bring back and never
       does; a commented mount is a screen the frontend still calls. */
    /* It must READ like an import statement, not merely start with the word:
       a comment saying "a defensive dynamic import in the route" is prose. */
    const commentedImport = /^\s*\/\/\s*import\s+(?:[{*'"]|[\w$]+[^\n]*\bfrom\b)/;
    const commentedMount = /^\s*\/\/\s*\w+(Routes|app)\.(route|get|post|put|patch|delete)\s*\(/;
    for (const path of FILES) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (commentedImport.test(line) || commentedMount.test(line)) {
          offenders.push(`${short(path)}:${index + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("has no file that is a copy of another file", () => {
    /* "architect-workspace copy.tsx" shipped for weeks, exporting the same
       name as the real one. A copy in the tree is an ambiguity, not a backup. */
    const offenders = FILES.filter((path) => / copy\.|\.copy\.|-copy\./i.test(path)).map(short);
    expect(offenders).toEqual([]);
  });
});

describe("the dead names stay dead", () => {
  it("never names a retired product on a screen, in a message, or in a comment", () => {
    /* One AI Builder. Every older name for it was removed on 2026-08-27, and
       a name that comes back in one file spreads to twenty. Storage keys are
       exempt by design — they carry values an admin already saved — and they
       are spelled as identifiers, which this pattern does not match. */
    const dead = /Smart Designer|Design Brain|Design Chat|Page Brain/i;
    const offenders: string[] = [];
    for (const path of FILES) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (dead.test(line)) offenders.push(`${short(path)}:${index + 1}  ${line.trim().slice(0, 70)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
