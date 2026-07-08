export type AuthRole = "ADMIN" | "BUSINESS" | "ARCHITECT";

export type AuthUser = {
  id: string;
  fullName: string | null;
  email: string;
  role: AuthRole;
  profilePhotoUrl?: string | null;
};

export const AUTH_USER_UPDATED_EVENT = "coreai-auth-user-updated";

function notifyAuthUserUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_USER_UPDATED_EVENT));
}

export function saveAuthSession(token: string, user: AuthUser) {
  if (typeof window === "undefined") return;

  localStorage.setItem("coreai-token", token);
  localStorage.setItem("coreai-user", JSON.stringify(user));
  localStorage.setItem("coreai-role", user.role);
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
  notifyAuthUserUpdated();
}

export function logout() {
  clearAuthSession();
  if (typeof window === "undefined") return;
  window.location.href = "/";
}
