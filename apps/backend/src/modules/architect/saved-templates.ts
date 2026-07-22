import { normalizeAgentConfigure } from "@coreai/shared";
import { prisma } from "../../lib/prisma";
import type { WorkflowTemplate } from "./templates";

/** Slug prefix for architect-saved workflow templates (avoids collisions with static seed slugs). */
export const WORKFLOW_TEMPLATE_SLUG_PREFIX = "wf-";

export function workflowTemplateSlug(workflowId: string): string {
  return `${WORKFLOW_TEMPLATE_SLUG_PREFIX}${workflowId}`;
}

export function parseWorkflowTemplateSlug(slug: string): string | null {
  if (!slug.startsWith(WORKFLOW_TEMPLATE_SLUG_PREFIX)) return null;
  const workflowId = slug.slice(WORKFLOW_TEMPLATE_SLUG_PREFIX.length);
  return workflowId.length > 0 ? workflowId : null;
}

type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  workflowJson: unknown;
  configureJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function workflowJsonGraph(workflowJson: unknown): { nodes: unknown[]; edges: unknown[] } {
  if (!workflowJson || typeof workflowJson !== "object") {
    return { nodes: [], edges: [] };
  }
  const graph = workflowJson as { nodes?: unknown; edges?: unknown };
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph.edges) ? graph.edges : []
  };
}

function difficultyFromNodeCount(nodeCount: number): WorkflowTemplate["difficulty"] {
  if (nodeCount <= 3) return "Beginner";
  if (nodeCount <= 6) return "Intermediate";
  return "Advanced";
}

function workflowToTemplate(workflow: WorkflowRow): WorkflowTemplate {
  const configure = normalizeAgentConfigure(workflow.configureJson, {
    name: workflow.name,
    tagline: workflow.description,
    description: workflow.description,
    workflowJson: workflow.workflowJson
  });

  const workflowJson = workflowJsonGraph(workflow.workflowJson);
  const nodeCount = workflowJson.nodes.length;
  const title = configure.basics.agentName.trim() || workflow.name.trim() || "Untitled Template";
  const description =
    configure.basics.tagline.trim() ||
    configure.basics.shortDescription.trim() ||
    workflow.description?.trim() ||
    "Architect workflow template";

  return {
    id: workflow.id,
    slug: workflowTemplateSlug(workflow.id),
    title,
    category: configure.basics.category.trim() || "Communication",
    difficulty: difficultyFromNodeCount(nodeCount),
    nodeCount,
    description,
    forks: 0,
    rating: 0,
    reviewCount: 0,
    tags: configure.basics.industryTags.length > 0 ? configure.basics.industryTags : ["Custom"],
    workflowJson: workflowJson as WorkflowTemplate["workflowJson"],
    status: "ACTIVE",
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString()
  };
}

/** Card metadata for saved architect templates (omits workflowJson). */
export async function listSavedTemplateCards() {
  const workflows = await prisma.workflowDefinition.findMany({
    where: { isTemplate: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      workflowJson: true,
      configureJson: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return workflows.map((workflow) => {
    const { workflowJson: _workflowJson, ...card } = workflowToTemplate(workflow);
    return card;
  });
}

export async function getSavedTemplateBySlug(slug: string): Promise<WorkflowTemplate | null> {
  const workflowId = parseWorkflowTemplateSlug(slug);
  if (!workflowId) return null;

  const workflow = await prisma.workflowDefinition.findFirst({
    where: { id: workflowId, isTemplate: true },
    select: {
      id: true,
      name: true,
      description: true,
      workflowJson: true,
      configureJson: true,
      createdAt: true,
      updatedAt: true
    }
  });

  if (!workflow) return null;
  return workflowToTemplate(workflow);
}

export function cloneSavedTemplateWorkflow(template: WorkflowTemplate) {
  return JSON.parse(JSON.stringify(template.workflowJson)) as WorkflowTemplate["workflowJson"];
}
