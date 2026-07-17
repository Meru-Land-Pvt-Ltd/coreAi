import type { ReactNode } from "react";
import { Suspense } from "react";
import { BusinessSidebarLayout } from "@/components/business/sidebar";
import { BusinessAuthGuard } from "@/components/business/business-auth-guard";
import { BusinessOnboardingGate } from "@/components/business/business-onboarding-gate";

export default function BusinessLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <BusinessAuthGuard>
        <BusinessOnboardingGate>
          <BusinessSidebarLayout>{children}</BusinessSidebarLayout>
        </BusinessOnboardingGate>
      </BusinessAuthGuard>
    </Suspense>
  );
}