# Platform Phone Numbers — DB-Managed Inventory

Last updated: 2026-07-14

Phone numbers are **database inventory**, never env config. Production supports many numbers across many businesses.

## Data model

- **`PlatformPhoneNumber`** — the Triven-owned pool. One row per number: `phoneNumber` (E.164, unique), `provider` (TWILIO), `status` (AVAILABLE | ASSIGNED | DISABLED), `twilioSid`/`providerNumberId` (PN…), `country`/`region`/`locality`, `capabilities` (`{voice, sms, mms}`), `businessId` + `assignedAt` once assigned, and `isPlatformSmsSender` (role flag for the ONE reserved shared SMS sender).
- **`BusinessPhoneNumber`** — the live mapping used by call routing: `phoneNumber`, `provider`, `businessId`, `installedAgentId`, `forwardToPhone`, `isActive`, `configJson`.
- **`SmsExecution`** — one row per outbound SMS through the shared Messaging Service (Message SID, status, delivery timestamps, Twilio errors, segments, cost).

Rules enforced by the backend:

- A platform number belongs to **at most one business**.
- Buyers only ever see AVAILABLE numbers plus their own assigned number — never another business's.
- Assignment/deploy writes run in a **transaction** with a re-check, so two concurrent deploys can't grab the same number, and no half-assigned state is possible.
- "Assigned to you" in the UI is server-computed (`businessId === currentBusiness.id`), never inferred client-side.
- The shared SMS sender (`isPlatformSmsSender=true`, currently `+17252202182`) is **excluded from buyer inventory, auto-provisioning, and admin assignment** — every path returns `PLATFORM_SMS_SENDER_NOT_ASSIGNABLE`. Buyer numbers are **voice numbers**; all SMS leaves through the shared sender, and the buyer number only appears inside message bodies as the callback number.
- Buyer voice-number provisioning is **not blocked** on the buyer number's A2P status (buyer numbers don't send SMS); Phase 1 SMS compliance rides on the shared sender's approved campaign.

## Seed one number (buyer voice inventory)

Use the number's REAL Twilio capabilities — capability (`sms`) and role (`isPlatformSmsSender`) are separate; an SMS-capable buyer number is still never used as a sender:

```bash
npm run seed:platform-phone-numbers --workspace=@coreai/backend -- \
  --provider=TWILIO \
  --number=+1XXXXXXXXXX \
  --sid=PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --country=US \
  --voice=true --sms=true --mms=false
```

## Reserve the shared SMS sender

After the number exists in `PlatformPhoneNumber` (seed or admin sync):

```bash
npm run mark:sms-sender --workspace=@coreai/backend -- --number=+17252202182
```

Sets `isPlatformSmsSender=true, smsEnabled=true`; refuses a number that is currently assigned to a buyer. Admin "Sync Twilio numbers" also auto-flags the number configured in `TWILIO_SHARED_SMS_NUMBER`.

## Import many (CSV)

```bash
npm run seed:platform-phone-numbers --workspace=@coreai/backend -- --file=platform-numbers.csv
```

CSV header:

```csv
phoneNumber,provider,twilioSid,country,region,locality,voice,sms,mms,status
+1XXXXXXXXXX,TWILIO,PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx,US,NV,Las Vegas,true,true,false,AVAILABLE
```

Seeding is idempotent (upsert by `phoneNumber`). **Assigned numbers get metadata-only updates** — status/businessId/assignedAt are never touched, so a live business's number can't be released by a seed run. `--release-demo` is a dev-only escape hatch that refuses to run with `NODE_ENV=production`.

## Buyer flow

1. Setup Step 2 calls `GET /business/setup/phone-numbers` → AVAILABLE numbers + the buyer's own assigned number (with locality/capabilities shown on the card).
2. Buyer selects a number; **Deploy live agent** (`POST /business/setup` with `deploy: true`) atomically: assigns the `PlatformPhoneNumber` (ASSIGNED, businessId, assignedAt), upserts `BusinessPhoneNumber` (linked to the `InstalledAgent`, with `forwardToPhone`), builds the per-business Vapi assistant, and persists `configJson.vapiAssistantId`.
3. Deploy success requires `installedAgentId + assignedPhoneNumber + vapiAssistantId` — otherwise the UI shows *"Live voice assistant was not created. Check Vapi configuration."*
4. Step 4 → **Test call routing** (`POST /business/setup/test-call-routing` with `{ phoneNumber? , selectedPlatformPhoneNumberId? }`) runs the same resolver the live webhook uses and returns pass/fail checks including the exact Twilio webhook URL to paste.

## Call resolution (webhook)

`POST /architect/connectors/twilio/voice` resolves the agent from the `To`/`Called` number: `BusinessPhoneNumber` (active) → `PlatformPhoneNumber.businessId` → latest ACTIVE `InstalledAgent` fallback. Unresolvable/incomplete setups return HTTP 200 `<Say>` TwiML — never a 404 `<Reject/>`.

## Verify

```bash
curl -i -X POST "https://triven.ai/api/architect/connectors/twilio/voice" \
  --data-urlencode "To=+17252202182" --data-urlencode "Called=+17252202182" \
  --data-urlencode "From=+919999999999" --data-urlencode "Caller=+919999999999" \
  --data-urlencode "CallSid=CAtest-production"
```

Deployed → `<Response><Connect><Stream url="wss://…vapi.ai…">`; not deployed yet → `<Response><Say>This AI agent is not deployed yet.</Say></Response>` (also fine before the buyer deploys).
