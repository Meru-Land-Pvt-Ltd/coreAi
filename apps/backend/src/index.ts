import { serve } from "@hono/node-server";
import { env } from "./config/env";
import { app } from "./app";
import { prisma } from "./lib/prisma";
import { initProviderEngine } from "./modules/ai-provider-engine/provider-engine";
import { preloadPlatformApiSettings } from "./modules/admin/platform-api-settings";
import { attachDeepgramLiveProxy } from "./modules/ai-provider-engine/deepgram-live-proxy";
import { startBillingScheduler, stopBillingScheduler } from "./modules/business/billing-cycle";
import { startEarningReleaseWorker, stopEarningReleaseWorker } from "./modules/payouts/release-worker";
// [DISABLED:non-handoff] worker imports for the commented starts below.
// import { startReminderWorker, stopReminderWorker } from "./modules/business/reminders/reminder-worker";
// import {
//   startRetentionSweepWorker,
//   stopRetentionSweepWorker
// } from "./modules/business/conversation-understanding/retention";
// import { evaluateRecentCalls } from "./modules/business/quality/evaluate";
// [DISABLED] import { escalateStaleWaiting } from "./modules/business/inbox/inbox-service";
import {
  registerTelegramManagerWebhook,
  telegramManagerEnvironmentConfigured
} from "./modules/architect/telegram-connector";

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT
  },
  async (info) => {
    console.log(`Triven backend running on http://localhost:${info.port}`);
    /* Warm the admin-managed API keys BEFORE the provider engine validates
       credentials — otherwise the engine boots against .env only and a key
       entered in Admin → Manage API would look missing until the cache filled. */
    await preloadPlatformApiSettings();
    await initProviderEngine();
    startBillingScheduler();
    startEarningReleaseWorker();
    // [DISABLED:non-handoff] reminder + retention workers and quality sweep.
    // startReminderWorker();
    // startRetentionSweepWorker();
    // const qualitySweep = setInterval(() => {
    //   evaluateRecentCalls({ limit: 20 }).catch((error) =>
    //     console.error("[quality] sweep failed", error)
    //   );
    // }, 15 * 60 * 1000);
    // qualitySweep.unref();
    // [DISABLED] inbox SLA escalation sweep.
    // const inboxSlaSweep = setInterval(() => {
    //   escalateStaleWaiting().catch((error) => console.error("[inbox] SLA sweep failed", error));
    // }, 60 * 1000);
    // inboxSlaSweep.unref();
    if (telegramManagerEnvironmentConfigured()) {
      void registerTelegramManagerWebhook()
        .then((result) => {
          console.log(`[telegram-manager] webhook ready for @${result.botUsername}`);
        })
        .catch((error) => {
          console.warn(
            `[telegram-manager] managed provisioning unavailable: ${
              error instanceof Error ? error.message : "setup failed"
            }`
          );
        });
    }
  }
);

attachDeepgramLiveProxy(server as Parameters<typeof attachDeepgramLiveProxy>[0]);

async function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down gracefully...`);

  stopBillingScheduler();
  stopEarningReleaseWorker();
  // [DISABLED:non-handoff]
  // stopReminderWorker();
  // stopRetentionSweepWorker();

  await prisma.$disconnect();

  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
