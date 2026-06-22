import type { WorkflowDefinition } from "./types.js";

export const validateWorkflowDefinition = (definition: WorkflowDefinition): string[] => {
  const errors: string[] = [];

  if (!definition.nodes.length) errors.push("Workflow must include at least one node");
  if (!definition.edges.length) errors.push("Workflow must include at least one edge");

  const nodeIds = new Set(definition.nodes.map((n) => n.id));
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push(`Invalid edge ${edge.id} references missing nodes`);
    }
  }

  return errors;
};
