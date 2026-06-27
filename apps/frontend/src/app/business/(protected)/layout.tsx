import type { ReactNode } from "react";
import { BusinessSidebarLayout } from "@/components/business/sidebar";
import { BusinessAuthGuard } from "@/components/business/business-auth-guard";

export default function BusinessLayout({ children }: { children: ReactNode }) {
  return (
    <BusinessAuthGuard>
      <BusinessSidebarLayout>{children}</BusinessSidebarLayout>
    </BusinessAuthGuard>
  );
}