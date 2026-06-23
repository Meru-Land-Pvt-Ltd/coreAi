import { ArchitectWorkflowBuilderView } from "@/components/architect/ui/workflow-builder-view";

export default async function ArchitectWorkflowBuilderPage({
  params
}: {
  params: Promise<{
    workflowId: string;
  }>;
}) {
  const { workflowId } = await params;

  return <ArchitectWorkflowBuilderView workflowId={workflowId} />;
}