import { AuthCard } from "@/components/auth/auth-card";

export default function BusinessSignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] px-4">
      <AuthCard
        role="BUSINESS"
        mode="signup"
        title="Business Signup"
        subtitle="Create a business account to request, install, and run AI agents."
        switchHref="/business/login"
        switchText="Already have a business account?"
        dashboardPath="/business/dashboard"
      />
    </main>
  );
}