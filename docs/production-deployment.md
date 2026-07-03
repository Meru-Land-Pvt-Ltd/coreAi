# CoreAI / Triven.ai — Production Deployment Runbook

Last updated: 2026-07-03

## 1. Domains & URLs

| Env var | Production value (example) |
|---|---|
| `BACKEND_URL` | `https://api.triven.ai` |
| `FRONTEND_URL` | `https://triven.ai` |
| `NEXT_PUBLIC_API_URL` (frontend) | `https://api.triven.ai` |

- The backend **refuses to boot** with `NODE_ENV=production` if `BACKEND_URL`/`FRONTEND_URL` are not public https URLs (localhost / LAN IPs / ngrok are rejected) — see `apps/backend/src/config/env.ts`.
- ngrok (`https://omega-storm-coaster.ngrok-free.dev`) is **dev/testing only**. No source code references ngrok; it enters only via env.
- All webhook URLs are built from `BACKEND_URL`:
  - Twilio voice: `POST {BACKEND_URL}/architect/connectors/twilio/voice`
  - Twilio voice action: `POST {BACKEND_URL}/architect/connectors/twilio/voice-action`
  - Twilio inbound SMS: `POST {BACKEND_URL}/architect/connectors/twilio/inbound-sms`
  - Vapi server webhook: `POST {BACKEND_URL}/architect/connectors/vapi/webhook`
  - Google OAuth callback: `GET {BACKEND_URL}/architect/connectors/gmail/callback`

## 2. Required environment variables (production)

Required to boot: `DATABASE_URL`, `JWT_SECRET` (24+ chars), `ENCRYPTION_KEY` (24+ chars), `BACKEND_URL`, `FRONTEND_URL`.

Required for the AI Receptionist to work live:

| Group | Vars |
|---|---|
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (or per-business PlatformPhoneNumber rows), `TWILIO_VALIDATE_SIGNATURE=true`, `TWILIO_TEST_MODE=false` |
| Vapi | `VAPI_API_KEY`, `VAPI_DEFAULT_VOICE_PROVIDER=11labs`, `VAPI_DEFAULT_VOICE_ID` |
| ElevenLabs | `ELEVENLABS_API_KEY` (voice preview only; live calls go through Vapi) |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI=https://api.triven.ai/architect/connectors/gmail/callback` |
| Stripe (if billing on) | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM_NAME` |
| Optional | `REDIS_URL` (provisioned in docker-compose but **not used by code yet**), `VAPI_DEFAULT_ASSISTANT_ID`/`VAPI_DEFAULT_PHONE_NUMBER_ID` (legacy fallback), Firebase admin vars |

**Rotate before production:** every secret that ever lived in a dev `.env` — Twilio auth token, Vapi API key, ElevenLabs key, Google client secret, JWT_SECRET, ENCRYPTION_KEY, SMTP password, Stripe keys. AppleDouble `._.env` artifacts were committed to git history early on, and a `STRIPE_SECRET_KEY` sat in `apps/frontend/.env.local` — treat all dev secrets as exposed. Remove `STRIPE_SECRET_KEY` from the frontend env entirely (the frontend must only hold `NEXT_PUBLIC_*` values).

## 3. Dashboard setup

### Twilio
1. **Upgrade off the trial account** — trial accounts can only call/text verified numbers and inject the trial message; that blocks real customers.
2. For each platform number (e.g. `+18173985754`): Phone Numbers → Manage → Active Number →
   - Voice webhook: `POST https://api.triven.ai/architect/connectors/twilio/voice`
   - Messaging webhook: `POST https://api.triven.ai/architect/connectors/twilio/inbound-sms`
3. Geo permissions: enable SMS/voice to India (+91) if serving Indian customers.
4. Set `TWILIO_VALIDATE_SIGNATURE=true` once the webhook URL is final (signature is computed against `BACKEND_URL`).

### India phone-number reality check
- Indian carriers generally **do not reliably forward to US +1 numbers**, and outbound SMS from a US Twilio number to Indian mobiles is subject to DLT regulations.
- The US number `+18173985754` is fine for **direct-dial demos** only.
- For production Indian businesses, provision an Indian-reachable number via **Exotel, Knowlarity, Airtel IQ, TeleCMI, or an Indian SIP trunk** (Twilio has no Indian local numbers), then map it as a `PlatformPhoneNumber` row and point its voice webhook at the same CoreAI endpoint. The resolver keys off the `To`/`Called` number, so any provider that can POST Twilio-compatible webhooks (or a thin adapter) works.

### Vapi
- Use a production Vapi API key (`VAPI_API_KEY`).
- Assistants are created **per business at buyer deploy** (never at architect publish); the shared `VAPI_DEFAULT_ASSISTANT_ID` is only a legacy fallback and can be left unset in production.
- Voice: ElevenLabs (`11labs`) provider inside Vapi; set `VAPI_DEFAULT_VOICE_ID` as the fallback voice.

### Google Cloud (OAuth)
1. OAuth consent screen: publish to production (out of "Testing" mode, or refresh tokens expire every 7 days).
2. Authorized redirect URI (must match exactly): `https://api.triven.ai/architect/connectors/gmail/callback`
3. Scopes: Calendar + Gmail as currently requested by `gmail-connector.ts`.

## 4. Database & migrations

- Migration history was **squashed to a single baseline**: `prisma/migrations/20260703000000_init_production_baseline/` (the previous 4 folders described a dead schema, and the migration that created Business/PlatformPhoneNumber/BusinessPhoneNumber/InstalledAgent had never been committed).
- The dev database was baselined with `prisma migrate resolve --applied 20260703000000_init_production_baseline`.
- **Production deploy (fresh DB):**
  ```bash
  npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
  ```
- Never use `prisma db push` in production. New schema changes: `npx prisma migrate dev --name <change>` locally → commit the folder → `migrate deploy` in prod.

## 5. Dev/demo scripts (never in production)

```bash
npm run seed:platform-phone-numbers --workspace=@coreai/backend            # safe, idempotent
npm run seed:platform-phone-numbers --workspace=@coreai/backend -- --release-demo   # dev only; REFUSES to run when NODE_ENV=production
npm run repair:phone-agent-links --workspace=@coreai/backend               # safe one-off repair
```

Production must not depend on repair scripts — buyer setup/deploy persists number assignment, `BusinessPhoneNumber` linkage, and `configJson.vapiAssistantId` automatically.

## 6. Go-live verification

1. `npm run build:shared && npm run typecheck:backend && npm run typecheck:frontend`
2. Buyer completes the setup wizard → Deploy live agent → success screen requires `installedAgentId + assignedPhoneNumber + vapiAssistantId`.
3. Step 4 → **Test call routing** → all checks pass (includes "Backend URL is public HTTPS" + webhook URL).
4. Webhook check (replace `$BACKEND_URL`):
   ```bash
   curl -i -X POST "$BACKEND_URL/architect/connectors/twilio/voice" \
     --data-urlencode "To=+18173985754" --data-urlencode "Called=+18173985754" \
     --data-urlencode "From=+916396039675" --data-urlencode "Caller=+916396039675" \
     --data-urlencode "CallSid=CAtest-production-routing"
   ```
   - Deployed → `<Response><Connect><Stream url="wss://…vapi.ai…">`
   - Incomplete setup → HTTP 200 `<Response><Say>This AI agent is not deployed yet…</Say></Response>`
   - Never HTTP 404 / `<Reject/>` for setup errors (only a 403 `<Reject/>` on a genuine Twilio signature failure).
5. Real call: dial the CoreAI number directly; then test carrier forwarding from the business number.
