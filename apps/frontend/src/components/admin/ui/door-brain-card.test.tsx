import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DoorBrainCard } from "./door-brain-card";

/**
 * Admin → Door Brain card: load, swap the battery, and put the standard one
 * back — with the API client mocked, mirroring the other admin page suites.
 */

const { getAdminDoorBrainMock, updateAdminDoorBrainMock } = vi.hoisted(() => ({
  getAdminDoorBrainMock: vi.fn(),
  updateAdminDoorBrainMock: vi.fn()
}));

vi.mock("@/components/admin/features/door-brain", async () => {
  const actual = await vi.importActual<typeof import("@/components/admin/features/door-brain")>(
    "@/components/admin/features/door-brain"
  );
  return {
    ...actual,
    getAdminDoorBrain: getAdminDoorBrainMock,
    updateAdminDoorBrain: updateAdminDoorBrainMock
  };
});

const PROVIDERS = [
  { id: "gemini", displayName: "Google Gemini" },
  { id: "claude", displayName: "Anthropic Claude" },
  { id: "openai", displayName: "OpenAI" }
];

function doorBrainPayload(
  providerId: string,
  modelId: string | null,
  isDefault: boolean
) {
  return {
    providerId,
    modelId,
    isDefault,
    updatedAt: isDefault ? null : "2026-08-16T00:00:00.000Z",
    defaultProviderId: "gemini",
    providers: PROVIDERS,
    models: []
  };
}

beforeEach(() => {
  cleanup();
  getAdminDoorBrainMock.mockReset().mockResolvedValue({
    success: true,
    data: { doorBrain: doorBrainPayload("gemini", null, true) }
  });
  updateAdminDoorBrainMock.mockReset();
});

describe("Admin → Door Brain card", () => {
  it("loads the saved battery with the plain-words explainer", async () => {
    render(<DoorBrainCard />);

    const provider = (await screen.findByTestId("admin-door-brain-provider")) as HTMLSelectElement;
    expect(provider.value).toBe("gemini");
    expect((screen.getByTestId("admin-door-brain-model") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("admin-door-brain-status").textContent).toBe("Platform default");
    expect(screen.getByTestId("admin-door-brain-explainer").textContent).toBe(
      "This brain runs the smart input and output inside every step. Change it any time — everything switches instantly."
    );
    // Nothing changed yet — Save stays off.
    expect(screen.getByTestId("admin-door-brain-save").hasAttribute("disabled")).toBe(true);
  });

  it("offers every AI service the engine can run doors on", async () => {
    render(<DoorBrainCard />);

    const provider = (await screen.findByTestId("admin-door-brain-provider")) as HTMLSelectElement;
    expect(Array.from(provider.options).map((option) => option.value)).toEqual([
      "gemini",
      "claude",
      "openai"
    ]);
  });

  it("falls back to the built-in provider list when the server sends none", async () => {
    getAdminDoorBrainMock.mockResolvedValue({
      success: true,
      data: { doorBrain: { ...doorBrainPayload("gemini", null, true), providers: [] } }
    });

    render(<DoorBrainCard />);

    const provider = (await screen.findByTestId("admin-door-brain-provider")) as HTMLSelectElement;
    expect(Array.from(provider.options).map((option) => option.value)).toContain("gemini");
    expect(provider.options.length).toBeGreaterThan(1);
  });

  it("shows the API error when loading fails", async () => {
    getAdminDoorBrainMock.mockResolvedValue({ success: false, error: "Not allowed" });

    render(<DoorBrainCard />);

    expect((await screen.findByTestId("admin-door-brain-error")).textContent).toBe("Not allowed");
  });

  it("saves a new provider and model and confirms in plain words", async () => {
    updateAdminDoorBrainMock.mockResolvedValue({
      success: true,
      data: {
        doorBrain: doorBrainPayload("claude", "claude-haiku-4-5-20251001", false),
        restoredDefault: false
      }
    });

    render(<DoorBrainCard />);
    const user = userEvent.setup();

    await screen.findByTestId("admin-door-brain-provider");
    await user.selectOptions(screen.getByTestId("admin-door-brain-provider"), "claude");
    await user.type(screen.getByTestId("admin-door-brain-model"), "claude-haiku-4-5-20251001");
    await user.click(screen.getByTestId("admin-door-brain-save"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-door-brain-message").textContent).toContain(
        "Every step switched over right away"
      )
    );
    expect(updateAdminDoorBrainMock).toHaveBeenCalledWith({
      provider: "claude",
      model: "claude-haiku-4-5-20251001"
    });
    expect(screen.getByTestId("admin-door-brain-status").textContent).toBe("Customized");
    // The just-saved battery becomes the clean state — Save switches off again.
    expect(screen.getByTestId("admin-door-brain-save").hasAttribute("disabled")).toBe(true);
  });

  it("saves a provider on its own when the model box is left blank", async () => {
    updateAdminDoorBrainMock.mockResolvedValue({
      success: true,
      data: { doorBrain: doorBrainPayload("openai", null, false), restoredDefault: false }
    });

    render(<DoorBrainCard />);
    const user = userEvent.setup();

    await screen.findByTestId("admin-door-brain-provider");
    await user.selectOptions(screen.getByTestId("admin-door-brain-provider"), "openai");
    await user.click(screen.getByTestId("admin-door-brain-save"));

    await waitFor(() =>
      expect(updateAdminDoorBrainMock).toHaveBeenCalledWith({ provider: "openai", model: "" })
    );
  });

  it("puts the standard brain back by saving blank", async () => {
    getAdminDoorBrainMock.mockResolvedValue({
      success: true,
      data: { doorBrain: doorBrainPayload("openai", "gpt-4o-mini", false) }
    });
    updateAdminDoorBrainMock.mockResolvedValue({
      success: true,
      data: { doorBrain: doorBrainPayload("gemini", null, true), restoredDefault: true }
    });

    render(<DoorBrainCard />);
    const user = userEvent.setup();

    await screen.findByTestId("admin-door-brain-provider");
    await user.click(screen.getByTestId("admin-door-brain-restore"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-door-brain-message").textContent).toContain(
        "Back to the standard brain"
      )
    );
    expect(updateAdminDoorBrainMock).toHaveBeenCalledWith({ provider: "", model: "" });
    expect((screen.getByTestId("admin-door-brain-provider") as HTMLSelectElement).value).toBe(
      "gemini"
    );
    expect((screen.getByTestId("admin-door-brain-model") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("admin-door-brain-status").textContent).toBe("Platform default");
  });

  it("surfaces a save failure without losing the picked battery", async () => {
    updateAdminDoorBrainMock.mockResolvedValue({
      success: false,
      error: "That model belongs to a different AI service."
    });

    render(<DoorBrainCard />);
    const user = userEvent.setup();

    await screen.findByTestId("admin-door-brain-provider");
    await user.selectOptions(screen.getByTestId("admin-door-brain-provider"), "claude");
    await user.type(screen.getByTestId("admin-door-brain-model"), "gpt-4o");
    await user.click(screen.getByTestId("admin-door-brain-save"));

    expect((await screen.findByTestId("admin-door-brain-error")).textContent).toBe(
      "That model belongs to a different AI service."
    );
    expect((screen.getByTestId("admin-door-brain-provider") as HTMLSelectElement).value).toBe(
      "claude"
    );
    expect((screen.getByTestId("admin-door-brain-model") as HTMLInputElement).value).toBe("gpt-4o");
  });
});
