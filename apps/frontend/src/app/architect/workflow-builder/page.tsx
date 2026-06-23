import { WorkflowBuilder } from "@/components/workflow/workflow-builder";

export default function ArchitectWorkflowBuilderPage() {
  return (
    <main className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-4 text-3xl font-bold text-orange-950">Architect Workflow Builder</h1>
        <WorkflowBuilder />
      </div>
    </main>
  );
}
