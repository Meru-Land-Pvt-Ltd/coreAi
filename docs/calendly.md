# Calendly Connector — Architecture & Guide

CoreAI integrates Calendly as a first-class connector for architect workflows and buyer-installed agents. Buyers connect their own Calendly account during setup; architects dry-test with theirs.

---

## 1. High-level architecture

```
┌─────────────┐     OAuth      ┌──────────────────┐
│  Calendly   │◄──────────────►│  CoreAI Backend  │
│  (API +     │   Webhooks     │  calendly-       │
│   Webhooks) │───────────────►│  connector +     │
└─────────────┘                │  webhook.ts      │
                               └────────┬─────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
            Architect dry-test   Workflow runner      Installed agents
            / Test panel         (actions + triggers) (mode: live)
                    │                   │                   │
                    └───────────────────┴───────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
            Architect UI                              Business setup
            (builder, pickers)                        (Connect + event type)
```

### Responsibilities

| Layer | Role |
|--------|------|
| **Calendly API** | OAuth tokens, event types, events, invitees, scheduling links, contacts (paid), etc. |
| **`calendly-connector.ts`** | OAuth, token refresh, webhook subscription, API wrappers, signature verify |
| **`webhook.ts`** | Ingest Calendly POSTs → match workflows / ACTIVE installed agents → `runWorkflowTest` |
| **`workflow-runner.ts`** | Execute `trigger.calendly` / `action.calendly` nodes |
| **Shared `node-registry`** | Canonical trigger events + action options |
| **Business setup** | OAuth connect + **default event type** on `InstalledAgent.configJson.calendly` |

### Ownership model

- **Architect:** connects Calendly for dry-test / builder pickers.
- **Business (buyer):** connects Calendly during agent setup. Live webhooks resolve credential by **organization URI** → owner → ACTIVE `InstalledAgent`s whose workflow matches the event.

---

## 2. Low-level architecture

### Key files

| Path | Purpose |
|------|---------|
| `apps/backend/src/modules/calendly/calendly-connector.ts` | OAuth, API, webhooks |
| `apps/backend/src/modules/calendly/webhook.ts` | Live + architect trigger dispatch |
| `apps/backend/src/modules/architect/workflow-runner.ts` | Node execution |
| `packages/shared/src/node-registry.ts` | `CALENDLY_*` types/options |
| `packages/shared/src/setup-field-rules.ts` | Setup visibility when nodes include Calendly |
| `apps/frontend/src/components/business/setup/calendly-setup-section.tsx` | Buyer Connect UI |
| `apps/frontend/src/components/architect/ui/workflow-builder/use-calendly-pickers.ts` | Architect builder pickers |

### Env vars

| Variable | Purpose |
|----------|---------|
| `CALENDLY_CLIENT_ID` | OAuth app client id |
| `CALENDLY_CLIENT_SECRET` | OAuth secret |
| `CALENDLY_OAUTH_REDIRECT_URI` | Must be `{BACKEND}/architect/connectors/calendly/callback` |
| `CALENDLY_WEBHOOK_URL` | Public URL for webhooks (default `{BACKEND}/webhook/calendly`) |
| `BACKEND_URL` / `FRONTEND_URL` | Base URLs for redirects |

### OAuth flow

1. UI calls `GET .../connectors/calendly/oauth-url`
2. User authorizes on Calendly
3. Callback exchanges code → stores encrypted credential (access/refresh, org URI, signing key)
4. Backend registers webhook subscription for:
   - `invitee.created`
   - `invitee.canceled`
   - (+ routing form where configured)

### Live webhook path

1. `POST /webhook/calendly`
2. Resolve org URI from payload → find credential
3. Verify `Calendly-Webhook-Signature` when signing key present
4. Map event → internal trigger slug (`meeting_booked`, etc.)
5. Match **architect** `WorkflowDefinition`s owned by credential user
6. Match **ACTIVE** `InstalledAgent`s for businesses owned by that user
7. Run workflow with seeded `calendly.invitee` / `calendly.event` (+ buyer `calendlyEventTypeUri` when saved)

### Node model (canonical)

Prefer **one trigger node** + **one action node**:

- Trigger: `trigger.calendly` with `data.calendlyEvent`
- Action: `action.calendly` with `data.connectorAction`

Legacy types (`trigger.calendly_meeting_booked`, etc.) still map via `CALENDLY_LEGACY_TRIGGER_TYPES`.

### Context / variables

Typical produced context:

- `calendly.invitee` — invitee payload
- `calendly.event` / scheduled event fields
- `calendlyEventTypeUri` — from buyer setup when live
- Test overrides: UUIDs, emails, times (Architect Test panel)

---

## 3. Triggers

Node: **`trigger.calendly`** · config: **`calendlyEvent`**

| Value | Label | Calendly webhook | Notes |
|-------|--------|------------------|--------|
| `meeting_booked` | Meeting booked | `invitee.created` | Default; not a reschedule |
| `meeting_cancelled` | Meeting cancelled | `invitee.canceled` | |
| `meeting_rescheduled` | Meeting rescheduled | `invitee.created` | Detected via `old_invitee` / `rescheduled` |
| `routing_form_submitted` | Routing form submitted | `routing_form_submission.created` | |

### How to use (Architect)

1. Add **Calendly Trigger**
2. Choose event in inspector
3. Connect Calendly in Integrations / Test panel
4. Dry-test with sample fields, or book a real event against a public webhook URL

### How to use (Buyer live)

1. Install agent that includes a Calendly trigger
2. Connect Calendly + pick default event type
3. Go live (ACTIVE)
4. Real Calendly events that match the trigger slug run the agent

---

## 4. Actions

Node: **`action.calendly`** · config: **`connectorAction`**

### Free / standard API

| Action | Label | Typical inputs |
|--------|--------|----------------|
| `find_available_times` | Find available times | Event type URI, start/end, timezone |
| `get_event` | Get event details | Event UUID |
| `list_events` | List events | Optional time window / status |
| `get_invitee` | Get invitee details | Event UUID + Invitee UUID |
| `list_invitees` | List invitees | Event UUID |
| `get_event_types` | Get event types | (from connected user/org) |
| `get_my_profile` | Get my profile | — |
| `create_scheduling_link` | Create scheduling link | Event type URI |
| `cancel_event` / `cancel_scheduled_event` | Cancel | Event UUID (+ reason) |
| `create_one_off_meeting_link` | One-off link | Duration / date window |
| `mark_invitee_no_show` | Mark no-show | Event + invitee UUIDs |
| `find_event` | Find event | Search / filters |
| `find_invitee_by_email` | Find invitee by email | Email |
| `find_user` | Find user | Search string |

### Paid Calendly plan

| Action | Note |
|--------|------|
| `book_meeting_for_invitee` | Scheduling API |
| `create_contact` / `update_contact` / `delete_contact` | Contacts |
| `find_contact` / `list_contacts` | Contacts |
| `find_meeting_recap` / `find_meeting_recap_transcript` | Notetaker |

Missing required fields in dry-test usually surface as **waiting / needs input** (not a hard crash) so the Test panel can collect UUIDs/emails.

---

## 5. Setup & configuration (main feature)

### When Calendly appears in buyer setup

`deriveSetupVisibility` turns on `calendly` when:

- workflow has Calendly trigger/action nodes, or
- listing `requiredConnectors` includes `calendly`

Then Connect shows the Calendly card; checklist requires connect **and** default event type.

### Buyer Connect step

UI: `CalendlySetupSection`

1. **Connect** → OAuth (`/business/connectors/calendly/oauth-url`)
2. **Default event type** (required `*`) → loads `/business/connectors/calendly/event-types`
3. Selection saved via `PUT /business/connectors/calendly/config` onto:

```json
InstalledAgent.configJson.calendly = {
  "eventTypeUri": "https://api.calendly.com/event_types/...",
  "eventTypeName": "30 Minute Meeting",
  "schedulingUrl": "https://calendly.com/..."
}
```

4. **Disconnect** → `DELETE /business/connectors/calendly`

### Readiness

Go-live / checklist treat Calendly as complete only when:

- `calendly.connected === true`, and
- `eventTypeUri` is non-empty

### Business APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/business/connectors/calendly/status` | Connected + email |
| GET | `/business/connectors/calendly/oauth-url` | Start OAuth |
| GET | `/business/connectors/calendly/event-types` | Picker options |
| PUT | `/business/connectors/calendly/config` | Save default event type |
| DELETE | `/business/connectors/calendly` | Disconnect |

### Architect APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/architect/connectors/calendly/status` | Status |
| GET | `/architect/connectors/calendly/oauth-url` | OAuth |
| GET | `/architect/connectors/calendly/callback` | OAuth callback |
| DELETE | `/architect/connectors/calendly` | Disconnect |
| GET | `/architect/connectors/calendly/event-types` | Pickers |
| GET | `/architect/connectors/calendly/available-times` | Availability |
| GET | `/architect/connectors/calendly/events` | List events |
| GET | `/architect/connectors/calendly/events/:eventUuid/invitees` | Invitees |

### Setup wizard behavior notes

- Calendly-only agents often **skip Configure** (no phone/voice/business-profile flags).
- Progress advances by **active steps** (Connect → Test → Go live), not blind `step + 1`.
- Test step can show a Calendly sample-run panel; Continue may deploy for Calendly-only flows.

---

## 6. End-to-end how to use

### Architect: build & dry-test

1. Create workflow: Calendly Trigger → (optional) Calendly Actions / other nodes
2. Connect Calendly as architect
3. Fill Test panel fields for the chosen action
4. Run dry test
5. Publish listing (requires Calendly connector when nodes need it)

### Business: install & go live

1. Install / start free trial from marketplace
2. Setup → **Connect Calendly** → pick **default event type**
3. Complete other required steps (if any)
4. Test → Go live
5. Book/cancel/reschedule on Calendly → webhook runs ACTIVE agent

### Live requirements

- Public `CALENDLY_WEBHOOK_URL` reachable by Calendly
- Correct OAuth redirect URI
- Buyer connected + event type saved
- Agent status **ACTIVE**
- Trigger `calendlyEvent` matches webhook mapping

---

## 7. Design principles

- **Buyer owns Calendly** at runtime (not a shared platform account).
- **One connector, many actions** via `connectorAction`.
- **Event type is buyer config**, injected into live runs.
- **Google Calendar ≠ Calendly** — separate connectors/flags.
- Seed marketplace Calendly templates were removed; build custom workflows with nodes.

---

## 8. Quick troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Webhook ignored `unknown_organization` | Org URI not on stored credential / wrong account |
| Signature 401 | Signing key mismatch / bad body |
| Agent never runs | Not ACTIVE, trigger mismatch, or no matching workflow |
| Actions “needs input” | Missing event/invitee UUID or email in test/live context |
| Empty event-type picker | Not connected, or Calendly user has no event types |
| Continue stuck on Connect | Skipped Configure step — navigation must use active steps |
