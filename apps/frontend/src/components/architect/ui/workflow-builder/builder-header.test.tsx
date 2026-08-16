import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuilderHeader } from "./builder-header";

/**
 * The standalone Preview button is gone — the live preview now lives in the
 * Test tab with the Design Brain docked beside it. The header keeps exactly
 * "Run" and "Publish Agent" as its actions, and on the Preview step it also
 * carries the compact device switcher plus the quiet "Advanced testing"
 * link (both moved up from the old preview toolbar strip).
 */

type HeaderOverrides = Partial<Parameters<typeof BuilderHeader>[0]>;

function renderHeader(overrides: HeaderOverrides = {}) {
  return render(
    <BuilderHeader
      agentName="Dental Receptionist"
      message=""
      activeTab="build"
      running={false}
      saving={false}
      hasGmailFlow={false}
      onAgentNameChange={vi.fn()}
      onTabChange={vi.fn()}
      onRunTest={vi.fn()}
      onSave={vi.fn()}
      {...overrides}
    />
  );
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

describe("BuilderHeader", () => {
  it("has no Preview button — only Run and Publish Agent actions", () => {
    renderHeader();

    expect(screen.queryByTestId("builder-preview")).toBeNull();
    // The step tab is now labeled "Preview"; only the old standalone Preview
    // action button must stay gone.

    expect(screen.getByTestId("builder-run-test").textContent).toContain("Run");
    expect(screen.getByTestId("builder-run-test").textContent).not.toContain("Test Workflow");
    expect(screen.getByTestId("builder-publish-marketplace").textContent).toBe("Publish Agent");
  });

  it("keeps the four step tabs untouched", () => {
    renderHeader();

    for (const tab of ["build", "test", "configure", "publish"]) {
      expect(screen.getByTestId(`builder-tab-${tab}`)).toBeTruthy();
    }
  });
});

describe("BuilderHeader preview device switcher", () => {
  it("stays hidden off the Preview step", () => {
    renderHeader();

    expect(screen.queryByTestId("preview-device-switcher")).toBeNull();
    expect(screen.queryByTestId("preview-panel-advanced-toggle")).toBeNull();
  });

  it("renders the compact icon-only switcher with the customer promise as its tooltip", () => {
    renderHeader({
      activeTab: "test",
      showPreviewControls: true,
      previewDevice: "desktop",
      onPreviewDeviceChange: vi.fn(),
      onOpenAdvanced: vi.fn()
    });

    const wrapper = screen.getByTestId("preview-device-switcher");
    // The old caption is now a tooltip only — no visible text anywhere.
    expect(wrapper.getAttribute("title")).toBe(
      "This is exactly what your customer will see."
    );
    expect(screen.queryByText("This is exactly what your customer will see.")).toBeNull();

    for (const [id, label] of [
      ["desktop", "Desktop"],
      ["tablet", "Tablet"],
      ["phone", "Phone"]
    ] as const) {
      const button = screen.getByTestId(`preview-device-${id}`);
      expect(button.getAttribute("aria-label")).toBe(label);
      expect(button.getAttribute("title")).toBe(label);
      // Icon-only: no visible text label inside the segment.
      expect(button.textContent).toBe("");
    }

    expect(
      screen.getByTestId("preview-device-desktop").getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByTestId("preview-device-tablet").getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("reflects the active device and reports picks upward", async () => {
    const onPreviewDeviceChange = vi.fn();
    const user = userEvent.setup();
    renderHeader({
      activeTab: "test",
      showPreviewControls: true,
      previewDevice: "tablet",
      onPreviewDeviceChange
    });

    expect(
      screen.getByTestId("preview-device-tablet").getAttribute("aria-pressed")
    ).toBe("true");

    await user.click(screen.getByTestId("preview-device-phone"));
    expect(onPreviewDeviceChange).toHaveBeenCalledWith("phone");
  });

  it("opens Advanced testing from the quiet link beside the switcher", async () => {
    const onOpenAdvanced = vi.fn();
    const user = userEvent.setup();
    renderHeader({
      activeTab: "test",
      showPreviewControls: true,
      previewDevice: "desktop",
      onOpenAdvanced
    });

    await user.click(screen.getByTestId("preview-panel-advanced-toggle"));
    expect(onOpenAdvanced).toHaveBeenCalledTimes(1);
  });
});

describe("BuilderHeader arrange toggle", () => {
  it("stays hidden off the Preview step", () => {
    renderHeader();
    expect(screen.queryByTestId("preview-arrange-toggle")).toBeNull();
  });

  it("stays hidden on tablet and phone — desktop view only", () => {
    renderHeader({
      activeTab: "test",
      showPreviewControls: true,
      previewDevice: "tablet",
      onArrangeModeChange: vi.fn()
    });
    expect(screen.queryByTestId("preview-arrange-toggle")).toBeNull();
  });

  it("renders on desktop with plain copy and reports the toggle upward", async () => {
    const onArrangeModeChange = vi.fn();
    const user = userEvent.setup();
    renderHeader({
      activeTab: "test",
      showPreviewControls: true,
      previewDevice: "desktop",
      arrangeMode: false,
      onArrangeModeChange
    });

    const toggle = screen.getByTestId("preview-arrange-toggle");
    expect(toggle.textContent).toBe("Arrange");
    expect(toggle.getAttribute("title")).toBe("Drag to arrange");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await user.click(toggle);
    expect(onArrangeModeChange).toHaveBeenCalledWith(true);
  });

  it("shows the amber active state while arrange mode is on, and toggles off", async () => {
    const onArrangeModeChange = vi.fn();
    const user = userEvent.setup();
    renderHeader({
      activeTab: "test",
      showPreviewControls: true,
      previewDevice: "desktop",
      arrangeMode: true,
      onArrangeModeChange
    });

    const toggle = screen.getByTestId("preview-arrange-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.className).toContain("bg-amber-500");

    await user.click(toggle);
    expect(onArrangeModeChange).toHaveBeenCalledWith(false);
  });
});
