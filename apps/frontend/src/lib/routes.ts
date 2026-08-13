import type { Route } from "next";

export const HOME_PATH = "/" as Route;
export const BUSINESS_ONBOARDING_PATH = "/business/onboarding" as Route;
export const BUSINESS_DASHBOARD_PATH = "/business/dashboard" as Route;
export const BUSINESS_MARKETPLACE_PATH = "/business/marketplace" as Route;
export const BUSINESS_MARKETPLACE_PUBLIC_PATH = "/marketplace" as Route;
export const BUSINESS_CHECKOUT_PATH = "/business/checkout" as Route;
export const BUSINESS_AGENTS_PATH = "/business/agents" as Route;
export const BUSINESS_ANALYTICS_PATH = "/business/analytics" as Route;
export const BUSINESS_CRM_PATH = "/business/crm" as Route;
export const BUSINESS_PAYMENT_SUCCESS_PATH = "/business/paymentsuccess" as Route;
export const BUSINESS_PAYMENT_FAILED_PATH = "/business/paymentfailed" as Route;
export const BUSINESS_BILLING_PATH = "/business/billingandusage" as Route;
export const BUSINESS_SETTINGS_PATH = "/business/setting" as Route;
export const BUSINESS_INVOICE_PATH = "/business/billingandusage/billing" as Route;
export const BUSINESS_LOGIN_PATH = "/business/login" as Route;
export const BUSINESS_SETUP_PATH = "/business/agents/setup" as Route;
export const MISSED_CALL_SETUP_PATH = "/business/agent/missed-call/setup" as Route;
export const ASSIGNMENT_PATH = "/assignment" as Route;
export const MARKETPLACE_PATH = "/marketplace" as Route;
export const ARCHITECT_LOGIN_PATH = "/architect/login" as Route;
export const ARCHITECT_MY_AGENTS_PATH = "/architect/agents" as Route;
export const ARCHITECT_PAYOUTS_PATH = "/architect/payouts" as Route;
export const ARCHITECT_SETTINGS_PATH = "/architect/settings" as Route;
export const ARCHITECT_ANALYTICS_PATH = "/architect/agents/analytics" as Route;
export const ARCHITECT_WHATSAPP_PATH = "/architect/integrations/whatsapp" as Route;

export const FOOTER_HASH_PATH = "#footer" as Route;
export const ABOUT_HASH_PATH = "/#about" as Route;
export const CONTACT_HASH_PATH = "/#contact" as Route;
export const HELP_PATH = "/contact" as Route;
export const PRIVACY_PATH = "/privacy" as Route;
export const TERM_PATH = "/terms" as Route;
export const CONTACT_PATH = "/contact" as Route;
export const ABOUT_PATH = "/about" as Route;


/**
 * Business analytics page. With an agentId it opens the same page focused on
 * that one agent — the page reads the id from the query string.
 */
export function businessAnalyticsPath(agentId?: string | null): Route {
  return (agentId
    ? `/business/analytics?agentId=${encodeURIComponent(agentId)}`
    : "/business/analytics") as Route;
}

/** Public shareable agent details page (no login required to view). */
export function publicAgentPath(agentId: string): Route {
  return `/agent/${agentId}` as Route;
}

/** Public share URL for a marketplace listing — same as publicAgentPath. */
export function businessAgentSharePath(listingId: string): Route {
  return publicAgentPath(listingId);
}

/** Optional short share alias that redirects to /agent/[listingId]. */
export function shareAgentPath(listingId: string): Route {
  return `/share/agent/${listingId}` as Route;
}

/** Business login with a safe post-auth return path (e.g. checkout). */
export function businessLoginPathWithNext(nextPath: string): Route {
  return `/business/login?next=${encodeURIComponent(nextPath)}` as Route;
}

export function resolveBusinessLoginReturnPath(next: string | null | undefined): Route | null {
  if (!next) return null;
  if (!next.startsWith("/business/")) return null;
  if (next.startsWith("/business/login") || next.startsWith("/business/signup")) return null;
  return next as Route;
}

/** Business profile agent description page (/business/agents/[agentId]). */
export function businessAgentDetailPath(agentId: string): Route {
  return `/business/agents/${agentId}` as Route;
}

// Single invoice detail page, carrying the invoice/payment id.
export function businessInvoicePath(invoiceId: string): Route {
  return `/business/billingandusage/billing?invoiceId=${encodeURIComponent(invoiceId)}` as Route;
}

// Architect publishing-status page. Carries the listing/agent id so the page can
// resolve the agent and open the matching status panel (under review, approved, …).
export function architectPublishingStatusPath(listingId?: string): Route {
  return (listingId
    ? `/architect/agents/publishingstatus?listingId=${encodeURIComponent(listingId)}`
    : "/architect/agents/publishingstatus") as Route;
}

// Architect My Agents page, optionally pre-filtered (e.g. "live" → APPROVED).
export function architectMyAgentsPath(filter?: string): Route {
  return (filter
    ? `/architect/agents?filter=${encodeURIComponent(filter)}`
    : "/architect/agents") as Route;
}

export function architectAnalyticsPath(listingId?: string): Route {
  return (listingId
    ? `/architect/agents/analytics?listingId=${encodeURIComponent(listingId)}`
    : "/architect/agents/analytics") as Route;
}

// Business install/setup destination. Buyers installing an agent go to the
// business setup wizard (NOT the architect publish flow). Optionally carries the
// marketplace listing id as context.
export function businessSetupPath(listingId?: string, edit?: boolean): Route {
  if (!listingId) {
    return (edit ? "/business/agents/setup?mode=edit" : "/business/agents/setup") as Route;
  }
  const base = `/business/agents/setup?listingId=${encodeURIComponent(listingId)}`;
  return (edit ? `${base}&mode=edit` : base) as Route;
}

// Checkout destination. Buyers starting a trial go to the checkout page,
// optionally carrying the marketplace listing id as context.
export function businessCheckoutPath(listingId?: string): Route {
  return (listingId
    ? `/business/checkout?listingId=${encodeURIComponent(listingId)}`
    : "/business/checkout") as Route;
}

export function businessInvoiceCheckoutPath({
  invoiceId,
  invoiceType,
  listingId,
  agentId
}: {
  invoiceId: string;
  invoiceType: "agent" | "usage";
  listingId?: string | null;
  agentId?: string | null;
}): Route {
  const query = new URLSearchParams({ invoiceId, invoiceType });
  if (listingId) query.set("listingId", listingId);
  if (agentId) query.set("agentId", agentId);
  return `/business/checkout?${query.toString()}` as Route;
}

type PaymentResultParams = {
  listingId?: string;
  agent?: string;
  amount?: number;
  email?: string;
  mode?: "trial" | "purchase" | "free" | "invoice";
  trialDays?: number;
  /** Real Payment row id — shown as the order/transaction reference. */
  paymentId?: string;
  /** Buyer-facing failure reason to display on the failed page. */
  reason?: string;
};

function buildPaymentResultPath(base: string, params?: PaymentResultParams): Route {
  if (!params) return base as Route;

  const query = new URLSearchParams();

  if (params.listingId) query.set("listingId", params.listingId);
  if (params.agent) query.set("agent", params.agent);
  if (typeof params.amount === "number") query.set("amount", String(params.amount));
  if (params.email) query.set("email", params.email);
  if (params.mode) query.set("mode", params.mode);
  if (typeof params.trialDays === "number") query.set("trialDays", String(params.trialDays));
  if (params.paymentId) query.set("paymentId", params.paymentId);
  if (params.reason) query.set("reason", params.reason);

  const queryString = query.toString();

  return (queryString ? `${base}?${queryString}` : base) as Route;
}

// Post-checkout result pages (opened in a new tab from checkout).
export function businessPaymentSuccessPath(params?: PaymentResultParams): Route {
  return buildPaymentResultPath("/business/paymentsuccess", params);
}

export function businessPaymentFailedPath(params?: PaymentResultParams): Route {
  return buildPaymentResultPath("/business/paymentfailed", params);
}
