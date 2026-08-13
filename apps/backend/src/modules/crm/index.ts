/**
 * Customer-context CRM.
 *
 * Public surface for the rest of the backend. The agent runtime should import
 * ONLY from here — never reach into a provider folder directly — so adding
 * Salesforce or Zoho later does not touch call-path code.
 */

export { CRM_CATALOG, findCatalogEntry, isLiveProvider, providerDisplayName } from "./catalog";
export type { CrmCatalogEntry, CrmCatalogId, CrmProviderStatus } from "./catalog";

export {
  EMPTY_CALLER_CONTEXT,
  buildCrmGreeting,
  buildCrmPromptSection,
  getActiveCrmConnection,
  loadCrmCallerContext
} from "./hubspot/context.service";
export type { CrmCallerContext } from "./hubspot/context.service";

export { syncCallToCrm } from "./hubspot/call-sync.service";
export type { CallSyncInput, CallSyncResult } from "./hubspot/call-sync.service";

export { crmRoutes } from "./routes";
