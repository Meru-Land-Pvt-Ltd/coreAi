import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
import { z } from "zod";

const booleanFromEnv = z.preprocess(
  (value) => value === true || value === "true" || value === "1",
  z.boolean()
);

const emptyEnvStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

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
  SMS_ATTRIBUTION_BRAND: z.string().optional(),
  TWILIO_US_SMS_FROM: z.string().optional(),
  /** Public URL Twilio posts message delivery-status callbacks to. */
  TWILIO_SMS_STATUS_CALLBACK_URL: z.string().url().optional(),
  TWILIO_SMS_MODE: z.enum(["SIMULATED", "TWILIO_TEST_CREDENTIALS", "LIVE"]).optional(),
  /** Twilio TEST credentials — used ONLY in TWILIO_TEST_CREDENTIALS mode. */
  TWILIO_TEST_ACCOUNT_SID: z.string().optional(),
  TWILIO_TEST_AUTH_TOKEN: z.string().optional(),
  /** @deprecated Use TWILIO_SMS_MODE. true maps to SIMULATED (no provider request). */
  TWILIO_TEST_MODE: booleanFromEnv.default(false),
  TWILIO_VALIDATE_SIGNATURE: booleanFromEnv.default(false),
  SMS_KEYWORD_APP_REPLIES: booleanFromEnv.default(false),
  SMS_UNRELIABLE_COUNTRY_PREFIXES: z.string().default("91"),

  // Only SES is supported; the literal guards against configuring a removed provider.
  MAIL_PROVIDER: z.enum(["ses"]).default("ses"),
  SES_REGION: z.string().optional(),
  SES_FROM_DOMAIN: z.string().default("reply.triven.ai"),
  SES_MAIL_FROM_DOMAIN: z.string().default("bounce.reply.triven.ai"),
  SES_INBOUND_BUCKET: z.string().optional(),
  SES_INBOUND_TOPIC_ARN: z.string().optional(),
  SES_EVENTS_TOPIC_ARN: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().optional(),
  SES_SNS_VERIFY: booleanFromEnv.default(true),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_UPLOAD_BUCKET: z.string().optional(),
  S3_UPLOAD_REGION: z.string().optional(),
  S3_UPLOAD_PUBLIC_BASE_URL: z.string().url().optional(),
  S3_UPLOAD_PREFIX: z.string().default("marketplace"),
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

  TELEGRAM_API_BASE_URL: z.string().url().default("https://api.telegram.org"),
  /** Platform manager bot. Individual business bot tokens are encrypted in PostgreSQL. */
  TELEGRAM_MANAGER_BOT_TOKEN: z.string().optional(),
  TELEGRAM_MANAGER_BOT_USERNAME: z.preprocess(
    emptyEnvStringToUndefined,
    z
      .string()
      .regex(/^@?[A-Za-z0-9_]{5,32}$/, "Enter the Telegram manager bot username")
      .optional()
  ),
  TELEGRAM_MANAGER_WEBHOOK_SECRET: z.preprocess(
    emptyEnvStringToUndefined,
    z
      .string()
      .min(24)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/, "Telegram webhook secret contains unsupported characters")
      .optional()
  ),

  /** Buyer knowledge documents: max stored files per business. */
  KNOWLEDGE_MAX_FILES_PER_BUSINESS: z.coerce.number().int().positive().default(20),
  /** Buyer knowledge documents: max extracted characters per document. */
  KNOWLEDGE_MAX_EXTRACTED_CHARS: z.coerce.number().int().positive().default(200_000),
  /** Buyer knowledge documents: max pages parsed from one PDF. */
  KNOWLEDGE_MAX_PDF_PAGES: z.coerce.number().int().positive().default(150),

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

  VAPI_DEFAULT_LLM_PROVIDER: z.string().default("openai"),
  VAPI_DEFAULT_LLM_MODEL: z.string().default("gpt-4o-mini"),
  VAPI_ANTHROPIC_ENABLED: booleanFromEnv.default(false),
  VAPI_ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  VAPI_TRANSCRIBER_PROVIDER: z.string().default("deepgram"),
  VAPI_TRANSCRIBER_MODEL: z.string().default("nova-3"),
  VAPI_ENABLE_BOOKING_TOOLS: booleanFromEnv.default(true),

  /** Platform-wide cap on marketplace demo call starts per day (cost control). */
  MARKETPLACE_DEMO_GLOBAL_DAILY_LIMIT: z.coerce.number().int().positive().default(200),
  MEMORY_VECTOR_THRESHOLD_TOKENS: z.coerce.number().int().positive().default(1_000_000),
  MEMORY_VECTOR_TOP_K: z.coerce.number().int().positive().default(20),
  MEMORY_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  MEMORY_MAX_CHUNKS_PER_SCOPE: z.coerce.number().int().positive().default(5000),
  MEMORY_EMBED_MAX_PER_CALL: z.coerce.number().int().positive().default(256),
  /** Smart Memory: token cap per tenant (business or architect) — oldest records pruned beyond it. */
  MEMORY_MAX_TOKENS_PER_TENANT: z.coerce.number().int().positive().default(50_000_000),
  /** Smart Memory: delete records older than this many days (0 disables). */
  MEMORY_RETENTION_DAYS: z.coerce.number().int().min(0).default(365),
  /** Smart Memory: shorter retention for test-session records (0 disables). */
  MEMORY_TEST_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),

  /** Meta WhatsApp Cloud API (optional — connections store their own tokens). */
  META_WHATSAPP_APP_ID: z.string().optional(),
  META_WHATSAPP_APP_SECRET: z.string().optional(),
  META_WHATSAPP_API_VERSION: z.string().default("v21.0"),
  META_WHATSAPP_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  /**
   * WhatsApp Embedded Signup configuration id (Facebook Login for Business).
   * Required to launch the embedded signup flow without asking for tokens/ids from customers.
   */
  META_WHATSAPP_EMBEDDED_SIGNUP_CONFIGURATION_ID: z.string().optional(),
  /**
   * Webhook verify token expected by Meta during subscription challenges.
   * Used to ensure the app can verify Meta webhooks after automated onboarding.
   */
  META_WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
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

  /** Cartesia TTS — the provider behind the Skylar/Ronald voice presets. */
  CARTESIA_API_KEY: z.string().optional(),
  CARTESIA_VERSION: z.string().default("2024-06-10"),
  CARTESIA_TTS_MODEL: z.string().default("sonic-2"),
  CARTESIA_VOICE_SKYLAR_ID: z.string().optional(),
  CARTESIA_VOICE_ELLA_ID: z.string().optional(),
  CARTESIA_VOICE_JACQUELINE_ID: z.string().optional(),
  CARTESIA_VOICE_BLAKE_ID: z.string().optional(),
  CARTESIA_VOICE_RONALD_ID: z.string().optional(),

  DEEPGRAM_API_KEY: z.string().optional(),

  MISTRAL_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  STABILITY_API_KEY: z.string().optional(),
  LLAMA_BASE_URL: z.string().default("http://localhost:11434/v1"),

  GOOGLE_WORKSPACE_AI_PROCESSING_ENABLED: booleanFromEnv.default(false),
  VAPI_WORKSPACE_NO_TRAINING_CONFIRMED: booleanFromEnv.default(false),
  VAPI_HIPAA_OR_ZDR_CONFIRMED: booleanFromEnv.default(false),
  OPENAI_NO_TRAINING_CONFIRMED: booleanFromEnv.default(false),
  OPENAI_DATA_SHARING_DISABLED_CONFIRMED: booleanFromEnv.default(false),
  ANTHROPIC_NO_TRAINING_CONFIRMED: booleanFromEnv.default(false),
  ANTHROPIC_FEEDBACK_SHARING_DISABLED_CONFIRMED: booleanFromEnv.default(false),
  GEMINI_PAID_SERVICE_CONFIRMED: booleanFromEnv.default(false),
  GEMINI_DATASET_SHARING_DISABLED_CONFIRMED: booleanFromEnv.default(false),
  DEEPGRAM_MIP_OPT_OUT_CONFIRMED: booleanFromEnv.default(false),
  ELEVENLABS_TRAINING_OPT_OUT_CONFIRMED: booleanFromEnv.default(false),
  ELEVENLABS_ZRM_CONFIRMED: booleanFromEnv.default(false),

  VAPI_ANSWER_INBOUND: booleanFromEnv.default(false),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY: z.string().optional(),

  STRIPE_CONNECT_RETURN_URL: z.string().url().optional(),
  STRIPE_CONNECT_REFRESH_URL: z.string().url().optional(),
  ARCHITECT_EARNING_HOLD_DAYS: z.coerce.number().int().min(0).max(365).default(7),
  ARCHITECT_MINIMUM_TRANSFER_AMOUNT_MINOR: z.coerce.number().int().min(1).default(100),
  ARCHITECT_MINIMUM_PAYOUT_AMOUNT_MINOR: z.coerce.number().int().min(1).default(500),
  ARCHITECT_DEFAULT_PAYOUT_CURRENCY: z.string().default("usd"),
  ARCHITECT_PAYOUT_MAX_ACTIVE_REQUESTS: z.coerce.number().int().min(1).max(20).default(3),
  ARCHITECT_PAYOUT_RESERVATION_TIMEOUT_MINUTES: z.coerce.number().int().min(5).default(60),
  ARCHITECT_AUTO_TRANSFER_ENABLED: booleanFromEnv.default(false),

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

  // Without the shared secret, the Vapi webhook accepts unsigned posts —
  // spoofed end-of-call reports would create billing/usage rows.
  if (parsedEnv.VAPI_API_KEY && !parsedEnv.VAPI_WEBHOOK_SECRET) {
    problems.push(
      "VAPI_WEBHOOK_SECRET is required in production when VAPI_API_KEY is set — unsigned Vapi webhooks must be rejected."
    );
  }

  if (parsedEnv.VAPI_API_KEY && !parsedEnv.VAPI_PUBLIC_KEY) {
    console.warn(
      "[env] VAPI_PUBLIC_KEY is not set — browser voice tests and marketplace demo calls will be unavailable."
    );
  }

  // Payments degrade to 503s without these — warn loudly instead of failing
  // silently at the first buyer checkout.
  if (!parsedEnv.STRIPE_SECRET_KEY || !parsedEnv.STRIPE_PUBLISHABLE_KEY) {
    console.warn(
      "[env] STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY are not both set — buyer checkout (paid agents) will be unavailable."
    );
  } else if (parsedEnv.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
    console.warn(
      "[env] STRIPE_SECRET_KEY is a TEST key in production — real cards will be rejected."
    );
  }

  if (parsedEnv.STRIPE_SECRET_KEY && !parsedEnv.STRIPE_WEBHOOK_SECRET) {
    console.warn(
      "[env] STRIPE_WEBHOOK_SECRET is not set — the payment webhook backstop is disabled; a purchase whose response is lost after the charge will not be recorded automatically."
    );
  }

  if (parsedEnv.STRIPE_SECRET_KEY && !parsedEnv.STRIPE_CONNECT_WEBHOOK_SECRET) {
    console.warn(
      "[env] STRIPE_CONNECT_WEBHOOK_SECRET is not set — Connect payout/account events are dropped; payout statuses rely on polling only."
    );
  }

  for (const [name, url] of [
    ["STRIPE_CONNECT_RETURN_URL", parsedEnv.STRIPE_CONNECT_RETURN_URL],
    ["STRIPE_CONNECT_REFRESH_URL", parsedEnv.STRIPE_CONNECT_REFRESH_URL]
  ] as const) {
    if (url && isDevOnlyUrl(url)) {
      problems.push(`${name} (${url}) must be a public https URL in production, e.g. https://triven.ai/architect/payouts.`);
    }
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

  const telegramManagerValues = [
    parsedEnv.TELEGRAM_MANAGER_BOT_TOKEN,
    parsedEnv.TELEGRAM_MANAGER_BOT_USERNAME,
    parsedEnv.TELEGRAM_MANAGER_WEBHOOK_SECRET
  ];
  if (telegramManagerValues.some(Boolean) && !telegramManagerValues.every(Boolean)) {
    problems.push(
      "TELEGRAM_MANAGER_BOT_TOKEN, TELEGRAM_MANAGER_BOT_USERNAME, and TELEGRAM_MANAGER_WEBHOOK_SECRET must be set together."
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
