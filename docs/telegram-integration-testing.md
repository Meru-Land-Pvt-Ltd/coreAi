# Telegram Bot Integration: Setup and Test Guide

This guide covers the Architect nodes, per-business bot installation, live webhook processing, booking, isolation, deployment, and rollback.

## 1. Architecture

Each installation has its own row and credentials:

```text
Architect workflow
  -> InstalledAgent (Business A)
     -> TelegramBotConnection A
     -> BusinessService A
     -> TelegramConversationState A
     -> Google Calendar A
     -> Appointment A
  -> InstalledAgent (Business B)
     -> TelegramBotConnection B
     -> BusinessService B
     -> TelegramConversationState B
     -> Google Calendar B
     -> Appointment B
```

Runtime connection resolution always includes `businessId`, `installedAgentId`, and `telegramConnectionId`. Business bot tokens are AES-GCM encrypted in PostgreSQL. They are never stored in workflow JSON, returned by an API, or placed in a per-business environment variable.

## 2. Environment

Use Node 22 for development and tests. The current Vitest toolchain does not start on Node 20.11.

Required core values:

```dotenv
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6380
ENCRYPTION_KEY=at-least-24-random-characters
BACKEND_URL=https://your-public-domain.example/api
```

Optional managed-bot provisioning:

```dotenv
TELEGRAM_API_BASE_URL=https://api.telegram.org
TELEGRAM_MANAGER_BOT_TOKEN=123456789:AA...
TELEGRAM_MANAGER_BOT_USERNAME=your_manager_bot
TELEGRAM_MANAGER_WEBHOOK_SECRET=base64url-random-secret
```

Generate the manager webhook secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are not required. This integration uses the Telegram Bot API, including Bot Management Mode when available.

Production needs the API and Telegram worker. Without `REDIS_URL`, local development schedules processing in the API process after the webhook response.

Verify configuration without printing secrets:

```powershell
node -e "require('dotenv').config({path:'apps/backend/.env'}); for (const k of ['DATABASE_URL','REDIS_URL','ENCRYPTION_KEY','BACKEND_URL','TELEGRAM_MANAGER_BOT_TOKEN','TELEGRAM_MANAGER_BOT_USERNAME','TELEGRAM_MANAGER_WEBHOOK_SECRET']) console.log(k, process.env[k] ? 'SET' : 'MISSING')"
```

## 3. Local Start

Telegram cannot deliver a webhook to `localhost`. Architect dry runs work locally. For a live bot, use a public HTTPS `BACKEND_URL`.

```powershell
docker compose up -d postgres redis
npm run build:shared
npm run prisma:migrate:deploy
npm run prisma:generate
```

Start these in separate terminals:

```powershell
npm run dev:backend
npm run dev:frontend
npm run dev:telegram-worker
```

## 4. Manager Bot

1. Create the platform manager bot in BotFather.
2. Enable Bot Management Mode for that bot.
3. Put the manager token, username, and webhook secret in the backend environment.
4. Restart the backend. It verifies Bot Management Mode and registers the manager webhook automatically.
5. The authenticated Architect action `POST /architect/connectors/telegram/manager/setup` remains available as a manual retry.
6. Expect `canManageBots: true` and the manager webhook URL.
7. In Business Setup, select **Managed setup** and press **Approve in Telegram**.
8. Start the manager bot and use the **Create business bot** button.
9. Return to Business Setup and refresh status.

The platform prepares a collision-resistant username based on the business slug plus a stable installed-agent suffix. Telegram still requires the owner's approval.

If Bot Management Mode is unavailable, use the manual fallback.

## 5. Manual BotFather Fallback

1. The business owner opens BotFather.
2. Run `/newbot`.
3. Choose a display name and a globally unique username ending in `bot`.
4. Copy the token.
5. In Business Setup, open **BotFather token**.
6. Enter the display name and token, then press **Connect**.
7. Triven calls `getMe`, checks that the bot is not mapped to another installation, encrypts the token, applies the profile and command menu, installs the secret webhook, and verifies it with `getWebhookInfo`.
8. The token field is cleared and is never returned.

Use **Rotate token** after revoking or regenerating a token in BotFather.

## 6. Architect Example

Import the template:

**Telegram Appointment Booking Assistant**

The template contains:

- Telegram Bot Trigger
- Telegram Send Message
- Telegram Send Buttons
- Telegram Answer Callback
- Telegram Request Contact
- Telegram Send Photo
- Telegram Send Document
- Telegram Send Voice
- Telegram Send Location
- Telegram Edit Message
- Telegram Delete Message
- Calendar Availability
- Book Calendar Appointment
- Save Lead
- Optional Email Notification

Default customer commands:

```text
/start
/services
/book
/mybookings
/reschedule
/cancel
/help
```

The standard booking controller is enabled by `telegramBookingMode=true`. It persists state across webhook requests and does not depend on the LLM for commands or callback buttons. An AI Brain node can still handle unmatched natural-language questions.

## 7. Trigger Test

In Architect:

1. Add **Telegram Bot Trigger**.
2. Keep **Private chats only**, **Ignore bots**, and **Booking commands** enabled.
3. Select the event type to test.
4. Open **Test**.
5. Enter a trigger message and press **Run dry test**.

Expected:

```text
Telegram Bot Trigger - Telegram bot event received.
```

Expected variables include:

```text
{{trigger.telegram.updateId}}
{{trigger.telegram.eventType}}
{{trigger.telegram.chat.id}}
{{trigger.telegram.sender.id}}
{{trigger.telegram.sender.firstName}}
{{trigger.telegram.message.id}}
{{trigger.telegram.message.text}}
{{trigger.telegram.callback.id}}
{{trigger.telegram.callback.data}}
{{trigger.telegram.contact.phoneNumber}}
{{trigger.telegram.media.fileId}}
{{trigger.telegram.location.latitude}}
{{trigger.telegram.location.longitude}}
```

Trigger cases:

| Mode | Test input | Expected |
| --- | --- | --- |
| Message | `Hello` | `eventType=message` |
| Command | `/book` with command `book` | Match |
| Keyword | `I want an appointment`, keyword `appointment` | Match |
| Callback | Live inline button click | `eventType=callback_query` |
| Contact | Share contact | Contact phone normalized, ownership checked |
| Photo | Send a photo | Largest `file_id` selected |
| Document | Send a PDF | File ID, name, and MIME type exposed |
| Voice | Send a voice note | Voice file ID exposed |
| Location | Share location | Latitude and longitude exposed |

## 8. Telegram Action Node Tests

Architect dry run never calls Telegram. Every action returns representative output:

```json
{
  "success": true,
  "chatId": "architect-dry-run-chat",
  "messageId": "dry-run-node-id",
  "actionType": "telegram.send_message",
  "telegramConnectionId": "dry-run-telegram-connection",
  "dryRun": true
}
```

### Send Message

- Recipient: `Current Telegram trigger chat`
- Chat: `{{trigger.telegram.chat.id}}`
- Text: `Hello {{trigger.telegram.sender.firstName}}`
- Expected live result: one message and a `TelegramMessageExecution` with `SENT`.
- Failures: malformed chat ID, blocked user, inactive connection, invalid formatting.

### Send Buttons

```json
[
  [
    {"text":"View services","callbackData":"nav:services"},
    {"text":"Website","url":"https://example.com"}
  ]
]
```

- Callback data must be 1-64 UTF-8 bytes.
- Use stable IDs, not mutable display text.
- Multiple rows are supported.

### Answer Callback

- Callback ID: `{{trigger.telegram.callback.id}}`
- Response: `Selection received`
- Expected: Telegram stops the button loading indicator.

### Request Contact

- Private chat only.
- Expected: reply keyboard containing a contact-sharing button.
- Test both accepted contact and manual `+15551234567`.
- A contact with another Telegram user ID is rejected.

### Photo, Document, Voice

- Source: Telegram `file_id`, public HTTPS URL, or a `data:` URL from a previous uploaded-file variable.
- Optional caption.
- Maximum inline uploaded-file size: 20 MB.
- Expected: one media message and a returned message ID.

### Send Location

- Latitude: between `-90` and `90`.
- Longitude: between `-180` and `180`.
- Expected: one Telegram location message.

### Edit Message

- Chat ID plus a message ID from a previous action.
- Configure text, caption, or buttons.
- Expected: the original message changes; restrictions are reported as non-retryable.

### Delete Message

- Chat ID plus message ID.
- Expected: deletion when Telegram permissions and age restrictions allow.

## 9. Business Installation

1. Install **Telegram Appointment Booking Assistant**.
2. In **Connect**, select the business phone/routing required by the agent.
3. Connect Google Calendar.
4. Connect the dedicated Telegram bot using managed or manual setup.
5. Press **Authorize** under Owner notifications.
6. In the business bot, press **Start**. Return and refresh.
7. Press **Send live test** and verify the owner receives it.
8. In **Configure**, enter the business name, services, timezone, business hours, appointment schedule, and booking rules.
9. Continue to **Test** and run dry tests.
10. Go live. Deployment is blocked until Telegram and required calendar connections are healthy.

Existing service strings are synchronized into stable `BusinessService` rows for the installed agent. Callback data uses the stable service slug.

## 10. Webhook Test

After a live bot is connected:

1. Press **Check health**. Expect `HEALTHY`.
2. Open the bot and send `/start`.
3. Verify `TelegramBotConnection.lastWebhookAt` advances.
4. Verify one `TelegramProcessedUpdate` row with `status=PROCESSED`.
5. Replay the same `update_id` in an integration test.
6. Verify the unique `(telegramConnectionId, updateId)` constraint accepts it only once.
7. Verify action rows under `TelegramMessageExecution`.
8. Verify no token, webhook secret, message body, contact, or full chat ID appears in application logs.

Useful redacted database checks:

```sql
SELECT "status", "provisioningMode", "provisioningStatus", "webhookStatus",
       "ownerNotificationStatus", "lastWebhookAt", "lastSuccessfulSendAt", "lastError"
FROM "TelegramBotConnection"
ORDER BY "updatedAt" DESC;

SELECT "updateId", "status", "attempts", "errorCode", "processedAt"
FROM "TelegramProcessedUpdate"
ORDER BY "createdAt" DESC
LIMIT 20;

SELECT "nodeId", "actionType", "status", "attempts", "errorCode", "sentAt"
FROM "TelegramMessageExecution"
ORDER BY "createdAt" DESC
LIMIT 20;
```

## 11. Complete Booking Test

1. Open the installed business bot.
2. Send `/start`.
3. Click **View services**.
4. Start `/book` or click **Book appointment**.
5. Select a service.
6. Select an available date.
7. Select a time.
8. Enter the customer name.
9. Share contact or type an E.164 phone number.
10. Enter email and notes when the trigger requires them.
11. Review the summary.
12. Click **Confirm booking**.
13. Verify the callback is answered immediately.
14. Verify the selected slot is rechecked.
15. Verify one local `Appointment` with `source=TELEGRAM`.
16. Verify its Google `calendarEventId` is present.
17. Verify the customer confirmation.
18. Verify the owner notification.
19. Verify the lead is upserted rather than duplicated.
20. Click **Confirm booking** again.
21. Verify it is acknowledged as already processed and no second event, appointment, lead, or notification is created.

Disconnected-calendar behavior:

- No success message.
- No local booked appointment.
- A temporary-unavailable message is sent.
- The last integration error is visible in Business Setup.

## 12. My Bookings, Reschedule, Cancel

`/mybookings`:

- The bot requests a phone if it is not already in the scoped conversation state.
- Only future appointments matching the business, installed agent, and customer phone are shown.

`/reschedule`:

- Choose an existing scoped booking.
- Choose new availability.
- Confirm.
- The exact slot is rechecked, the Google event is patched, and the local appointment is updated.

`/cancel`:

- During an unfinished booking, it cancels the conversation.
- Otherwise it lists scoped bookings.
- Confirmation deletes the Google event and marks the local appointment cancelled.

## 13. Multi-Business Isolation

1. Install the same template for Business A and Business B.
2. Connect Bot A and Bot B using different Telegram bot tokens.
3. Configure different services, calendars, timezones, and owner chats.
4. Book a service through Bot A.
5. Verify only Business A services were displayed.
6. Verify only Calendar A received the event.
7. Verify only owner A received the notification.
8. Verify state, update, action, lead, conversation, and appointment rows all contain Business A and Agent A identifiers.
9. Repeat through Bot B.
10. Attempt to use connection A with Agent B in an integration test.
11. Expect connection resolution to fail before any Telegram or calendar action.
12. Send webhook A with webhook B's secret and expect HTTP 401.

## 14. Retry and Failure Tests

Retryable:

- HTTP 429 with `retry_after`
- HTTP 408/425
- HTTP 500/502/503/504
- timeouts and network errors

Expected: bounded retries, provider delay honored, attempts recorded, and a successful action not sent again for the same idempotency key.

Non-retryable:

- invalid token
- blocked recipient
- deactivated user
- malformed chat ID
- invalid callback data
- invalid media source
- insufficient permission
- invalid request

Expected: `FAILED`, a redacted error, no indefinite retry, and integration health visible to the buyer.

## 15. Production Deployment

```powershell
npm ci
npm run build:shared
npm run prisma:migrate:deploy
npm run prisma:generate
npm run build
docker compose up -d postgres redis backend telegram-worker frontend
```

Then:

1. Register the manager webhook when managed provisioning is enabled.
2. Check API and worker logs.
3. Connect a staging business bot.
4. Run the webhook, booking, duplicate-confirmation, owner-notification, and isolation tests.

## 16. Database Migrations

The integration uses three additive migrations:

- `20260729150000_add_telegram_bot_connections`: one encrypted bot connection per installed agent.
- `20260729173000_complete_telegram_runtime`: webhook IDs, persistent state, deduplication, action audit, services, and appointment linkage.
- `20260729190000_add_telegram_chat_delivery_status`: blocked, deactivated, and unreachable recipient status.

Apply them with:

```powershell
npm run prisma:migrate:deploy
npm run prisma:generate
```

## 17. Rollback

1. Disable new Telegram installations in the UI/deployment configuration.
2. Disconnect affected bots through Business Setup. This removes their webhooks without exposing tokens.
3. Stop `telegram-worker`; queued jobs remain in Redis.
4. Roll back application code.
5. Keep the additive database migration in place during normal rollback. Old code ignores the new tables and nullable appointment fields.
6. Drop new tables/columns only in a separately reviewed migration after backup and after confirming no Telegram data must be retained.

## 18. Telegram Limitations

- Bot Management Mode must be enabled for the platform manager bot; manual BotFather setup is the supported fallback.
- Telegram requires a public HTTPS webhook.
- Bots cannot initiate a private owner chat. The owner must open the business bot and press Start.
- Phase 1 accepts private chats. Group/channel/business-message modes are not enabled.
- Telegram controls bot usernames globally; a prefilled managed username can still require owner adjustment.
- Telegram enforces message-edit/delete age and permission limits.
- Bot API media limits and supported MIME types still apply.
- Optional SMS follows existing consent rules. Optional email uses the existing Triven proxy email configuration.
