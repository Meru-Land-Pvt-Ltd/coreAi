import { describe, expect, it } from "vitest";
import { omitLegacyFreeInstallationValue } from "./billing-details";

describe("omitLegacyFreeInstallationValue", () => {
  it.each([
    "Free Install",
    "Free Installation",
    "freeinstallation",
    " free_installation "
  ])("removes the legacy %s billing placeholder", (value) => {
    expect(omitLegacyFreeInstallationValue(value)).toBeNull();
  });

  it("preserves a real billing value", () => {
    expect(omitLegacyFreeInstallationValue(" 42 Example Street ")).toBe(
      "42 Example Street"
    );
  });

  it("normalizes missing and blank values to null", () => {
    expect(omitLegacyFreeInstallationValue(null)).toBeNull();
    expect(omitLegacyFreeInstallationValue(undefined)).toBeNull();
    expect(omitLegacyFreeInstallationValue("   ")).toBeNull();
  });
});
