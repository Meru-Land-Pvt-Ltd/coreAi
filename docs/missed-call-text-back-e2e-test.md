# Missed Call Text-Back — End-to-End Test Guide

This is the first revenue MVP agent: **AI Receptionist / Missed Call Text-Back**.
It uses Twilio (telephony + SMS), Vapi (AI voice), and Google Calendar (booking),
routed per-business by the inbound Twilio `To`/`Called` number.

Routing chain:

```
Twilio To number
  → BusinessPhoneNumber
  → Business
  → InstalledAgent
  → WorkflowDefinition (Missed Call Text-Back)
  → BusinessProfile + BusinessKnowledgeBase
```

All examples assume:

```bash
export BACKEND_URL="http://localhost:8787"
export FRONTEND_URL="http://localhost:3000"
```

---

## 1. Required environment variables (`apps/backend/.env`)

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

For a no-cost local run set `TWILIO_TEST_MODE=true` and leave `TWILIO_VALIDATE_SIGNATURE` unset.

---

## 2. Seed platform phone numbers

The buyer setup assigns a number from `PlatformPhoneNumber` (status `AVAILABLE`).

```bash
# Defaults: +15550100001..3
npm run seed:numbers --workspace=@coreai/backend

# Or your own (optionally "number|twilioSid"):
npm run seed:numbers --workspace=@coreai/backend -- "+13135551234" "+13135559876|PNxxxxxxxx"
```

Verify: `PlatformPhoneNumber` rows exist with `status = AVAILABLE`.

---

## 3. Setup wizard test (creates everything)

1. Start apps: `npm run dev`.
2. Log in as a **Business** user at `${FRONTEND_URL}/business/login` (OTP).
3. Go to `${FRONTEND_URL}/business/agents/setup` (or Marketplace → "Missed Call Text-Back" → Start free trial).
4. Fill business name/type, **forwarding phone**, services, FAQs, hours, booking URL, team phone, tone, escalation. Optionally **Connect Google Calendar** and set Vapi IDs.
5. Submit **Save & activate agent** → success screen shows the assigned CoreAI number.

Equivalent API call (replace `$TOKEN` with the business JWT from `localStorage["coreai-token"]`):

```bash
curl -sX POST "$BACKEND_URL/business/setup" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "businessName":"Bright Smile Dental","businessType":"Dental practice",
    "forwardToPhone":"+15551230000","teamPhone":"+15551239999",
    "bookingUrl":"https://calendly.com/bright-smile","timeZone":"America/New_York",
    "tone":"friendly","escalationRules":"Escalate emergencies to the on-call dentist.",
    "services":["Cleaning","Whitening","Emergency visit"],
    "faqs":[{"question":"Do you take walk-ins?","answer":"Yes, before noon."}],
    "hours":[{"day":"Monday","open":"09:00","close":"17:00","closed":false}],
    "knowledge":[{"title":"Parking","content":"Free lot behind the building."}]
  }'
```

**Verify in DB:**
- `Business` (ownerId = the buyer)
- `BusinessProfile` (services/faqsJson/hoursJson/tone/bookingUrl/...)
- `BusinessKnowledgeBase` rows
- `InstalledAgent` (status `ACTIVE`, linked workflow)
- `WorkflowDefinition` (Missed Call Text-Back: trigger → save_lead → ai → send_sms → save_conversation → output)
- `BusinessPhoneNumber` (phoneNumber = assigned number, forwardToPhone set)
- `PlatformPhoneNumber` (that number flipped to `status = ASSIGNED`, businessId set)

> Use the assigned number below as `<ASSIGNED_NUMBER>` (E.164, e.g. `+15550100001`).

---

## 4. Twilio voice webhook (incoming call → forward)

> **Use `--data-urlencode`** for any field containing `+` (phone numbers). With plain
> `-d`, curl form-encodes `+` as a space, so the number won't resolve to a business
> (you'll get `<Reject/>`). Real Twilio webhooks send these correctly.

```bash
curl -sX POST "$BACKEND_URL/architect/connectors/twilio/voice" \
  --data-urlencode "To=<ASSIGNED_NUMBER>" \
  --data-urlencode "From=+15557654321" \
  --data-urlencode "CallSid=CAtest1"
```

**Expected:** TwiML `<Response><Dial ... action=".../voice-action/<workflowId>?to=<ASSIGNED_NUMBER>"><Number>+1555...forward...</Number></Dial></Response>`.
(If the number doesn't resolve to a business → `<Reject/>`.)

---

## 5. Twilio missed-call dial result (no answer → text back)

Simulate the `<Dial>` callback with an unanswered status:

```bash
curl -sX POST "$BACKEND_URL/architect/connectors/twilio/voice-action" \
  --data-urlencode "To=<ASSIGNED_NUMBER>" \
  --data-urlencode "From=+15557654321" \
  --data-urlencode "DialCallStatus=no-answer"
```

**Expected:** empty `<Response></Response>`, and the workflow runs:
- `Lead` upserted (status `CAPTURED`, source `TWILIO_MISSED_CALL`)
- `Conversation` + `ConversationMessage` (SYSTEM "Missed call detected", OUTBOUND text-back)
- Twilio SMS sent (or accepted in test mode)
- Vapi outbound call started if Vapi is configured (`VapiCall` row)

If `DialCallStatus=completed`, nothing happens (call was answered).

---

## 6. Inbound SMS (reply / booking)

```bash
# General reply (context-aware)
curl -sX POST "$BACKEND_URL/architect/connectors/twilio/inbound-sms" \
  --data-urlencode "To=<ASSIGNED_NUMBER>" \
  --data-urlencode "From=+15557654321" \
  --data-urlencode "Body=What are your hours?"

# Booking by text (needs Google Calendar connected for the business owner)
curl -sX POST "$BACKEND_URL/architect/connectors/twilio/inbound-sms" \
  --data-urlencode "To=<ASSIGNED_NUMBER>" \
  --data-urlencode "From=+15557654321" \
  --data-urlencode "Body=Can I book tomorrow at 3pm?"
```

**Expected:** inbound + outbound `ConversationMessage` rows; for a parseable day+time, an `Appointment` row + Google Calendar event + confirmation SMS; `Lead` status `BOOKED`.

---

## 7. Vapi tool-call webhook (voice booking)

```bash
curl -sX POST "$BACKEND_URL/architect/connectors/vapi/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "type": "tool-calls",
      "call": { "id": "vapi-call-1", "customer": { "number": "+15557654321" } },
      "toolCallList": [
        { "id": "tc1", "name": "book_appointment",
          "parameters": { "service": "Cleaning", "customerName": "Jordan",
            "startAt": "2026-07-01T15:00:00.000Z", "endAt": "2026-07-01T15:30:00.000Z" } }
      ]
    },
    "metadata": { "businessId": "<BUSINESS_ID>" }
  }'
```

**Expected:** JSON `results[0].result` with `status:"booked"`; `Appointment` row + Google Calendar event + confirmation SMS; `VapiCall` row updated.

---

## 8. Database tables to verify (summary)

| Table | What to check |
|---|---|
| `PlatformPhoneNumber` | seeded `AVAILABLE`; becomes `ASSIGNED` after setup |
| `Business` / `BusinessProfile` | owned by buyer; profile fields saved |
| `BusinessKnowledgeBase` | knowledge rows saved |
| `InstalledAgent` / `WorkflowDefinition` | ACTIVE agent linked to MCTB workflow |
| `BusinessPhoneNumber` | assigned number mapped, forwardToPhone set |
| `Conversation` / `ConversationMessage` | system/inbound/outbound messages |
| `Lead` | CAPTURED → BOOKED / ESCALATED |
| `Appointment` | created on booking (SMS or Vapi) |
| `VapiCall` | created when a Vapi call starts / webhook fires |

---

## 9. Node execution reference

Launch-critical executable nodes (runner): `trigger.twilio_missed_call`,
`trigger.twilio_inbound_sms`, `trigger.vapi_tool_call`, `ai.context_reply`,
`action.send_sms`, `action.start_vapi_call`,
`action.google_calendar_create_appointment`, `action.save_lead`,
`action.save_conversation_message`, `action.human_handoff`,
`action.trigger_next_workflow`, `logic.condition`, `output.result`.

The single source of truth is `packages/shared/src/node-registry.ts` (imported by
both the builder and the runner). Nodes marked `comingSoon` appear in the builder
as disabled "Coming soon" chips and cannot be added to a workflow.

Workflow chaining (`Next Workflow`) forwards context (businessId, conversationId,
leadId, customerPhone/name, business context, latest message) and is bounded by
`MAX_WORKFLOW_CHAIN_DEPTH = 3` with loop detection.
