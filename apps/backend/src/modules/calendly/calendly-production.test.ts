import { describe, expect, it, beforeEach } from "vitest";
import {
  calendlyDefaultEventListRange,
  isCalendlyPlanRestrictionError,
  isCalendlySampleResourceId,
  normalizeCalendlyResourceId,
  verifyCalendlyWebhookSignature
} from "./calendly-connector";
import {
  claimCalendlyWebhookDelivery,
  mapCalendlyWebhookEventToTrigger,
  resetCalendlyWebhookIdempotencyForTests
} from "./webhook";
import crypto from "crypto";
import { calendlyActionPaidPlanNote } from "@coreai/shared";

describe("normalizeCalendlyResourceId / sample ids", () => {
  it("extracts UUID from scheduled event URI", () => {
    expect(
      normalizeCalendlyResourceId("https://api.calendly.com/scheduled_events/abc-123")
    ).toBe("abc-123");
  });

  it("extracts invitee UUID from invitee URI", () => {
    expect(
      normalizeCalendlyResourceId(
        "https://api.calendly.com/scheduled_events/evt-1/invitees/inv-9"
      )
    ).toBe("inv-9");
  });

  it("detects sample placeholders", () => {
    expect(isCalendlySampleResourceId("SAMPLE_EVENT_UUID")).toBe(true);
    expect(isCalendlySampleResourceId("SAMPLE")).toBe(true);
    expect(
      isCalendlySampleResourceId("https://api.calendly.com/scheduled_events/SAMPLE_INVITEE_UUID")
    ).toBe(true);
    expect(isCalendlySampleResourceId("real-uuid-here")).toBe(false);
  });
});

describe("mapCalendlyWebhookEventToTrigger", () => {
  it("maps invitee.created to meeting_booked", () => {
    expect(mapCalendlyWebhookEventToTrigger("invitee.created", false)).toBe("meeting_booked");
  });

  it("maps invitee.created + reschedule flag to meeting_rescheduled", () => {
    expect(mapCalendlyWebhookEventToTrigger("invitee.created", true)).toBe("meeting_rescheduled");
  });

  it("maps invitee.canceled to meeting_cancelled", () => {
    expect(mapCalendlyWebhookEventToTrigger("invitee.canceled", false)).toBe("meeting_cancelled");
  });

  it("maps routing form submissions", () => {
    expect(mapCalendlyWebhookEventToTrigger("routing_form_submission.created", false)).toBe(
      "routing_form_submitted"
    );
  });

  it("ignores unknown events", () => {
    expect(mapCalendlyWebhookEventToTrigger("invitee.no_show", false)).toBeNull();
  });
});

describe("isCalendlyPlanRestrictionError + paid notes", () => {
  it("flags upgrade / paid plan style messages", () => {
    expect(isCalendlyPlanRestrictionError("Please upgrade to a paid plan")).toBe(true);
    expect(isCalendlyPlanRestrictionError("Payment required (402)")).toBe(true);
    expect(isCalendlyPlanRestrictionError("organization: is not a supported query parameter")).toBe(
      true
    );
    expect(isCalendlyPlanRestrictionError("You are not allowed to view this event")).toBe(false);
  });

  it("exposes paid plan notes for gated actions", () => {
    expect(calendlyActionPaidPlanNote("book_meeting_for_invitee")).toMatch(/paid/i);
    expect(calendlyActionPaidPlanNote("create_contact")).toMatch(/paid|Contacts/i);
    expect(calendlyActionPaidPlanNote("get_event")).toBeNull();
    expect(calendlyActionPaidPlanNote("cancel_event")).toBeNull();
  });
});

describe("verifyCalendlyWebhookSignature", () => {
  it("accepts a valid recent signature", () => {
    const signingKey = "test-signing-key";
    const rawBody = JSON.stringify({ event: "invitee.created" });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    expect(
      verifyCalendlyWebhookSignature({
        rawBody,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        signingKey
      })
    ).toBe(true);
  });

  it("rejects stale timestamps", () => {
    const signingKey = "test-signing-key";
    const rawBody = "{}";
    const timestamp = Math.floor(Date.now() / 1000 - 10 * 60).toString();
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    expect(
      verifyCalendlyWebhookSignature({
        rawBody,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        signingKey
      })
    ).toBe(false);
  });
});

describe("claimCalendlyWebhookDelivery idempotency", () => {
  beforeEach(() => {
    resetCalendlyWebhookIdempotencyForTests();
  });

  it("allows the first delivery and blocks the duplicate", async () => {
    const key = `calendly:webhook:test:${Date.now()}`;
    expect(await claimCalendlyWebhookDelivery(key)).toBe(false);
    expect(await claimCalendlyWebhookDelivery(key)).toBe(true);
  });
});

describe("calendlyDefaultEventListRange", () => {
  it("covers one year past and one year ahead", () => {
    const now = Date.UTC(2026, 7, 5, 12, 0, 0);
    const range = calendlyDefaultEventListRange(now);
    const min = new Date(range.minStartTime).getTime();
    const max = new Date(range.maxStartTime).getTime();
    expect(max - min).toBe(730 * 24 * 60 * 60 * 1000);
  });
});
