import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(10),
  ENCRYPTION_KEY: z.string().min(16),
  PLATFORM_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(15),
});

export const env = schema.parse(process.env);
