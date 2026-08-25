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

  it("carries no Advanced testing link — Rule 3 of the Preview Law", () => {
    renderHeader({ activeTab: "test", showPreviewControls: true });
    expect(screen.queryByTestId("preview-panel-advanced-toggle")).toBeNull();
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

describe("BuilderHeader preview width control", () => {
  it("stays hidden off the Preview step", () => {
    renderHeader();

    expect(screen.queryByTestId("preview-width-control")).toBeNull();
    expect(screen.queryByTestId("preview-width-select")).toBeNull();
  });

  it("offers the four widths in plain words, widest last", () => {
    renderHeader({
      activeTab: "test",
      showPreviewControls: true,
      previewDevice: "desktop",
      onPreviewWidthChange: vi.fn()
    });

    const control = screen.getByTestId("preview-width-control");
    expect(control.textContent).toContain("Width");
    // The rule the dial cannot break is stated where the architect can see it.
    expect(control.getAttribute("title")).toContain("Phones and tablets always use the whole screen");

    for (const [id, label] of [
      ["compact", "Compact"],
      ["standard", "Standard"],
      ["wide", "Wide"],
      ["full", "Full screen"]
    ] as const) {
      expect(screen.getByTestId(`preview-width-${id}`).textContent).toBe(label);
    }
  });

  it("shows the saved width and reports a change upward", async () => {
    const onPreviewWidthChange = vi.fn();
    const user = userEvent.setup();
    renderHeader({
      activeTab: "test",
      showPreviewControls: true,
      previewDevice: "desktop",
      previewWidth: "wide",
      onPreviewWidthChange
    });

    const select = screen.getByTestId("preview-width-select") as HTMLSelectElement;
    expect(select.value).toBe("wide");

    await user.selectOptions(select, "full");
    expect(onPreviewWidthChange).toHaveBeenCalledWith("full");
  });

  it("defaults to Standard when nothing is saved yet", () => {
    renderHeader({ activeTab: "test", showPreviewControls: true });

    expect((screen.getByTestId("preview-width-select") as HTMLSelectElement).value).toBe(
      "standard"
    );
  });

  it("stays visible on every device frame — the setting is saved either way", () => {
    for (const previewDevice of ["desktop", "tablet", "phone"] as const) {
      cleanup();
      renderHeader({ activeTab: "test", showPreviewControls: true, previewDevice });
      expect(screen.getByTestId("preview-width-control")).toBeTruthy();
    }
  });

  it("cannot write while the agent is review-locked", () => {
    renderHeader({ activeTab: "test", showPreviewControls: true, locked: true });

    expect(
      (screen.getByTestId("preview-width-select") as HTMLSelectElement).disabled
    ).toBe(true);
  });

  it("keeps the toolbar one row: same 32px pill height as the device switcher", () => {
    renderHeader({ activeTab: "test", showPreviewControls: true, previewDevice: "desktop" });

    expect(screen.getByTestId("preview-width-control").className).toContain("h-8");
    expect(screen.getByTestId("preview-device-switcher").className).toContain("h-8");
  });
});
