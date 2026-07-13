import JSZip from "jszip";
import { prisma } from "../../lib/prisma";
import { loadArchitectEarnings, serializeArchitectSale } from "./payout-earnings";
import { normalizePayoutSchedule } from "./payout-schedule";

/**
 * Builds a ZIP export of an architect's account data.
 *
 * IMPORTANT: This intentionally EXCLUDES agent source code (workflow
 * definitions / node graphs) and conversation logs (call transcripts, chat
 * history) per product policy. Only account, storefront, listing metadata,
 * sales, and payout records are included.
 */
export async function buildArchitectDataExportZip(
  architectUserId: string
): Promise<{ filename: string; zip: ArrayBuffer }> {
  const [user, listings, payoutMethod, payouts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: architectUserId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        location: true,
        timezone: true,
        role: true,
        createdAt: true,
        architectProfile: true
      }
    }),
    prisma.agentListing.findMany({
      where: { architectUserId },
      // Metadata only — no workflowJson / source code fields are selected.
      select: {
        id: true,
        name: true,
        shortDescription: true,
        description: true,
        priceCents: true,
        status: true,
        category: true,
        tags: true,
        industryTags: true,
        pricingModel: true,
        reviewStatus: true,
        publishStatus: true,
        submittedAt: true,
        approvedAt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.architectPayoutMethod.findUnique({ where: { architectUserId } }),
    prisma.architectPayout.findMany({
      where: { architectUserId },
      orderBy: { createdAt: "desc" }
    })
  ]);

  if (!user) {
    throw new Error("Architect not found");
  }

  const sales = await loadArchitectEarnings(architectUserId);

  const profile = user.architectProfile;

  const account = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    location: user.location,
    timezone: user.timezone,
    role: user.role,
    createdAt: user.createdAt
  };

  const storefront = profile
    ? {
        displayName: profile.displayName,
        title: profile.title,
        tagline: profile.tagline,
        bio: profile.bio,
        portfolioUrl: profile.portfolioUrl,
        githubUrl: profile.githubUrl,
        linkedinUrl: profile.linkedinUrl,
        twitterHandle: profile.twitterHandle,
        experienceBand: profile.experienceBand,
        skills: profile.skills,
        approvalStatus: profile.approvalStatus,
        rating: profile.rating,
        completedJobs: profile.completedJobs
      }
    : null;

  const preferences = profile
    ? {
        notifications: profile.notificationPrefs ?? null,
        privacy: profile.privacyPrefs ?? null,
        payoutSchedule: normalizePayoutSchedule(profile.payoutSchedule)
      }
    : null;

  const payoutData = {
    payoutMethod: payoutMethod
      ? {
          bankName: payoutMethod.bankName,
          accountHolderName: payoutMethod.accountHolderName,
          accountLast4: payoutMethod.accountLast4 ?? payoutMethod.accountNumber?.slice(-4) ?? "",
          country: payoutMethod.country,
          currency: payoutMethod.currency,
          routingLabel: payoutMethod.country === "IN" ? "IFSC" : "ABA routing number",
          routingLast4: payoutMethod.routingLast4,
          verificationStatus: payoutMethod.verificationStatus,
          createdAt: payoutMethod.createdAt
        }
      : null,
    payouts: payouts.map((payout) => ({
      id: payout.id,
      amountCents: payout.amountCents,
      status: payout.status,
      createdAt: payout.createdAt
    }))
  };

  const generatedAt = new Date();
  const zip = new JSZip();

  zip.file(
    "README.txt",
    [
      "Triven — Architect data export",
      `Generated: ${generatedAt.toISOString()}`,
      `Account: ${user.email}`,
      "",
      "This archive contains your account, storefront, listing metadata,",
      "sales, and payout records.",
      "",
      "For your protection and per platform policy, this export does NOT",
      "include agent source code (workflow definitions) or conversation logs",
      "(call transcripts and chat history).",
      ""
    ].join("\n")
  );

  const pretty = (value: unknown) => JSON.stringify(value, null, 2);

  zip.file("account.json", pretty(account));
  zip.file("storefront.json", pretty(storefront));
  zip.file("preferences.json", pretty(preferences));
  zip.file("listings.json", pretty(listings));
  zip.file("sales.json", pretty(sales.map(serializeArchitectSale)));
  zip.file("payouts.json", pretty(payoutData));

  const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });
  const dateStamp = generatedAt.toISOString().slice(0, 10);

  return {
    filename: `triven-architect-data-${dateStamp}.zip`,
    zip: zipBuffer
  };
}
