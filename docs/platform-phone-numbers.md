# Platform Phone Numbers — DB-Managed Inventory

Last updated: 2026-07-03

Phone numbers are **database inventory**, never env config. Production supports many numbers across many businesses.

## Data model

- **`PlatformPhoneNumber`** — the CoreAI-owned pool. One row per number: `phoneNumber` (E.164, unique), `provider` (TWILIO), `status` (AVAILABLE | ASSIGNED | DISABLED), `twilioSid`/`providerNumberId` (PN…), `country`/`region`/`locality`, `capabilities` (`{voice, sms, mms}`), `businessId` + `assignedAt` once assigned.
- **`BusinessPhoneNumber`** — the live mapping used by call routing: `phoneNumber`, `provider`, `businessId`, `installedAgentId`, `forwardToPhone`, `isActive`, `configJson`.

Rules enforced by the backend:

- A platform number belongs to **at most one business**.
- Buyers only ever see AVAILABLE numbers plus their own assigned number — never another business's.
- Assignment/deploy writes run in a **transaction** with a re-check, so two concurrent deploys can't grab the same number, and no half-assigned state is possible.
- "Assigned to you" in the UI is server-computed (`businessId === currentBusiness.id`), never inferred client-side.

## Seed one number

```bash
npm run seed:platform-phone-numbers --workspace=@coreai/backend -- \
  --provider=TWILIO \
  --number=+17252202182 \
  --sid=PN8b3aac460ad6aaa746ac30e34a298984 \
  --country=US --region=NV --locality="Las Vegas" \
  --voice=true --sms=false --mms=false
```

## Import many (CSV)

```bash
npm run seed:platform-phone-numbers --workspace=@coreai/backend -- --file=platform-numbers.csv
```

CSV header:

```csv
phoneNumber,provider,twilioSid,country,region,locality,voice,sms,mms,status
+17252202182,TWILIO,PN8b3aac460ad6aaa746ac30e34a298984,US,NV,Las Vegas,true,false,false,AVAILABLE
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
