import "dotenv/config";
import { z } from "zod";

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

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_TEST_MODE: z
    .preprocess((value) => value === true || value === "true" || value === "1", z.boolean())
    .default(false),
  TWILIO_VALIDATE_SIGNATURE: z
    .preprocess((value) => value === true || value === "true" || value === "1", z.boolean())
    .default(false),
  TWILIO_DEFAULT_BUSINESS_NAME: z.string().optional(),
  TWILIO_FORWARD_TO_PHONE: z.string().optional(),
  TWILIO_FORWARD_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(20),
  TWILIO_DEFAULT_BOOKING_URL: z.string().optional(),
  TWILIO_DEFAULT_TEAM_PHONE: z.string().optional(),
  TWILIO_NUMBER_POOL: z.string().optional(),
  VAPI_API_KEY: z.string().optional(),
  VAPI_BASE_URL: z.string().url().default("https://api.vapi.ai"),
  VAPI_DEFAULT_ASSISTANT_ID: z.string().optional(),
  VAPI_DEFAULT_PHONE_NUMBER_ID: z.string().optional(),
  VAPI_DEFAULT_VOICE_ID: z.string().optional(),
  VAPI_DEFAULT_VOICE_PROVIDER: z.string().default("11labs"),

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_SARAH_ID: z.string().optional(),
  ELEVENLABS_VOICE_ARIA_ID: z.string().optional(),
  ELEVENLABS_VOICE_RACHEL_ID: z.string().optional(),
  ELEVENLABS_VOICE_ADAM_ID: z.string().optional(),
  ELEVENLABS_VOICE_PRIYA_ID: z.string().optional(),
  VAPI_ANSWER_INBOUND: z
    .preprocess((value) => value === true || value === "true" || value === "1", z.boolean())
    .default(false),

  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_CALENDAR_DEFAULT_TIMEZONE: z.string().default("America/New_York"),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY: z.string().optional(),

});

/** True when a URL is only suitable for local/dev use (never production). */
function isDevOnlyUrl(url: string): boolean {
  return (
    !url.startsWith("https://") ||
    /localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.\d+\.|\.ngrok(-free)?\./i.test(url)
  );
}

const parsedEnv = envSchema.parse(process.env);

// Production hard guards: fail fast on dev-only URLs so Twilio/Google/Stripe
// webhooks and OAuth callbacks can never silently point at localhost or ngrok.
if (parsedEnv.NODE_ENV === "production") {
  const problems: string[] = [];
  if (isDevOnlyUrl(parsedEnv.BACKEND_URL)) {
    problems.push(
      `BACKEND_URL (${parsedEnv.BACKEND_URL}) must be a public https URL in production (e.g. https://triven.ai/api).`
    );
  }
  if (isDevOnlyUrl(parsedEnv.FRONTEND_URL)) {
    problems.push(
      `FRONTEND_URL (${parsedEnv.FRONTEND_URL}) must be a public https URL in production (e.g. https://triven.ai).`
    );
  }
  if (problems.length > 0) {
    throw new Error(`Production env misconfigured:\n- ${problems.join("\n- ")}`);
  }

  if (!parsedEnv.TWILIO_VALIDATE_SIGNATURE) {
    console.warn(
      "[env] TWILIO_VALIDATE_SIGNATURE is OFF in production — Twilio webhooks are unauthenticated. Set TWILIO_VALIDATE_SIGNATURE=true."
    );
  }
  if (parsedEnv.TWILIO_TEST_MODE) {
    console.warn("[env] TWILIO_TEST_MODE is ON in production — SMS sends are mocked. Set TWILIO_TEST_MODE=false.");
  }
}

export const env = parsedEnv;

export const isProduction = env.NODE_ENV === "production";