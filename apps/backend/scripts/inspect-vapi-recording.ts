import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";

const BASE = env.VAPI_BASE_URL.replace(/\/$/, "");

function findUrls(value: unknown, path: string, out: Array<{ path: string; url: string }>) {
  if (typeof value === "string") {
    if (/^https:\/\//i.test(value.trim())) out.push({ path, url: value.trim() });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findUrls(item, `${path}[${index}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      findUrls(nested, path ? `${path}.${key}` : key, out);
    }
  }
}

async function probe(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-1" },
      signal: AbortSignal.timeout(8000)
    });
    return `HTTP ${response.status}${response.status === 200 || response.status === 206 ? " ✓ playable" : " ✗"}`;
  } catch (error) {
    return `fetch failed (${(error as Error).message}) ✗`;
  }
}

async function main() {
  let callId = (process.argv[2] ?? "").trim();

  if (!callId) {
    const latest = await prisma.vapiCall.findFirst({
      where: { executionMode: "LIVE" },
      orderBy: { createdAt: "desc" },
      select: { callId: true }
    });
    if (!latest) {
      console.error("[inspect] no LIVE calls in the database — pass a Vapi call id explicitly.");
      process.exitCode = 1;
      return;
    }
    callId = latest.callId;
  }

  console.log(`[inspect] call ${callId}`);

  const response = await fetch(`${BASE}/call/${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` },
    signal: AbortSignal.timeout(20000)
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    console.error(`[inspect] Vapi API ${response.status}: ${JSON.stringify(payload.message ?? payload.error ?? "")}`);
    if (response.status === 401) {
      console.error("[inspect] the environment's VAPI_API_KEY is not the real private key — run on the server.");
    }
    process.exitCode = 1;
    return;
  }

  const urls: Array<{ path: string; url: string }> = [];
  findUrls(payload, "", urls);
  const recordingUrls = urls.filter(({ path, url }) => /record|artifact|\.wav|\.mp3/i.test(`${path} ${url}`));

  if (recordingUrls.length === 0) {
    console.log("[inspect] NO recording URLs in the API payload — recording disabled, still uploading, or HIPAA storage without artifact URLs.");
    console.log("[inspect] payload top-level keys:", Object.keys(payload).sort().join(", "));
    return;
  }

  for (const { path, url } of recordingUrls) {
    const signed = /[?&]X-Amz-Signature=/i.test(url) ? "presigned" : "BARE (no signature)";
    const status = await probe(url);
    console.log(`[inspect] ${path}\n  ${url.split("?")[0]}\n  ${signed} → ${status}`);
  }

  console.log(
    "[inspect] verdict: if a presigned URL shows ✓, the dashboard player works via /business/calls/:id/recording-url. If only BARE URLs exist and they 400, the org still has HIPAA storage — run `npm run vapi:fix-hipaa -- --apply`."
  );
}

main()
  .catch((error) => {
    console.error("[inspect] failed", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
