/**
 * After-Hours & Emergency Routing config section: safety warnings always
 * visible, supported contact methods only (SMS/EMAIL/NONE — no PHONE/WEBHOOK),
 * truthful earliest-available-slot wording, and controlled onChange wiring.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AfterHoursPolicySection,
  DEFAULT_AFTER_HOURS_POLICY_FORM
} from "./after-hours-policy-section";

describe("AfterHoursPolicySection", () => {
  beforeEach(() => {
    cleanup();
  });

  it("always shows the clinical-safety warnings and hides detail fields until enabled", () => {
    const onChange = vi.fn();
    render(<AfterHoursPolicySection value={DEFAULT_AFTER_HOURS_POLICY_FORM} onChange={onChange} />);

    const warnings = screen.getByTestId("business-setup-after-hours-warnings");
    expect(warnings.textContent).toContain("This feature does not provide medical diagnosis.");
    expect(warnings.textContent).toContain(
      "Emergency scripts should be reviewed by a licensed professional before production use."
    );
    expect(warnings.textContent).toContain(
      "For immediate emergencies, the assistant directs callers to emergency services."
    );

    expect(screen.queryByTestId("business-setup-after-hours-category")).toBeNull();

    fireEvent.click(screen.getByTestId("business-setup-after-hours-enabled"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_AFTER_HOURS_POLICY_FORM, enabled: true });
  });

  it("offers only supported contact methods and the truthful earliest-slot setting", () => {
    render(
      <AfterHoursPolicySection
        value={{ ...DEFAULT_AFTER_HOURS_POLICY_FORM, enabled: true }}
        onChange={vi.fn()}
      />
    );

    const methodSelect = screen.getByTestId("business-setup-after-hours-contact-method") as HTMLSelectElement;
    const options = Array.from(methodSelect.options).map((option) => option.value);
    expect(options).toEqual(["NONE", "SMS", "EMAIL"]);
    expect(options).not.toContain("PHONE");
    expect(options).not.toContain("WEBHOOK");

    // Truthful wording: earliest available appointment, never "emergency slots".
    const earliest = screen.getByTestId("business-setup-after-hours-earliest-slot");
    expect(earliest.closest("label")?.textContent).toContain("earliest available");
    expect(screen.getByTestId("business-setup-after-hours-section").textContent).not.toContain(
      "checking emergency slots"
    );
  });

  it("edits flow through onChange (category, callback-number privacy toggle)", () => {
    const onChange = vi.fn();
    const enabled = { ...DEFAULT_AFTER_HOURS_POLICY_FORM, enabled: true };
    render(<AfterHoursPolicySection value={enabled} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("business-setup-after-hours-category"), {
      target: { value: "DENTAL" }
    });
    expect(onChange).toHaveBeenCalledWith({ ...enabled, emergencyCategory: "DENTAL" });

    fireEvent.click(screen.getByTestId("business-setup-after-hours-include-callback"));
    expect(onChange).toHaveBeenCalledWith({ ...enabled, includeCallbackInStaffAlert: false });
  });
});
