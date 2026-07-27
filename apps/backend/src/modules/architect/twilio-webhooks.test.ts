import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { sendTrackedSms } from "../notifications/sms-notification-service";
import { handleTwilioInboundSms, handleTwilioMessageStatus } from "./twilio-business-routing";

/**
 * Webhook-level tests: Twilio signature validation on the message-status
 * callback, and shared-sender inbound SMS routing safety. Twilio's outbound
 * API is stubbed; DB-dependent cases skip when the database is down.
 */

const RUN = `twhtest-${process.pid}-${Date.now().toString(36)}`;

const originalEnv = {
  TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY_SID: env.TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET: env.TWILIO_API_KEY_SECRET,
  TWILIO_MESSAGING_SERVICE_SID: env.TWILIO_MESSAGING_SERVICE_SID,
  TWILIO_SMS_MODE: env.TWILIO_SMS_MODE,
  TWILIO_TEST_MODE: env.TWILIO_TEST_MODE,
  TWILIO_VALIDATE_SIGNATURE: env.TWILIO_VALIDATE_SIGNATURE,
  TWILIO_SHARED_SMS_NUMBER: env.TWILIO_SHARED_SMS_NUMBER
};

const AUTH_TOKEN = "unit-test-auth-token";

let dbAvailable = false;
let bizAId = "";
let bizBId = "";

/** Twilio's documented signing: URL + sorted(key+value), HMAC-SHA1, base64. */
function twilioSign(url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", AUTH_TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

function buildApp() {
  const app = new Hono();
  app.post("/architect/connectors/twilio/message-status", handleTwilioMessageStatus);
  app.post("/architect/connectors/twilio/inbound-sms", handleTwilioInboundSms);
  return app;
}

function postForm(
  app: Hono,
  path: string,
  params: Record<string, string>,
  headers: Record<string, string> = {}
) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(params)
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[twilio-webhooks.test] database unreachable — DB cases skipped");
    return;
  }

  const [ownerA, ownerB] = await Promise.all([
    prisma.user.create({ data: { email: `${RUN}-a@test.local`, role: "BUSINESS" } }),
    prisma.user.create({ data: { email: `${RUN}-b@test.local`, role: "BUSINESS" } })
  ]);
  const [bizA, bizB] = await Promise.all([
    prisma.business.create({ data: { ownerId: ownerA.id, name: `${RUN} A`, type: "dental" } }),
    prisma.business.create({ data: { ownerId: ownerB.id, name: `${RUN} B`, type: "salon" } })
  ]);
  bizAId = bizA.id;
  bizBId = bizB.id;
}, 30_000);

afterAll(async () => {
  if (dbAvailable) {
    await prisma.smsExecution.deleteMany({ where: { businessId: { in: [bizAId, bizBId] } } });
    await prisma.conversation.deleteMany({ where: { businessId: { in: [bizAId, bizBId] } } });
    await prisma.business.deleteMany({ where: { id: { in: [bizAId, bizBId] } } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  }
  await prisma.$disconnect();
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe("message-status webhook signature validation", () => {
  it("rejects an unsigned/invalid request when validation is enabled", async () => {
    env.TWILIO_VALIDATE_SIGNATURE = true;
    env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;

    const app = buildApp();
    const unsigned = await postForm(app, "/architect/connectors/twilio/message-status", {
      MessageSid: "SMx",
      MessageStatus: "delivered"
    });
    expect(unsigned.status).toBe(403);

    const badlySigned = await postForm(
      app,
      "/architect/connectors/twilio/message-status",
      { MessageSid: "SMx", MessageStatus: "delivered" },
      { "X-Twilio-Signature": "not-a-real-signature" }
    );
    expect(badlySigned.status).toBe(403);
  });

  it("accepts a correctly signed request", async () => {
    env.TWILIO_VALIDATE_SIGNATURE = true;
    env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;

    const params = { MessageSid: `SM-${RUN}-signed`, MessageStatus: "sent" };
    // The backend reconstructs the public URL from BACKEND_URL + route path.
    const publicUrl = `${env.BACKEND_URL.replace(/\/$/, "")}/architect/connectors/twilio/message-status`;

    const app = buildApp();
    const response = await postForm(app, "/architect/connectors/twilio/message-status", params, {
      "X-Twilio-Signature": twilioSign(publicUrl, params)
    });
    expect(response.status).toBe(200);
  });
});

describe("shared-sender inbound SMS routing safety", () => {
  let sidCounter = 0; // module-lifetime counter — message SIDs must stay unique across tests

  function stubTwilioAccepting() {
    env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
    env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    env.TWILIO_MESSAGING_SERVICE_SID = "MGtest0000000000000000000000000000";
    env.TWILIO_SMS_MODE = "LIVE";
    env.TWILIO_TEST_MODE = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        sidCounter += 1;
        return {
          ok: true,
          status: 201,
          json: async () => ({ sid: `SM${RUN}in${sidCounter}`, status: "queued", num_segments: "1" })
        };
      })
    );
  }

  it("does not attach a reply to any buyer when multiple businesses texted the customer", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubTwilioAccepting();
    env.TWILIO_VALIDATE_SIGNATURE = false;
    env.TWILIO_SHARED_SMS_NUMBER = "+17252202182";

    const customer = `+1555${String(Date.now()).slice(-7)}`;
    await sendTrackedSms({ to: customer, body: "from A", messageType: "TEST_SMS", businessId: bizAId });
    await sendTrackedSms({ to: customer, body: "from B", messageType: "TEST_SMS", businessId: bizBId });

    const app = buildApp();
    const response = await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: "+17252202182",
      From: customer,
      Body: "What time is my appointment?"
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<Response></Response>");

    const conversations = await prisma.conversation.findMany({
      where: { customerPhone: customer, businessId: { in: [bizAId, bizBId] } }
    });
    expect(conversations).toHaveLength(0);
  });

  it("never infers a business even when exactly one recently texted the customer", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    stubTwilioAccepting();
    env.TWILIO_VALIDATE_SIGNATURE = false;
    env.TWILIO_SHARED_SMS_NUMBER = "+17252202182";

    const customer = `+1556${String(Date.now()).slice(-7)}`;
    await sendTrackedSms({ to: customer, body: "from A only", messageType: "TEST_SMS", businessId: bizAId });

    const app = buildApp();
    const response = await postForm(app, "/architect/connectors/twilio/inbound-sms", {
      To: "+17252202182",
      From: customer,
      Body: "Thanks!"
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<Response></Response>");

    // No heuristic association: the reply must not reach ANY buyer.
    const conversations = await prisma.conversation.findMany({ where: { customerPhone: customer } });
    expect(conversations).toHaveLength(0);
  });
});
