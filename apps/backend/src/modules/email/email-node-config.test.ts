import { describe, expect, it } from "vitest";
import {
  extractSendEmailNodeConfig,
  fillEmailTemplate,
  parseEmailList,
  resolveVariableRecipient
} from "./email-node-config";

describe("fillEmailTemplate", () => {
  const vars = { customerName: "Priya", businessName: "Smile Dental", serviceName: "cleaning" };

  it("fills allowed variables", () => {
    expect(fillEmailTemplate("Hi {{customerName}}, your {{serviceName}} at {{businessName}}.", vars)).toBe(
      "Hi Priya, your cleaning at Smile Dental."
    );
  });

  it("removes unknown variables instead of leaking them", () => {
    expect(fillEmailTemplate("x {{secretKey}} y {{process.env}} z", vars)).toBe("x y z");
  });

  it("fills missing allowed variables as empty", () => {
    expect(fillEmailTemplate("Call {{businessPhone}} now", vars)).toBe("Call now");
  });
});

describe("parseEmailList", () => {
  it("splits, lowercases, validates and caps", () => {
    expect(parseEmailList("A@b.com, not-an-email; c@d.com")).toEqual(["a@b.com", "c@d.com"]);
    expect(parseEmailList("")).toEqual([]);
  });
});

describe("extractSendEmailNodeConfig", () => {
  const workflow = (data: Record<string, unknown>) => ({
    nodes: [{ data: { type: "communication.send_email", ...data } }]
  });

  it("returns null when there is no send_email node", () => {
    expect(extractSendEmailNodeConfig({ nodes: [] })).toBeNull();
    expect(extractSendEmailNodeConfig(null)).toBeNull();
  });

  it("validates recipient type, purpose, and custom recipient", () => {
    const config = extractSendEmailNodeConfig(
      workflow({
        recipientType: "custom",
        customRecipient: "Owner@Biz.com",
        purpose: "BOOKING_CONFIRMATION",
        ccTemplate: "a@b.com, bad",
        bodyTemplate: "Hello {{customerName}}",
        continueOnFailure: "false",
        fallbackBehavior: "notify_team"
      })
    );
    expect(config).not.toBeNull();
    expect(config?.recipientType).toBe("custom");
    expect(config?.customRecipient).toBe("owner@biz.com");
    expect(config?.purpose).toBe("BOOKING_CONFIRMATION");
    expect(config?.cc).toEqual(["a@b.com"]);
    expect(config?.continueOnFailure).toBe(false);
    expect(config?.fallbackBehavior).toBe("notify_team");
  });

  it("falls back to safe defaults on garbage input", () => {
    const config = extractSendEmailNodeConfig(
      workflow({ recipientType: "nonsense", purpose: "DROP TABLE", customRecipient: "not-an-email" })
    );
    expect(config?.recipientType).toBe("customer");
    expect(config?.purpose).toBe("auto");
    expect(config?.customRecipient).toBe("");
    expect(config?.continueOnFailure).toBe(true);
    expect(config?.fallbackBehavior).toBe("skip");
  });
});

describe("resolveVariableRecipient", () => {
  it("resolves customerEmail aliases only", () => {
    expect(resolveVariableRecipient("customerEmail", { customerEmail: "a@b.com" })).toBe("a@b.com");
    expect(resolveVariableRecipient("{{customerEmail}}", { customerEmail: "a@b.com" })).toBe("a@b.com");
    expect(resolveVariableRecipient("customer.email", { customerEmail: "a@b.com" })).toBe("a@b.com");
    expect(resolveVariableRecipient("businessName", { businessName: "x" })).toBeNull();
    expect(resolveVariableRecipient("customerEmail", {})).toBeNull();
  });
});
