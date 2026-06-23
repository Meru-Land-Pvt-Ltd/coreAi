import Link from "next/link";
import { WorkflowBuilder } from "@/components/workflow/workflow-builder";

export default function ArchitectWorkflowBuilderPage() {
  return (
    <main className="min-h-screen bg-[#fff8ef] p-6 text-orange-950">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-orange-700">
              AI Architect
            </p>
            <h1 className="text-3xl font-bold">Workflow Builder</h1>
          </div>

          <Link
            href="/architect/dashboard"
            className="rounded-full border border-orange-300 px-4 py-2 text-sm"
          >
            Back to Dashboard
          </Link>
        </div>

        <section className="rounded-3xl soft-card p-5">
          <WorkflowBuilder />
        </section>
      </div>
    </main>
  );
}