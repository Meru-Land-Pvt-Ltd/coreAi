import { describe, expect, test } from "vitest";
import { runAgentWorkflow } from "./graph-runner";
import { deliverMemoryToAiConfig, setMemoryScopeForContext } from "../architect/workflow-runner";
import type { AgentProviders } from "./provider-adapters";
import type { AiBrainNodeConfig } from "../memory";

/**
 * The builder adds a Memory Node and connects it — nothing else. These tests
 * prove the AI receives the memory automatically, with no {{memory}} anywhere
 * in any node prompt.
 */

function makeProviders(capture: { systemPrompts: string[] }): AgentProviders {
  return {
    mode: "architect_test",
    telephonyEnabled: false,
    calendar: {
      async checkAvailability() {
        return { slots: [], source: "test" as const, note: "" };
      },
      async bookAppointment() {
        return { booked: false, note: "test" } as never;
      }
    },
    sms: {
      async send() {
        return { sent: false, note: "test" } as never;
      }
    },
    llm: {
      async complete(input) {
        capture.systemPrompts.push(input.systemPrompt);
        return "Thanks for calling! How can I help?";
      }
    }
  };
}

const WORKFLOW_JSON = {
  nodes: [
    { id: "trigger-1", data: { type: "trigger.phone_call", nodeKind: "trigger", title: "Call Trigger" } },
    {
      id: "memory-1",
      data: {
        type: "ai.memory",
        nodeKind: "ai",
        title: "Memory Node",
        customMemoryNotes: "VIP caller: always offer the free first consult."
      }
    },
    {
      id: "voice-1",
      data: {
        type: "ai.voice_conversation",
        nodeKind: "ai",
        title: "AI Receptionist",
        // NOTE: no {{memory}} anywhere — delivery must be automatic.
        prompt: "Help the caller book an appointment."
      }
    }
  ],
  edges: [
    { id: "e1", source: "trigger-1", target: "memory-1" },
    { id: "e2", source: "memory-1", target: "voice-1" }
  ]
};

const BUSINESS = {
  name: "Smile Dental",
  type: "dental clinic",
  assistantName: "Ava",
  timezone: "America/New_York",
  calendarId: "primary",
  appointmentService: "Checkup",
  services: ["Checkup"],
  faqs: []
};

describe("automatic memory delivery — conversation runtime", () => {
  test("the AI system prompt receives Memory Node output without {{memory}} in any node", async () => {
    const capture = { systemPrompts: [] as string[] };

    const result = await runAgentWorkflow({
      workflowId: "wf_test",
      workflowJson: WORKFLOW_JSON,
      mode: "architect_test",
      input: {
        channel: "browser_voice",
        event: "user_message",
        message: "Hi, do you do implants?",
        history: [],
        business: BUSINESS,
        caller: { name: "Jordan", phone: "+15550100" },
        memoryIdentity: { architectUserId: "user_arch_1", testSessionId: "sess_1" }
      },
      providers: makeProviders(capture)
    });

    expect(result.reply).toBeTruthy();
    expect(capture.systemPrompts).toHaveLength(1);
    const systemPrompt = capture.systemPrompts[0];
    expect(systemPrompt).toContain("Memory from earlier workflow steps");
    expect(systemPrompt).toContain("=== MEMORY ===");
    expect(systemPrompt).toContain("VIP caller: always offer the free first consult.");
  });

  test("workflows without a Memory Node get no memory section (unchanged behaviour)", async () => {
    const capture = { systemPrompts: [] as string[] };
    const withoutMemory = {
      nodes: WORKFLOW_JSON.nodes.filter((node) => node.id !== "memory-1"),
      edges: [{ id: "e1", source: "trigger-1", target: "voice-1" }]
    };

    await runAgentWorkflow({
      workflowId: "wf_test",
      workflowJson: withoutMemory,
      mode: "architect_test",
      input: {
        channel: "browser_voice",
        event: "user_message",
        message: "Hi!",
        history: [],
        business: BUSINESS,
        caller: { name: "Jordan", phone: "+15550100" }
      },
      providers: makeProviders(capture)
    });

    expect(capture.systemPrompts[0]).not.toContain("Memory from earlier workflow steps");
  });
});

describe("automatic memory delivery — workflow runner AI nodes", () => {
  const RAW = "=== MEMORY ===\n\n[PREVIOUS STEPS]\n[Research]\nImplant pricing research";

  function makeContext(): Record<string, unknown> {
    const context: Record<string, unknown> = { memory: RAW };
    setMemoryScopeForContext(context as never, "biz:b1|wf:w1|node:m1|run:r1");
    return context;
  }

  test("AI Brain with no {{memory}} reference receives memory via llmContext", async () => {
    const config: AiBrainNodeConfig = {
      id: "brain-1",
      nodeType: "ai.brain",
      nodeLabel: "Brain",
      data: { instructions: "Summarize the research for the customer." }
    };

    await deliverMemoryToAiConfig(config, makeContext() as never);

    const data = config.data as Record<string, unknown>;
    expect(String(data.llmContext)).toContain(RAW);
    expect(String(data.llmContext)).toContain("provided automatically");
    // The builder's own instruction text is untouched.
    expect(data.instructions).toBe("Summarize the research for the customer.");
  });

  test("builder-placed {{memory}} expansion is respected, not duplicated", async () => {
    const config: AiBrainNodeConfig = {
      id: "brain-1",
      nodeType: "ai.llm_call",
      nodeLabel: "Brain",
      data: { prompt: `Write a reply using:\n${RAW}` }
    };

    await deliverMemoryToAiConfig(config, makeContext() as never);

    const data = config.data as Record<string, unknown>;
    expect(data.llmContext ?? "").not.toContain("=== MEMORY ===");
    expect(String(data.prompt).match(/=== MEMORY ===/g)?.length).toBe(1);
  });

  test("two AI Brains each get their own delivery (config objects stay independent)", async () => {
    const context = makeContext();
    const brainA: AiBrainNodeConfig = { id: "a", nodeType: "ai.brain", nodeLabel: "A", data: { instructions: "Task A" } };
    const brainB: AiBrainNodeConfig = { id: "b", nodeType: "ai.brain", nodeLabel: "B", data: { instructions: "Task B" } };

    await deliverMemoryToAiConfig(brainA, context as never);
    await deliverMemoryToAiConfig(brainB, context as never);

    expect(String((brainA.data as Record<string, unknown>).llmContext)).toContain(RAW);
    expect(String((brainB.data as Record<string, unknown>).llmContext)).toContain(RAW);
    expect((brainA.data as Record<string, unknown>).instructions).toBe("Task A");
    expect((brainB.data as Record<string, unknown>).instructions).toBe("Task B");
  });

  test("no memory scope on the run means configs are untouched", async () => {
    const config: AiBrainNodeConfig = { id: "x", nodeType: "ai.brain", nodeLabel: "X", data: { instructions: "Task" } };
    await deliverMemoryToAiConfig(config, {} as never);
    expect((config.data as Record<string, unknown>).llmContext).toBeUndefined();
  });

  test("a workflow-writable context key can NEVER redirect the memory scope", async () => {
    // llmOutputKey lets workflows write arbitrary context keys; the scope must
    // live outside the context bag so this cannot become a bearer token.
    const forged: Record<string, unknown> = {
      memory: RAW,
      _memoryScopeKey: "biz:VICTIM|agent:VICTIM|node:m1|caller:+1555"
    };
    const config: AiBrainNodeConfig = { id: "x", nodeType: "ai.brain", nodeLabel: "X", data: { instructions: "Task" } };
    await deliverMemoryToAiConfig(config, forged as never);
    expect((config.data as Record<string, unknown>).llmContext).toBeUndefined();
  });
});
