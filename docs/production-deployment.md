# CoreAI / Triven.ai — Production Deployment Runbook

Last updated: 2026-07-03

## 1. Canonical URL strategy

Production backend is served **behind the frontend domain under a path prefix**:

| Env var | Production value |
|---|---|
| `BACKEND_URL` | `https://triven.ai/api` |
| `FRONTEND_URL` | `https://triven.ai` |
| `NEXT_PUBLIC_API_URL` (frontend) | `https://triven.ai/api` |

There is **no `api.triven.ai` subdomain**. All public callbacks/webhooks/OAuth URLs are built from `BACKEND_URL`:

| Purpose | External URL | Internal Hono route |
|---|---|---|
| Twilio voice | `POST https://triven.ai/api/architect/connectors/twilio/voice` | `/architect/connectors/twilio/voice` |
| Twilio voice action | `POST https://triven.ai/api/architect/connectors/twilio/voice-action` | `/architect/connectors/twilio/voice-action` |
| Twilio inbound SMS | `POST https://triven.ai/api/architect/connectors/twilio/inbound-sms` | `/architect/connectors/twilio/inbound-sms` |
| Vapi server webhook | `POST https://triven.ai/api/architect/connectors/vapi/webhook` | `/architect/connectors/vapi/webhook` |
| Google OAuth callback | `GET https://triven.ai/api/architect/connectors/gmail/callback` | `/architect/connectors/gmail/callback` |

**Reverse proxy (nginx, see `infra/coreai.conf`):** `location /api/ { proxy_pass http://127.0.0.1:8787/; }` — the trailing slash strips `/api` before the request reaches the backend, so internal routes stay unprefixed. Twilio **signature validation** reconstructs the public URL as `${BACKEND_URL}${route}` (helper `buildPublicWebhookUrl`, tolerant of proxies that don't strip the prefix). Verify locally:

```bash
npm run verify:webhook-url --workspace=@coreai/backend
```

- The backend **refuses to boot** with `NODE_ENV=production` if `BACKEND_URL`/`FRONTEND_URL` are not public https URLs (localhost / LAN IPs / tunnels are rejected) — `apps/backend/src/config/env.ts`.
- Tunnels (ngrok etc.) are dev-only and never belong in production env.

## 2. Required environment variables (production)

Boot-required: `DATABASE_URL`, `JWT_SECRET` (24+ chars), `ENCRYPTION_KEY` (24+ chars), `BACKEND_URL`, `FRONTEND_URL`.

| Group | Vars |
|---|---|
| Twilio auth | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` (Standard API Key — preferred REST auth), `TWILIO_AUTH_TOKEN` (**webhook signature validation only**), `TWILIO_VALIDATE_SIGNATURE=true`, `TWILIO_TEST_MODE=false` |
| Vapi | `VAPI_API_KEY`, `VAPI_DEFAULT_VOICE_PROVIDER=11labs`, `VAPI_DEFAULT_VOICE_ID` |
| ElevenLabs | `ELEVENLABS_API_KEY` (voice preview only) |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI=https://triven.ai/api/architect/connectors/gmail/callback` |
| Stripe (if billing) | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM_NAME` |
| Optional | `REDIS_URL` (not used by code yet), Firebase admin vars |

**Phone numbers are NOT env config.** `TWILIO_PHONE_NUMBER` is a legacy/dev fallback only — production numbers live in the `PlatformPhoneNumber` table (see `docs/platform-phone-numbers.md`). Production logic never requires an env phone number.

**Rotate before production:** every secret that ever lived in a dev `.env` (Twilio token, Vapi key, ElevenLabs key, Google secret, JWT_SECRET, ENCRYPTION_KEY, SMTP, Stripe). AppleDouble `._.env` artifacts were committed to git history early on — treat all dev secrets as exposed. The frontend env must only contain `NEXT_PUBLIC_*` values (a stray `STRIPE_SECRET_KEY` was removed from `apps/frontend/.env.local`).

### Firebase Admin (service account) — security rules

Firebase Admin is **backend-only and optional** — it verifies Google sign-in ID tokens on `POST /auth/firebase-login`; if `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` are unset (or left as placeholders), the backend boots normally and only that route errors.

- **Never commit a service-account JSON** — `.gitignore` blocks `service-account*.json`, `serviceAccount*.json`, `firebase-admin*.json`, `*-firebase-adminsdk-*.json`, and all `.env*` files.
- **Never put the private key in frontend env** — the frontend uses only public `NEXT_PUBLIC_FIREBASE_*` client config (`apps/frontend/src/lib/firebase.ts`).
- **Rotate any key that was ever pasted or shared** (incl. the `triven-ai-713a6` key generated during 2026-07-03 setup): Firebase console → Project settings → Service accounts → *Generate new private key*, then **delete the old key** in Google Cloud IAM → Service accounts → Keys.
- `FIREBASE_PRIVATE_KEY` must be quoted with `\n`-escaped newlines (the backend unescapes via `replace(/\\n/g, "\n")`). `FIREBASE_PROJECT_ID` is the project id (`triven-ai-713a6`), **not** the JSON's `private_key_id` hex string.
- The key is never logged; keep it that way.

## 3. Dashboard setup

Twilio: see `docs/production-twilio-setup.md`. Vapi: production API key; assistants are created per business at buyer deploy (architect publish never touches Vapi). Google Cloud: publish the OAuth consent screen (Testing mode expires refresh tokens after 7 days) and add the exact redirect URI `https://triven.ai/api/architect/connectors/gmail/callback`.

## 4. Database & migrations

- Migration history was squashed to a baseline on 2026-07-03: `20260703000000_init_production_baseline` (full schema incl. `PlatformPhoneNumber`, `BusinessPhoneNumber`, `InstalledAgent`, `Payment`, `TemplateRequest`, `ContactSubmission`), followed by `20260703084126_phone_number_inventory_metadata` (number inventory metadata + `BusinessPhoneNumber.provider/configJson`).
- **One-time note for pre-existing dev DBs:** databases created before the squash must be baselined once:
  ```bash
  npx prisma migrate resolve --applied 20260703000000_init_production_baseline
  ```
  A **fresh production DB needs nothing special** — just:
  ```bash
  npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
  ```
- Never use `prisma db push` in production. New changes: `prisma migrate dev --name <change>` locally → commit → `migrate deploy`.
- Production must never rely on manual SQL or repair scripts — buyer setup/deploy persists number assignment, mapping, and `configJson.vapiAssistantId` transactionally.

## 5. Dev/demo scripts (never in production)

```bash
npm run seed:platform-phone-numbers --workspace=@coreai/backend -- --number=+1... --sid=PN...  # safe, idempotent
npm run seed:platform-phone-numbers --workspace=@coreai/backend -- --release-demo             # dev only; REFUSES when NODE_ENV=production
npm run repair:phone-agent-links --workspace=@coreai/backend                                  # safe one-off repair
npm run verify:webhook-url --workspace=@coreai/backend                                        # webhook/signature URL self-check
```

## 6. Go-live verification

1. `npm run build:shared && npm run typecheck:backend && npm run typecheck:frontend`
2. Seed the production numbers (`docs/platform-phone-numbers.md`).
3. Buyer completes setup wizard → Deploy live agent → success requires `installedAgentId + assignedPhoneNumber + vapiAssistantId`.
4. Step 4 → **Test call routing** → all checks pass (includes public-HTTPS, exact webhook URL, signature validation, DB-managed numbers).
5. Webhook check:
   ```bash
   curl -i -X POST "https://triven.ai/api/architect/connectors/twilio/voice" \
     --data-urlencode "To=+17252202182" --data-urlencode "Called=+17252202182" \
     --data-urlencode "From=+919999999999" --data-urlencode "Caller=+919999999999" \
     --data-urlencode "CallSid=CAtest-production"
   ```
   - Deployed → `<Response><Connect><Stream url="wss://…vapi.ai…">`
   - Incomplete → HTTP 200 `<Response><Say>This AI agent is not deployed yet…</Say></Response>`
   - Never HTTP 404 / `<Reject/>` for setup errors (403 `<Reject/>` only on genuine signature failure).
   - Note: with `TWILIO_VALIDATE_SIGNATURE=true`, unsigned curl requests are rejected with 403 — that means validation is working; test with a real Twilio call.
6. Real call to the platform number; then carrier forwarding from the business's public number.

## 7. India note

Indian carriers generally don't forward reliably to US +1 numbers, and US→India SMS is subject to DLT rules. US Twilio numbers are for direct-dial demos; for Indian businesses provision Indian-reachable numbers (Exotel, Knowlarity, Airtel IQ, TeleCMI, or an Indian SIP trunk) and add them to `PlatformPhoneNumber` — the resolver keys off the called number, not the provider.
