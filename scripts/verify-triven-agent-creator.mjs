import assert from "node:assert/strict";
import {
  deriveRequiredIntegrationsFromWorkflow,
  getNodeDefinition,
  normalizeAgentConfigure,
  TRIVEN_AGENT_TAXONOMY_ENTRIES,
  validateBuyerSetupAnswers,
  validateBuyerSetupFields,
  validateConfigureForSubmit
} from "../packages/shared/dist/index.js";
import {
  AGENTS,
  buildTagline,
  configure,
  loadAgentIconDataUrl,
  makeWorkflow,
  resolveIconDirectory,
  systemPrompt
} from "./triven_agent_creator.mjs";

const EXPECTED_NODE_TYPES = [
  "trigger.phone_call",
  "ai.voice_conversation",
  "calendar.availability",
  "calendar.book_appointment",
  "communication.send_sms",
  "flow.end"
];

const expectedTaxonomy = new Map(
  TRIVEN_AGENT_TAXONOMY_ENTRIES.map((entry) => [entry.agentName, entry])
);
const iconDirectory = resolveIconDirectory();
const taglines = new Set();
const fullDescriptions = new Set();
const shortDescriptions = new Set();

assert.equal(AGENTS.length, 25, "The creator must define exactly 25 agents");
assert.equal(new Set(AGENTS.map((agent) => agent.name)).size, 25, "Agent names must be unique");
assert.equal(new Set(AGENTS.map((agent) => `${agent.industry}/${agent.subindustry}`)).size, 25, "Industry targets must be unique");

for (const agent of AGENTS) {
  const taxonomy = expectedTaxonomy.get(agent.name);
  assert.ok(taxonomy, `${agent.name} must exist in the shared taxonomy`);
  assert.equal(agent.industry, taxonomy.industry, `${agent.name} industry must match the taxonomy`);
  assert.equal(agent.subindustry, taxonomy.subindustry, `${agent.name} subindustry must match the taxonomy`);

  const tagline = buildTagline(agent);
  assert.ok(!taglines.has(tagline.toLowerCase()), `${agent.name} tagline must be unique`);
  taglines.add(tagline.toLowerCase());

  const description = String(agent.fullDescription).trim();
  assert.ok(description.length >= 100 && description.length <= 2000, `${agent.name} description length is invalid`);
  assert.ok(!fullDescriptions.has(description.toLowerCase()), `${agent.name} full description must be unique`);
  fullDescriptions.add(description.toLowerCase());

  const icon = loadAgentIconDataUrl(agent, iconDirectory);
  assert.ok(icon.dataUrl.startsWith("data:image/"), `${agent.name} icon must be an image data URL`);

  const workflow = makeWorkflow(agent);
  const nodeTypes = workflow.nodes.map((node) => node.data.type);
  const nodeIds = workflow.nodes.map((node) => node.id);
  assert.deepEqual(nodeTypes, EXPECTED_NODE_TYPES, `${agent.name} must use the approved voice-booking flow`);
  assert.equal(new Set(nodeIds).size, nodeIds.length, `${agent.name} node ids must be unique`);
  assert.deepEqual(
    workflow.edges.map((edge) => [edge.source, edge.target]),
    nodeIds.slice(0, -1).map((source, index) => [source, nodeIds[index + 1]]),
    `${agent.name} graph must be one connected chain`
  );
  for (const nodeType of nodeTypes) {
    const definition = getNodeDefinition(nodeType);
    assert.ok(definition, `${agent.name} uses unknown node ${nodeType}`);
    assert.equal(definition.comingSoon, false, `${agent.name} uses unavailable node ${nodeType}`);
  }

  const integrations = deriveRequiredIntegrationsFromWorkflow(workflow);
  assert.deepEqual(
    integrations,
    {
      phone: true,
      sms: true,
      calendar: true,
      email: false,
      crm: false,
      webhook: false,
      telegram: false,
      vapi: true,
      twilio: true,
      whatsapp: false
    },
    `${agent.name} integration requirements must match its graph`
  );

  const draft = normalizeAgentConfigure(
    configure(agent, workflow, icon.dataUrl, true),
    { name: agent.name, tagline, description, workflowJson: workflow }
  );
  assert.deepEqual(validateConfigureForSubmit(draft), [], `${agent.name} must pass publish validation`);
  assert.equal(draft.basics.category, agent.subindustry);
  assert.ok(draft.basics.industryTags.includes(agent.industry), `${agent.name} must retain its parent industry`);
  assert.ok(draft.basics.industryTags.includes(agent.subindustry), `${agent.name} must retain its exact subindustry`);
  assert.equal(draft.media.fullDescription, description);
  assert.ok(!shortDescriptions.has(draft.basics.shortDescription.toLowerCase()), `${agent.name} short description must be unique`);
  shortDescriptions.add(draft.basics.shortDescription.toLowerCase());

  assert.deepEqual(validateBuyerSetupFields(draft.template.requiredBuyerSetup), [], `${agent.name} setup schema must be valid`);
  const validAnswers = draft.template.requiredBuyerSetup.map((field) => ({
    key: field.key,
    label: field.label,
    value:
      field.type === "phone" ? "+1 617 555 0134" :
      field.type === "email" ? "team@example.com" :
      field.type === "number" ? 30 :
      field.type === "boolean" ? true :
      field.type === "multiselect" ? [field.options?.[0] ?? "Configured"] :
      field.type === "select" ? field.options?.[0] ?? "Configured" :
      field.type === "url" ? "https://example.com" :
      field.type === "date" ? "2026-08-20" :
      field.type === "time" ? "10:30" :
      "Configured value"
  }));
  assert.deepEqual(
    validateBuyerSetupAnswers(draft.template.requiredBuyerSetup, validAnswers, { requireMissing: true }),
    [],
    `${agent.name} setup schema must accept complete buyer answers`
  );

  const prompt = systemPrompt(agent);
  assert.ok(prompt.includes(agent.purpose), `${agent.name} prompt must carry its specific purpose`);
  assert.ok(prompt.includes("Never invent"), `${agent.name} prompt must prohibit fabricated facts`);
  assert.ok(prompt.includes("SMS consent disclosure"), `${agent.name} prompt must enforce SMS consent`);
  if (agent.industry === "Healthcare") {
    assert.ok(prompt.includes("Do not diagnose"), `${agent.name} must keep a clinical safety boundary`);
  }
  if (agent.industry === "Legal") {
    assert.ok(prompt.includes("Do not provide legal advice"), `${agent.name} must keep a legal safety boundary`);
  }
  if (agent.industry === "Real Estate") {
    assert.ok(prompt.includes("Do not guarantee property availability"), `${agent.name} must keep a property accuracy boundary`);
  }
  if (agent.industry === "Automotive") {
    assert.ok(prompt.includes("Do not guarantee inventory"), `${agent.name} must keep an inventory accuracy boundary`);
  }
}

assert.equal(taglines.size, 25);
assert.equal(fullDescriptions.size, 25);
assert.equal(shortDescriptions.size, 25);
console.log("Triven agent creator production contract: PASS (25/25 workflows, copy, setup, icons, and safety)");
