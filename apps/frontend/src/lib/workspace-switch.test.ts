import { beforeEach, describe, expect, it, vi } from "vitest";

const apiPostMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiPost: apiPostMock
}));

import {
  getActiveWorkspace,
  getAuthToken,
  getAuthUser,
  hasAuthRole,
  saveAuthSession,
  setActiveWorkspace,
  type AuthUser
} from "@/lib/auth";
import { ensureBusinessWorkspaceAccess } from "@/lib/business-workspace";

const TOKEN = "test-token-123";

function architectUser(roles?: AuthUser["roles"]): AuthUser {
  return {
    id: "user-1",
    fullName: "Archie Tect",
    email: "archie@test.local",
    role: "ARCHITECT",
    ...(roles ? { roles } : {})
  };
}

beforeEach(() => {
  localStorage.clear();
  apiPostMock.mockReset();
});

describe("workspace switching preserves authentication", () => {
  it("stores the active workspace separately from roles and never touches the token", () => {
    saveAuthSession(TOKEN, architectUser(["ARCHITECT", "BUSINESS"]));
    expect(getActiveWorkspace()).toBe("ARCHITECT");

    setActiveWorkspace("BUSINESS");
    expect(getActiveWorkspace()).toBe("BUSINESS");
    expect(getAuthToken()).toBe(TOKEN);
    expect(getAuthUser()?.role).toBe("ARCHITECT");

    setActiveWorkspace("ARCHITECT");
    expect(getAuthToken()).toBe(TOKEN);
    expect(hasAuthRole(getAuthUser(), "ARCHITECT")).toBe(true);
    expect(hasAuthRole(getAuthUser(), "BUSINESS")).toBe(true);
  });

  it("hasAuthRole falls back to the legacy single role", () => {
    expect(hasAuthRole(architectUser(), "ARCHITECT")).toBe(true);
    expect(hasAuthRole(architectUser(), "BUSINESS")).toBe(false);
    expect(hasAuthRole(null, "BUSINESS")).toBe(false);
  });

  it("enters the Business workspace directly when the account already holds BUSINESS", async () => {
    saveAuthSession(TOKEN, architectUser(["ARCHITECT", "BUSINESS"]));

    const access = await ensureBusinessWorkspaceAccess();

    expect(access).toBe("authed");
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(getActiveWorkspace()).toBe("BUSINESS");
    expect(getAuthToken()).toBe(TOKEN);
  });

  it("activates the BUSINESS capability for an architect-only account, keeping the session", async () => {
    saveAuthSession(TOKEN, architectUser(["ARCHITECT"]));
    apiPostMock.mockResolvedValue({
      success: true,
      data: { roles: ["ARCHITECT", "BUSINESS"], activeWorkspace: "BUSINESS" }
    });

    const access = await ensureBusinessWorkspaceAccess();

    expect(access).toBe("authed");
    expect(apiPostMock).toHaveBeenCalledWith("/auth/business-workspace/activate", {});
    expect(getAuthToken()).toBe(TOKEN);
    const user = getAuthUser();
    expect(user?.role).toBe("ARCHITECT");
    expect(hasAuthRole(user, "BUSINESS")).toBe(true);
    expect(getActiveWorkspace()).toBe("BUSINESS");
  });

  it("reports failure without destroying the session when activation fails", async () => {
    saveAuthSession(TOKEN, architectUser(["ARCHITECT"]));
    apiPostMock.mockResolvedValue({ success: false, error: "nope" });

    const access = await ensureBusinessWorkspaceAccess();

    expect(access).toBe("activation-failed");
    expect(getAuthToken()).toBe(TOKEN);
    expect(getAuthUser()?.role).toBe("ARCHITECT");
  });

  it("requires authentication", async () => {
    expect(await ensureBusinessWorkspaceAccess()).toBe("unauthenticated");
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});
