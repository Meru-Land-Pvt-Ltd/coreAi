/**
 * Pre-deploy 5-shape verification, run with tsx on the host.
 *
 * Exercises the REAL pipeline on the REAL five workflows with the REAL model:
 * deriveDeclarations → buildComposerSystemPrompt → Claude Opus 5 →
 * extractComposerJson → sanitizeProductSpec → checkComposition. Only the DB
 * save and the browser render wait for the production deploy — everything the
 * composer decides is verified here first.
 *
 * The key arrives via ANTHROPIC_API_KEY in the process env for this run only —
 * in production it lives encrypted in the admin store; nothing here writes it
 * anywhere.
 */
import { readFileSync } from "node:fs";
import { deriveDeclarations, sanitizeProductSpec } from "@coreai/shared";
import {
  buildComposerSystemPrompt,
  checkComposition,
  extractComposerJson
} from "./smart-composer";

const WORKFLOWS_FILE = process.argv[2];
if (!WORKFLOWS_FILE) throw new Error("usage: tsx shape-test-local.ts <five-workflows.json>");

const SHAPE_BY_ID: Record<string, string> = {
  cmswy3pgk000nn20ilzntt6hp: "voice",
  cmsvs9qmf0005qi0jebiw5n9v: "conversation",
  wfytc170c125fd4fdc12: "api-lookup",
  cmswsdq3e0015p00jp0p7hjhp: "generation",
  wfweatheredce67e3ef8d: "multi-form"
};

async function callOpus(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not in env");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

(async () => {
  const rows = JSON.parse(readFileSync(WORKFLOWS_FILE, "utf8")) as Array<{
    id: string;
    name: string;
    workflowJson: { nodes?: Array<{ id: string }> };
  }>;

  let passed = 0;
  for (const row of rows) {
    const t0 = Date.now();
    const out: Record<string, unknown> = { shape: SHAPE_BY_ID[row.id], name: row.name };
    try {
      const decl = deriveDeclarations(row.workflowJson);
      out.declared = {
        shape: decl.shape,
        asks: decl.asks.map((a) => `${a.id}(${a.kind}${a.nodeIds.length > 1 ? `,merged×${a.nodeIds.length}` : ""})`),
        shows: decl.shows.length
      };

      const system = buildComposerSystemPrompt({
        agent: { name: row.name, tagline: null },
        declarations: decl
      });
      const text = await callOpus(system, "Generate my product's interface.");
      out.llmMs = Date.now() - t0;

      const raw = extractComposerJson(text) as { reply?: string; product?: unknown } | null;
      if (!raw) throw new Error("no JSON in model output");
      const spec = sanitizeProductSpec(raw.product ?? raw);
      if (!spec) throw new Error("sanitize rejected the spec");

      const graphIds = new Set((row.workflowJson.nodes ?? []).map((n) => n.id));
      const check = checkComposition(spec, decl, graphIds);
      out.check = { asksPlaced: check.asksPlaced, violations: check.violations };
      if (!check.product) throw new Error("check failed: " + check.violations.join(" | "));

      // What the founder will actually see — counted, not claimed.
      const page = check.product.pages[0];
      const flat: Array<{ type: string; label?: string; kind?: string; wire?: unknown }> = [];
      const walk = (nodes: Array<Record<string, unknown>>) => {
        for (const n of nodes) {
          flat.push({
            type: n.type as string,
            label: (n.label ?? n.text) as string | undefined,
            kind: n.kind as string | undefined,
            wire: n.wire
          });
          if (Array.isArray(n.children)) walk(n.children as Array<Record<string, unknown>>);
        }
      };
      walk(page.blocks as unknown as Array<Record<string, unknown>>);
      out.interface = {
        inputs: flat.filter((n) => ["input", "upload", "choice"].includes(n.type)).map((n) => `${n.type}:${n.kind ?? "text"}:${n.label ?? ""}`),
        buttons: flat.filter((n) => n.type === "button").map((n) => n.label),
        results: flat.filter((n) => n.type === "result").length,
        totalBlocks: flat.length
      };
      out.ok = true;
      passed++;
    } catch (e) {
      out.ok = false;
      out.error = (e as Error).message;
    }
    out.totalMs = Date.now() - t0;
    console.log(JSON.stringify(out));
  }
  console.log(`SCORE: ${passed}/5`);
})();
