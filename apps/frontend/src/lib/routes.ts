import type { Route } from "next";

export const HOME_PATH = "/" as Route;
export const BUSINESS_MARKETPLACE_PATH = "/business/marketplace" as Route;
export const BUSINESS_MARKETPLACE_PUBLIC_PATH = "/marketplace" as Route;
export const BUSINESS_CHECKOUT_PATH = "/business/checkout" as Route;
export const BUSINESS_AGENTS_PATH = "/business/agents" as Route;
export const BUSINESS_PAYMENT_SUCCESS_PATH = "/business/paymentsuccess" as Route;
export const BUSINESS_PAYMENT_FAILED_PATH = "/business/paymentfailed" as Route;
export const BUSINESS_LOGIN_PATH = "/business/login" as Route;
export const BUSINESS_SETUP_PATH = "/business/agents/setup" as Route;
export const MISSED_CALL_SETUP_PATH = "/business/agent/missed-call/setup" as Route;
export const ASSIGNMENT_PATH = "/assignment" as Route;
export const MARKETPLACE_PATH = "/marketplace" as Route;
export const ARCHITECT_LOGIN_PATH = "/architect/login" as Route;
export const ARCHITECT_MY_AGENTS_PATH = "/architect/agents" as Route;
export const ARCHITECT_ANALYTICS_PATH = "/architect/analytics" as Route;

export const FOOTER_HASH_PATH = "#footer" as Route;
export const ABOUT_HASH_PATH = "/#about" as Route;
export const CONTACT_HASH_PATH = "/#contact" as Route;
export const HELP_PATH = "/contact" as Route;
export const PRIVACY_PATH = "/privacy" as Route;
export const TERM_PATH = "/terms" as Route;
export const CONTACT_PATH = "/contact" as Route;
export const ABOUT_PATH = "/about" as Route;


export function businessAgentPath(agentId: string): Route {
  return `/business/${agentId}` as Route;
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
    ? `/architect/analytics?listingId=${encodeURIComponent(listingId)}`
    : "/architect/analytics") as Route;
}

// Business install/setup destination. Buyers installing an agent go to the
// business setup wizard (NOT the architect publish flow). Optionally carries the
// marketplace listing id as context.
export function businessSetupPath(listingId?: string): Route {
  return (listingId
    ? `/business/agents/setup?listingId=${encodeURIComponent(listingId)}`
    : "/business/agents/setup") as Route;
}

// Checkout destination. Buyers starting a trial go to the checkout page,
// optionally carrying the marketplace listing id as context.
export function businessCheckoutPath(listingId?: string): Route {
  return (listingId
    ? `/business/checkout?listingId=${encodeURIComponent(listingId)}`
    : "/business/checkout") as Route;
}

type PaymentResultParams = {
  listingId?: string;
  agent?: string;
  amount?: number;
  email?: string;
};

function buildPaymentResultPath(base: string, params?: PaymentResultParams): Route {
  if (!params) return base as Route;

  const query = new URLSearchParams();

  if (params.listingId) query.set("listingId", params.listingId);
  if (params.agent) query.set("agent", params.agent);
  if (typeof params.amount === "number") query.set("amount", String(params.amount));
  if (params.email) query.set("email", params.email);

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