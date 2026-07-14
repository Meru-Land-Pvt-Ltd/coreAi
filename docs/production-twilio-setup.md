# Production Twilio Setup — Triven.ai

Last updated: 2026-07-14

## 0. SMS architecture (Phase 1)

- **One global Messaging Service** (`TWILIO_MESSAGING_SERVICE_SID`) sends **every** transactional SMS (appointment confirmations, missed-call text-backs, test SMS).
- **One shared Triven SMS sender** (`TWILIO_SHARED_SMS_NUMBER`, currently `+17252202182`) sits in that Messaging Service's sender pool. It is flagged `isPlatformSmsSender=true` in `PlatformPhoneNumber` and can **never** enter buyer inventory, be assigned to a business/installed agent, or be mapped to a Vapi assistant (guards at every assignment path; API code `PLATFORM_SMS_SENDER_NOT_ASSIGNABLE`).
- **Every buyer keeps a dedicated voice number** for inbound calls/Vapi routing. Buyer numbers are **not SMS senders** — the code never passes them as `From`; they appear only inside the SMS body ("For assistance call {businessPhone}").
- Capability vs role are separate fields: the shared sender is `smsEnabled=true` **and** `isPlatformSmsSender=true`; a buyer voice number may technically be SMS-capable (`smsEnabled=true`) but is still never used as the Phase 1 sender.
- Each outbound SMS creates an `SmsExecution` row; Twilio delivery-status callbacks (`POST https://triven.ai/api/architect/connectors/twilio/message-status`) update it.
- Shared-sender SMS is **one-way** in Phase 1: replies to the shared number cannot be routed by `To`, and **no business association is ever inferred** (no recency heuristics). STOP/START/HELP are handled by the Messaging Service (Advanced Opt-Out); any other reply is logged as an unmatched shared-sender inbound message (metadata only, never the content) and answered with empty TwiML — SMS copy must not promise the business received the reply ("For assistance call {businessPhone}"). Dedicated-number inbound SMS keeps its existing conversational flow.
- SMS recipients must be **explicit E.164** (`+1XXXXXXXXXX` for US). Bare ten-digit numbers are ambiguous between countries and are rejected, never guessed.
- **The A2P campaign must be approved before live US production sending.** Until then use `TWILIO_SMS_MODE=SIMULATED` (no Twilio request) or `TWILIO_SMS_MODE=TWILIO_TEST_CREDENTIALS` (Twilio test account + magic numbers).

Mark the shared sender after importing it (safe; refuses an assigned number):

```bash
npm run mark:sms-sender --workspace=@coreai/backend -- --number=+17252202182
```

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

Numbers are **DB inventory**, not env config — see `docs/platform-phone-numbers.md`. Buying a new **buyer voice** number: buy in the console (or the admin panel, which also configures webhooks), then seed it with its real capabilities:

```bash
npm run seed:platform-phone-numbers --workspace=@coreai/backend -- \
  --provider=TWILIO \
  --number=+1XXXXXXXXXX \
  --sid=PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --country=US \
  --voice=true --sms=true --mms=false
```

Set `--sms` to the number's ACTUAL Twilio capability — capability (`smsEnabled`) and role (`isPlatformSmsSender`) are separate fields, and an SMS-capable buyer number is still never used as a sender. Then set its two webhooks (section 2). The number appears in buyer setup Step 2 as AVAILABLE.

`+17252202182` is NOT buyer inventory — it is the reserved shared SMS sender (section 0). Admin "Sync Twilio numbers" auto-flags it from `TWILIO_SHARED_SMS_NUMBER`, and sync only reports a number's webhooks as CONFIGURED when **both** the voice and SMS webhook URLs match.

## 5. Geo / India

- Enable voice/SMS geo-permissions for the countries you serve (Messaging/Voice → Geo permissions).
- Indian carriers generally can't forward to +1 numbers and US→India SMS hits DLT rules — use Exotel / Knowlarity / Airtel IQ / TeleCMI numbers for Indian businesses and seed them into `PlatformPhoneNumber` the same way (the call resolver is provider-agnostic; it matches the called number).

## 6. Env checklist

```env
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_AUTH_TOKEN=...            # signature validation only

# Shared Triven SMS (section 0)
TWILIO_MESSAGING_SERVICE_SID=MG3159ba3a6f1e33f025f7e80186bf442f
TWILIO_SHARED_SMS_NUMBER=+17252202182
TWILIO_SMS_STATUS_CALLBACK_URL=https://triven.ai/api/architect/connectors/twilio/message-status
TWILIO_SMS_MODE=LIVE            # SIMULATED | TWILIO_TEST_CREDENTIALS | LIVE (must be LIVE in prod)

TWILIO_VALIDATE_SIGNATURE=true
TWILIO_TEST_MODE=false          # deprecated — true maps to TWILIO_SMS_MODE=SIMULATED
# NO TWILIO_PHONE_NUMBER needed — numbers live in the PlatformPhoneNumber table.
```

## 7. Messaging Service console checklist

In the Twilio Console (Messaging → Services → the Triven service):

1. The A2P 10DLC **campaign is approved** (Regulatory Compliance) — required before live US sending; `a2pStatus` in the admin panel stays `UNKNOWN`/`PENDING` until confirmed (the basic phone-numbers API does not report it).
2. The Messaging Service is **linked to the approved campaign**.
3. `+17252202182` is the **only** intended sender in the service's Sender Pool.
4. Integration → **Status callback URL** = `https://triven.ai/api/architect/connectors/twilio/message-status`.
5. Opt-Out Management → **Advanced Opt-Out enabled**; STOP, START and HELP configured.

## 8. Testing SMS

Three explicit modes via `TWILIO_SMS_MODE`:

| Mode | Twilio request? | Delivered? | Credentials |
|---|---|---|---|
| `SIMULATED` | no | no | none needed |
| `TWILIO_TEST_CREDENTIALS` | yes (test account) | no (magic From `+15005550006`) | `TWILIO_TEST_ACCOUNT_SID` / `TWILIO_TEST_AUTH_TOKEN` only — never production |
| `LIVE` | yes | yes | production credentials + `TWILIO_MESSAGING_SERVICE_SID` |

- Buyer UI: setup Step 4 → **Test SMS** (E.164 recipient required; shows Message SID, status, simulated/test-credentials flags, mode, shared sender).
- CLI (refuses to send without `--live`; requires explicit E.164 `--to`):

```bash
npm run test:twilio-sms --workspace=@coreai/backend -- --to="+1XXXXXXXXXX" --live
```

- A real Twilio failure is always reported as a failure — no mode converts errors into success. `TWILIO_TEST_MODE` is deprecated and maps to `SIMULATED`.
