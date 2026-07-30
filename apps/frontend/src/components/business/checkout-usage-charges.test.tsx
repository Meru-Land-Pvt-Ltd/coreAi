import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckoutUsageCharges } from "./checkout-usage-charges";

describe("checkout usage charges", () => {
  // API-shaped fixture with values intentionally different from the seeded
  // Admin Pricing defaults, proving the component does not own live prices.
  const adminConfiguredServices = [
    {
      code: "admin_voice_connectivity",
      invoiceLabel: "Admin Voice Connectivity",
      unit: "PER_MINUTE" as const,
      billingRateUsd: 0.0091,
      showInPhoneCallBreakdown: true
    },
    {
      code: "admin_speech_recognition",
      invoiceLabel: "Admin Speech Recognition",
      unit: "PER_MINUTE" as const,
      billingRateUsd: 0.0063,
      showInPhoneCallBreakdown: true
    },
    {
      code: "admin_conversation_ai",
      invoiceLabel: "Admin Conversation AI",
      unit: "PER_MINUTE" as const,
      billingRateUsd: 0.0124,
      showInPhoneCallBreakdown: true
    },
    {
      code: "admin_voice_generation",
      invoiceLabel: "Admin Voice Generation",
      unit: "PER_MINUTE" as const,
      billingRateUsd: 0.0312,
      showInPhoneCallBreakdown: true
    },
    {
      code: "database_storage",
      invoiceLabel: "Call logs and records",
      unit: "PER_MINUTE" as const,
      billingRateUsd: 1,
      showInPhoneCallBreakdown: false
    },
    {
      code: "google_calendar",
      invoiceLabel: "Appointment booking",
      unit: "PER_MINUTE" as const,
      billingRateUsd: 1,
      showInPhoneCallBreakdown: false
    }
  ];

  it("shows the combined admin rate with the admin labels and prices", () => {
    render(<CheckoutUsageCharges services={adminConfiguredServices} />);

    const toggle = screen.getByTestId("checkout-usage-charges-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Phone Call Minutes")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Phone Call Minutes")).toBeTruthy();
    expect(screen.getByTestId("checkout-phone-call-total").textContent).toBe(
      "$0.059 / min"
    );
    expect(screen.queryByText("Admin Speech Recognition")).toBeNull();

    fireEvent.click(screen.getByTestId("checkout-phone-call-breakdown-toggle"));

    expect(screen.getByText("Admin Voice Connectivity")).toBeTruthy();
    expect(screen.getByText("Admin Speech Recognition")).toBeTruthy();
    expect(screen.getByText("Admin Conversation AI")).toBeTruthy();
    expect(screen.getByText("Admin Voice Generation")).toBeTruthy();
    expect(screen.getByText("$0.0091 / min")).toBeTruthy();
    expect(screen.getByText("$0.0063 / min")).toBeTruthy();
    expect(screen.getByText("$0.0124 / min")).toBeTruthy();
    expect(screen.getByText("$0.0312 / min")).toBeTruthy();
    expect(screen.queryByText("Call logs and records")).toBeNull();
    expect(screen.queryByText("Appointment booking")).toBeNull();
  });

  it("renders nothing when the selected agent has no phone-call services", () => {
    const { container } = render(
      <CheckoutUsageCharges
        services={[
          {
            code: "google_calendar",
            invoiceLabel: "Appointment booking",
            unit: "PER_UNIT",
            billingRateUsd: 1,
            showInPhoneCallBreakdown: false
          }
        ]}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
