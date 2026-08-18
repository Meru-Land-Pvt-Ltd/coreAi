import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SmartDesignerBrainCard } from "./smart-designer-brain-card";

/**
 * Admin → Smart Designer Brain card: load, swap the battery, and put the
 * standard one back — with the API client mocked, mirroring the door brain
 * card suite.
 */

const { getAdminSmartDesignerBrainMock, updateAdminSmartDesignerBrainMock } = vi.hoisted(() => ({
  getAdminSmartDesignerBrainMock: vi.fn(),
  updateAdminSmartDesignerBrainMock: vi.fn()
}));

vi.mock("@/components/admin/features/smart-designer-brain", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/admin/features/smart-designer-brain")
  >("@/components/admin/features/smart-designer-brain");
  return {
    ...actual,
    getAdminSmartDesignerBrain: getAdminSmartDesignerBrainMock,
    updateAdminSmartDesignerBrain: updateAdminSmartDesignerBrainMock
  };
});

const PROVIDERS = [
  { id: "claude", displayName: "Anthropic Claude" },
  { id: "gemini", displayName: "Google Gemini" },
  { id: "openai", displayName: "OpenAI" }
];

function smartDesignerBrainPayload(
  providerId: string,
  modelId: string | null,
  isDefault: boolean
) {
  return {
    providerId,
    modelId,
    isDefault,
    updatedAt: isDefault ? null : "2026-08-16T00:00:00.000Z",
    defaultProviderId: "claude",
    providers: PROVIDERS,
    models: []
  };
}

beforeEach(() => {
  cleanup();
  getAdminSmartDesignerBrainMock.mockReset().mockResolvedValue({
    success: true,
    data: { smartDesignerBrain: smartDesignerBrainPayload("claude", null, true) }
  });
  updateAdminSmartDesignerBrainMock.mockReset();
});

describe("Admin → Smart Designer Brain card", () => {
  it("loads the saved battery with the plain-words explainer", async () => {
    render(<SmartDesignerBrainCard />);

    const provider = (await screen.findByTestId(
      "admin-smart-designer-brain-provider"
    )) as HTMLSelectElement;
    expect(provider.value).toBe("claude");
    expect(
      (screen.getByTestId("admin-smart-designer-brain-model") as HTMLInputElement).value
    ).toBe("");
    expect(screen.getByTestId("admin-smart-designer-brain-status").textContent).toBe(
      "Platform default"
    );
    expect(screen.getByTestId("admin-smart-designer-brain-explainer").textContent).toBe(
      "This brain designs every product's interface and handles the change requests architects type. The standard one is Claude."
    );
    // Nothing changed yet — Save stays off.
    expect(
      screen.getByTestId("admin-smart-designer-brain-save").hasAttribute("disabled")
    ).toBe(true);
  });

  it("offers every AI service the engine can run the designer on", async () => {
    render(<SmartDesignerBrainCard />);

    const provider = (await screen.findByTestId(
      "admin-smart-designer-brain-provider"
    )) as HTMLSelectElement;
    expect(Array.from(provider.options).map((option) => option.value)).toEqual([
      "claude",
      "gemini",
      "openai"
    ]);
  });

  it("falls back to the built-in provider list when the server sends none", async () => {
    getAdminSmartDesignerBrainMock.mockResolvedValue({
      success: true,
      data: {
        smartDesignerBrain: { ...smartDesignerBrainPayload("claude", null, true), providers: [] }
      }
    });

    render(<SmartDesignerBrainCard />);

    const provider = (await screen.findByTestId(
      "admin-smart-designer-brain-provider"
    )) as HTMLSelectElement;
    expect(Array.from(provider.options).map((option) => option.value)).toContain("claude");
    expect(provider.options.length).toBeGreaterThan(1);
  });

  it("shows the API error when loading fails", async () => {
    getAdminSmartDesignerBrainMock.mockResolvedValue({ success: false, error: "Not allowed" });

    render(<SmartDesignerBrainCard />);

    expect((await screen.findByTestId("admin-smart-designer-brain-error")).textContent).toBe(
      "Not allowed"
    );
  });

  it("saves a new provider and model and confirms in plain words", async () => {
    updateAdminSmartDesignerBrainMock.mockResolvedValue({
      success: true,
      data: {
        smartDesignerBrain: smartDesignerBrainPayload("openai", "gpt-4o", false),
        restoredDefault: false
      }
    });

    render(<SmartDesignerBrainCard />);
    const user = userEvent.setup();

    await screen.findByTestId("admin-smart-designer-brain-provider");
    await user.selectOptions(screen.getByTestId("admin-smart-designer-brain-provider"), "openai");
    await user.type(screen.getByTestId("admin-smart-designer-brain-model"), "gpt-4o");
    await user.click(screen.getByTestId("admin-smart-designer-brain-save"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-smart-designer-brain-message").textContent).toContain(
        "Every new design uses it right away"
      )
    );
    expect(updateAdminSmartDesignerBrainMock).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-4o"
    });
    expect(screen.getByTestId("admin-smart-designer-brain-status").textContent).toBe("Customized");
    // The just-saved battery becomes the clean state — Save switches off again.
    expect(
      screen.getByTestId("admin-smart-designer-brain-save").hasAttribute("disabled")
    ).toBe(true);
  });

  it("saves a provider on its own when the model box is left blank", async () => {
    updateAdminSmartDesignerBrainMock.mockResolvedValue({
      success: true,
      data: {
        smartDesignerBrain: smartDesignerBrainPayload("gemini", null, false),
        restoredDefault: false
      }
    });

    render(<SmartDesignerBrainCard />);
    const user = userEvent.setup();

    await screen.findByTestId("admin-smart-designer-brain-provider");
    await user.selectOptions(screen.getByTestId("admin-smart-designer-brain-provider"), "gemini");
    await user.click(screen.getByTestId("admin-smart-designer-brain-save"));

    await waitFor(() =>
      expect(updateAdminSmartDesignerBrainMock).toHaveBeenCalledWith({
        provider: "gemini",
        model: ""
      })
    );
  });

  it("puts the standard brain back by saving blank", async () => {
    getAdminSmartDesignerBrainMock.mockResolvedValue({
      success: true,
      data: { smartDesignerBrain: smartDesignerBrainPayload("openai", "gpt-4o-mini", false) }
    });
    updateAdminSmartDesignerBrainMock.mockResolvedValue({
      success: true,
      data: {
        smartDesignerBrain: smartDesignerBrainPayload("claude", null, true),
        restoredDefault: true
      }
    });

    render(<SmartDesignerBrainCard />);
    const user = userEvent.setup();

    await screen.findByTestId("admin-smart-designer-brain-provider");
    await user.click(screen.getByTestId("admin-smart-designer-brain-restore"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-smart-designer-brain-message").textContent).toContain(
        "Back to the standard brain"
      )
    );
    expect(updateAdminSmartDesignerBrainMock).toHaveBeenCalledWith({ provider: "", model: "" });
    expect(
      (screen.getByTestId("admin-smart-designer-brain-provider") as HTMLSelectElement).value
    ).toBe("claude");
    expect(
      (screen.getByTestId("admin-smart-designer-brain-model") as HTMLInputElement).value
    ).toBe("");
    expect(screen.getByTestId("admin-smart-designer-brain-status").textContent).toBe(
      "Platform default"
    );
  });

  it("surfaces a save failure without losing the picked battery", async () => {
    updateAdminSmartDesignerBrainMock.mockResolvedValue({
      success: false,
      error: "That model belongs to a different AI service."
    });

    render(<SmartDesignerBrainCard />);
    const user = userEvent.setup();

    await screen.findByTestId("admin-smart-designer-brain-provider");
    await user.selectOptions(screen.getByTestId("admin-smart-designer-brain-provider"), "openai");
    await user.type(screen.getByTestId("admin-smart-designer-brain-model"), "claude-opus-5");
    await user.click(screen.getByTestId("admin-smart-designer-brain-save"));

    expect((await screen.findByTestId("admin-smart-designer-brain-error")).textContent).toBe(
      "That model belongs to a different AI service."
    );
    expect(
      (screen.getByTestId("admin-smart-designer-brain-provider") as HTMLSelectElement).value
    ).toBe("openai");
    expect(
      (screen.getByTestId("admin-smart-designer-brain-model") as HTMLInputElement).value
    ).toBe("claude-opus-5");
  });
});
