import { sendPlatformEmail } from "../../lib/mailer";
import { env } from "../../config/env";

/**
 * TELLING AN ARCHITECT WHAT WE DECIDED.
 *
 * Four screens promise it in these words — "we'll email you within 24–48
 * hours" — and until 2026-08-27 nothing ever did. The decision landed in the
 * database and the architect had to think to go and look. Someone who has
 * built something and submitted it deserves to be told the answer, and we had
 * already told them we would.
 *
 * Three outcomes, three plain messages. Nothing here is a template with the
 * decision dropped in: a rejection reads differently from an approval, because
 * it is different news.
 */

type ReviewedListing = {
  id: string;
  name: string;
  status: string;
  reviewStatus: string | null;
  rejectionReason: string | null;
  architect: { email: string; fullName: string | null };
};

function agentsUrl(): string {
  return `${env.FRONTEND_URL.replace(/\/$/, "")}/architect/agents`;
}

function outcomeFor(listing: ReviewedListing): { subject: string; body: string } | null {
  const name = listing.name;
  const greeting = listing.architect.fullName?.trim()
    ? `Hi ${listing.architect.fullName.trim().split(" ")[0]},`
    : "Hi,";

  if (listing.status === "APPROVED") {
    return {
      subject: `${name} is approved`,
      body: `${greeting}

${name} has been approved and is on the Triven marketplace. Businesses can find it and install it from now on.

You can see it, and how it is doing, here:
${agentsUrl()}

— Triven`
    };
  }

  if (listing.reviewStatus === "CHANGES_REQUESTED") {
    return {
      subject: `${name} needs a change before it goes live`,
      body: `${greeting}

We looked at ${name} and it is not quite ready to publish yet.

What needs changing:
${listing.rejectionReason?.trim() || "No detail was given. Reply to this email and we will tell you."}

Make the change and submit it again — you do not start from scratch:
${agentsUrl()}

— Triven`
    };
  }

  if (listing.status === "REJECTED") {
    return {
      subject: `${name} was not approved`,
      body: `${greeting}

${name} was not approved for the Triven marketplace.

Why:
${listing.rejectionReason?.trim() || "No reason was recorded. Reply to this email and we will explain."}

Your work is not lost — it is still in your account, and you can change it and submit it again:
${agentsUrl()}

— Triven`
    };
  }

  /* Any other status change is bookkeeping, not a decision the architect is
     waiting on. Silence is correct. */
  return null;
}

export async function notifyArchitectOfReviewDecision(listing: ReviewedListing): Promise<void> {
  const to = listing.architect.email?.trim();
  if (!to) return;

  const outcome = outcomeFor(listing);
  if (!outcome) return;

  await sendPlatformEmail({
    purpose: "notification",
    to,
    subject: outcome.subject,
    text: outcome.body
  });
}
