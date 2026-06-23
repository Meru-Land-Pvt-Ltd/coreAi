import { AuthCard } from "@/components/auth/auth-card";

export default function ArchitectSignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] px-4">
      <AuthCard
        role="ARCHITECT"
        mode="signup"
        title="AI Architect Signup"
        subtitle="Create an AI Architect account to design agents and automation workflows."
        switchHref="/architect/login"
        switchText="Already have an architect account?"
        dashboardPath="/architect/dashboard"
      />
    </main>
  );
}