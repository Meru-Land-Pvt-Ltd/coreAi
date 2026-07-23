import { env } from "../src/config/env";

async function main() {
  const base = env.VAPI_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/call?limit=8`, {
    headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` }
  });
  if (!res.ok) {
    console.error(`Vapi API ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const calls = await res.json();
  for (const call of Array.isArray(calls) ? calls : []) {
    const started = call.startedAt ?? call.createdAt;
    const ended = call.endedAt;
    const durMs = started && ended ? new Date(ended).getTime() - new Date(started).getTime() : null;
    console.log(
      JSON.stringify({
        id: call.id?.slice(0, 14),
        type: call.type,
        status: call.status,
        endedReason: call.endedReason ?? null,
        durationSec: durMs !== null ? Math.round(durMs / 1000) : null,
        createdAt: call.createdAt
      })
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
