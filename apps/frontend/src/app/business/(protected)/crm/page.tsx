"use client";

import { CrmPage } from "@/components/business/crm/crm-page";

/**
 * /business/crm — buyer CRM. The protected layout already supplies
 * BusinessAuthGuard, BusinessOnboardingGate and BusinessSidebarLayout.
 */
export default function BusinessCrmPage() {
  return <CrmPage />;
}
