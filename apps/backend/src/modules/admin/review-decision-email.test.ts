import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE PROMISE FOUR SCREENS MAKE (2026-08-27).
 *
 * "Submitted for review — we'll email you within 24–48 hours." An architect
 * reads that on submit, on the success card, on the publish panel and in the
 * builder, and until today nothing ever sent it. The decision landed in the
 * database and they had to think to go and look.
 */

const sendPlatformEmail = vi.hoisted(() => vi.fn());

vi.mock("../../lib/mailer", () => ({ sendPlatformEmail }));
vi.mock("../../config/env", () => ({ env: { FRONTEND_URL: "https://triven.ai" } }));

import { notifyArchitectOfReviewDecision } from "./review-decision-email";

const base = {
  id: "listing-1",
  name: "Front Desk",
  status: "APPROVED",
  reviewStatus: "APPROVED" as string | null,
  rejectionReason: null as string | null,
  architect: { email: "maker@example.com", fullName: "Asha Rao" }
};

beforeEach(() => vi.clearAllMocks());

describe("telling an architect what we decided", () => {
  it("says an approved agent is live, and where to see it", async () => {
    await notifyArchitectOfReviewDecision(base);

    expect(sendPlatformEmail).toHaveBeenCalledTimes(1);
    const mail = sendPlatformEmail.mock.calls[0]![0];
    expect(mail.to).toBe("maker@example.com");
    expect(mail.subject).toContain("Front Desk");
    expect(mail.text).toContain("Hi Asha,");
    expect(mail.text).toContain("https://triven.ai/architect/agents");
  });

  it("gives the reason when it was not approved, and says the work is not lost", async () => {
    await notifyArchitectOfReviewDecision({
      ...base,
      status: "REJECTED",
      reviewStatus: "REJECTED",
      rejectionReason: "The booking step has no calendar behind it."
    });

    const mail = sendPlatformEmail.mock.calls[0]![0];
    expect(mail.text).toContain("The booking step has no calendar behind it.");
    expect(mail.text).toContain("not lost");
  });

  it("never leaves them guessing when no reason was recorded", async () => {
    await notifyArchitectOfReviewDecision({ ...base, status: "REJECTED", reviewStatus: "REJECTED" });

    const mail = sendPlatformEmail.mock.calls[0]![0];
    /* Worse than a hard reason is no reason and no way to ask. */
    expect(mail.text).toContain("Reply to this email");
  });

  it("asks for a change without calling it a rejection", async () => {
    await notifyArchitectOfReviewDecision({
      ...base,
      status: "REJECTED",
      reviewStatus: "CHANGES_REQUESTED",
      rejectionReason: "Add a price."
    });

    const mail = sendPlatformEmail.mock.calls[0]![0];
    expect(mail.subject).toContain("needs a change");
    expect(mail.text).toContain("Add a price.");
    expect(mail.text).toContain("submit it again");
  });

  it("stays quiet about bookkeeping nobody is waiting on", async () => {
    await notifyArchitectOfReviewDecision({ ...base, status: "SUSPENDED", reviewStatus: null });
    expect(sendPlatformEmail).not.toHaveBeenCalled();
  });

  it("never tries to send to nobody", async () => {
    await notifyArchitectOfReviewDecision({ ...base, architect: { email: "  ", fullName: null } });
    expect(sendPlatformEmail).not.toHaveBeenCalled();
  });
});
