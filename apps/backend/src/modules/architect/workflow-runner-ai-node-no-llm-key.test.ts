import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest, type WorkflowRunLog } from "./workflow-runner";

const RUN = `ainokey-${process.pid}-${Date.now().toString(36)}`;

const LLM_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY"
] as const;

let dbAvailable = false;
let userId = "";
let workflowId = "";

const workflowJson = {
  nodes: [
    {
      id: "trigger-1",
      data: { label: "Incoming Event", nodeKind: "trigger", type: "trigger.missed_call" }
    },
    {
      id: "ai-1",
      data: {
        label: "AI Brain",
        nodeKind: "ai",
        type: "ai.brain",
        provider: "openai",
        model: "gpt-4o",
        prompt: "Write a friendly missed-call text-back message."
      }
    }
  ],
  edges: [{ id: "e1", source: "trigger-1", target: "ai-1" }]
};

const saved = new Map<string, { env: unknown; process: string | undefined }>();

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[workflow-runner-ai-node-no-llm-key.test] database unreachable — suite skipped");
    return;
  }

  const user = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "ARCHITECT" }
  });
  userId = user.id;

  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: userId,
      name: `${RUN} ai node workflow`,
      workflowJson: workflowJson as never
    }
  });
  workflowId = workflow.id;
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    if (workflowId) await prisma.workflowDefinition.deleteMany({ where: { id: workflowId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

beforeEach(() => {
  for (const key of LLM_KEYS) {
    saved.set(key, { env: (env as Record<string, unknown>)[key], process: process.env[key] });
    (env as Record<string, unknown>)[key] = undefined;
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of LLM_KEYS) {
    const previous = saved.get(key);
    (env as Record<string, unknown>)[key] = previous?.env;
    if (previous?.process === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous.process;
    }
  }
});

describe("AI node dry run with no LLM key configured", () => {
  it("falls back to a scripted reply instead of the provider SDK credential error", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const result = await runWorkflowTest({
      userId,
      workflowId,
      workflowJson,
      mode: "test",
      input: {
        callerName: "Jordan Lee",
        callerNumber: "+15550000000",
        businessName: "Sample Business",
        businessType: "Dental Practice"
      }
    });

    const logs = result.logs as WorkflowRunLog[];
    const messages = logs.map((log) => log.message).join("\n");
    expect(messages).not.toContain("Missing credentials");
    expect(messages).not.toContain("apiKey");

    const aiLog = logs.find((log) => log.nodeId === "ai-1");
    expect(aiLog?.status).toBe("success");
    expect(aiLog?.message).toContain("Simulated reply");
    expect(aiLog?.message).toContain("OPENAI_API_KEY");

    const aiOutput = (result.context.ai as { output?: string } | undefined)?.output ?? "";
    expect(aiOutput).toContain("Sample Business");
  });

  it("fails a live run with the actionable message, not the raw SDK error", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const result = await runWorkflowTest({
      userId,
      workflowId,
      workflowJson,
      mode: "live",
      input: {
        callerName: "Jordan Lee",
        callerNumber: "+15550000000",
        businessName: "Sample Business"
      }
    });

    const aiLog = (result.logs as WorkflowRunLog[]).find((log) => log.nodeId === "ai-1");
    expect(aiLog?.status).toBe("error");
    expect(aiLog?.message).toContain("No LLM provider key is configured");
    expect(aiLog?.message).not.toContain("Missing credentials");
  });
});
