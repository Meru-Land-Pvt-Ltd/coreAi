import Link from "next/link";

export default function ArchitectDashboardPage() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold text-orange-900">AI Architect Dashboard</h1>
      <p className="mt-2 text-orange-800">Build and sell agents, manage proposals, and track earnings.</p>
      <Link href="/dashboard/architect/workflow-builder" className="mt-5 inline-block rounded-lg bg-orange-600 px-4 py-2 text-white">
        Open Workflow Builder
      </Link>
    </main>
  );
}
