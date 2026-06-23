import type { Context, Next } from "hono";
import { randomUUID } from "crypto";

export async function requestIdMiddleware(c: Context, next: Next) {
  const requestId = c.req.header("x-request-id") ?? randomUUID();

  c.set("requestId", requestId);
  c.header("x-request-id", requestId);

  await next();
}