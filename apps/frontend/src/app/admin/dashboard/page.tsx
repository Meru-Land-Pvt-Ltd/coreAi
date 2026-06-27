import { DashboardShell } from "@/components/common/dashboard-shell";
import { StatCard } from "@/components/common/stat-card";

export default function AdminDashboardPage() {
  return (
    <DashboardShell
      role="ADMIN"
      title="Admin Dashboard"
      subtitle="Manage users, approvals, AI Architects, Businesses, projects, and marketplace quality."
    >
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Users" value="126" hint="Prototype count" />
        <StatCard label="Businesses" value="38" hint="Registered companies" />
        <StatCard label="AI Architects" value="24" hint="Builder profiles" />
        <StatCard label="Pending Reviews" value="9" hint="Need admin action" />
      </div>

      <section className="mt-6 rounded-3xl soft-card p-6">
        <h2 className="text-xl font-bold" data-testid="admin-dashboard-admin-actions-heading">Admin Actions</h2>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {["Approve AI Architects", "Review Agent Listings", "Monitor Workflow Runs"].map(
            (item) => (
              <div key={item} className="rounded-2xl bg-orange-50 p-4 text-sm font-semibold">
                {item}
              </div>
            )
          )}
        </div>
      </section>
    </DashboardShell>
  );
}