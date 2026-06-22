import { WorkflowBuilder } from "@/components/workflow/workflow-builder";

export default function ArchitectWorkflowBuilderPage() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="mb-4 text-3xl font-bold text-orange-900">Visual Workflow Builder</h1>
      <WorkflowBuilder />
    </main>
  );
}
