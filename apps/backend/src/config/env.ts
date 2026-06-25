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
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_TEST_MODE: z
    .preprocess((value) => value === true || value === "true" || value === "1", z.boolean())
    .default(false),
  TWILIO_DEFAULT_BUSINESS_NAME: z.string().optional(),
  TWILIO_FORWARD_TO_PHONE: z.string().optional(),
  TWILIO_FORWARD_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(20),
  TWILIO_DEFAULT_BOOKING_URL: z.string().optional(),
  TWILIO_DEFAULT_TEAM_PHONE: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === "production";