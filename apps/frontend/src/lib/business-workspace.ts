import { apiPost } from "@/lib/api";
import {
  getAuthToken,
  getAuthUser,
  hasAuthRole,
  setActiveWorkspace,
  updateAuthUser,
  type AuthRole
} from "@/lib/auth";

export type BusinessWorkspaceAccess = "authed" | "unauthenticated" | "activation-failed";

/**
 * Entry gate for the Business (buyer) workspace. Any authenticated account
 * may enter: users without the BUSINESS capability (e.g. an ARCHITECT
 * intentionally opening the buyer side) get it granted server-side, keeping
 * their existing roles. The auth token is never touched — switching
 * workspaces preserves the session.
 */
export async function ensureBusinessWorkspaceAccess(): Promise<BusinessWorkspaceAccess> {
  const token = getAuthToken();
  const user = getAuthUser();

  if (!token || !user) return "unauthenticated";

  if (!hasAuthRole(user, "BUSINESS")) {
    const response = await apiPost<{ roles: AuthRole[] }>(
      "/auth/business-workspace/activate",
      {}
    );

    if (!response.success || !response.data?.roles.includes("BUSINESS")) {
      return "activation-failed";
    }

    updateAuthUser({ roles: response.data.roles });
  }

  setActiveWorkspace("BUSINESS");
  return "authed";
}
