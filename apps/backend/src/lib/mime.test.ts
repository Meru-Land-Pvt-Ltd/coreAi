import { describe, expect, it } from "vitest";
import { buildRawMimeMessage, encodeAddressHeader, encodeHeaderText } from "./mime";

function decodeBase64Section(raw: string, afterMarker: string): string {
  const start = raw.indexOf(afterMarker);
  const blank = raw.indexOf("\r\n\r\n", start);
  const end = raw.indexOf("\r\n--", blank);
  const b64 = raw.slice(blank + 4, end === -1 ? undefined : end).replace(/\r\n/g, "");
  return Buffer.from(b64, "base64").toString("utf8");
}

describe("buildRawMimeMessage", () => {
  it("builds a plain text message with headers", () => {
    const raw = buildRawMimeMessage({
      from: "Smile Dental via Triven <smile-dental@reply.triven.ai>",
      to: "customer@example.com",
      subject: "Your appointment",
      text: "See you tomorrow at 10am."
    }).toString("utf8");

    expect(raw).toContain("From: Smile Dental via Triven <smile-dental@reply.triven.ai>");
    expect(raw).toContain("To: customer@example.com");
    expect(raw).toContain("Subject: Your appointment");
    expect(raw).toContain("MIME-Version: 1.0");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decodeBase64Section(raw, "text/plain")).toBe("See you tomorrow at 10am.");
  });

  it("includes Reply-To and an HTML alternative", () => {
    const raw = buildRawMimeMessage({
      from: "a@reply.triven.ai",
      to: "b@example.com",
      subject: "s",
      text: "text body",
      html: "<p>html body</p>",
      replyTo: "a@reply.triven.ai"
    }).toString("utf8");

    expect(raw).toContain("Reply-To: a@reply.triven.ai");
    expect(raw).toContain("multipart/alternative");
    expect(decodeBase64Section(raw, "text/html")).toBe("<p>html body</p>");
  });

  it("attaches PDF content as base64 multipart/mixed", () => {
    const pdf = Buffer.from("%PDF-1.4 fake");
    const raw = buildRawMimeMessage({
      from: "billing@triven.ai",
      to: "b@example.com",
      subject: "Invoice",
      text: "attached",
      attachments: [{ filename: "invoice-1.pdf", content: pdf, contentType: "application/pdf" }]
    }).toString("utf8");

    expect(raw).toContain("multipart/mixed");
    expect(raw).toContain('Content-Disposition: attachment; filename="invoice-1.pdf"');
    expect(raw).toContain(pdf.toString("base64"));
  });

  it("encodes non-ASCII subjects and display names (RFC 2047)", () => {
    expect(encodeHeaderText("Café booking")).toMatch(/^=\?UTF-8\?B\?/);
    expect(encodeHeaderText("Plain")).toBe("Plain");
    expect(encodeAddressHeader("Café Müller <cafe@reply.triven.ai>")).toMatch(/^=\?UTF-8\?B\?.+ <cafe@reply\.triven\.ai>$/);

    const raw = buildRawMimeMessage({
      from: "Café Müller <cafe@reply.triven.ai>",
      to: "x@example.com",
      subject: "Grüße aus dem Café",
      text: "hallo"
    }).toString("utf8");
    expect(raw).toContain("Subject: =?UTF-8?B?");
  });
});
