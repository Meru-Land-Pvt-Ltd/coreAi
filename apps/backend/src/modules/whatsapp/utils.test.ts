import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  isLikelyGroupMessage,
  messageTypeMatchesListenFor,
  normalizeWhatsAppRecipient,
  renderSimpleTemplate,
  verifyMetaSignature,
  whatsappWebhookCallbackUrl
} from "./utils";

describe("normalizeWhatsAppRecipient", () => {
  it("strips non-digits and leading +", () => {
    expect(normalizeWhatsAppRecipient("+1 (650) 555-1234")).toBe("16505551234");
  });

  it("returns trimmed original when no digits", () => {
    expect(normalizeWhatsAppRecipient("  abc  ")).toBe("abc");
  });
});

describe("verifyMetaSignature", () => {
  it("accepts a valid X-Hub-Signature-256", () => {
    const secret = "app-secret";
    const body = '{"object":"whatsapp_business_account"}';
    const sig = `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    expect(verifyMetaSignature(body, sig, secret)).toBe(true);
  });

  it("rejects missing header or secret", () => {
    expect(verifyMetaSignature("{}", undefined, "secret")).toBe(false);
    expect(verifyMetaSignature("{}", "sha256=abc", "")).toBe(false);
  });

  it("rejects tampered body", () => {
    const secret = "app-secret";
    const sig = `sha256=${crypto.createHmac("sha256", secret).update("good", "utf8").digest("hex")}`;
    expect(verifyMetaSignature("bad", sig, secret)).toBe(false);
  });
});

describe("messageTypeMatchesListenFor", () => {
  it("all accepts any type", () => {
    expect(messageTypeMatchesListenFor("text", "all")).toBe(true);
    expect(messageTypeMatchesListenFor("image", "all")).toBe(true);
  });

  it("filters by type including voice as audio", () => {
    expect(messageTypeMatchesListenFor("text", "text")).toBe(true);
    expect(messageTypeMatchesListenFor("image", "text")).toBe(false);
    expect(messageTypeMatchesListenFor("voice", "audio")).toBe(true);
    expect(messageTypeMatchesListenFor("audio", "audio")).toBe(true);
    expect(messageTypeMatchesListenFor("video", "video")).toBe(true);
  });
});

describe("isLikelyGroupMessage", () => {
  it("detects group-like from values", () => {
    expect(isLikelyGroupMessage("120363@g.us")).toBe(true);
    expect(isLikelyGroupMessage("12345-67890")).toBe(true);
    expect(isLikelyGroupMessage("16505551234")).toBe(false);
  });
});

describe("renderSimpleTemplate", () => {
  it("renders dotted paths and blanks missing", () => {
    expect(
      renderSimpleTemplate("Hi {{contact.name}} at {{contact.phone}}", {
        "contact.name": "Ada",
        "contact.phone": "16505551234"
      })
    ).toBe("Hi Ada at 16505551234");
    expect(renderSimpleTemplate("Hi {{missing}}", {})).toBe("Hi ");
  });
});

describe("whatsappWebhookCallbackUrl", () => {
  it("appends the public webhook path", () => {
    expect(whatsappWebhookCallbackUrl("https://api.example.com/")).toBe(
      "https://api.example.com/architect/connectors/whatsapp"
    );
  });
});
