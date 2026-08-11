import { describe, expect, test } from "vitest";
import { buildCompactMemoryString } from "../memory/memory-compression";
import { executeNode } from "./node-handlers";
import { createDefaultRuntimeContext, type AgentRuntimeContext } from "./runtime-context";

describe("Memory Node Deterministic Aggregation", () => {
  test("buildCompactMemoryString formats previous steps, documents, and facts correctly", () => {
    const memoryText = buildCompactMemoryString({
      executedNodes: [
        { nodeId: "node-1", label: "Phone Trigger", status: "executed", message: "Call from +15550100" },
        { nodeId: "node-2", label: "AI Brain", status: "executed", output: { intent: "booking", service: "Teeth Cleaning" } }
      ],
      variables: {
        "caller.phone": "+15550100",
        "customer.name": "Sarah Jenkins",
        service: "Teeth Cleaning"
      },
      attachments: [
        { name: "policy.pdf", data: "24h cancellation notice required" }
      ],
      customNotes: "Patient prefers morning appointments"
    });

    expect(memoryText).toContain("=== MEMORY ===");
    expect(memoryText).toContain("[DOCUMENTS]");
    expect(memoryText).toContain("Notes: Patient prefers morning appointments");
    expect(memoryText).toContain("policy.pdf: 24h cancellation notice required");
    expect(memoryText).toContain("[PREVIOUS STEPS]");
    expect(memoryText).toContain("[Phone Trigger]\nCall from +15550100");
    expect(memoryText).toContain("[AI Brain]\nIntent: booking\nService: Teeth Cleaning");
    expect(memoryText).toContain("[KEY VARIABLES]");
    expect(memoryText).toContain("service: Teeth Cleaning");
  });

  test("executeNode executes ai.memory and stores memory in runtime context", async () => {
    const context: AgentRuntimeContext = {
      mode: "architect_test",
      channel: "phone_call",
      workflowId: "wf-1",
      currentNodeId: "",
      userMessage: "I want to book an appointment",
      history: [],
      variables: {},
      business: {
        name: "Dental Clinic",
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
        schedulingIntent: true,
        currentContributes: true,
        ending: false,
        detailsComplaint: false,
        vagueQuestion: false,
        collectedName: "Sarah",
        collectedPhone: "+15550100",
        requestedService: "Cleaning",
        requestedDate: "2026-07-26",
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

    context.executedNodes.push({
      nodeId: "trigger-1",
      label: "Phone Call Trigger",
      status: "executed",
      message: "Call received"
    });

    const memoryNode = {
      id: "node-memory-1",
      data: {
        type: "ai.memory",
        title: "Memory Node",
        customMemoryNotes: "Important: Verify insurance before booking",
        attachments: [
          { name: "pricing.txt", data: "Cleaning: $120" }
        ]
      }
    };

    const mockProviders: any = {};

    const result = await executeNode(memoryNode, context, mockProviders);

    expect(result.status).toBe("executed");
    expect(context.variables["memory"]).toBeDefined();
    const memoryVar = context.variables["memory"] as string;
    expect(memoryVar).toContain("=== MEMORY ===");
    expect(memoryVar).toContain("Important: Verify insurance before booking");
    expect(memoryVar).toContain("pricing.txt: Cleaning: $120");
    expect(memoryVar).toContain("[Phone Call Trigger]\nCall received");
  });
});
