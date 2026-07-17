import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verbalSmsConsentDisclosure, webFormSmsConsentDisclosure } from "@coreai/shared";

/**
 * Static compliance guarantees over the monorepo source:
 * - the public /sms-consent page and /book/[slug] form exist with the exact
 *   required language, an unchecked-by-default optional checkbox, bold
 *   STOP/HELP markup, and Privacy/Terms links;
 * - no backend code path can send Twilio SMS without going through the
 *   central consent-gated service.
 *
 * Source-level assertions are deliberate: they run in the backend suite
 * (there is no frontend test runner) and fail the build if the compliance
 * language or wiring is edited away.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const FRONTEND_APP = path.join(REPO_ROOT, "apps/frontend/src/app");
const BACKEND_SRC = path.join(REPO_ROOT, "apps/backend/src");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("public /sms-consent page", () => {
  const pagePath = "apps/frontend/src/app/sms-consent/page.tsx";

  it("exists as a public route with no authentication requirement", () => {
    expect(existsSync(path.join(REPO_ROOT, pagePath))).toBe(true);
    const source = read(pagePath);
    // Not inside a (protected) group and pulls in no auth/token helpers.
    expect(pagePath).not.toContain("(protected)");
    expect(source).not.toMatch(/useAuth|requireAuth|coreai-token|localStorage/);
  });

  it("contains the required program, business-specific, and privacy statements", () => {
    const source = read(pagePath);
    expect(source).toContain("operated by CollabGlam LLC");
    expect(source).toContain(
      "Consent is specific to the identified business and Triven.ai messaging program and"
    );
    expect(source).toContain(
      "Mobile phone numbers, SMS opt-in information, and consent records are not sold,"
    );
    expect(source).toContain("Message frequency varies.");
    expect(source).toContain("Message and data rates may apply.");
  });

  it("shows the exact verbal and checkbox disclosures from the shared module", () => {
    const source = read(pagePath);
    // The page renders the disclosures via the same shared functions the
    // backend hashes — one source of truth.
    expect(source).toContain("verbalSmsConsentDisclosure");
    expect(source).toContain("webFormSmsConsentDisclosure");
    // And the shared disclosure text itself carries the required elements.
    const verbal = verbalSmsConsentDisclosure("{{business_name}}");
    expect(verbal).toContain("transactional text messages from {{business_name}} through Triven.ai");
    expect(verbal).toContain("Message frequency varies.");
    expect(verbal).toContain("Message and data rates may apply.");
    expect(verbal).toContain("Reply STOP to opt out or HELP for help.");
    expect(verbal).toContain("Consent is not required to complete the booking or service request.");
    expect(verbal).toContain("Please say yes or no.");
  });

  it("renders STOP and HELP in real bold markup", () => {
    const source = read(pagePath);
    expect(source).toMatch(/<strong[^>]*>STOP<\/strong>/);
    expect(source).toMatch(/<strong[^>]*>HELP<\/strong>/);
  });

  it("links to the privacy policy, terms, and support email", () => {
    const source = read(pagePath);
    expect(source).toContain('"/privacy" as Route');
    expect(source).toContain('"/terms" as Route');
    expect(source).toContain("mailto:info@triven.ai");
  });

  it("includes the consent flow diagram steps", () => {
    const source = read(pagePath);
    expect(source).toContain("Customer calls or opens the booking form");
    expect(source).toContain("Consent disclosure shown or read aloud");
    expect(source).toContain("Customer says yes or checks the optional box");
    expect(source).toContain("Consent stored");
    expect(source).toContain("Transactional SMS may be sent");
  });
});

describe("public booking form consent checkbox", () => {
  const pagePath = "apps/frontend/src/app/book/[slug]/page.tsx";

  it("exists as a public slug-based booking route", () => {
    expect(existsSync(path.join(REPO_ROOT, pagePath))).toBe(true);
  });

  it("is unchecked by default and never required", () => {
    const source = read(pagePath);
    // Initial form state starts the checkbox at false…
    expect(source).toMatch(/smsConsent:\s*false/);
    // …and the input is a controlled real checkbox with no required flag.
    expect(source).toContain('type="checkbox"');
    expect(source).toMatch(/checked=\{form\.smsConsent\}/);
    const checkboxBlock = source.slice(source.indexOf('id="booking-sms-consent"'), source.indexOf('id="booking-sms-consent"') + 600);
    expect(checkboxBlock).not.toContain("required");
    expect(source).not.toContain("defaultChecked");
  });

  it("uses the exact shared checkbox disclosure and links Privacy/Terms", () => {
    const source = read(pagePath);
    expect(source).toContain("webFormSmsConsentDisclosure(business.name)");
    expect(source).toContain('"/privacy" as Route');
    expect(source).toContain('"/terms" as Route');
    const checkbox = webFormSmsConsentDisclosure("Acme Dental");
    expect(checkbox).toContain("I agree to receive transactional SMS messages from Acme Dental through Triven.ai");
    expect(checkbox).toContain("Consent is not a condition of purchase, booking, or receiving services.");
  });

  it("does not force consent on submit (checkbox is not validated as required)", () => {
    const source = read(pagePath);
    const validate = source.slice(source.indexOf("const validateForm"), source.indexOf("const handleSubmit"));
    expect(validate).not.toContain("smsConsent");
  });
});

describe("terms of service SMS program section", () => {
  it("renders the Triven.ai SMS Program with bold STOP and HELP", () => {
    const source = read("apps/frontend/src/app/terms/page.tsx");
    const flattened = source.replace(/\s+/g, " ");
    expect(source).toContain("Triven.ai SMS Program:");
    expect(source).toMatch(/<strong[^>]*>STOP<\/strong>/);
    expect(source).toMatch(/<strong[^>]*>HELP<\/strong>/);
    expect(flattened).toContain("Consent is not a condition of purchase, booking, or receiving services.");
    expect(flattened).toContain("Message frequency varies. Message and data rates may apply.");
  });
});

describe("privacy policy SMS section", () => {
  it("contains the required consent, opt-out, and no-sale statements", () => {
    const source = read("apps/frontend/src/app/privacy/page.tsx");
    expect(source).toContain("operated by CollabGlam LLC");
    expect(source).toContain("only after the end-user's affirmative consent");
    expect(source).toContain("unchecked by default");
    expect(source).toContain("will not be sold, rented, transferred, or shared");
    expect(source).toContain("non-transferable");
  });
});

describe("no SMS send path bypasses the central consent-gated service", () => {
  it("only the tracked service (and the out-of-scope OTP sender) touch sendTwilioSms", () => {
    // The consent gate lives in sendTrackedSms. The only legitimate callers of
    // the raw Twilio sink are:
    //  - the connector module that defines it,
    //  - the tracked notification service (the gate itself),
    //  - the phone-verification OTP send (a separate verification flow,
    //    explicitly outside the transactional messaging campaign; Twilio
    //    Verify is the intended long-term home).
    const allowed = new Set([
      "modules/architect/twilio-connector.ts",
      "modules/notifications/sms-notification-service.ts",
      "modules/setup/routes.ts"
    ]);

    const grep = execFileSync(
      "grep",
      ["-rl", "sendTwilioSms", "--include=*.ts", "."],
      { cwd: BACKEND_SRC, encoding: "utf8" }
    );
    const offenders = grep
      .split("\n")
      .map((line) => line.replace(/^\.\//, ""))
      .filter(Boolean)
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => !allowed.has(file));

    expect(offenders).toEqual([]);
  });

  it("frontend never calls Twilio directly", () => {
    // grep exits non-zero when nothing matches — that is the success case.
    let matches = "";
    try {
      matches = execFileSync(
        "grep",
        ["-rl", "api.twilio.com", "--include=*.ts", "--include=*.tsx", "."],
        { cwd: FRONTEND_APP, encoding: "utf8" }
      );
    } catch {
      matches = "";
    }
    expect(matches.trim()).toBe("");
  });
});
