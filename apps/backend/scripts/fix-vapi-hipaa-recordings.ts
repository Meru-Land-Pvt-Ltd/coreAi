import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const BASE = env.VAPI_BASE_URL.replace(/\/$/, "");

function isRealId(value?: string | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return Boolean(v && !v.includes("your_") && !v.includes("xxx") && !v.includes("placeholder"));
}

async function vapi(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.VAPI_API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    signal: AbortSignal.timeout(20000)
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

function hipaaStateOf(record: Record<string, unknown>): boolean {
  if (record.hipaaEnabled === true) return true;
  const plan = record.compliancePlan;
  if (plan && typeof plan === "object" && (plan as Record<string, unknown>).hipaaEnabled === true) return true;
  return false;
}

async function collectAssistantIds(): Promise<string[]> {
  const ids = new Set<string>();

  const profiles = await prisma.businessProfile.findMany({
    where: { vapiAssistantId: { not: null } },
    select: { vapiAssistantId: true }
  });
  for (const profile of profiles) {
    if (isRealId(profile.vapiAssistantId)) ids.add(profile.vapiAssistantId as string);
  }

  const agents = await prisma.installedAgent.findMany({ select: { configJson: true } });
  for (const agent of agents) {
    const config =
      agent.configJson && typeof agent.configJson === "object" && !Array.isArray(agent.configJson)
        ? (agent.configJson as Record<string, unknown>)
        : {};
    const id = typeof config.vapiAssistantId === "string" ? config.vapiAssistantId : "";
    if (isRealId(id)) ids.add(id);
  }

  return [...ids];
}

async function main() {
  console.log(`[vapi-hipaa] mode: ${APPLY ? "APPLY" : "report-only (pass --apply to fix)"}`);

  // --- Org-level flag: this is the one that forces the private bucket. ---
  const org = await vapi("/org");
  if (org.status === 401) {
    console.error(
      "[vapi-hipaa] 401 from Vapi — this environment does not have the real PRIVATE api key. Run this on the production server."
    );
    process.exitCode = 1;
    return;
  }
  if (org.status >= 400) {
    console.error("[vapi-hipaa] could not read org settings", org.status, org.body?.message ?? "");
    process.exitCode = 1;
    return;
  }

  const orgHipaa = hipaaStateOf(org.body);
  console.log(`[vapi-hipaa] org "${org.body.name ?? org.body.id}": hipaaEnabled=${orgHipaa}`);

  if (orgHipaa && APPLY) {
    const patched = await vapi("/org", { method: "PATCH", body: JSON.stringify({ hipaaEnabled: false }) });
    if (patched.status < 400 && !hipaaStateOf(patched.body)) {
      console.log("[vapi-hipaa] org HIPAA turned OFF");
    } else {
      console.error("[vapi-hipaa] org PATCH failed", patched.status, patched.body?.message ?? "");
    }
  }

  // --- Assistant-level flags for every assistant this platform deployed. ---
  const assistantIds = await collectAssistantIds();
  console.log(`[vapi-hipaa] checking ${assistantIds.length} deployed assistant(s)`);

  let flagged = 0;
  for (const assistantId of assistantIds) {
    const assistant = await vapi(`/assistant/${encodeURIComponent(assistantId)}`);
    if (assistant.status >= 400) {
      console.warn(`[vapi-hipaa] assistant ${assistantId}: lookup failed (${assistant.status})`);
      continue;
    }

    const hipaa = hipaaStateOf(assistant.body);
    console.log(`[vapi-hipaa] assistant ${assistantId} (${assistant.body.name ?? "unnamed"}): hipaa=${hipaa}`);
    if (!hipaa) continue;

    flagged += 1;
    if (!APPLY) continue;

    let patched = await vapi(`/assistant/${encodeURIComponent(assistantId)}`, {
      method: "PATCH",
      body: JSON.stringify({ compliancePlan: { hipaaEnabled: false } })
    });
    if (patched.status < 400 && hipaaStateOf(patched.body)) {
      // Older API shape: legacy top-level flag still set — clear it too.
      patched = await vapi(`/assistant/${encodeURIComponent(assistantId)}`, {
        method: "PATCH",
        body: JSON.stringify({ hipaaEnabled: false })
      });
    }
    if (patched.status < 400 && !hipaaStateOf(patched.body)) {
      console.log(`[vapi-hipaa] assistant ${assistantId}: HIPAA turned OFF`);
    } else {
      console.error(`[vapi-hipaa] assistant ${assistantId}: PATCH failed`, patched.status, patched.body?.message ?? "");
    }
  }

  console.log(
    `[vapi-hipaa] done. org hipaa=${orgHipaa}${APPLY && orgHipaa ? " (fix attempted)" : ""}, assistants flagged=${flagged}.`
  );
  console.log(
    "[vapi-hipaa] note: recordings already stored in the hipaa-recordings bucket stay unplayable — make a NEW call after fixing to verify playback."
  );
}

main()
  .catch((error) => {
    console.error("[vapi-hipaa] failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
