import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATE_VARIABLES, VOICE_NODE_TYPES, getNodeDefinition } from "@coreai/shared";
import { workflowCapabilities } from "../agent-runtime/graph-runner";
import {
  APPROVED_CALLING_AGENT_NODE_TYPES,
  NON_CALLING_AGENT_NAMES,
  buildAllCallingAgentDraftDefinitions,
  buildCallingAgentDraftDefinitions,
  buildRemainingCallingAgentDraftDefinitions
} from "./calling-agent-drafts";
import { genericAssistantTools } from "./vapi-connector";

const existingNames = [
  "Travel Booking AI Assistant",
  "Tour Reservation AI Agent",
  "Event Coordination AI Agent",
  "Wedding Consultation AI Agent"
];

const remainingNames = [
  "Recruitment AI Assistant",
  "Candidate Screening AI Agent",
  "Internet Support AI Agent",
  "Telecom Customer Support AI",
  "AI Sales Development Representative (AI SDR)",
  "IT Support AI Assistant",
  "Customer Success AI Agent"
];

describe("calling-agent draft definitions", () => {
  const existingDefinitions = buildCallingAgentDraftDefinitions();
  const remainingDefinitions = buildRemainingCallingAgentDraftDefinitions();
  const allDefinitions = buildAllCallingAgentDraftDefinitions();

  it("keeps the four previously created Travel and Events agents separate", () => {
    expect(existingDefinitions.map((definition) => definition.name)).toEqual(existingNames);
  });

  it("defines exactly the seven remaining DOCX agents", () => {
    expect(remainingDefinitions.map((definition) => definition.name)).toEqual(remainingNames);
    expect(remainingDefinitions).toHaveLength(7);
  });

  it("covers every DOCX entry once and has no non-calling remainder", () => {
    expect(allDefinitions.map((definition) => definition.name)).toEqual([
      ...existingNames,
      ...remainingNames
    ]);
    expect(new Set(allDefinitions.map((definition) => definition.key)).size).toBe(11);
    expect(NON_CALLING_AGENT_NAMES).toEqual([]);
  });

  it.each(remainingDefinitions)("$name uses exactly the seven approved nodes in one connected chain", (definition) => {
    const nodes = definition.workflowJson.nodes;
    const nodeTypes = nodes.map((node) => String(node.data.type ?? ""));
    const nodeIds = nodes.map((node) => node.id);

    expect(nodeTypes).toEqual([...APPROVED_CALLING_AGENT_NODE_TYPES]);
    expect(new Set(nodeTypes).size).toBe(APPROVED_CALLING_AGENT_NODE_TYPES.length);

    for (const nodeType of nodeTypes) {
      const registryNode = getNodeDefinition(nodeType);
      expect(registryNode, nodeType).toBeDefined();
      expect(registryNode?.comingSoon, nodeType).toBe(false);
    }

    expect(definition.workflowJson.edges).toHaveLength(nodes.length - 1);
    expect(definition.workflowJson.edges.map((edge) => [edge.source, edge.target])).toEqual(
      nodeIds.slice(0, -1).map((source, index) => [source, nodeIds[index + 1]])
    );

    expect(workflowCapabilities(definition.workflowJson)).toEqual({
      canCheckAvailability: true,
      canBook: true,
      canText: true,
      canEmail: true,
      hasEnd: true,
      hasAi: true
    });
  });

  it.each(remainingDefinitions)("$name has deployable integrations, prompts, email, and SMS", (definition) => {
    expect(definition.configure.template.requiredIntegrations).toMatchObject({
      phone: true,
      calendar: true,
      email: true,
      vapi: true,
      twilio: true,
      sms: true
    });
    expect(definition.configure.template.requiredBuyerSetup.length).toBeGreaterThanOrEqual(10);

    const voice = definition.workflowJson.nodes.find(
      (node) => node.data.type === VOICE_NODE_TYPES.voiceConversation
    );
    expect(voice?.data.model).toBe("gpt-4o-mini");
    expect(String(voice?.data.systemPrompt)).toContain("lookup_knowledge");
    expect(String(voice?.data.systemPrompt)).toContain("Never invent");

    const email = definition.workflowJson.nodes.find(
      (node) => node.data.type === VOICE_NODE_TYPES.sendEmail
    );
    const html = String(email?.data.htmlTemplate ?? "");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("{{appointmentDate}}");
    expect(html).toContain("{{appointmentTime}}");
    const emailVariables = [...html.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map(
      (match) => match[1]
    );
    expect(emailVariables.every((name) => EMAIL_TEMPLATE_VARIABLES.includes(name as never))).toBe(true);

    const sms = definition.workflowJson.nodes.find(
      (node) => node.data.type === VOICE_NODE_TYPES.sendSms
    );
    expect(sms?.data.sendToCustomer).toBe("true");
    expect(sms?.data.sendToTeam).toBe("false");
    expect(String(sms?.data.customerTemplate)).toContain("{{appointment.date}}");
    expect(String(sms?.data.customerTemplate)).toContain("{{appointment.time}}");
  });

  it("gives Candidate Screening a neutral intake boundary", () => {
    const candidate = remainingDefinitions.find(
      (definition) => definition.name === "Candidate Screening AI Agent"
    );
    const prompt = String(
      candidate?.workflowJson.nodes.find(
        (node) => node.data.type === VOICE_NODE_TYPES.voiceConversation
      )?.data.systemPrompt ?? ""
    );

    expect(prompt).toContain("Never rank, score, recommend, reject");
    expect(prompt).toContain("make a hiring decision");
    expect(prompt).toContain("protected characteristics");
  });

  it("keeps the AI SDR inbound and non-transactional", () => {
    const sales = remainingDefinitions.find(
      (definition) => definition.name === "AI Sales Development Representative (AI SDR)"
    );
    const prompt = String(
      sales?.workflowJson.nodes.find(
        (node) => node.data.type === VOICE_NODE_TYPES.voiceConversation
      )?.data.systemPrompt ?? ""
    );

    expect(prompt).toContain("inbound AI Sales Development Representative");
    expect(prompt).toContain("Do not perform outbound cold calling");
  });

  it("lets the voice assistant pass a confirmed customer email to send_notification", () => {
    const sendNotification = genericAssistantTools().find(
      (tool) => tool.function.name === "send_notification"
    );
    const parameters = sendNotification?.function.parameters as {
      properties?: Record<string, unknown>;
    };

    expect(parameters.properties).toHaveProperty("customer_email");
  });
});
