/**
 * Canvas graph validation.
 *
 * The rule itself lives in `@coreai/shared` (workflow-graph.ts) so the builder
 * canvas and the shipped template seeds are judged by exactly one
 * implementation — a one-tap template import can never be less correct than a
 * hand-wired canvas. This module stays as the builder's import path.
 */

export { analyzeWorkflowGraph } from "@coreai/shared";
export type {
  WorkflowGraphEdge as GraphEdge,
  WorkflowGraphIssue,
  WorkflowGraphValidation
} from "@coreai/shared";
