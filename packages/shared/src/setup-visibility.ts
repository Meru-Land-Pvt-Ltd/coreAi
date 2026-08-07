import { SETUP_FIELD_RULES, type SetupFieldRulesConfig } from "./setup-field-rules.js";

export type SetupRulesJson = SetupFieldRulesConfig;
export type SetupFieldKey =
  | "phone"
  | "callForwarding"
  | "answeringMode"
  | "calendar"
  | "calendly"
  | "mail"
  | "telegram"
  | "deepgram"
  | "smsNote"
  | "businessProfile"
  | "knowledge"
  | "hours"
  | "bookingRules"
  | "aiCallCoverage"
  | "voiceIdentity"
  | "agentBehaviorVoice"
  | "callTest"
  | "calendarTest"
  | "voicePreview"
  | "deepgramTest";

export type SetupVisibility = Record<SetupFieldKey, boolean>;

export type SetupValidationPlan = {
  requireBusinessName: boolean;
  requireBusinessType: boolean;
  requireAddress: boolean;
  requirePhoneSelection: boolean;
  requireCallForwarding: boolean;
  requireCalendar: boolean;
  requireCalendly: boolean;
  requireMail: boolean;
  requireTelegram: boolean;
  requireVoiceIdentity: boolean;
  requireBookingRules: boolean;
};

export const DEFAULT_FLAGS: SetupVisibility = Object.freeze({ ...SETUP_FIELD_RULES.default });

/**
 * Pure derive function: O(nodes), no network, no races.
 * Resolves each node's type (`data.type` ?? `data.kind` ?? `type`) and merges node rules.
 * Also ORs connector-derived flags if explicit connector keys are provided or present.
 */
export function deriveSetupVisibility(
  workflowJson: unknown,
  requiredConnectorKeys?: string[]
): SetupVisibility {
  const flags: SetupVisibility = { ...DEFAULT_FLAGS };

  const container = workflowJson && typeof workflowJson === "object" ? (workflowJson as Record<string, unknown>) : {};
  const actualWorkflow =
    container.workflowJson ??
    (container.workflow && typeof container.workflow === "object"
      ? (container.workflow as Record<string, unknown>).workflowJson
      : null) ??
    workflowJson;

  const nodes =
    typeof actualWorkflow === "object" && actualWorkflow !== null && Array.isArray((actualWorkflow as any).nodes)
      ? (actualWorkflow as any).nodes
      : [];

  const nodeRules = SETUP_FIELD_RULES.nodes;

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const nodeData = (node as any).data;
    const type: string | undefined =
      typeof nodeData?.type === "string"
        ? nodeData.type
        : typeof nodeData?.kind === "string"
        ? nodeData.kind
        : typeof (node as any).type === "string"
        ? (node as any).type
        : undefined;

    if (type && nodeRules[type]) {
      const rule = nodeRules[type];
      for (const key of Object.keys(rule) as SetupFieldKey[]) {
        if (rule[key]) {
          flags[key] = true;
        }
      }
    }
  }

  const connectorKeys =
    requiredConnectorKeys ??
    (Array.isArray(container.requiredConnectors)
      ? container.requiredConnectors
      : Array.isArray(container.requiredKeys)
      ? container.requiredKeys
      : []);

  for (const connector of connectorKeys) {
    const connStr = typeof connector === "string" ? connector : (connector as any)?.connector;
    if (typeof connStr !== "string") continue;
    const lower = connStr.toLowerCase();

    if (lower === "phone" || lower === "twilio" || lower === "vapi") {
      flags.phone = true;
      flags.callForwarding = true;
      flags.callTest = true;
      if (nodes.length === 0) {
        flags.answeringMode = true;
        flags.businessProfile = true;
        flags.knowledge = true;
        flags.hours = true;
        flags.voiceIdentity = true;
        flags.voicePreview = true;
      }
    }
    if (lower === "google_calendar" || lower === "calendar") {
      flags.calendar = true;
    }
    if (lower === "calendly") {
      flags.calendly = true;
    }
    if (lower === "gmail" || lower === "triven_mail" || lower === "email" || lower === "mail") {
      flags.mail = true;
    }
    if (lower === "telegram") {
      flags.telegram = true;
      flags.businessProfile = true;
    }
    if (lower === "deepgram") {
      flags.deepgram = true;
      flags.deepgramTest = true;
    }
    if (lower === "sms") {
      flags.phone = true;
      flags.smsNote = true;
    }
  }

  return Object.freeze(flags);
}

/**
 * Maps visibility flags -> which checklist/validation rules apply.
 */
export function getSetupValidationPlan(visibility: SetupVisibility): SetupValidationPlan {
  return Object.freeze({
    requireBusinessName: Boolean(visibility.businessProfile),
    requireBusinessType: Boolean(visibility.businessProfile),
    requireAddress: Boolean(visibility.businessProfile),
    requirePhoneSelection: Boolean(visibility.phone),
    requireCallForwarding: Boolean(visibility.callForwarding),
    requireCalendar: Boolean(visibility.calendar),
    requireCalendly: Boolean(visibility.calendly),
    requireMail: Boolean(visibility.mail),
    requireTelegram: Boolean(visibility.telegram),
    requireVoiceIdentity: Boolean(visibility.voiceIdentity),
    requireBookingRules: Boolean(visibility.bookingRules)
  });
}
