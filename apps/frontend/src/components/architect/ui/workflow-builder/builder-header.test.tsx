import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BuilderHeader } from "./builder-header";

/**
 * The standalone Preview button is gone — the live preview now lives in the
 * Test tab with the Design Brain docked beside it. The header keeps exactly
 * "Test Workflow" and "Publish Agent" as its actions.
 */

function renderHeader() {
  render(
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
    />
  );
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

describe("BuilderHeader", () => {
  it("has no Preview button — only Test Workflow and Publish Agent actions", () => {
    renderHeader();

    expect(screen.queryByTestId("builder-preview")).toBeNull();
    expect(document.body.textContent).not.toContain("Preview");

    expect(screen.getByTestId("builder-run-test").textContent).toContain("Test Workflow");
    expect(screen.getByTestId("builder-publish-marketplace").textContent).toBe("Publish Agent");
  });

  it("keeps the four step tabs untouched", () => {
    renderHeader();

    for (const tab of ["build", "test", "configure", "publish"]) {
      expect(screen.getByTestId(`builder-tab-${tab}`)).toBeTruthy();
    }
  });
});
