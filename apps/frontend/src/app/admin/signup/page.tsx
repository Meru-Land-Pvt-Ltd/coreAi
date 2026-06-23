import { AuthCard } from "@/components/auth/auth-card";

export default function AdminSignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] px-4">
      <AuthCard
        role="ADMIN"
        mode="signup"
        title="Admin Signup"
        subtitle="Create an admin account for prototype management and moderation."
        switchHref="/admin/login"
        switchText="Already have an admin account?"
        dashboardPath="/admin/dashboard"
      />
    </main>
  );
}