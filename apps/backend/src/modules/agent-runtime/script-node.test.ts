import { SCRIPT_NODE_TYPE, getNodeDefinition } from "@coreai/shared";
import { describe, expect, test } from "vitest";
import { executeNode } from "./node-handlers";
import { nodeCapability } from "./tool-registry";
import type { AgentRuntimeContext } from "./runtime-context";
import type { AgentProviders } from "./provider-adapters";

function runtimeContext(): AgentRuntimeContext {
  return {
    mode: "architect_test",
    channel: "phone_call",
    workflowId: "wf-script",
    currentNodeId: "",
    userMessage: "my name is Sarah",
    history: [],
    variables: { "customer.name": "Sarah", service: "Cleaning" },
    business: {
      name: "Bright Smile Dental",
      type: "Dental Practice",
      assistantName: "Ruby",
      timezone: "America/New_York",
      calendarId: "primary",
      appointmentService: "Cleaning",
      services: ["Cleaning"],
      faqs: []
    },
    caller: { phone: "+15550100", name: "Sarah" },
    conversation: {
      schedulingIntent: false,
      currentContributes: true,
      ending: false,
      detailsComplaint: false,
      vagueQuestion: false,
      collectedName: "Sarah",
      collectedPhone: "+15550100",
      requestedService: "Cleaning",
      requestedDate: "2026-08-20",
      lastTimeMessage: ""
    },
    turn: {
      bookedThisTurn: false,
      smsThisTurn: false,
      slotsOffered: false,
      missingVariables: [],
      endReached: false
    },
    executedNodes: [],
    toolCalls: []
  };
}

/* Providers are untouched by a Code node; the cast keeps the fixture to the
   one thing under test rather than a full adapter double. */
const providers = {} as AgentProviders;

describe("Code node in the conversation runtime", () => {
  test("resolves to its own capability rather than falling through to logic.condition", () => {
    expect(getNodeDefinition(SCRIPT_NODE_TYPE)?.capability).toBe(SCRIPT_NODE_TYPE);
    expect(nodeCapability({ id: "n1", data: { type: SCRIPT_NODE_TYPE, nodeKind: "condition" } })).toBe(
      SCRIPT_NODE_TYPE
    );
  });

  test("writes the script result into the variable map under the configured key", async () => {
    const context = runtimeContext();

    const result = await executeNode(
      {
        id: "node-code-1",
        data: {
          type: SCRIPT_NODE_TYPE,
          title: "Split name",
          scriptLanguage: "javascript",
          scriptCode: `const [first] = String(input["customer.name"]).split(" "); return { first, service: input.service };`,
          scriptOutputKey: "greeting.parts"
        }
      },
      context,
      providers
    );

    expect(result.status).toBe("executed");
    expect(context.variables["greeting.parts"]).toEqual({ first: "Sarah", service: "Cleaning" });
    expect(context.variables["node.node-code-1.output"]).toEqual({ first: "Sarah", service: "Cleaning" });
    expect(context.executedNodes.at(-1)).toMatchObject({ nodeId: "node-code-1", status: "success" });
  });

  test("sees the latest user message alongside the collected variables", async () => {
    const context = runtimeContext();

    await executeNode(
      {
        id: "node-code-2",
        data: {
          type: SCRIPT_NODE_TYPE,
          scriptCode: `return input["conversation.latest_user_message"];`
        }
      },
      context,
      providers
    );

    expect(context.variables["script.output"]).toBe("my name is Sarah");
  });

  test("marks the node failed and logs the error when the script throws", async () => {
    const context = runtimeContext();

    const result = await executeNode(
      {
        id: "node-code-3",
        data: { type: SCRIPT_NODE_TYPE, scriptCode: `throw new Error("no calendar id");` }
      },
      context,
      providers
    );

    expect(result.status).toBe("failed");
    expect(context.executedNodes.at(-1)).toMatchObject({ status: "error" });
    expect(context.executedNodes.at(-1)?.message).toContain("no calendar id");
    expect(context.variables["script.output"]).toBeUndefined();
  });
});
