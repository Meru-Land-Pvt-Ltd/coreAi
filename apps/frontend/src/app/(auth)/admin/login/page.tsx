import { RoleLoginCard } from "@/components/ui/role-login-card";

export default function AdminLoginPage() {
  return (
    <main className="min-h-screen p-6 md:p-12">
      <RoleLoginCard role="admin" dashboardPath="/dashboard/admin" />
    </main>
  );
}
