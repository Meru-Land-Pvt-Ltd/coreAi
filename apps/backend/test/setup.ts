// Load the backend .env first (real DATABASE_URL for integration tests), then
// fill anything still missing with dummies so src/config/env.ts parses.
// SES always stays in dry-run here — no AWS call is ever made from tests.
import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-at-least-24-chars";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "test-encryption-key-24-chars!";
process.env.SES_DRY_RUN = "true";
// Tests never talk to Redis — email jobs dispatch inline.
delete process.env.REDIS_URL;
