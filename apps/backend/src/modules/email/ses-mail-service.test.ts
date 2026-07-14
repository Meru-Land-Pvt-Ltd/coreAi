import { describe, expect, it } from "vitest";
import {
  RESERVED_LOCAL_PARTS,
  aliasEmailAddress,
  isValidEmailAddress,
  normalizeEmailAliasLocalPart,
  sanitizeInboundHtml,
  validateLocalPart
} from "./ses-mail-service";

describe("normalizeEmailAliasLocalPart", () => {
  it("derives a safe alias from a business name", () => {
    expect(normalizeEmailAliasLocalPart("Smile Dental Clinic")).toBe("smile-dental-clinic");
    expect(normalizeEmailAliasLocalPart("  A&B Plumbing!! ")).toBe("a-b-plumbing");
    expect(normalizeEmailAliasLocalPart("--weird---name--")).toBe("weird-name");
    expect(normalizeEmailAliasLocalPart("ÜBER Café")).toBe("ber-caf");
  });

  it("caps length at 50 and strips trailing separators", () => {
    const long = normalizeEmailAliasLocalPart("x".repeat(80));
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("validateLocalPart", () => {
  it("accepts valid aliases", () => {
    expect(validateLocalPart("smile-dental")).toBeNull();
    expect(validateLocalPart("clinic-2")).toBeNull();
  });

  it("rejects reserved aliases from the spec list", () => {
    for (const reserved of [
      "admin", "support", "billing", "security", "help", "info", "contact",
      "sales", "postmaster", "abuse", "mailer-daemon", "noreply", "no-reply",
      "notifications", "triven", "root", "system"
    ]) {
      expect(RESERVED_LOCAL_PARTS.has(reserved)).toBe(true);
      expect(validateLocalPart(reserved)).not.toBeNull();
    }
  });

  it("rejects uppercase, spaces, leading/trailing hyphens, and empty", () => {
    expect(validateLocalPart("")).not.toBeNull();
    expect(validateLocalPart("Smile")).not.toBeNull();
    expect(validateLocalPart("has space")).not.toBeNull();
    expect(validateLocalPart("-leading")).not.toBeNull();
    expect(validateLocalPart("trailing-")).not.toBeNull();
  });
});

describe("aliasEmailAddress", () => {
  it("builds the proxy address on the configured domain", () => {
    expect(aliasEmailAddress("smile-dental")).toBe("smile-dental@reply.triven.ai");
  });
});

describe("isValidEmailAddress", () => {
  it("validates recipients", () => {
    expect(isValidEmailAddress("owner@smiledental.com")).toBe(true);
    expect(isValidEmailAddress("not-an-email")).toBe(false);
    expect(isValidEmailAddress("a b@c.com")).toBe(false);
  });
});

describe("sanitizeInboundHtml", () => {
  it("strips scripts, styles, event handlers, and javascript: URLs", () => {
    const dirty = `<div onclick="steal()"><script>alert(1)</script><style>x{}</style>` +
      `<a href="javascript:evil()">x</a><img src="ok.png" onerror="p0wn()"></div>`;
    const clean = sanitizeInboundHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("<style");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("ok.png");
  });

  it("caps body size", () => {
    expect(sanitizeInboundHtml("a".repeat(200_000)).length).toBeLessThanOrEqual(100_000);
  });
});
