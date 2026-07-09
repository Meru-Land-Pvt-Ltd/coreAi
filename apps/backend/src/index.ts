import { serve } from "@hono/node-server";
import { env } from "./config/env";
import { app } from "./app";
import { prisma } from "./lib/prisma";
import { initProviderEngine } from "./modules/ai-provider-engine/provider-engine";

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT
  },
  async (info) => {
    console.log(`CoreAI backend running on http://localhost:${info.port}`);
    await initProviderEngine();
  }
);

async function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down gracefully...`);

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