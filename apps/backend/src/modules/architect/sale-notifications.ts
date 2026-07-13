import { prisma } from "../../lib/prisma";
import { sendArchitectNewSaleEmail } from "../../lib/mailer";
import { ARCHITECT_SHARE } from "./payout-earnings";

const DEFAULT_NEW_SALE_EMAIL = true;

function newSaleEmailEnabled(notificationPrefs: unknown): boolean {
  if (!notificationPrefs || typeof notificationPrefs !== "object") return DEFAULT_NEW_SALE_EMAIL;
  const prefs = notificationPrefs as Record<string, unknown>;
  const newSale = prefs.newSale;
  if (!newSale || typeof newSale !== "object") return DEFAULT_NEW_SALE_EMAIL;
  const email = (newSale as Record<string, unknown>).email;
  return typeof email === "boolean" ? email : DEFAULT_NEW_SALE_EMAIL;
}

/**
 * Emails the architect that another buyer is now using one of their agents,
 * but only when that architect has the "New sale" email notification enabled.
 *
 * Best-effort and self-contained: any failure is swallowed so it can never
 * break the buyer's purchase flow.
 */
export async function notifyArchitectOfNewSale(params: {
  listingId: string;
  agentPriceCents?: number | null;
}): Promise<void> {
  try {
    const listing = await prisma.agentListing.findUnique({
      where: { id: params.listingId },
      select: {
        name: true,
        priceCents: true,
        architect: {
          select: {
            email: true,
            fullName: true,
            architectProfile: { select: { notificationPrefs: true } }
          }
        }
      }
    });

    if (!listing?.architect?.email) return;
    if (!newSaleEmailEnabled(listing.architect.architectProfile?.notificationPrefs)) return;

    const grossCents = params.agentPriceCents ?? listing.priceCents ?? 0;
    const earningsCents = grossCents > 0 ? Math.round(grossCents * ARCHITECT_SHARE) : null;

    await sendArchitectNewSaleEmail({
      to: listing.architect.email,
      architectName: listing.architect.fullName,
      agentName: listing.name,
      earningsCents
    });
  } catch (error) {
    console.error("[architect-new-sale] notification failed (non-fatal)", {
      listingId: params.listingId,
      error
    });
  }
}
