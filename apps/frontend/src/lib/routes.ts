import type { Route } from "next";

export const HOME_PATH = "/" as Route;
export const BUSINESS_MARKETPLACE_PATH = "/business/marketplace" as Route;
export const BUSINESS_CHECKOUT_PATH = "/business/checkout" as Route;
export const BUSINESS_LOGIN_PATH = "/business/login" as Route;
export const BUSINESS_SETUP_PATH = "/business/agents/setup" as Route;
export const MISSED_CALL_SETUP_PATH = "/business/agent/missed-call/setup" as Route;
export const ASSIGNMENT_PATH = "/assignment" as Route;
export const MARKETPLACE_PATH = "/marketplace" as Route;
export const ARCHITECT_LOGIN_PATH = "/architect/login" as Route;

export const FOOTER_HASH_PATH = "#footer" as Route;
export const ABOUT_HASH_PATH = "/#about" as Route;
export const CONTACT_HASH_PATH = "/#contact" as Route;
export const HELP_PATH = "/contact" as Route;

export function businessAgentPath(agentId: string): Route {
  return `/business/agent/${agentId}` as Route;
}

// Business install/setup destination. Buyers installing an agent go to the
// business setup wizard (NOT the architect publish flow). Optionally carries the
// marketplace listing id as context.
export function businessSetupPath(listingId?: string): Route {
  return (listingId
    ? `/business/agents/setup?listingId=${encodeURIComponent(listingId)}`
    : "/business/agents/setup") as Route;
}