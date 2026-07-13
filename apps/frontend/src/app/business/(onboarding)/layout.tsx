import type { ReactNode } from "react";
import { BusinessOnboardingLayoutGuard } from "@/components/business/business-onboarding-layout-guard";

export default function BusinessOnboardingLayout({ children }: { children: ReactNode }) {
  return <BusinessOnboardingLayoutGuard>{children}</BusinessOnboardingLayoutGuard>;
}
