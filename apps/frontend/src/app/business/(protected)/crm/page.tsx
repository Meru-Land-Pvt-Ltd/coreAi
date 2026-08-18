// [DISABLED] The buyer CRM (HubSpot) UI is temporarily turned off. The route is
// kept so the path stays valid, but it renders an inert placeholder instead of
// the real CRM. The original page body is preserved below as comments.
//
// [DISABLED] import { CrmPage } from "@/components/business/crm/crm-page";

/**
 * /business/crm — buyer CRM. The protected layout already supplies
 * BusinessAuthGuard, BusinessOnboardingGate and BusinessSidebarLayout.
 */
export default function BusinessCrmPage() {
  // [DISABLED] original body: return <CrmPage />;
  return (
    <div className="p-8">
      <p className="text-sm text-slate-500" data-testid="business-crm-disabled">
        This feature is currently disabled.
      </p>
    </div>
  );
}
