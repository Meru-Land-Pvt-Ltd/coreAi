import Link from "next/link";
import { DashboardShell } from "@/components/common/dashboard-shell";
import { StatCard } from "@/components/common/stat-card";

export default function BusinessDashboardPage() {
  return (
    <DashboardShell
      role="BUSINESS"
      title="Business Dashboard"
      subtitle="Install agents, post requirements, hire AI Architects, and monitor business workflows."
    >
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Installed Agents" value="3" />
        <StatCard label="Workflow Runs" value="61" />
        <StatCard label="Pending Approvals" value="5" />
        <StatCard label="Prototype Cost" value="₹920" />
      </div>

      <section className="mt-6 grid gap-5 md:grid-cols-[1fr_0.8fr]">
        <div className="rounded-3xl soft-card p-6">
          <h2 className="text-xl font-bold">My Agents</h2>

          <div className="mt-4 space-y-3">
            {["Customer Support Agent", "Lead Qualification Agent", "Invoice Reminder Agent"].map(
              (agent) => (
                <div
                  key={agent}
                  className="flex items-center justify-between rounded-2xl bg-orange-50 p-4"
                >
                  <div>
                    <h3 className="font-semibold">{agent}</h3>
                    <p className="text-sm text-orange-700">Prototype installed agent</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">
                    Active
                  </span>
                </div>
              )
            )}
          </div>
        </div>

        <div className="rounded-3xl soft-card p-6">
          <h2 className="text-xl font-bold">Need Custom Agent?</h2>
          <p className="mt-2 text-sm text-orange-800/75">
            Post a requirement and hire an AI Architect.
          </p>

          <Link
            href="/projects"
            className="mt-5 inline-flex rounded-full bg-orange-500 px-5 py-3 text-sm font-semibold text-white"
          >
            View Project Flow
          </Link>
        </div>
      </section>
    </DashboardShell>
  );
}