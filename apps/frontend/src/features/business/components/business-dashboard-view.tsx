import Link from "next/link";

export function BusinessDashboardView() {
  return (
    <main className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-6xl rounded-3xl border border-orange-200 bg-white/90 p-8">
        <h1 className="text-3xl font-bold text-orange-950">Business Dashboard</h1>
        <p className="mt-2 text-orange-800">Install agents, monitor execution logs, and approve sensitive workflow actions.</p>
        <div className="mt-6 flex gap-3">
          <Link href="/marketplace" className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white">
            Browse Marketplace
          </Link>
          <Link href="/projects" className="rounded-lg border border-orange-300 px-4 py-2 font-semibold text-orange-800">
            Post Custom Requirement
          </Link>
        </div>
      </div>
    </main>
  );
}
