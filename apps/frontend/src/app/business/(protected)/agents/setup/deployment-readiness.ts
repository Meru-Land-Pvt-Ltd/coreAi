export type WorkflowDeploymentValidationPlan = { requirePhoneSelection?: boolean } | null | undefined;

export type WorkflowDeploymentPersistResult = { installedAgentId?: string | null; number?: string | null } | null | undefined;

export function isDeploymentReadyForWorkflowRequirements(
  validationPlan: WorkflowDeploymentValidationPlan,
  persistResult: WorkflowDeploymentPersistResult,
  assignedNumber?: string | null
): boolean {
  if (!persistResult?.installedAgentId) return false;
  if (!validationPlan?.requirePhoneSelection) return true;
  return Boolean(persistResult.number || assignedNumber);
}
