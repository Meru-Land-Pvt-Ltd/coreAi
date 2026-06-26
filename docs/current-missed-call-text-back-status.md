# Missed Call Text-Back — Current Status Checkpoint

First-revenue MVP agent: **AI Receptionist / Missed Call Text-Back** for service
businesses (launch vertical: dental practices).

Stack: Twilio (telephony + SMS) · Vapi (AI voice) · Google Calendar (booking),
routed **per business** by the inbound Twilio `To`/`Called` number.

Routing chain:

```
Twilio To number
  → BusinessPhoneNumber
  → Business
  → InstalledAgent
  → WorkflowDefinition (Missed Call Text-Back)
  → BusinessProfile + BusinessKnowledgeBase
```

> Companion runbook with full curl payloads: `docs/missed-call-text-back-e2e-test.md`.

---

## 1. What is working now

- **Phase 1 — Frontend:** typed-route casts fixed; build/typecheck clean.
- **Phase 2 — Backend flow:** Twilio voice webhook + missed-call dial result,
  inbound SMS, Vapi tool-call webhook, and Google Calendar booking implemented
  end to end, all resolving the business per inbound number.
- **Phase 3 — Buyer activation:**
  - Buyer setup wizard (`/business/agents/setup`) + `POST /business/setup` endpoint.
  - Platform phone-number pool (`PlatformPhoneNumber`) with assignment on setup.
  - Per-business Google Calendar connector (OAuth, encrypted tokens).
  - Marketplace CTA → "Missed Call Text-Back" → Start free trial.
- **Shared node registry** (`packages/shared/src/node-registry.ts`) — single source
  of truth imported by both builder and runner; launch-critical executable nodes live.
- **Next Workflow chaining** — context-forwarding, depth-bounded (`MAX_WORKFLOW_CHAIN_DEPTH = 3`)
  with loop detection.
- Businesses do **not** need their own Twilio keys (platform-provisioned numbers).

---

## 2. Exact tested flow (local, simulated provider boundary)

1. Seed platform numbers → `PlatformPhoneNumber` rows `AVAILABLE`.
2. Business logs in, runs setup wizard / `POST /business/setup` → Business,
   BusinessProfile, BusinessKnowledgeBase, InstalledAgent, WorkflowDefinition,
   BusinessPhoneNumber created; assigned number flips to `ASSIGNED`.
3. `POST /architect/connectors/twilio/voice` (incoming call) → TwiML `<Dial>` forward
   to the business phone (resolved by `To`).
4. `POST /architect/connectors/twilio/voice-action` with `DialCallStatus=no-answer`
   (missed call) → workflow runs: lead captured, conversation + text-back message,
   SMS sent, Vapi outbound call started (when configured).
5. `POST /architect/connectors/twilio/inbound-sms` with a booking intent
   ("Can I book tomorrow at 3pm?") → AI reply, appointment parsed, Google Calendar
   event created, confirmation SMS, lead → `BOOKED`.
6. `POST /architect/connectors/vapi/webhook` (`book_appointment` tool call) →
   appointment + calendar event + confirmation SMS; VapiCall updated.

---

## 3. DB rows created / mutated (proven)

| Table | Result |
|---|---|
| `PlatformPhoneNumber` | seeded `AVAILABLE` → `ASSIGNED` after setup |
| `Business` / `BusinessProfile` | owned by buyer; profile fields saved |
| `BusinessKnowledgeBase` | knowledge rows saved |
| `InstalledAgent` / `WorkflowDefinition` | ACTIVE agent linked to MCTB workflow |
| `BusinessPhoneNumber` | assigned number mapped, `forwardToPhone` set |
| `Conversation` / `ConversationMessage` | SYSTEM / INBOUND / OUTBOUND messages persisted |
| `Lead` | `CAPTURED` → `BOOKED` |
| `Appointment` | created on booking (SMS or Vapi path) |
| `VapiCall` | created when a Vapi call starts / webhook fires |

Local simulated run confirmed: inbound messages persisted, `VapiCall` row persisted,
`Appointment` row created, Google Calendar event created, confirmation SMS path
verified, `Lead` status became `BOOKED`.

---

## 4. Provider boundaries proven

Validated at the provider boundary using local simulated requests (no live carrier
traffic). Each external call is isolated behind a connector so it can be exercised
without the real provider:

- **Twilio voice webhook** → correct TwiML `<Dial>` / `<Reject>` returned.
- **Twilio missed-call dial result** (`DialCallStatus`) → text-back workflow triggered.
- **Twilio SMS send** → exercised via `TWILIO_TEST_MODE` (accepted, no real SMS billed).
- **Twilio inbound SMS** → context-aware AI reply + booking path.
- **Vapi tool-call webhook** → `book_appointment` returns `status:"booked"`.
- **Google Calendar** → event created via the per-business OAuth connector.

> Not yet proven against **live** Twilio/Vapi carriers end to end (see §9).

---

## 5. Required environment variables (`apps/backend/.env`)

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | ≥ 24 chars |
| `ENCRYPTION_KEY` | yes | ≥ 24 chars (encrypts Google tokens) |
| `BACKEND_URL` | yes | Public URL Twilio/Vapi post to (must match for signature checks) |
| `FRONTEND_URL` | yes | Used for OAuth redirects |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | yes (live) | Twilio credentials |
| `TWILIO_PHONE_NUMBER` **or** `TWILIO_MESSAGING_SERVICE_SID` | yes (live) | SMS sender fallback |
| `TWILIO_TEST_MODE` | optional | `true` uses Twilio magic test numbers (no real SMS) |
| `TWILIO_VALIDATE_SIGNATURE` | optional | `true` enforces `X-Twilio-Signature` (enable in prod) |
| `TWILIO_FORWARD_TO_PHONE` | optional | Global fallback forward number |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes (booking) | Google OAuth (Gmail + Calendar scope) |
| `GMAIL_OAUTH_REDIRECT_URI` | optional | Defaults to `${BACKEND_URL}/architect/connectors/gmail/callback` |
| `VAPI_API_KEY` | yes (voice) | Vapi API key |
| `VAPI_DEFAULT_ASSISTANT_ID` / `VAPI_DEFAULT_PHONE_NUMBER_ID` | optional | Per-business overrides win; env is the default |
| `GOOGLE_CALENDAR_DEFAULT_TIMEZONE` | optional | Defaults to `America/New_York` |

No-cost local run: set `TWILIO_TEST_MODE=true` and leave `TWILIO_VALIDATE_SIGNATURE` unset.

---

## 6. How to seed platform Twilio numbers

```bash
# Defaults: +15550100001..3 (status AVAILABLE)
npm run seed:numbers --workspace=@coreai/backend

# Or supply your own (optionally "number|twilioSid"):
npm run seed:numbers --workspace=@coreai/backend -- "+13135551234" "+13135559876|PNxxxxxxxx"
```

Idempotent upsert into `PlatformPhoneNumber` (`provider=TWILIO`, `status=AVAILABLE`).
Verify rows exist as `AVAILABLE` before running the setup wizard.

---

## 7. How to run local simulated curl tests

```bash
export BACKEND_URL="http://localhost:8787"
export FRONTEND_URL="http://localhost:3000"
```

1. `npm run dev` (backend + frontend), `TWILIO_TEST_MODE=true`.
2. Seed numbers (§6), then run the wizard / `POST /business/setup` to create a business
   and capture the assigned number as `<ASSIGNED_NUMBER>`.
3. Exercise the flow (use `--data-urlencode` for any field containing `+`):

```bash
# Incoming call → forward TwiML
curl -sX POST "$BACKEND_URL/architect/connectors/twilio/voice" \
  --data-urlencode "To=<ASSIGNED_NUMBER>" --data-urlencode "From=+15557654321" \
  --data-urlencode "CallSid=CAtest1"

# Missed call → text-back workflow
curl -sX POST "$BACKEND_URL/architect/connectors/twilio/voice-action" \
  --data-urlencode "To=<ASSIGNED_NUMBER>" --data-urlencode "From=+15557654321" \
  --data-urlencode "DialCallStatus=no-answer"

# Inbound SMS booking → appointment + calendar event + confirmation
curl -sX POST "$BACKEND_URL/architect/connectors/twilio/inbound-sms" \
  --data-urlencode "To=<ASSIGNED_NUMBER>" --data-urlencode "From=+15557654321" \
  --data-urlencode "Body=Can I book tomorrow at 3pm?"
```

Full payloads (Vapi tool-call, setup body, expected outputs): `docs/missed-call-text-back-e2e-test.md`.

---

## 8. How to run a live ngrok + Twilio test

1. Set live env: real `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`, `VAPI_API_KEY`,
   Google OAuth creds; unset `TWILIO_TEST_MODE`.
2. Start backend, then expose it:
   ```bash
   ngrok http 8787
   ```
3. Set `BACKEND_URL` to the public ngrok URL (must match exactly for signature checks),
   set `TWILIO_VALIDATE_SIGNATURE=true`, and restart the backend.
4. In the Twilio console, point the **platform number's** Voice webhook at
   `${BACKEND_URL}/architect/connectors/twilio/voice` and Messaging webhook at
   `${BACKEND_URL}/architect/connectors/twilio/inbound-sms` (POST).
5. Seed that real number into `PlatformPhoneNumber` (§6) and run setup so it maps to a business.
6. Call the number from a real phone, let it ring out (no answer), and confirm the
   text-back SMS arrives; reply to book and confirm the Google Calendar event +
   confirmation SMS.
7. Point the Vapi webhook at `${BACKEND_URL}/architect/connectors/vapi/webhook`.

---

## 9. What is still missing before paid launch

- **Live carrier E2E not yet run** — only simulated provider-boundary proven.
- **Billing / payments** — no charge, subscription, or trial-to-paid conversion wired.
- **Number provisioning automation** — numbers are seeded manually; no auto-purchase
  from Twilio or auto-configuration of webhooks per assigned number.
- **Signature enforcement in prod** — `TWILIO_VALIDATE_SIGNATURE` must be on and verified live.
- **AI reply quality / booking parser hardening** — natural-language date/time parsing
  needs real-world coverage (timezones, ambiguous phrasing, no-availability cases).
- **Observability** — delivery/failure tracking, retries, and alerting for SMS/voice/calendar errors.
- **Compliance** — A2P 10DLC registration, opt-out (STOP/HELP) handling, consent records.
- **Multi-number scale** — pool exhaustion handling and per-business number lifecycle (release/reassign).

---

## 10. Next recommended phase

**Phase 4 — Live pilot + monetization:**

1. Run one **live** Twilio + Vapi + Google Calendar pilot with a single real dental
   practice (manual number provisioning is acceptable for the pilot).
2. Turn on `TWILIO_VALIDATE_SIGNATURE` and verify signed webhooks end to end.
3. Wire **billing** (trial → paid) so the buyer loop closes on first revenue.
4. Add A2P 10DLC + STOP/HELP opt-out handling.
5. Add minimal observability (message/call/booking success + failure logging and alerts).

Defer automated number provisioning and pool-scale work until after the first paid pilot validates the loop.
