import { describe, expect, it } from "vitest";
import {
  analyzeWorkflowGraph,
  BLOCK_NODE_TYPES,
  DESIGN_BRAIN_NODE_TYPE,
  hasNodeDoors,
  nodeDoorsEnabled,
  VOICE_NODE_TYPES
} from "@coreai/shared";
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

  it("image-studio: Prompt Box + Styles Gallery → Image Generation → Result Viewer → History Shelf", () => {
    const graph = graphOf("image-studio");
    // No prompt-writing brain: turning the customer's words and their chosen
    // style into the picture request is door work, not a canvas node.
    expect(graph.nodes.map((candidate) => candidate.data.type)).toEqual([
      DESIGN_BRAIN_NODE_TYPE,
      BLOCK_NODE_TYPES.promptComposer,
      BLOCK_NODE_TYPES.presetGallery,
      "ai.image_generation",
      BLOCK_NODE_TYPES.outputStage,
      BLOCK_NODE_TYPES.historyShelf
    ]);
    expectEdgesResolve(graph);
    expect(edgePairs(graph)).toEqual([
      "design-brain->prompt-box",
      "prompt-box->image-generation",
      "styles-gallery->image-generation",
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

    // Empty image prompt on purpose: the image step reads the customer's own
    // request — what they typed plus the style they picked.
    const image = node(graph, "image-generation");
    expect(image.data.prompt).toBe("");
    expect(image.data.nodeKind).toBe("ai");
    // The translator brain is gone for good.
    expect(graph.nodes.some((candidate) => candidate.data.type === "ai.llm_call")).toBe(false);
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

/**
 * Door-native templates (founder law).
 *
 * Every node carries its own AI entry and exit doors where translation is
 * needed, so a shipped template holds ONLY real steps: Face blocks, Hands, and
 * at most one thinking Brain where genuine reasoning is wanted. A brain placed
 * on the canvas purely to fill in the next step's request, or to tidy the last
 * step's reply, is a hand-placed door — those are gone, and these tests keep
 * them gone.
 */
describe("door-native template graphs", () => {
  const LIVE_FACE_SLUGS = ["chatbot", "voice-agent", "image-studio", "form-tool"] as const;

  type AnyNode = { id: string; data: Record<string, unknown> };
  type AnyEdge = { source: string; target: string };
  type AnyGraph = { nodes: AnyNode[]; edges: AnyEdge[] };

  function allGraphs(): Array<{ slug: string; graph: AnyGraph }> {
    return TEMPLATE_SEED.map((template) => ({
      slug: template.slug,
      graph: template.workflowJson as unknown as AnyGraph
    }));
  }

  function typeOf(candidate: AnyNode): string {
    return String(candidate.data?.type ?? "");
  }

  /** A Brain: anything the canvas draws as thinking. */
  function isBrain(candidate: AnyNode): boolean {
    return String(candidate.data?.nodeKind ?? "") === "ai" || typeOf(candidate).startsWith("ai.");
  }

  function nodeById(graph: AnyGraph): Map<string, AnyNode> {
    return new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  }

  it("gives every live Face at most one Brain", () => {
    for (const slug of LIVE_FACE_SLUGS) {
      const graph = getTemplateBySlug(slug)!.workflowJson as unknown as AnyGraph;
      const brains = graph.nodes.filter(isBrain).map(typeOf);
      expect(brains.length, `${slug} brains: ${brains.join(", ")}`).toBeLessThanOrEqual(1);
    }
  });

  it("never chains a Brain into another Brain — that middle node is a door", () => {
    for (const { slug, graph } of allGraphs()) {
      const byId = nodeById(graph);
      for (const edge of graph.edges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) continue;
        expect(
          isBrain(source) && isBrain(target),
          `${slug}: ${typeOf(source)} → ${typeOf(target)} is a hand-placed door`
        ).toBe(false);
      }
    }
  });

  it("never sits a Brain between two nodes that already have doors", () => {
    for (const { slug, graph } of allGraphs()) {
      const byId = nodeById(graph);
      for (const candidate of graph.nodes) {
        if (!isBrain(candidate)) continue;
        const feedsIn = graph.edges
          .filter((edge) => edge.target === candidate.id)
          .map((edge) => byId.get(edge.source))
          .some((upstream) => upstream !== undefined && hasNodeDoors(typeOf(upstream)));
        const feedsOut = graph.edges
          .filter((edge) => edge.source === candidate.id)
          .map((edge) => byId.get(edge.target))
          .some((downstream) => downstream !== undefined && hasNodeDoors(typeOf(downstream)));
        expect(
          feedsIn && feedsOut,
          `${slug}: ${typeOf(candidate)} only translates between two door-bearing steps`
        ).toBe(false);
      }
    }
  });

  it("ships every door-bearing node with its doors switched on", () => {
    let doorBearing = 0;
    for (const { slug, graph } of allGraphs()) {
      for (const candidate of graph.nodes) {
        if (!hasNodeDoors(typeOf(candidate))) continue;
        doorBearing += 1;
        expect(nodeDoorsEnabled(candidate.data), `${slug}: ${typeOf(candidate)}`).toBe(true);
      }
    }
    // The seed really does exercise doors — a zero here would make this vacuous.
    expect(doorBearing).toBeGreaterThan(0);
  });

  it("passes the same graph validation the builder canvas runs", () => {
    for (const { slug, graph } of allGraphs()) {
      const validation = analyzeWorkflowGraph(graph.nodes, graph.edges);
      expect(validation.issue, `${slug}: ${validation.title} ${validation.message}`).toBeNull();
      expect(validation.ok, slug).toBe(true);
    }
  });

  it("inserts the node types each live Face promises, and no filler", () => {
    const expected: Record<string, string[]> = {
      chatbot: [
        DESIGN_BRAIN_NODE_TYPE,
        BLOCK_NODE_TYPES.promptComposer,
        "ai.llm_call",
        BLOCK_NODE_TYPES.outputStage,
        BLOCK_NODE_TYPES.historyShelf
      ],
      "voice-agent": [
        VOICE_NODE_TYPES.phoneCallTrigger,
        VOICE_NODE_TYPES.voiceConversation,
        VOICE_NODE_TYPES.calendarAvailability,
        VOICE_NODE_TYPES.bookAppointment,
        VOICE_NODE_TYPES.endFlow
      ],
      "image-studio": [
        DESIGN_BRAIN_NODE_TYPE,
        BLOCK_NODE_TYPES.promptComposer,
        BLOCK_NODE_TYPES.presetGallery,
        "ai.image_generation",
        BLOCK_NODE_TYPES.outputStage,
        BLOCK_NODE_TYPES.historyShelf
      ],
      "form-tool": [
        BLOCK_NODE_TYPES.promptComposer,
        BLOCK_NODE_TYPES.actionButton,
        "ai.llm_call",
        BLOCK_NODE_TYPES.outputStage
      ]
    };

    for (const slug of LIVE_FACE_SLUGS) {
      const template = getTemplateBySlug(slug)!;
      const graph = template.workflowJson as unknown as AnyGraph;
      expect(graph.nodes.map(typeOf), slug).toEqual(expected[slug]);
      expect(template.nodeCount, slug).toBe(expected[slug].length);
    }
  });
});
