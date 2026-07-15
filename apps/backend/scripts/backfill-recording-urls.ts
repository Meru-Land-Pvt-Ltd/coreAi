/**
 * One-off backfill: populate VapiCall.recordingUrl for historical calls.
 *
 * Source order per call:
 *   1. The stored end-of-call webhook body (VapiCall.metadataJson).
 *   2. Vapi's call record (GET /call/:id) for rows without usable metadata.
 *
 * Usage:
 *   npm run backfill:recording-urls            # apply
 *   npm run backfill:recording-urls -- --dry-run
 */
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { extractRecordingUrl } from "../src/modules/business/usage-billing";

const DRY_RUN = process.argv.includes("--dry-run");

function messageOf(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const record = body as Record<string, unknown>;

  return record.message && typeof record.message === "object" && !Array.isArray(record.message)
    ? (record.message as Record<string, unknown>)
    : record;
}

async function fetchRecordingFromVapi(callId: string): Promise<string | null> {
  if (!env.VAPI_API_KEY) return null;

  try {
    const response = await fetch(
      `${env.VAPI_BASE_URL.replace(/\/$/, "")}/call/${encodeURIComponent(callId)}`,
      {
        headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) return null;

    const call = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    return call ? extractRecordingUrl(call) : null;
  } catch {
    return null;
  }
}

async function main() {
  const rows = await prisma.vapiCall.findMany({
    where: { recordingUrl: null },
    select: { id: true, callId: true, metadataJson: true },
    orderBy: { createdAt: "desc" }
  });

  console.log(`[backfill] ${rows.length} calls without recordingUrl${DRY_RUN ? " (dry run)" : ""}`);

  let fromMetadata = 0;
  let fromApi = 0;
  let missing = 0;

  for (const row of rows) {
    const message = messageOf(row.metadataJson);
    let url = message ? extractRecordingUrl(message) : null;
    let source = "metadata";

    if (!url) {
      url = await fetchRecordingFromVapi(row.callId);
      source = "vapi-api";
      // Gentle pacing for the Vapi API.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (!url) {
      missing += 1;
      console.log(`[backfill] no recording: call=${row.callId.slice(0, 8)}…`);
      continue;
    }

    if (!DRY_RUN) {
      await prisma.vapiCall.update({ where: { id: row.id }, data: { recordingUrl: url } });
    }

    if (source === "metadata") fromMetadata += 1;
    else fromApi += 1;

    console.log(`[backfill] ${DRY_RUN ? "would set" : "set"} call=${row.callId.slice(0, 8)}… via ${source} (…${url.slice(-12)})`);
  }

  console.log(
    `[backfill] done: ${fromMetadata} from stored webhooks, ${fromApi} from the Vapi API, ${missing} without a recording`
  );
}

main()
  .catch((error) => {
    console.error("[backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
