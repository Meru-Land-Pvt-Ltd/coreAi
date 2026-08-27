import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DesignRulesPage from "./page";

/**
 * Admin → AI Builder rules page: load, edit + save, and restore-default —
 * with the API client mocked, mirroring the other admin page suites.
 */

const { getAdminDesignRulesMock, updateAdminDesignRulesMock } = vi.hoisted(() => ({
  getAdminDesignRulesMock: vi.fn(),
  updateAdminDesignRulesMock: vi.fn()
}));

vi.mock("@/components/admin/features/design-rules", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/admin/features/design-rules")
  >("@/components/admin/features/design-rules");
  return {
    ...actual,
    getAdminDesignRules: getAdminDesignRulesMock,
    updateAdminDesignRules: updateAdminDesignRulesMock
  };
});

const DEFAULT_RULES = "1. Mobile first, always.\n2. Keep text easy to read.";
const CUSTOM_RULES = "1. Everything in warm colors.";

function rulesPayload(value: string, isDefault: boolean) {
  return {
    value,
    isDefault,
    updatedAt: isDefault ? null : "2026-08-16T00:00:00.000Z",
    defaultValue: DEFAULT_RULES
  };
}

beforeEach(() => {
  cleanup();
  getAdminDesignRulesMock.mockReset().mockResolvedValue({
    success: true,
    data: { rules: rulesPayload(DEFAULT_RULES, true) }
  });
  updateAdminDesignRulesMock.mockReset();
});

describe("AI Builder rules page", () => {
  it("loads the effective rules into the editor with a character count", async () => {
    render(<DesignRulesPage />);

    const textarea = (await screen.findByTestId(
      "admin-design-rules-textarea"
    )) as HTMLTextAreaElement;
    expect(textarea.value).toBe(DEFAULT_RULES);
    expect(screen.getByTestId("admin-design-rules-status").textContent).toBe("Platform default");
    expect(screen.getByTestId("admin-design-rules-count").textContent).toContain(
      `${DEFAULT_RULES.length} / 8000`
    );
    expect(screen.getByTestId("admin-design-rules-subtitle").textContent).toBe(
      "These rules discipline the AI Builder on every styling request."
    );
    // Nothing edited yet — Save stays off.
    expect(screen.getByTestId("admin-design-rules-save").hasAttribute("disabled")).toBe(true);
  });

  it("shows the API error when loading fails", async () => {
    getAdminDesignRulesMock.mockResolvedValue({ success: false, error: "Not allowed" });

    render(<DesignRulesPage />);

    expect((await screen.findByTestId("admin-design-rules-error")).textContent).toBe("Not allowed");
  });

  it("saves edited rules and confirms in plain words", async () => {
    updateAdminDesignRulesMock.mockResolvedValue({
      success: true,
      data: { rules: rulesPayload(CUSTOM_RULES, false), restoredDefault: false }
    });

    render(<DesignRulesPage />);
    const user = userEvent.setup();

    const textarea = await screen.findByTestId("admin-design-rules-textarea");
    await user.clear(textarea);
    await user.type(textarea, CUSTOM_RULES);
    await user.click(screen.getByTestId("admin-design-rules-save"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-design-rules-message").textContent).toContain("Rules saved")
    );
    expect(updateAdminDesignRulesMock).toHaveBeenCalledWith(CUSTOM_RULES);
    expect(screen.getByTestId("admin-design-rules-status").textContent).toBe("Customized");
    // The just-saved text becomes the clean state — Save switches off again.
    expect(screen.getByTestId("admin-design-rules-save").hasAttribute("disabled")).toBe(true);
  });

  it("restore default saves blank and brings the platform rulebook back", async () => {
    getAdminDesignRulesMock.mockResolvedValue({
      success: true,
      data: { rules: rulesPayload(CUSTOM_RULES, false) }
    });
    updateAdminDesignRulesMock.mockResolvedValue({
      success: true,
      data: { rules: rulesPayload(DEFAULT_RULES, true), restoredDefault: true }
    });

    render(<DesignRulesPage />);
    const user = userEvent.setup();

    await screen.findByTestId("admin-design-rules-textarea");
    await user.click(screen.getByTestId("admin-design-rules-restore"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-design-rules-message").textContent).toContain(
        "Default rules restored"
      )
    );
    expect(updateAdminDesignRulesMock).toHaveBeenCalledWith("");
    const textarea = screen.getByTestId("admin-design-rules-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe(DEFAULT_RULES);
    expect(screen.getByTestId("admin-design-rules-status").textContent).toBe("Platform default");
  });

  it("surfaces a save failure without losing the editor content", async () => {
    updateAdminDesignRulesMock.mockResolvedValue({ success: false, error: "Save failed" });

    render(<DesignRulesPage />);
    const user = userEvent.setup();

    const textarea = await screen.findByTestId("admin-design-rules-textarea");
    await user.clear(textarea);
    await user.type(textarea, CUSTOM_RULES);
    await user.click(screen.getByTestId("admin-design-rules-save"));

    expect((await screen.findByTestId("admin-design-rules-error")).textContent).toBe("Save failed");
    expect((textarea as HTMLTextAreaElement).value).toBe(CUSTOM_RULES);
  });
});
