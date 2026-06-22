import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./common/lib/env.js";

serve({
  fetch: app.fetch,
  port: env.PORT,
});

console.log(`backend listening on http://localhost:${env.PORT}`);
