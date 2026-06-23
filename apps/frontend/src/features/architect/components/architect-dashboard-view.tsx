import Link from "next/link";

export function ArchitectDashboardView() {
  return (
    <main className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-6xl rounded-3xl border border-orange-200 bg-white/90 p-8">
        <h1 className="text-3xl font-bold text-orange-950">Architect Dashboard</h1>
        <p className="mt-2 text-orange-800">Build custom agents, submit to marketplace, and manage your delivery pipeline.</p>
        <div className="mt-6 flex gap-3">
          <Link href="/architect/workflow-builder" className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white">
            Open Workflow Builder
          </Link>
          <Link href="/projects" className="rounded-lg border border-orange-300 px-4 py-2 font-semibold text-orange-800">
            Find Projects
          </Link>
        </div>
      </div>
    </main>
  );
}
