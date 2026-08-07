import { describe, expect, it } from "vitest";
import {
  buildPendingInvoiceReminderEmailHtml,
  buildSpendingAlertEmailHtml,
  buildSubscriptionRenewalReminderEmailHtml,
  buildUsageOverdueEmailHtml
} from "./mailer";

describe("billing notification email templates", () => {
  it("renders an overdue invoice in the shared branded email shell", () => {
    const html = buildUsageOverdueEmailHtml({
      name: "Asha & Sons",
      invoiceNumber: "USG-2026-08-0042",
      billingPeriod: "August 2026",
      amountUsd: "125.40",
      gracePeriodEnd: "September 7, 2026",
      billingUrl: "https://app.triven.ai/business/billingandusage"
    });

    expect(html).toContain("<title>Usage invoice overdue</title>");
    expect(html).toContain('alt="Triven.ai"');
    expect(html).toContain("Asha &amp; Sons");
    expect(html).toContain("PAYMENT OVERDUE");
    expect(html).toContain("USG-2026-08-0042");
    expect(html).toContain("$125.40");
    expect(html).toContain("September 7, 2026");
    expect(html).toContain(
      'href="https://app.triven.ai/business/billingandusage"'
    );
    expect(html).toContain("View and pay invoice");
    expect(html).toContain(">Privacy</a>");
    expect(html).toContain(">Help Center</a>");
  });

  it("renders a spending alert in the same branded email shell", () => {
    const html = buildSpendingAlertEmailHtml({
      name: "Ravi <Owner>",
      billingPeriod: "August 2026",
      totalUsd: "80.25",
      thresholdUsd: "75.00",
      billingUrl: "https://app.triven.ai/business/billingandusage"
    });

    expect(html).toContain("<title>Spending alert reached</title>");
    expect(html).toContain('alt="Triven.ai"');
    expect(html).toContain("Ravi &lt;Owner&gt;");
    expect(html).toContain("SPENDING ALERT");
    expect(html).toContain("$80.25");
    expect(html).toContain("$75.00");
    expect(html).toContain("Review detailed usage");
    expect(html).toContain("Billing &amp; Usage");
    expect(html).toContain(">Privacy</a>");
    expect(html).toContain(">Help Center</a>");
  });

  it("renders the day-before subscription renewal reminder", () => {
    const html = buildSubscriptionRenewalReminderEmailHtml({
      name: "Asha & Sons",
      agentName: "AI Receptionist",
      renewalDate: "September 6, 2026",
      amountUsd: "149.00",
      billingUrl: "https://app.triven.ai/business/billingandusage"
    });

    expect(html).toContain("<title>Subscription renewal reminder</title>");
    expect(html).toContain('alt="Triven.ai"');
    expect(html).toContain("RENEWAL REMINDER");
    expect(html).toContain("AI Receptionist");
    expect(html).toContain("September 6, 2026");
    expect(html).toContain("$149.00");
    expect(html).toContain("Review renewal invoice");
  });

  it("renders a gentle pending-invoice reminder", () => {
    const html = buildPendingInvoiceReminderEmailHtml({
      name: "Ravi <Owner>",
      invoiceNumber: "USG-2026-08-0091",
      description: "August agent execution usage",
      amountUsd: "64.25",
      dueDate: "September 6, 2026",
      billingUrl: "https://app.triven.ai/business/billingandusage"
    });

    expect(html).toContain("<title>Pending invoice reminder</title>");
    expect(html).toContain('alt="Triven.ai"');
    expect(html).toContain("PAYMENT REMINDER");
    expect(html).toContain("Ravi &lt;Owner&gt;");
    expect(html).toContain("USG-2026-08-0091");
    expect(html).toContain("$64.25");
    expect(html).toContain("Review and pay invoice");
  });
});
