import { describe, expect, it } from "vitest";
import { BLOCK_NODE_TYPES, DESIGN_BRAIN_NODE_TYPE, VOICE_NODE_TYPES } from "@coreai/shared";
import { cloneTemplateWorkflow, getTemplateBySlug, TEMPLATE_SEED } from "./templates";

/**
 * "Start with a Face" template graphs: each live face imports a fully wired,
 * working product — expected node types, palette-shaped node data, and edges
 * that all resolve to real nodes. Faces without a working engine (Video
 * Studio, Monitor) have NO template at all: they are disabled cards in the
 * builder sidebar, never importable half-products.
 */

type SeedNode = { id: string; data: Record<string, unknown>; position: { x: number; y: number } };
type SeedEdge = { id: string; source: string; target: string };

function graphOf(slug: string): { nodes: SeedNode[]; edges: SeedEdge[] } {
  const template = getTemplateBySlug(slug);
  expect(template, `template ${slug} exists`).toBeTruthy();
  return template!.workflowJson as unknown as { nodes: SeedNode[]; edges: SeedEdge[] };
}

function node(graph: { nodes: SeedNode[] }, id: string): SeedNode {
  const found = graph.nodes.find((candidate) => candidate.id === id);
  expect(found, `node ${id} exists`).toBeTruthy();
  return found!;
}

function edgePairs(graph: { edges: SeedEdge[] }): string[] {
  return graph.edges.map((edge) => `${edge.source}->${edge.target}`);
}

function expectEdgesResolve(graph: { nodes: SeedNode[]; edges: SeedEdge[] }): void {
  const ids = new Set(graph.nodes.map((candidate) => candidate.id));
  for (const edge of graph.edges) {
    expect(ids.has(edge.source), `edge source ${edge.source} resolves`).toBe(true);
    expect(ids.has(edge.target), `edge target ${edge.target} resolves`).toBe(true);
  }
}

describe("face template seeds", () => {
  it("registers the four live faces and nothing for engine-less faces", () => {
    for (const slug of ["chatbot", "voice-agent", "image-studio", "form-tool"]) {
      expect(getTemplateBySlug(slug)).toBeTruthy();
    }
    // Honest-scope law: no importable template may exist for these.
    expect(getTemplateBySlug("video-studio")).toBeUndefined();
    expect(getTemplateBySlug("monitor")).toBeUndefined();
    // Slugs stay unique across the whole seed.
    const slugs = TEMPLATE_SEED.map((template) => template.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("chatbot: Prompt Box → AI Brain (gemini) → Result Viewer → History Shelf, Design Brain styling", () => {
    const graph = graphOf("chatbot");
    expect(graph.nodes.map((candidate) => candidate.data.type)).toEqual([
      DESIGN_BRAIN_NODE_TYPE,
      BLOCK_NODE_TYPES.promptComposer,
      "ai.llm_call",
      BLOCK_NODE_TYPES.outputStage,
      BLOCK_NODE_TYPES.historyShelf
    ]);
    expectEdgesResolve(graph);
    expect(edgePairs(graph)).toEqual([
      "design-brain->prompt-box",
      "prompt-box->ai-brain",
      "ai-brain->result-viewer",
      "result-viewer->history-shelf"
    ]);

    const brain = node(graph, "ai-brain");
    expect(brain.data.nodeKind).toBe("ai");
    expect(brain.data.kind).toBe("AI Brain");
    expect(brain.data.llmProvider).toBe("gemini");
    expect(brain.data.llmModel).toBe("gemini-3.5-flash");
    expect(String(brain.data.llmSystemPrompt)).toContain("friendly");
    expect(brain.data.llmOutputKey).toBe("ai.output");

    const promptBox = node(graph, "prompt-box");
    expect(promptBox.data.nodeKind).toBe("block");
    expect(promptBox.data.kind).toBe("PRODUCT");
    expect(promptBox.data.accent).toBe("rose");
    expect(promptBox.data.placeholder).toBe("Ask me anything…");

    // Result Viewer keeps its flat config kind ("auto"), same as a palette drop.
    expect(node(graph, "result-viewer").data.kind).toBe("auto");
    expect(node(graph, "design-brain").data.kind).toBe("DESIGN");
  });

  it("voice-agent: mirrors the dental voice chain with generic business copy", () => {
    const graph = graphOf("voice-agent");
    expect(graph.nodes.map((candidate) => candidate.data.type)).toEqual([
      VOICE_NODE_TYPES.phoneCallTrigger,
      VOICE_NODE_TYPES.voiceConversation,
      VOICE_NODE_TYPES.calendarAvailability,
      VOICE_NODE_TYPES.bookAppointment,
      VOICE_NODE_TYPES.endFlow
    ]);
    expectEdgesResolve(graph);
    expect(edgePairs(graph)).toEqual([
      "phone-call->voice-conversation",
      "voice-conversation->calendar-availability",
      "calendar-availability->book-appointment",
      "book-appointment->end-flow"
    ]);

    const conversation = node(graph, "voice-conversation");
    expect(String(conversation.data.systemPrompt)).not.toMatch(/dental|dentist/i);
    expect(String(conversation.data.systemPrompt).length).toBeGreaterThan(0);
    expect(String(conversation.data.firstMessage).length).toBeGreaterThan(0);
    expect(node(graph, "phone-call").data.nodeKind).toBe("trigger");
    expect(String(node(graph, "end-flow").data.closingMessage).length).toBeGreaterThan(0);
  });

  it("image-studio: Prompt Box + Styles Gallery → AI Brain → Image Generation → Result Viewer → History Shelf", () => {
    const graph = graphOf("image-studio");
    expect(graph.nodes.map((candidate) => candidate.data.type)).toEqual([
      DESIGN_BRAIN_NODE_TYPE,
      BLOCK_NODE_TYPES.promptComposer,
      BLOCK_NODE_TYPES.presetGallery,
      "ai.llm_call",
      "ai.image_generation",
      BLOCK_NODE_TYPES.outputStage,
      BLOCK_NODE_TYPES.historyShelf
    ]);
    expectEdgesResolve(graph);
    expect(edgePairs(graph)).toEqual([
      "design-brain->prompt-box",
      "prompt-box->ai-brain",
      "styles-gallery->ai-brain",
      "ai-brain->image-generation",
      "image-generation->result-viewer",
      "result-viewer->history-shelf"
    ]);

    const gallery = node(graph, "styles-gallery");
    const presets = gallery.data.presets as Array<Record<string, unknown>>;
    expect(presets).toHaveLength(4);
    for (const preset of presets) {
      expect(typeof preset.id).toBe("string");
      expect(typeof preset.title).toBe("string");
      expect(typeof preset.emoji).toBe("string");
      expect(String(preset.promptFragment).length).toBeGreaterThan(0);
    }

    // Empty image prompt on purpose: the image step then uses the AI Brain output.
    const image = node(graph, "image-generation");
    expect(image.data.prompt).toBe("");
    expect(image.data.nodeKind).toBe("ai");
    expect(node(graph, "ai-brain").data.llmProvider).toBe("gemini");
  });

  it("form-tool: Prompt Box + Button → AI Brain (structured report) → Result Viewer", () => {
    const graph = graphOf("form-tool");
    expect(graph.nodes.map((candidate) => candidate.data.type)).toEqual([
      BLOCK_NODE_TYPES.promptComposer,
      BLOCK_NODE_TYPES.actionButton,
      "ai.llm_call",
      BLOCK_NODE_TYPES.outputStage
    ]);
    expectEdgesResolve(graph);
    expect(edgePairs(graph)).toEqual([
      "prompt-box->ai-brain",
      "create-button->ai-brain",
      "ai-brain->result-viewer"
    ]);

    expect(node(graph, "prompt-box").data.placeholder).toBe("Describe what you need");
    expect(node(graph, "create-button").data.label).toBe("Create my report");
    expect(String(node(graph, "ai-brain").data.llmSystemPrompt)).toContain("report");
  });

  it("clones face workflows without sharing object identity", () => {
    const template = getTemplateBySlug("chatbot")!;
    const clone = cloneTemplateWorkflow(template);
    expect(clone).toEqual(template.workflowJson);
    expect(clone).not.toBe(template.workflowJson);
    expect(clone.nodes[0]).not.toBe(template.workflowJson.nodes[0]);
  });
});
