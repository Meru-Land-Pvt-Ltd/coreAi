import type {
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowNode,
} from "./types.js";

const executeNode = async (node: WorkflowNode, payload: Record<string, unknown>) => {
  switch (node.type) {
    case "transform":
      return { ...payload, transformedBy: node.name };
    case "condition":
      return { ...payload, conditionResult: true };
    case "approval":
      return { ...payload, approvalRequired: true };
    default:
      return { ...payload, lastNode: node.name };
  }
};

export const runWorkflow = async (
  definition: WorkflowDefinition,
  context: WorkflowExecutionContext,
): Promise<Record<string, unknown>> => {
  let payload: Record<string, unknown> = { ...context.input };

  for (const node of definition.nodes) {
    payload = await executeNode(node, payload);
  }

  return payload;
};
