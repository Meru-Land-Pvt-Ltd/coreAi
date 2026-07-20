export type AuthRole = "ADMIN" | "BUSINESS" | "ARCHITECT";

export type AuthUser = {
  id: string;
  fullName: string | null;
  email: string;
  /** Legacy/primary role. Gate access with hasAuthRole(), not equality. */
  role: AuthRole;
  /** Every role this account holds (role memberships). Older sessions may
   *  not have it stored — hasAuthRole() falls back to `role`. */
  roles?: AuthRole[];
  profilePhotoUrl?: string | null;
};

/** Capability check: true when the account holds `role` as any of its roles. */
export function hasAuthRole(user: AuthUser | null | undefined, role: AuthRole): boolean {
  if (!user) return false;
  if (user.role === role) return true;
  return Array.isArray(user.roles) && user.roles.includes(role);
}

export const AUTH_USER_UPDATED_EVENT = "coreai-auth-user-updated";

/**
 * Active workspace — which side of the product the user is currently working
 * in. Stored separately from the permanent roles: switching workspaces never
 * touches the token or the roles.
 */
export type Workspace = "ADMIN" | "BUSINESS" | "ARCHITECT";

const WORKSPACE_STORAGE_KEY = "coreai-workspace";

export function getActiveWorkspace(): Workspace | null {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  return value === "ADMIN" || value === "BUSINESS" || value === "ARCHITECT" ? value : null;
}

export function setActiveWorkspace(workspace: Workspace) {
  if (typeof window === "undefined") return;
  localStorage.setItem(WORKSPACE_STORAGE_KEY, workspace);
}

function notifyAuthUserUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_USER_UPDATED_EVENT));
}

export function saveAuthSession(token: string, user: AuthUser) {
  if (typeof window === "undefined") return;

  localStorage.setItem("coreai-token", token);
  localStorage.setItem("coreai-user", JSON.stringify(user));
  localStorage.setItem("coreai-role", user.role);
  localStorage.setItem(WORKSPACE_STORAGE_KEY, user.role);
  notifyAuthUserUpdated();
}

export function getAuthToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("coreai-token");
}

export function getAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return null;

  const rawUser = localStorage.getItem("coreai-user");

  if (!rawUser) return null;

  try {
    return JSON.parse(rawUser) as AuthUser;
  } catch {
    return null;
  }
}

export function updateAuthUser(patch: Partial<AuthUser>) {
  if (typeof window === "undefined") return;

  const currentUser = getAuthUser();
  if (!currentUser) return;

  const nextUser = { ...currentUser, ...patch };
  localStorage.setItem("coreai-user", JSON.stringify(nextUser));
  if (nextUser.role) localStorage.setItem("coreai-role", nextUser.role);
  notifyAuthUserUpdated();
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;

  localStorage.removeItem("coreai-token");
  localStorage.removeItem("coreai-user");
  localStorage.removeItem("coreai-role");
  localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  notifyAuthUserUpdated();
}

export function logout() {
  clearAuthSession();
  if (typeof window === "undefined") return;
  window.location.href = "/";
}
