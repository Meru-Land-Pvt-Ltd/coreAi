import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen p-8 md:p-16">
      <section className="brand-gradient rounded-3xl p-8 text-white">
        <h1 className="text-3xl font-bold">CoreAI Agent Marketplace</h1>
        <p className="mt-2 max-w-2xl text-white/90">
          Build, buy, and operate custom AI agents with role-based workspaces and a native workflow engine.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/business/login" className="rounded-lg bg-white px-4 py-2 font-medium text-orange-700">Business Login</Link>
          <Link href="/architect/login" className="rounded-lg bg-orange-900/30 px-4 py-2 font-medium">Architect Login</Link>
          <Link href="/admin/login" className="rounded-lg bg-orange-900/30 px-4 py-2 font-medium">Admin Login</Link>
        </div>
      </section>
    </main>
  );
}
