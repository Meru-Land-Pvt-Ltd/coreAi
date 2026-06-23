import { AuthCard } from "@/components/auth/auth-card";

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] px-4">
      <AuthCard
        role="ADMIN"
        mode="login"
        title="Admin Login"
        subtitle="Login to manage users, approvals, agents, projects, and platform operations."
        switchHref="/admin/signup"
        switchText="Need an admin account?"
        dashboardPath="/admin/dashboard"
      />
    </main>
  );
}