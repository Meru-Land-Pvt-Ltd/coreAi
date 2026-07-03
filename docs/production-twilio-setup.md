# Production Twilio Setup — Triven.ai

Last updated: 2026-07-03

## 1. Account

1. **Upgrade off the trial** — trial accounts only reach verified numbers and inject a trial message.
2. Create a **Standard API Key** (Console → Account → API keys & tokens → Create API key, type *Standard* — NOT the Main key):
   ```env
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_API_KEY_SID=SK...
   TWILIO_API_KEY_SECRET=...
   ```
   REST calls authenticate with the API key (`SK...:secret`); the account SID only namespaces the URL.
3. Keep `TWILIO_AUTH_TOKEN` set — it is required for **webhook signature validation** (`TWILIO_VALIDATE_SIGNATURE=true`), never used as primary REST auth.

## 2. Per-number webhooks

For **every** platform number (Phone Numbers → Manage → Active numbers → the number):

| Setting | Value |
|---|---|
| Voice → A call comes in | `POST https://triven.ai/api/architect/connectors/twilio/voice` |
| Messaging → A message comes in | `POST https://triven.ai/api/architect/connectors/twilio/inbound-sms` |

The exact URLs (built from your `BACKEND_URL`) are printed by:

```bash
npm run verify:webhook-url --workspace=@coreai/backend
```

and shown in the buyer's **Test call routing** panel (setup Step 4).

## 3. Signature validation behind the `/api` proxy

Twilio signs the **public** URL (`https://triven.ai/api/...`). nginx strips `/api` before the backend sees the request, so the backend reconstructs the signed URL from `BACKEND_URL` + route (`buildPublicWebhookUrl` in `twilio-business-routing.ts`); it also tolerates proxies that pass the prefix through (no `/api/api` doubling). Requirements:

- `BACKEND_URL=https://triven.ai/api` must match the URL configured in Twilio **exactly** (scheme, host, path).
- `TWILIO_VALIDATE_SIGNATURE=true` and `TWILIO_AUTH_TOKEN` set.
- With validation on, unsigned requests (e.g. curl) get `403 <Reject/>` — that is correct; setup errors from *signed* requests still return `200 <Say>`.

## 4. Number inventory

Numbers are **DB inventory**, not env config — see `docs/platform-phone-numbers.md`. Buying a new Twilio number: buy in the console, then seed it:

```bash
npm run seed:platform-phone-numbers --workspace=@coreai/backend -- \
  --provider=TWILIO \
  --number=+17252202182 \
  --sid=PN8b3aac460ad6aaa746ac30e34a298984 \
  --country=US --region=NV --locality="Las Vegas" \
  --voice=true --sms=false --mms=false
```

then set its two webhooks (section 2). The number appears in buyer setup Step 2 as AVAILABLE.

## 5. Geo / India

- Enable voice/SMS geo-permissions for the countries you serve (Messaging/Voice → Geo permissions).
- Indian carriers generally can't forward to +1 numbers and US→India SMS hits DLT rules — use Exotel / Knowlarity / Airtel IQ / TeleCMI numbers for Indian businesses and seed them into `PlatformPhoneNumber` the same way (the call resolver is provider-agnostic; it matches the called number).

## 6. Env checklist

```env
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_AUTH_TOKEN=...            # signature validation only
TWILIO_VALIDATE_SIGNATURE=true
TWILIO_TEST_MODE=false
# NO TWILIO_PHONE_NUMBER needed — numbers live in the PlatformPhoneNumber table.
```
