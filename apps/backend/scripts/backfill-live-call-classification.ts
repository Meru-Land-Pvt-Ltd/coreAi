/**
 * One-off backfill for VapiCall execution modes + workflow runs.
 *
 * Pass 1 — demote: LIVE rows that are actually browser (web) test calls
 *   (stored call type "webCall", a test purpose, or no caller number) become
 *   BUSINESS_TEST. Only real inbound/outbound phone calls count as runs.
 * Pass 2 — promote: ARCHITECT_DRY_RUN rows that carry no test purpose and are
 *   not sandbox executions (per-agent check) become LIVE — these were demoted
 *   by the old business-wide sandbox check on dual-role owners.
 * Pass 3 — executions: every LIVE call with an attributable agent gets its
 *   WorkflowRun row (mode LIVE, COMPLETED), mirroring the end-of-call webhook.
 *
 * Usage:
 *   npm run backfill:live-classification -- --dry-run   # report only
 *   npm run backfill:live-classification                # apply
 */
import { prisma } from "../src/lib/prisma";
import { isSandboxExecutionBusiness } from "../src/modules/architect/twilio-business-routing";

const DRY_RUN = process.argv.includes("--dry-run");

const TEST_PURPOSES = new Set(["ARCHITECT_TEST", "BUYER_SETUP_PREVIEW", "MARKETPLACE_DEMO"]);

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function storedCallRecord(metadataJson: unknown): Record<string, unknown> | null {
  const body = nestedRecord(metadataJson);
  if (!body) return null;
  const message = nestedRecord(body.message);
  return nestedRecord(message?.call) ?? nestedRecord(body.call);
}

function storedPurpose(metadataJson: unknown): string {
  const body = nestedRecord(metadataJson);
  if (!body) return "";
  const candidates = [nestedRecord(storedCallRecord(metadataJson)?.metadata), nestedRecord(body.metadata)];
  for (const candidate of candidates) {
    const purpose = candidate?.purpose;
    if (typeof purpose === "string" && purpose) return purpose;
  }
  return "";
}

function storedCallType(metadataJson: unknown): string {
  const call = storedCallRecord(metadataJson);
  const type = call?.type;
  return typeof type === "string" ? type : "";
}

async function demoteWebTestCalls() {
  const rows = await prisma.vapiCall.findMany({
    where: { executionMode: "LIVE" },
    select: { id: true, callId: true, customerPhone: true, metadataJson: true },
    orderBy: { createdAt: "desc" }
  });

  let demoted = 0;
  for (const row of rows) {
    const purpose = storedPurpose(row.metadataJson);
    const callType = storedCallType(row.metadataJson);
    const phone = (row.customerPhone ?? "").trim().toLowerCase();
    const isWebTest =
      TEST_PURPOSES.has(purpose) ||
      callType.toLowerCase() === "webcall" ||
      phone === "" ||
      phone === "unknown";
    if (!isWebTest) continue;

    if (!DRY_RUN) {
      await prisma.vapiCall.update({ where: { id: row.id }, data: { executionMode: "BUSINESS_TEST" } });
      await prisma.workflowRun.deleteMany({ where: { callProvider: "VAPI", externalCallId: row.callId, mode: "LIVE" } });
    }
    demoted += 1;
    console.log(`[backfill] ${DRY_RUN ? "would demote" : "demoted"} call=${row.callId.slice(0, 12)}… → BUSINESS_TEST`);
  }
  return demoted;
}

async function promoteMisclassifiedDryRuns() {
  const rows = await prisma.vapiCall.findMany({
    where: { executionMode: "ARCHITECT_DRY_RUN" },
    select: { id: true, callId: true, businessId: true, installedAgentId: true, customerPhone: true, metadataJson: true },
    orderBy: { createdAt: "desc" }
  });

  let promoted = 0;
  for (const row of rows) {
    const purpose = storedPurpose(row.metadataJson);
    const callType = storedCallType(row.metadataJson);
    const phone = (row.customerPhone ?? "").trim().toLowerCase();
    if (TEST_PURPOSES.has(purpose)) continue;
    if (callType.toLowerCase() === "webcall" || phone === "" || phone === "unknown") continue;
    if (await isSandboxExecutionBusiness(row.businessId, row.installedAgentId ?? undefined)) continue;

    if (!DRY_RUN) {
      await prisma.vapiCall.update({ where: { id: row.id }, data: { executionMode: "LIVE" } });
    }
    promoted += 1;
    console.log(`[backfill] ${DRY_RUN ? "would promote" : "promoted"} call=${row.callId.slice(0, 12)}… → LIVE`);
  }
  return promoted;
}

async function ensureWorkflowRunsForLiveCalls() {
  const calls = await prisma.vapiCall.findMany({
    where: { executionMode: "LIVE", installedAgentId: { not: null } },
    select: { callId: true, businessId: true, installedAgentId: true, createdAt: true, endedAt: true },
    orderBy: { createdAt: "desc" }
  });

  let created = 0;
  for (const call of calls) {
    const existing = await prisma.workflowRun.findFirst({
      where: { callProvider: "VAPI", externalCallId: call.callId },
      select: { id: true }
    });
    if (existing) continue;

    const agent = await prisma.installedAgent.findFirst({
      where: { id: call.installedAgentId ?? "", businessId: call.businessId },
      select: { id: true, workflowId: true }
    });
    if (!agent) continue;

    if (!DRY_RUN) {
      await prisma.workflowRun.create({
        data: {
          workflowId: agent.workflowId,
          installedAgentId: agent.id,
          businessId: call.businessId,
          mode: "LIVE",
          status: "COMPLETED",
          callProvider: "VAPI",
          externalCallId: call.callId,
          startedAt: call.createdAt,
          finishedAt: call.endedAt ?? call.createdAt,
          inputJson: { source: "backfill_live_classification", callId: call.callId }
        }
      });
    }
    created += 1;
    console.log(`[backfill] ${DRY_RUN ? "would create" : "created"} workflow run for call=${call.callId.slice(0, 12)}…`);
  }
  return created;
}

async function main() {
  console.log(`[backfill] live-call classification${DRY_RUN ? " (dry run)" : ""}`);

  const demoted = await demoteWebTestCalls();
  const promoted = await promoteMisclassifiedDryRuns();
  const runsCreated = await ensureWorkflowRunsForLiveCalls();

  console.log(
    `[backfill] done: ${demoted} demoted to BUSINESS_TEST, ${promoted} promoted to LIVE, ${runsCreated} workflow runs created`
  );
  if (promoted > 0) {
    console.log("[backfill] tip: run `npm run backfill:recording-urls` next so promoted calls also get their recordings.");
  }
}

main()
  .catch((error) => {
    console.error("[backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
