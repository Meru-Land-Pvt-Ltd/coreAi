import { RoleLoginCard } from "@/components/ui/role-login-card";

export default function BusinessLoginPage() {
  return (
    <main className="min-h-screen p-6 md:p-12">
      <RoleLoginCard role="business" dashboardPath="/dashboard/business" />
    </main>
  );
}
