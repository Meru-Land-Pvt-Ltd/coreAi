import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckoutUsageCharges } from "./checkout-usage-charges";

describe("checkout usage charges", () => {
  const services = [
    {
      code: "openai_gpt4o_mini",
      invoiceLabel: "Conversation intelligence",
      unit: "PER_MINUTE" as const,
      billingRateUsd: 0.01
    },
    {
      code: "sms_confirmation",
      invoiceLabel: "SMS confirmation",
      unit: "PER_SMS" as const,
      billingRateUsd: 0.0085
    },
    {
      code: "phone_number",
      invoiceLabel: "Dedicated phone number",
      unit: "PER_UNIT" as const,
      billingRateUsd: 2
    }
  ];

  it("is collapsed initially and shows invoice labels with mapped billing units", () => {
    render(<CheckoutUsageCharges services={services} />);

    const toggle = screen.getByTestId("checkout-usage-charges-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Conversation intelligence")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Conversation intelligence")).toBeTruthy();
    expect(screen.getByText("$0.01 / min")).toBeTruthy();
    expect(screen.getByText("$0.0085 per SMS")).toBeTruthy();
    expect(screen.getByText("$2.00 / unit")).toBeTruthy();
  });

  it("renders nothing when the selected agent has no applicable priced services", () => {
    const { container } = render(<CheckoutUsageCharges services={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
