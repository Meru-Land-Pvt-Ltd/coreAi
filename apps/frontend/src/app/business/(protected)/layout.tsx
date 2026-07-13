import type { ReactNode } from "react";
import { BusinessSidebarLayout } from "@/components/business/sidebar";
import { BusinessAuthGuard } from "@/components/business/business-auth-guard";
import { BusinessOnboardingGate } from "@/components/business/business-onboarding-gate";

export default function BusinessLayout({ children }: { children: ReactNode }) {
  return (
    <BusinessAuthGuard>
      <BusinessOnboardingGate>
        <BusinessSidebarLayout>{children}</BusinessSidebarLayout>
      </BusinessOnboardingGate>
    </BusinessAuthGuard>
  );
}