import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GOOGLE_CALENDAR_DISCLOSURE } from "@coreai/shared";
import { GoogleDisclosureModal } from "./google-disclosure-modal";

/**
 * Requirement: OAuth may begin ONLY after "Agree and continue to Google".
 * Cancel, Escape, and outside/backdrop clicks must never trigger the agree
 * flow (which is what records consent and starts OAuth).
 */

describe("GoogleDisclosureModal", () => {
  const onAgree = vi.fn(async () => {});
  const onCancel = vi.fn();

  beforeEach(() => {
    cleanup();
    onAgree.mockClear();
    onCancel.mockClear();
  });

  it("renders the disclosure content and the exact agree label", () => {
    render(<GoogleDisclosureModal open onAgree={onAgree} onCancel={onCancel} />);
    expect(screen.getByTestId("google-disclosure-modal")).toBeTruthy();
    expect(screen.getByTestId("google-disclosure-agree").textContent).toBe("Agree and continue to Google");
    expect(screen.getAllByTestId("google-disclosure-bullet")).toHaveLength(
      GOOGLE_CALENDAR_DISCLOSURE.bullets.length
    );
  });

  it("renders nothing when closed", () => {
    render(<GoogleDisclosureModal open={false} onAgree={onAgree} onCancel={onCancel} />);
    expect(screen.queryByTestId("google-disclosure-modal")).toBeNull();
  });

  it("calls onAgree ONLY when the agree button is clicked", async () => {
    const user = userEvent.setup();
    render(<GoogleDisclosureModal open onAgree={onAgree} onCancel={onCancel} />);
    await user.click(screen.getByTestId("google-disclosure-agree"));
    expect(onAgree).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Cancel closes without recording consent", async () => {
    const user = userEvent.setup();
    render(<GoogleDisclosureModal open onAgree={onAgree} onCancel={onCancel} />);
    await user.click(screen.getByTestId("google-disclosure-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAgree).not.toHaveBeenCalled();
  });

  it("Escape closes without recording consent", async () => {
    const user = userEvent.setup();
    render(<GoogleDisclosureModal open onAgree={onAgree} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAgree).not.toHaveBeenCalled();
  });

  it("backdrop (outside) click closes without recording consent; inner clicks do not close", async () => {
    const user = userEvent.setup();
    render(<GoogleDisclosureModal open onAgree={onAgree} onCancel={onCancel} />);

    await user.click(screen.getByTestId("google-disclosure-title"));
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("google-disclosure-modal"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAgree).not.toHaveBeenCalled();
  });

  it("surfaces onAgree failures and re-enables the buttons", async () => {
    const user = userEvent.setup();
    const failing = vi.fn(async () => {
      throw new Error("Could not record your agreement.");
    });
    render(<GoogleDisclosureModal open onAgree={failing} onCancel={onCancel} />);
    await user.click(screen.getByTestId("google-disclosure-agree"));
    expect(await screen.findByTestId("google-disclosure-error")).toBeTruthy();
    expect((screen.getByTestId("google-disclosure-agree") as HTMLButtonElement).disabled).toBe(false);
  });
});
