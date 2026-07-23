import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  ExecutionPricingSummary,
  formatUsdRate,
  useBuyerExecutionPricing,
  type BuyerExecutionPricingPayload
} from "@/components/business/execution-pricing-summary";

const { apiGetMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({ apiGet: apiGetMock }));

function pricingPayload(overrides: Partial<BuyerExecutionPricingPayload> = {}): BuyerExecutionPricingPayload {
  return {
    executionPricing: {
      billingType: "USAGE_BASED",
      unit: "PER_MINUTE",
      ratePerMinuteUsd: 0.0664,
      currency: "USD",
      voice: { billingRatePerMinuteUsd: 0.0664 },
      sms: { billingRatePerSmsUsd: 0.01 },
      phoneNumber: { billingRateUsd: null }
    },
    phoneNumberBilling: {
      enabled: false,
      cadence: "MONTHLY",
      amountCents: null,
      currency: "USD",
      message: "Phone-number billing is currently not enabled."
    },
    ...overrides
  };
}

beforeEach(() => {
  cleanup();
  apiGetMock.mockReset();
});

describe("ExecutionPricingSummary states", () => {
  it("shows the loading message and never a $0 placeholder while loading", () => {
    render(<ExecutionPricingSummary pricing={null} loading={true} />);

    expect(screen.getByTestId("execution-pricing-loading").textContent).toContain("Loading usage pricing…");
    expect(screen.queryByText(/\$0/)).toBeNull();
    expect(screen.queryByTestId("execution-pricing-summary")).toBeNull();
  });

  it("shows unavailable on fetch error and never renders $0.00", () => {
    render(<ExecutionPricingSummary pricing={null} loading={false} unavailable />);

    expect(screen.getByTestId("execution-pricing-unavailable").textContent).toContain("Usage pricing unavailable");
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });

  it("treats a null voice rate as unavailable and never renders $0.00", () => {
    const payload = pricingPayload();
    payload.executionPricing.voice.billingRatePerMinuteUsd = null;
    payload.executionPricing.ratePerMinuteUsd = null;
    render(<ExecutionPricingSummary pricing={payload} loading={false} />);

    expect(screen.getByTestId("execution-pricing-unavailable").textContent).toContain("Usage pricing unavailable");
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
    expect(screen.queryByTestId("execution-pricing-summary")).toBeNull();
  });

  it("shows pending and lets it win over fully loaded rates", () => {
    render(<ExecutionPricingSummary pricing={pricingPayload()} loading={false} pending />);

    expect(screen.getByTestId("execution-pricing-pending").textContent).toContain("Usage pricing pending");
    expect(screen.queryByTestId("execution-pricing-summary")).toBeNull();
    expect(screen.queryByTestId("execution-pricing-voice-rate")).toBeNull();
  });
});

describe("ExecutionPricingSummary loaded full variant", () => {
  it("renders voice, SMS, disabled phone-number state, and Usage based billing type", () => {
    render(<ExecutionPricingSummary pricing={pricingPayload()} loading={false} />);

    expect(screen.getByTestId("execution-pricing-summary")).toBeTruthy();
    expect(screen.getByTestId("execution-pricing-voice-rate").textContent).toBe("$0.0664 per minute");
    expect(screen.getByTestId("execution-pricing-sms-rate").textContent).toBe("$0.01 per SMS");
    // Honest disabled state — a message, not a dollar rate.
    expect(screen.getByTestId("execution-pricing-phone").textContent).toBe(
      "Phone-number billing is currently not enabled."
    );
    expect(screen.getByTestId("execution-pricing-phone").textContent).not.toMatch(/\$/);
    expect(screen.getByTestId("execution-pricing-billing-type").textContent).toBe("Usage based");
  });

  it("renders the phone-number rate when phone-number billing is enabled", () => {
    const payload = pricingPayload({
      phoneNumberBilling: {
        enabled: true,
        cadence: "MONTHLY",
        amountCents: 200,
        currency: "USD",
        message: null
      }
    });
    render(<ExecutionPricingSummary pricing={payload} loading={false} />);

    expect(screen.getByTestId("execution-pricing-phone").textContent).toBe("$2.00 per number");
  });

  it("renders agent price Free for 0 cents alongside Usage based execution charges", () => {
    render(<ExecutionPricingSummary pricing={pricingPayload()} loading={false} agentPriceCents={0} />);

    // Free acquisition is separate from usage charges — both must show.
    expect(screen.getByTestId("execution-pricing-agent-price").textContent).toBe("Free");
    expect(screen.getByTestId("execution-pricing-billing-type").textContent).toBe("Usage based");
  });

  it("renders subscription and one-time agent prices", () => {
    const subscription = render(
      <ExecutionPricingSummary
        pricing={pricingPayload()}
        loading={false}
        agentPriceCents={4900}
        agentPricingModel="SUBSCRIPTION"
      />
    );
    expect(screen.getByTestId("execution-pricing-agent-price").textContent).toBe("$49.00/month");
    subscription.unmount();

    render(
      <ExecutionPricingSummary
        pricing={pricingPayload()}
        loading={false}
        agentPriceCents={4900}
        agentPricingModel="ONE_TIME"
      />
    );
    expect(screen.getByTestId("execution-pricing-agent-price").textContent).toBe("$49.00 one-time");
  });

  it("never renders vendor actual costs", () => {
    const { container } = render(
      <ExecutionPricingSummary pricing={pricingPayload()} loading={false} agentPriceCents={4900} />
    );

    // The buyer payload deliberately carries no actual-cost fields.
    expect(container.textContent).not.toMatch(/actual/i);
  });
});

describe("ExecutionPricingSummary compact variant", () => {
  it("renders the one-line form with voice and SMS rates", () => {
    render(<ExecutionPricingSummary pricing={pricingPayload()} loading={false} variant="compact" />);

    const summary = screen.getByTestId("execution-pricing-summary");
    expect(screen.getByTestId("execution-pricing-voice-rate").textContent).toBe("$0.0664/min");
    expect(screen.getByTestId("execution-pricing-sms-rate").textContent).toBe("$0.01/SMS");
    expect(summary.textContent).toContain("$0.0664/min");
    expect(summary.textContent).toContain("$0.01/SMS");
    // Compact omits the labeled full-variant rows.
    expect(summary.textContent).not.toContain("Voice execution");
    expect(summary.textContent).not.toContain("Execution charges");
  });
});

function PricingHarness() {
  const { pricing, loading, error } = useBuyerExecutionPricing();
  return <ExecutionPricingSummary pricing={pricing} loading={loading} unavailable={error} />;
}

describe("useBuyerExecutionPricing", () => {
  it("loads rates from /payments/execution-pricing on success", async () => {
    apiGetMock.mockResolvedValue({ success: true, data: pricingPayload() });
    render(<PricingHarness />);

    expect(screen.getByTestId("execution-pricing-loading")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("execution-pricing-voice-rate").textContent).toBe("$0.0664 per minute")
    );
    expect(apiGetMock).toHaveBeenCalledWith("/payments/execution-pricing");
    expect(screen.getByTestId("execution-pricing-sms-rate").textContent).toBe("$0.01 per SMS");
  });

  it("resolves to the unavailable state when the fetch rejects", async () => {
    apiGetMock.mockRejectedValue(new Error("network down"));
    render(<PricingHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("execution-pricing-unavailable").textContent).toContain("Usage pricing unavailable")
    );
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });
});

describe("formatUsdRate", () => {
  it("trims trailing zeros down to a minimum of two decimals", () => {
    expect(formatUsdRate(0.0664)).toBe("$0.0664");
    expect(formatUsdRate(0.01)).toBe("$0.01");
    expect(formatUsdRate(2)).toBe("$2.00");
    expect(formatUsdRate(0.04)).toBe("$0.04");
  });
});
