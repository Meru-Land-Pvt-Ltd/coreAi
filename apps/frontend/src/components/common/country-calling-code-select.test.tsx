import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import {
  CountryCallingCodeSelect,
  type CountryCallingCode
} from "./country-calling-code-select";

const COUNTRIES: CountryCallingCode[] = [
  { id: "us", name: "United States of America", countryCode: "US", callingCode: "+1", flag: "🇺🇸" },
  { id: "in", name: "India", countryCode: "IN", callingCode: "+91", flag: "🇮🇳" }
];

afterEach(cleanup);

function SelectHarness() {
  const [countryCode, setCountryCode] = useState("US");

  return (
    <CountryCallingCodeSelect
      countries={COUNTRIES}
      value={countryCode}
      fallbackCallingCode="+1"
      loading={false}
      onChange={(country) => setCountryCode(country.countryCode)}
    />
  );
}

describe("CountryCallingCodeSelect", () => {
  it("shows only the flag and calling code when closed", () => {
    render(<SelectHarness />);

    const trigger = screen.getByTestId("architect-settings-phone-country-code");
    expect(trigger.textContent).toContain("🇺🇸 +1");
    expect(trigger.textContent).not.toContain("United States");
  });

  it("shows full country names and calling codes in the menu", async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);

    await user.click(screen.getByTestId("architect-settings-phone-country-code"));
    const menu = screen.getByTestId("architect-settings-phone-country-menu");
    expect(within(menu).getByText("United States of America")).toBeTruthy();
    expect(within(menu).getByText("India")).toBeTruthy();

    await user.click(screen.getByTestId("architect-settings-phone-country-in"));
    const trigger = screen.getByTestId("architect-settings-phone-country-code");
    expect(trigger.textContent).toContain("🇮🇳 +91");
    expect(trigger.textContent).not.toContain("India");
  });
});
