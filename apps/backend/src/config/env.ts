import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z.preprocess(
  (value) => value === true || value === "true" || value === "1",
  z.boolean()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(24, "JWT_SECRET must be at least 24 characters"),
  JWT_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(7),

  ENCRYPTION_KEY: z.string().min(24, "ENCRYPTION_KEY must be at least 24 characters"),
  PLATFORM_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(15),

  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  BACKEND_URL: z.string().url().default("http://localhost:8787"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GMAIL_OAUTH_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_CALENDAR_DEFAULT_TIMEZONE: z.string().default("America/Los_Angeles"),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),

  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_PHONE_NUMBER_SID: z.string().optional(),

  /** Global Twilio Messaging Service every transactional SMS is sent through. */
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  /** Shared Triven SMS sender (E.164). Reserved — never assigned to a buyer. */
  TWILIO_SHARED_SMS_NUMBER: z.string().optional(),
  /** Public URL Twilio posts message delivery-status callbacks to. */
  TWILIO_SMS_STATUS_CALLBACK_URL: z.string().url().optional(),
  /**
   * Explicit SMS sending mode. SIMULATED = no provider request at all;
   * TWILIO_TEST_CREDENTIALS = Twilio test account + magic numbers (never
   * delivered, never production credentials); LIVE = shared Messaging Service.
   * Defaults to LIVE (or SIMULATED when the deprecated TWILIO_TEST_MODE=true).
   */
  TWILIO_SMS_MODE: z.enum(["SIMULATED", "TWILIO_TEST_CREDENTIALS", "LIVE"]).optional(),
  /** Twilio TEST credentials — used ONLY in TWILIO_TEST_CREDENTIALS mode. */
  TWILIO_TEST_ACCOUNT_SID: z.string().optional(),
  TWILIO_TEST_AUTH_TOKEN: z.string().optional(),
  /** @deprecated Use TWILIO_SMS_MODE. true maps to SIMULATED (no provider request). */
  TWILIO_TEST_MODE: booleanFromEnv.default(false),
  TWILIO_VALIDATE_SIGNATURE: booleanFromEnv.default(false),

  // Only SES is supported; the literal guards against configuring a removed provider.
  MAIL_PROVIDER: z.enum(["ses"]).default("ses"),
  SES_REGION: z.string().optional(),
  SES_FROM_DOMAIN: z.string().default("reply.triven.ai"),
  SES_MAIL_FROM_DOMAIN: z.string().default("bounce.reply.triven.ai"),
  SES_INBOUND_BUCKET: z.string().optional(),
  SES_INBOUND_TOPIC_ARN: z.string().optional(),
  SES_EVENTS_TOPIC_ARN: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().optional(),
  // SNS signature verification — always enforced in production; this flag only
  // allows unsigned test payloads in local development.
  SES_SNS_VERIFY: booleanFromEnv.default(true),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  /** Force dry-run (store + log instead of calling SES) even when configured. */
  SES_DRY_RUN: booleanFromEnv.default(false),

  /** Purpose-based platform senders (all transactional mail goes through SES). */
  SES_FROM_SUPPORT: z.string().optional(),
  SES_FROM_CONFIRM: z.string().optional(),
  SES_FROM_BILLING: z.string().optional(),
  SES_FROM_NO_REPLY: z.string().optional(),
  /** Reply-To for platform mail sent from no-reply-style senders. */
  SES_REPLY_TO: z.string().optional(),

  TWILIO_DEFAULT_BUSINESS_NAME: z.string().optional(),
  TWILIO_FORWARD_TO_PHONE: z.string().optional(),
  TWILIO_FORWARD_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(20),
  TWILIO_DEFAULT_BOOKING_URL: z.string().optional(),
  TWILIO_DEFAULT_TEAM_PHONE: z.string().optional(),
  TWILIO_NUMBER_POOL: z.string().optional(),

  VAPI_API_KEY: z.string().optional(),
  /** Shared secret Vapi sends back on webhook calls (Bearer or X-Vapi-Secret). */
  VAPI_WEBHOOK_SECRET: z.string().optional(),
  /** Frontend-safe Vapi public key for browser web calls (Architect test). */
  VAPI_PUBLIC_KEY: z.string().optional(),
  VAPI_BASE_URL: z.string().url().default("https://api.vapi.ai"),

  VAPI_DEFAULT_ASSISTANT_ID: z.string().optional(),
  VAPI_DEFAULT_PHONE_NUMBER_ID: z.string().optional(),

  VAPI_DEFAULT_VOICE_PROVIDER: z.string().default("vapi"),
  VAPI_DEFAULT_VOICE_ID: z.string().default("Savannah"),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().optional(),
  VAPI_ELEVENLABS_MODEL: z.string().default("eleven_flash_v2_5"),
  VAPI_TRANSCRIBER_PROVIDER: z.string().default("deepgram"),
  VAPI_TRANSCRIBER_MODEL: z.string().default("nova-3"),
  VAPI_ENABLE_BOOKING_TOOLS: booleanFromEnv.default(true),

  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-4o-mini"),
  ANTHROPIC_DEFAULT_MODEL: z.string().default("claude-sonnet-4-5"),
  GEMINI_DEFAULT_MODEL: z.string().default("gemini-2.0-flash"),

  ARCHITECT_TEST_LLM_MODEL: z.string().default("gpt-4o-mini"),

  ELEVENLABS_VOICE_RUBY_ID: z.string().optional(),
  ELEVENLABS_VOICE_SARAH_ID: z.string().optional(),
  ELEVENLABS_VOICE_ARIA_ID: z.string().optional(),
  ELEVENLABS_VOICE_ADAM_ID: z.string().optional(),
  ELEVENLABS_VOICE_PRIYA_ID: z.string().optional(),
  ELEVENLABS_VOICE_RACHEL_ID: z.string().optional(),

  ELEVENLABS_API_KEY: z.string().optional(),

  DEEPGRAM_API_KEY: z.string().optional(),

  MISTRAL_API_KEY: z.string().optional(),
  STABILITY_API_KEY: z.string().optional(),
  LLAMA_BASE_URL: z.string().default("http://localhost:11434/v1"),

  VAPI_ANSWER_INBOUND: booleanFromEnv.default(false),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY: z.string().optional(),

  /**
   * Platform access policy: when false (current default), every authenticated
   * BUSINESS owner may deploy/activate their agents regardless of Stripe
   * subscription state. Stripe billing data keeps updating normally either
   * way — deployment access and billing state are separate concepts.
   * Accepts true/false/1/0.
   */
  ENFORCE_AGENT_SUBSCRIPTION: booleanFromEnv.default(false)
});

function isDevOnlyUrl(url: string): boolean {
  return (
    !url.startsWith("https://") ||
    /localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.\d+\.|\.ngrok(-free)?\./i.test(url)
  );
}

const parsedEnv = envSchema.parse(process.env);

if (parsedEnv.TWILIO_TEST_MODE && !parsedEnv.TWILIO_SMS_MODE) {
  console.warn(
    "[env] TWILIO_TEST_MODE is deprecated and now maps to TWILIO_SMS_MODE=SIMULATED (no Twilio request is made). Set TWILIO_SMS_MODE explicitly."
  );
}

if (parsedEnv.NODE_ENV === "production") {
  const problems: string[] = [];

  if (isDevOnlyUrl(parsedEnv.BACKEND_URL)) {
    problems.push(
      `BACKEND_URL (${parsedEnv.BACKEND_URL}) must be a public https URL in production, e.g. https://triven.ai/api.`
    );
  }

  if (isDevOnlyUrl(parsedEnv.FRONTEND_URL)) {
    problems.push(
      `FRONTEND_URL (${parsedEnv.FRONTEND_URL}) must be a public https URL in production, e.g. https://triven.ai.`
    );
  }

  if (parsedEnv.BACKEND_URL.includes("api.triven.ai")) {
    problems.push("BACKEND_URL must be https://triven.ai/api, not api.triven.ai.");
  }

  if (parsedEnv.BACKEND_URL.includes("ngrok")) {
    problems.push("BACKEND_URL must not use ngrok in production.");
  }

  if (parsedEnv.FRONTEND_URL.includes("ngrok")) {
    problems.push("FRONTEND_URL must not use ngrok in production.");
  }

  if (!parsedEnv.TWILIO_ACCOUNT_SID) {
    problems.push("TWILIO_ACCOUNT_SID is required in production.");
  }

  if (!parsedEnv.TWILIO_AUTH_TOKEN) {
    problems.push("TWILIO_AUTH_TOKEN is required in production for webhook signature validation.");
  }

  if (!parsedEnv.TWILIO_API_KEY_SID || !parsedEnv.TWILIO_API_KEY_SECRET) {
    problems.push("TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET are required in production.");
  }

  if (!parsedEnv.TWILIO_VALIDATE_SIGNATURE) {
    problems.push("TWILIO_VALIDATE_SIGNATURE must be true in production.");
  }

  if (parsedEnv.TWILIO_TEST_MODE) {
    problems.push("TWILIO_TEST_MODE must be false in production (deprecated — use TWILIO_SMS_MODE=LIVE).");
  }

  if (parsedEnv.TWILIO_SMS_MODE && parsedEnv.TWILIO_SMS_MODE !== "LIVE") {
    problems.push(`TWILIO_SMS_MODE must be LIVE in production (got ${parsedEnv.TWILIO_SMS_MODE}).`);
  }

  if (parsedEnv.TWILIO_PHONE_NUMBER || parsedEnv.TWILIO_PHONE_NUMBER_SID) {
    console.warn(
      "[env] TWILIO_PHONE_NUMBER / TWILIO_PHONE_NUMBER_SID are legacy fallback values. Production routing should use DB-managed PlatformPhoneNumber + BusinessPhoneNumber."
    );
  }

  if (!parsedEnv.TWILIO_MESSAGING_SERVICE_SID || !parsedEnv.TWILIO_SHARED_SMS_NUMBER) {
    console.warn(
      "[env] TWILIO_MESSAGING_SERVICE_SID / TWILIO_SHARED_SMS_NUMBER are not set. Live outbound SMS uses the shared Triven Messaging Service and will fail until both are configured."
    );
  }

  if (parsedEnv.VAPI_DEFAULT_ASSISTANT_ID) {
    console.warn(
      "[env] VAPI_DEFAULT_ASSISTANT_ID is set. For production multi-business setup, keep it blank and store per-agent assistant IDs in InstalledAgent.configJson.vapiAssistantId."
    );
  }

  if (parsedEnv.VAPI_DEFAULT_PHONE_NUMBER_ID) {
    console.warn(
      "[env] VAPI_DEFAULT_PHONE_NUMBER_ID is set. For production multi-business setup, keep it blank and map phone numbers through PlatformPhoneNumber + BusinessPhoneNumber."
    );
  }

  if (problems.length > 0) {
    throw new Error(`Production env misconfigured:\n- ${problems.join("\n- ")}`);
  }
}

export const env = parsedEnv;

export const isProduction = env.NODE_ENV === "production";
