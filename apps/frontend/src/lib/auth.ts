export type AuthRole = "ADMIN" | "BUSINESS" | "ARCHITECT";

export type AuthUser = {
  id: string;
  fullName: string | null;
  email: string;
  role: AuthRole;
};

export function saveAuthSession(token: string, user: AuthUser) {
  if (typeof window === "undefined") return;

  localStorage.setItem("coreai-token", token);
  localStorage.setItem("coreai-user", JSON.stringify(user));
  localStorage.setItem("coreai-role", user.role);
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

export function clearAuthSession() {
  if (typeof window === "undefined") return;

  localStorage.removeItem("coreai-token");
  localStorage.removeItem("coreai-user");
  localStorage.removeItem("coreai-role");
}

export function logout() {
  clearAuthSession();
  if (typeof window === "undefined") return;
  window.location.href = "/";
}