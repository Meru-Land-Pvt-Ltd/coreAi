import { AuthCard } from "@/components/auth/auth-card";

export default function BusinessLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] px-4">
      <AuthCard
        role="BUSINESS"
        mode="login"
        title="Business Login"
        subtitle="Login to install agents, hire AI Architects, and manage your business workflows."
        switchHref="/business/signup"
        switchText="Need a business account?"
        dashboardPath="/business/dashboard"
      />
    </main>
  );
}