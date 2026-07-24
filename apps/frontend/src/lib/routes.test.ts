import { describe, expect, it } from "vitest";
import { businessInvoiceCheckoutPath } from "./routes";

describe("businessInvoiceCheckoutPath", () => {
  it("carries the exact agent invoice into checkout", () => {
    expect(
      businessInvoiceCheckoutPath({
        invoiceId: "invoice id",
        invoiceType: "agent",
        listingId: "listing/id"
      })
    ).toBe(
      "/business/checkout?invoiceId=invoice+id&invoiceType=agent&listingId=listing%2Fid"
    );
  });

  it("carries the exact usage invoice and agent into checkout", () => {
    expect(
      businessInvoiceCheckoutPath({
        invoiceId: "usage-1",
        invoiceType: "usage",
        agentId: "installed-1"
      })
    ).toBe(
      "/business/checkout?invoiceId=usage-1&invoiceType=usage&agentId=installed-1"
    );
  });
});
