/**
 * "My Keys" locker — settings page UI.
 *
 * The transport layer (`@/lib/api`) is mocked and driven by path, so the real
 * `features/api` wrappers run end to end. We prove: the empty-state explainer
 * renders, adding a key posts { name, value } and refreshes the masked list, and
 * the plaintext value the architect typed is NEVER shown back in the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { apiGetMock, apiPostMock, apiDeleteMock, apiPutMock, apiPatchMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  apiDeleteMock: vi.fn(),
  apiPutMock: vi.fn(),
  apiPatchMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  apiGet: apiGetMock,
  apiPost: apiPostMock,
  apiDelete: apiDeleteMock,
  apiPut: apiPutMock,
  apiPatch: apiPatchMock,
  apiClient: { get: vi.fn(), post: vi.fn() }
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: () => ({
    id: "arch-1",
    email: "architect@example.com",
    fullName: "Ada Architect",
    role: "ARCHITECT",
    profilePhotoUrl: null
  }),
  logout: vi.fn(),
  saveAuthSession: vi.fn(),
  updateAuthUser: vi.fn()
}));

import ArchitectSettingsPage from "./page";

const MASK = "••••••••";

/** In-memory locker the mocked transport reads/writes so add + delete round-trip. */
let lockerState: Array<{ id: string; name: string; maskedValue: string; createdAt: string; updatedAt: string }>;

beforeEach(() => {
  lockerState = [];
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  apiDeleteMock.mockReset();
  apiPutMock.mockReset();
  apiPatchMock.mockReset();

  apiGetMock.mockImplementation(async (path: string) => {
    if (path === "/architect/secrets") {
      return { success: true, data: { secrets: lockerState } };
    }
    if (path === "/countries") {
      return { success: true, data: { countries: [] } };
    }
    // Settings payload load takes the graceful fallback path.
    return { success: false, error: "not mocked", code: "NOT_MOCKED" };
  });

  apiPostMock.mockImplementation(async (path: string, body: { name: string; value: string }) => {
    if (path === "/architect/secrets") {
      const now = new Date("2026-08-16T12:00:00.000Z").toISOString();
      lockerState = [
        { id: `sec-${lockerState.length + 1}`, name: body.name, maskedValue: MASK, createdAt: now, updatedAt: now },
        ...lockerState
      ];
      return { success: true, data: { secret: lockerState[0] } };
    }
    return { success: false, error: "not mocked", code: "NOT_MOCKED" };
  });

  apiDeleteMock.mockImplementation(async (path: string) => {
    const id = path.replace("/architect/secrets/", "");
    lockerState = lockerState.filter((s) => s.id !== id);
    return { success: true, data: { deleted: true } };
  });
});

afterEach(() => cleanup());

async function renderAndOpenKeys() {
  const user = userEvent.setup();
  render(<ArchitectSettingsPage />);
  // Wait for the initial loads to settle, then reveal the My Keys panel.
  await waitFor(() => expect(screen.getByTestId("architect-settings-tab-keys")).toBeTruthy());
  await user.click(screen.getByTestId("architect-settings-tab-keys"));
  return user;
}

describe("My Keys settings panel", () => {
  it("shows the empty-state explainer when the architect has no keys", async () => {
    await renderAndOpenKeys();
    await waitFor(() => expect(screen.getByTestId("architect-secrets-empty")).toBeTruthy());
    expect(screen.getByTestId("architect-secrets-empty").textContent).toContain(
      "Store an API key once"
    );
  });

  it("adds a key: posts { name, value } and shows it masked, never the plaintext", async () => {
    const user = await renderAndOpenKeys();
    await waitFor(() => expect(screen.getByTestId("architect-secrets-empty")).toBeTruthy());

    await user.type(screen.getByTestId("architect-secret-name-input"), "Weather API key");
    await user.type(screen.getByTestId("architect-secret-value-input"), "sk-raw-value-9999");
    await user.click(screen.getByTestId("architect-secret-save-button"));

    // The value was sent to the server exactly once, with the right shape.
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(1));
    expect(apiPostMock).toHaveBeenCalledWith("/architect/secrets", {
      name: "Weather API key",
      value: "sk-raw-value-9999"
    });

    // The list now shows the key, masked — and the raw value is nowhere on screen.
    const list = await screen.findByTestId("architect-secrets-list");
    expect(within(list).getByText("Weather API key")).toBeTruthy();
    expect(within(list).getByText(MASK)).toBeTruthy();
    expect(screen.queryByText("sk-raw-value-9999")).toBeNull();
  });

  it("deletes a key and removes its row", async () => {
    lockerState = [
      { id: "sec-1", name: "Stocks key", maskedValue: MASK, createdAt: "x", updatedAt: "x" }
    ];
    const user = await renderAndOpenKeys();

    const row = await screen.findByTestId("architect-secret-row-sec-1");
    expect(row).toBeTruthy();
    await user.click(screen.getByTestId("architect-secret-delete-sec-1"));

    await waitFor(() => expect(apiDeleteMock).toHaveBeenCalledWith("/architect/secrets/sec-1"));
    await waitFor(() => expect(screen.queryByTestId("architect-secret-row-sec-1")).toBeNull());
  });
});
