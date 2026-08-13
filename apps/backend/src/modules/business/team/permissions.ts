/**
 * Business-workspace RBAC (plan Part 6 / section 8). Pure module: the role →
 * permission matrix, permission keys, and override resolution. Enforcement
 * lives in membership.ts — every protected backend operation authorizes
 * through it, never through hidden frontend buttons.
 */

export const BUSINESS_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "RECEPTIONIST",
  "SALES",
  "SUPPORT",
  "VIEWER"
] as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const BUSINESS_PERMISSIONS = [
  /** See calls, transcripts, conversations. */
  "view_calls",
  /** Delete calls/recordings. */
  "delete_calls",
  /** Create/edit/disable AI behavior rules. */
  "manage_rules",
  /** Enable/configure follow-up sequences & reminders. */
  "manage_workflows",
  /** Upload/archive knowledge, resolve gaps. */
  "manage_knowledge",
  /** Billing, usage caps, payment settings. */
  "manage_billing",
  /** Install/remove marketplace agents, deploy/pause. */
  "manage_agents",
  /** Reports & quality scores for the whole business. */
  "view_reports",
  /** Reports limited to conversations the member handled. */
  "view_own_reports",
  /** Take/assign/release live handoffs and inbox threads. */
  "take_handoff",
  /** Invite/deactivate members, change roles. */
  "manage_team",
  /** Connect/disconnect integrations, phone settings. */
  "manage_integrations",
  /** Edit customer profiles, merge/split identities. */
  "manage_customers",
  /** Read customer profiles/timeline. */
  "view_customers"
] as const;

export type BusinessPermission = (typeof BUSINESS_PERMISSIONS)[number];

const ALL: BusinessPermission[] = [...BUSINESS_PERMISSIONS];

/** Plan section 8 matrix, expressed positively. */
const ROLE_MATRIX: Record<BusinessRole, BusinessPermission[]> = {
  OWNER: ALL,
  ADMIN: ALL,
  MANAGER: [
    "view_calls",
    "manage_rules",
    "manage_workflows",
    "manage_knowledge",
    "view_reports",
    "take_handoff",
    "manage_customers",
    "view_customers"
  ],
  RECEPTIONIST: ["view_calls", "take_handoff", "manage_customers", "view_customers"],
  SALES: ["view_calls", "take_handoff", "view_own_reports", "manage_customers", "view_customers"],
  SUPPORT: ["view_calls", "take_handoff", "view_own_reports", "manage_customers", "view_customers"],
  VIEWER: ["view_calls", "view_reports", "view_customers"]
};

export function isBusinessRole(value: unknown): value is BusinessRole {
  return typeof value === "string" && (BUSINESS_ROLES as readonly string[]).includes(value);
}

export function isBusinessPermission(value: unknown): value is BusinessPermission {
  return typeof value === "string" && (BUSINESS_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Effective permission check: role matrix plus optional per-member overrides
 * ({ grant: [...], revoke: [...] }). Overrides can never grant manage_team or
 * manage_billing to a non-OWNER/ADMIN role — those stay role-gated so a
 * compromised low-privilege account cannot be quietly escalated.
 */
export function roleHasPermission(
  role: BusinessRole,
  permission: BusinessPermission,
  overrides?: unknown
): boolean {
  const base = ROLE_MATRIX[role]?.includes(permission) ?? false;

  const parsed = parseOverrides(overrides);
  if (!parsed) return base;

  if (parsed.revoke.includes(permission)) return false;
  if (parsed.grant.includes(permission)) {
    const escalationLocked = permission === "manage_team" || permission === "manage_billing";
    if (escalationLocked && role !== "OWNER" && role !== "ADMIN") return base;
    return true;
  }
  return base;
}

function parseOverrides(value: unknown): { grant: BusinessPermission[]; revoke: BusinessPermission[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const list = (input: unknown): BusinessPermission[] =>
    Array.isArray(input) ? input.filter(isBusinessPermission) : [];
  const grant = list(record.grant);
  const revoke = list(record.revoke);
  if (grant.length === 0 && revoke.length === 0) return null;
  return { grant, revoke };
}
