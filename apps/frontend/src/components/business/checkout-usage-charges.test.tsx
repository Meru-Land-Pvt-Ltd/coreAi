import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CheckoutUsageCharges } from "./checkout-usage-charges";

afterEach(cleanup);

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
      unit: "PER_CALL" as const,
      billingRateUsd: 0.02,
      showInPhoneCallBreakdown: false
    },
    {
      code: "google_calendar",
      invoiceLabel: "Appointment booking",
      unit: "PER_UNIT" as const,
      billingRateUsd: 0,
      showInPhoneCallBreakdown: false
    },
    {
      code: "sms_confirmation",
      invoiceLabel: "SMS messages",
      unit: "PER_SMS" as const,
      billingRateUsd: 0.01,
      showInPhoneCallBreakdown: false
    }
  ];

  it("keeps only call-minute services in the breakdown and shows other agent services outside it", () => {
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
    const chargeList = document.getElementById("checkout-usage-charge-list");
    expect(chargeList?.className).toContain("bg-white");
    expect(chargeList?.className).not.toContain("bg-slate");
    expect(screen.queryByText("Admin Speech Recognition")).toBeNull();
    expect(screen.queryByText("Call logs and records")).toBeNull();
    expect(screen.getByText("Appointment booking")).toBeTruthy();
    expect(screen.getByText("SMS messages")).toBeTruthy();
    expect(screen.queryByText("$0.02 / call")).toBeNull();
    expect(screen.getByText("$0.00 / unit")).toBeTruthy();
    expect(screen.getByText("$0.01 / SMS")).toBeTruthy();

    fireEvent.click(screen.getByTestId("checkout-phone-call-breakdown-toggle"));

    expect(screen.getByText("Admin Voice Connectivity")).toBeTruthy();
    expect(screen.getByText("Admin Speech Recognition")).toBeTruthy();
    expect(screen.getByText("Admin Conversation AI")).toBeTruthy();
    expect(screen.getByText("Admin Voice Generation")).toBeTruthy();
    expect(screen.getByText("$0.0091 / min")).toBeTruthy();
    expect(screen.getByText("$0.0063 / min")).toBeTruthy();
    expect(screen.getByText("$0.0124 / min")).toBeTruthy();
    expect(screen.getByText("$0.0312 / min")).toBeTruthy();

    const phoneBreakdown = document.getElementById("checkout-phone-call-breakdown");
    expect(phoneBreakdown).not.toBeNull();
    expect(within(phoneBreakdown as HTMLElement).getAllByTestId(/^checkout-usage-service-/)).toHaveLength(4);
    expect(within(phoneBreakdown as HTMLElement).queryByText("Appointment booking")).toBeNull();
    expect(within(phoneBreakdown as HTMLElement).queryByText("SMS messages")).toBeNull();
  });

  it("shows applicable services for an agent with no phone-call services", () => {
    render(
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

    fireEvent.click(screen.getByTestId("checkout-usage-charges-toggle"));
    expect(screen.queryByText("Phone Call Minutes")).toBeNull();
    expect(screen.getByText("Appointment booking")).toBeTruthy();
    expect(screen.getByText("$1.00 / unit")).toBeTruthy();
  });

  it("shows the dedicated phone number range only for listings that include one", () => {
    const { rerender } = render(
      <CheckoutUsageCharges
        services={adminConfiguredServices}
        includesDedicatedPhoneNumber
      />
    );

    fireEvent.click(screen.getByTestId("checkout-usage-charges-toggle"));
    expect(screen.getByText("Dedicated phone number")).toBeTruthy();
    expect(screen.getByText("$1–$4 / month")).toBeTruthy();

    rerender(<CheckoutUsageCharges services={adminConfiguredServices} />);
    expect(screen.queryByText("Dedicated phone number")).toBeNull();
  });

  it("renders nothing when the selected agent has no usage-priced services or phone number", () => {
    const { container } = render(<CheckoutUsageCharges services={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
