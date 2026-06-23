import { AuthCard } from "@/components/auth/auth-card";

export default function ArchitectLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] px-4">
      <AuthCard
        role="ARCHITECT"
        mode="login"
        title="AI Architect Login"
        subtitle="Login to build agents, create workflows, and work on business projects."
        switchHref="/architect/signup"
        switchText="Need an architect account?"
        dashboardPath="/architect/dashboard"
      />
    </main>
  );
}