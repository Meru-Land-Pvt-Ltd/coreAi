import { prisma } from "../src/lib/prisma";
import {
  DISCLOSURE_CONSENT_RETENTION_DAYS,
  pruneExpiredDisclosureConsents
} from "../src/modules/compliance/disclosure-consent";

/**
 * Retention enforcement for IntegrationDisclosureConsent (Privacy Policy §9):
 * identifiable consent records older than DISCLOSURE_CONSENT_RETENTION_DAYS
 * are deleted. Run periodically (cron) or manually.
 *
 * Usage:
 *   npm run prune:disclosure-consents              # dry-run (report only)
 *   npm run prune:disclosure-consents -- --apply   # delete expired records
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const cutoff = new Date(Date.now() - DISCLOSURE_CONSENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const expired = await prisma.integrationDisclosureConsent.count({
    where: { createdAt: { lt: cutoff } }
  });

  if (!apply) {
    console.log(
      `[dry-run] ${expired} consent record(s) older than ${DISCLOSURE_CONSENT_RETENTION_DAYS} days (before ${cutoff.toISOString()}) would be deleted.`
    );
    return;
  }

  const deleted = await pruneExpiredDisclosureConsents();
  console.log(`Deleted ${deleted} expired consent record(s) (retention ${DISCLOSURE_CONSENT_RETENTION_DAYS} days).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
