import { RoleLoginCard } from "@/components/ui/role-login-card";

export default function ArchitectLoginPage() {
  return (
    <main className="min-h-screen p-6 md:p-12">
      <RoleLoginCard role="architect" dashboardPath="/dashboard/architect" />
    </main>
  );
}
