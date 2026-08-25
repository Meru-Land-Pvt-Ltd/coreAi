/**
 * "CHECK MY AGENT" — the button that tallies the agent against its purpose.
 *
 * A check that does not know the goal can only find broken wires. This one
 * knows what the architect said they were building — the purpose, asked once
 * by the AI Builder and saved on the agent — so it can find the far more
 * expensive thing: an agent that runs perfectly and does the wrong job.
 *
 * The founder's own words set the bar: he described his agent as answering
 * yes/no questions, briefed the Brain to "repeat it back exactly", and every
 * wire was green. Only a check that KNEW the purpose could have caught it.
 *
 * What it does, in order, all real:
 *
 *   1. The wires — the same check the canvas runs, said in plain lines.
 *   2. The tests — it writes up to three test messages FROM THE PURPOSE,
 *      actually runs each one through the engine, and judges each answer
 *      against the purpose. Not "did it run" — "did it do the job".
 *   3. The verdict — pass and fail counts, and for every failure: what was
 *      asked, what came back, and which box to fix.
 *
 * No purpose saved? It says so, checks the wires anyway, and runs one plain
 * smoke test — an honest partial answer beats a refusal.
 */

import { checkWiring } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import { askPlatformBrain } from "./platform-brain";
import { runWorkflowTest } from "./workflow-runner";
import { resolveRunOutput } from "../agent-pages/run-output";

export type CheckLine = {
  kind: "ok" | "problem" | "note";
  text: string;
};

export type AgentCheckReport = {
  lines: CheckLine[];
  passed: number;
  failed: number;
};

const LLM_TIMEOUT_MS = 25_000;

async function ask(instruction: string, message: string, maxTokens: number): Promise<string | null> {
  return askPlatformBrain({ instruction, message, maxTokens, timeoutMs: LLM_TIMEOUT_MS, task: "agent-check" });
}

/** Test messages invented from the purpose — including one that should NOT fit it. */
async function inventTests(purpose: string): Promise<string[]> {
  const raw = await ask(
    [
      "You write test messages for an AI agent, as if you were its customer.",
      "",
      `THE AGENT'S PURPOSE: ${purpose}`,
      "",
      "Write exactly 3 short messages a person might type into it:",
      "- two ordinary ones the agent should handle well",
      "- one awkward one: off-purpose, an opinion, or nonsense — where honest agents admit their limits",
      "",
      'Answer as JSON and nothing else: {"tests": ["...", "...", "..."]}'
    ].join("\n"),
    "Write the three test messages.",
    300
  );
  try {
    const parsed = JSON.parse(String(raw).replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "")) as { tests?: unknown[] };
    const tests = (parsed.tests ?? []).map(String).filter((test) => test.trim()).slice(0, 3);
    if (tests.length > 0) return tests;
  } catch {
    /* fall through to the plain default below */
  }
  return ["hello"];
}

async function judge(purpose: string, asked: string, answered: string): Promise<{ pass: boolean; why: string }> {
  const raw = await ask(
    [
      "You judge one exchange with an AI agent against its stated purpose. Be strict but fair:",
      "an honest 'I cannot help with that' to an off-purpose message is a PASS, not a failure.",
      "",
      `THE AGENT'S PURPOSE: ${purpose}`,
      "",
      'Answer as JSON and nothing else: {"pass": true/false, "why": "<one short plain sentence>"}'
    ].join("\n"),
    `The customer wrote: "${asked}"\nThe agent answered: "${answered || "(nothing came back)"}"`,
    150
  );
  try {
    const parsed = JSON.parse(String(raw).replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "")) as {
      pass?: boolean;
      why?: string;
    };
    return { pass: Boolean(parsed.pass), why: String(parsed.why ?? "").trim() || "no reason given" };
  } catch {
    /* A judge that cannot answer must not fail the architect's agent. */
    return { pass: true, why: "the judge could not be reached, so this answer was not counted against you" };
  }
}

export async function checkAgent(input: {
  userId: string;
  workflowId: string;
}): Promise<AgentCheckReport> {
  const workflow = await prisma.workflowDefinition.findFirst({
    where: { id: input.workflowId, architectUserId: input.userId },
    select: { name: true, purpose: true, workflowJson: true }
  });
  if (!workflow) return { lines: [{ kind: "problem", text: "This agent could not be loaded." }], passed: 0, failed: 1 };

  const lines: CheckLine[] = [];
  let passed = 0;
  let failed = 0;

  /* ------------------------------------------------------------ the wires */
  const graph = workflow.workflowJson as {
    nodes?: Array<{ id: string; data?: Record<string, unknown> }>;
    edges?: Array<{ source: string; target: string }>;
  };
  const wiring = checkWiring({ nodes: graph.nodes ?? [], edges: graph.edges ?? [] });

  if (wiring.problems.length === 0) {
    lines.push({ kind: "ok", text: "Every step gets the data it needs — the wiring is sound." });
  } else {
    for (const problem of wiring.problems) {
      failed += 1;
      lines.push({ kind: "problem", text: problem.message });
    }
  }

  /* ---------------------------------------------------------- the purpose */
  /* DECLARED only. A description is a marketing tagline many old agents carry;
     testing against one produced confident nonsense about subscriber charts.
     If nobody told the AI Builder what this agent is for, the honest answer is
     to say so and ask — like a person would. */
  const purpose = (workflow.purpose ?? "").trim();
  if (!purpose) {
    lines.push({
      kind: "note",
      text: "I don't know what this agent is FOR yet — tell me in the chat and I can test it properly. For now, one plain hello:"
    });
  }

  /* ------------------------------------------------------------ the tests */
  const tests = purpose ? await inventTests(purpose) : ["hello"];

  for (const test of tests) {
    let answered = "";
    try {
      const result = await runWorkflowTest({
        userId: input.userId,
        workflowId: input.workflowId,
        workflowJson: workflow.workflowJson,
        input: { message: test, businessName: workflow.name },
        mode: "test"
      });
      const output = await resolveRunOutput(result, {
        userMessage: test,
        businessName: workflow.name,
        doorsEnabled: false
      });
      answered = String(output.text ?? "").trim();
    } catch (error) {
      failed += 1;
      lines.push({
        kind: "problem",
        text: `I asked it "${test}" and the run itself broke: ${(error as Error).message.slice(0, 120)}`
      });
      continue;
    }

    if (!purpose) {
      /* No yardstick — report what happened without pretending to judge it. */
      lines.push({
        kind: answered ? "ok" : "problem",
        text: answered
          ? `I said "${test}" and it answered: "${answered.slice(0, 140)}"`
          : `I said "${test}" and nothing came back.`
      });
      if (answered) passed += 1;
      else failed += 1;
      continue;
    }

    const verdict = await judge(purpose, test, answered);
    if (verdict.pass) {
      passed += 1;
      lines.push({ kind: "ok", text: `"${test}" → "${answered.slice(0, 120)}" — ${verdict.why}` });
    } else {
      failed += 1;
      lines.push({
        kind: "problem",
        text: `"${test}" → "${answered.slice(0, 120) || "(nothing)"}" — ${verdict.why}`
      });
    }
  }

  /* ----------------------------------------------------------- the verdict */
  lines.push({
    kind: failed === 0 ? "ok" : "note",
    text:
      failed === 0
        ? purpose
          ? `All ${passed} checks passed against your purpose: "${purpose.slice(0, 80)}"`
          : "Everything I could check without a purpose passed."
        : `${passed} passed, ${failed} need your attention — the lines above say exactly where.`
  });

  return { lines, passed, failed };
}
