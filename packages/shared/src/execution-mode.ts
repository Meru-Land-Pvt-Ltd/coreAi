export const EXECUTION_MODES = ["ARCHITECT_DRY_RUN", "BUSINESS_TEST", "LIVE"] as const;

export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === "string" && (EXECUTION_MODES as readonly string[]).includes(value);
}

export const ARCHITECT_TEST_EVENT_PREFIX = "[TRIVEN ARCHITECT TEST]";
export const BUSINESS_TEST_EVENT_PREFIX = "[TRIVEN BUSINESS TEST]";

export type ExecutionSideEffectPolicy = {
  allowRealCalendarEvents: boolean;
  calendarScope: "architect_test_calendar" | "business_calendar" | "business_calendar_live";
  calendarEventTitlePrefix: string;
  allowCustomerNotifications: boolean;
  allowTestRecipientDelivery: boolean;
  billable: boolean;
  countsAsProductionUsage: boolean;
  allowPhoneProvisioning: boolean;
};

const POLICIES: Record<ExecutionMode, ExecutionSideEffectPolicy> = {
  ARCHITECT_DRY_RUN: {
    allowRealCalendarEvents: true, // only the architect's explicitly connected test calendar
    calendarScope: "architect_test_calendar",
    calendarEventTitlePrefix: ARCHITECT_TEST_EVENT_PREFIX,
    allowCustomerNotifications: false,
    allowTestRecipientDelivery: true,
    billable: false,
    countsAsProductionUsage: false,
    allowPhoneProvisioning: false
  },
  BUSINESS_TEST: {
    allowRealCalendarEvents: true, // the business's own connected calendar, marked as test
    calendarScope: "business_calendar",
    calendarEventTitlePrefix: BUSINESS_TEST_EVENT_PREFIX,
    allowCustomerNotifications: false,
    allowTestRecipientDelivery: true,
    billable: false,
    countsAsProductionUsage: false,
    allowPhoneProvisioning: false
  },
  LIVE: {
    allowRealCalendarEvents: true,
    calendarScope: "business_calendar_live",
    calendarEventTitlePrefix: "",
    allowCustomerNotifications: true,
    allowTestRecipientDelivery: true,
    billable: true,
    countsAsProductionUsage: true,
    allowPhoneProvisioning: true
  }
};

export function executionSideEffectPolicy(mode: ExecutionMode): ExecutionSideEffectPolicy {
  return POLICIES[mode];
}

export function calendarEventTitleForMode(mode: ExecutionMode, serviceName: string): string {
  const prefix = POLICIES[mode].calendarEventTitlePrefix;
  const service = serviceName.trim();
  return prefix ? `${prefix} ${service}` : service;
}

export type ExecutionContext = {
  executionMode: ExecutionMode;
  workflowId: string;
  architectId?: string;
  businessId?: string;
  installedAgentId?: string;
  testSessionId?: string;
  timeZone: string;
  serviceName: string;
};

export function executionModeToRuntimeMode(mode: ExecutionMode): "architect_test" | "business_test" | "live" {
  if (mode === "ARCHITECT_DRY_RUN") return "architect_test";
  if (mode === "BUSINESS_TEST") return "business_test";
  return "live";
}

export function runtimeModeToExecutionMode(mode: "architect_test" | "business_test" | "live"): ExecutionMode {
  if (mode === "architect_test") return "ARCHITECT_DRY_RUN";
  if (mode === "business_test") return "BUSINESS_TEST";
  return "LIVE";
}
