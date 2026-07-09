# Triven Mail Setup — Amazon SES proxy email (reply.triven.ai)

Triven sends and receives buyer-branded transactional email through Amazon SES
on the dedicated subdomain **reply.triven.ai**. The root `triven.ai` mail
records are NOT touched.

- Proxy sender domain: `reply.triven.ai` (buyer aliases like `smile-dental@reply.triven.ai`)
- Custom MAIL FROM (bounce) domain: `bounce.reply.triven.ai`
- Inbound receiving domain: `reply.triven.ai`
- Outgoing display: `"<Business Name> via Triven" <alias@reply.triven.ai>` with `Reply-To` set to the same alias.
- Transactional only: call follow-ups, booking confirmations, lead notifications, call summaries, support replies. No marketing blasts.

## 1. Environment variables (`apps/backend/.env`)

```bash
SES_REGION=us-east-1                # any SES region that supports INBOUND receiving
SES_FROM_DOMAIN=reply.triven.ai
SES_MAIL_FROM_DOMAIN=bounce.reply.triven.ai
SES_INBOUND_BUCKET=triven-ses-inbound        # S3 bucket for raw inbound MIME (optional)
SES_INBOUND_TOPIC_ARN=arn:aws:sns:...        # SNS topic that posts to the backend webhooks
SES_CONFIGURATION_SET=triven-mail            # configuration set with the event destination
AWS_ACCESS_KEY_ID=...                        # IAM user restricted to ses:SendEmail on reply.triven.ai
AWS_SECRET_ACCESS_KEY=...
# SES_DRY_RUN=true                           # optional: log + store instead of calling SES
```

Behavior when unset: development stores + logs every send as a dry run
(`EmailMessage.metadata.dryRun = true`); production returns a clear
"Email is not configured (SES)" error. AWS secrets are never logged.

> Note: SES **inbound receiving** is only available in certain regions
> (us-east-1, us-west-2, eu-west-1, and a few others). Pick one of those.

## 2. SES console setup

1. **Verify the domain identity** `reply.triven.ai` in SES (Verified identities → Create identity → Domain). Do NOT verify root `triven.ai`.
2. Enable **Easy DKIM** (2048-bit) — SES shows 3 CNAME records.
3. Set the **custom MAIL FROM domain** to `bounce.reply.triven.ai` on the identity.
4. Create a **configuration set** (`SES_CONFIGURATION_SET`) with an SNS event destination for `Bounce` and `Complaint` events → topic posts to `POST {BACKEND_URL}/email/ses/bounce-complaint`.
5. **Inbound**: SES → Email receiving → create a **receipt rule set** (activate it) with a rule for domain `reply.triven.ai`:
   - Action 1 (optional but recommended): deliver raw message to S3 bucket `SES_INBOUND_BUCKET`.
   - Action 2: publish to the SNS topic `SES_INBOUND_TOPIC_ARN` → topic subscription posts to `POST {BACKEND_URL}/email/ses/inbound`.
   - The backend auto-confirms the SNS subscription (fetches `SubscribeURL`) and rejects notifications from other topics when `SES_INBOUND_TOPIC_ARN` is set.
6. Request **production access** (leave the SES sandbox) before real buyer traffic.

## 3. DNS records (add at your DNS provider for triven.ai)

| # | Type | Name | Value | Purpose |
|---|------|------|-------|---------|
| 1 | TXT | `reply.triven.ai` | (SES verification token, if using TXT verification) | Domain verification |
| 2 | CNAME ×3 | `<token1>._domainkey.reply.triven.ai` etc. | `<token>.dkim.amazonses.com` | DKIM signing (values from SES console) |
| 3 | MX | `bounce.reply.triven.ai` | `10 feedback-smtp.<region>.amazonses.com` | Custom MAIL FROM bounce handling |
| 4 | TXT | `bounce.reply.triven.ai` | `"v=spf1 include:amazonses.com ~all"` | SPF for the MAIL FROM domain |
| 5 | TXT | `_dmarc.reply.triven.ai` | `"v=DMARC1; p=quarantine; rua=mailto:dmarc@triven.ai; adkim=r; aspf=r"` | DMARC policy for the subdomain |
| 6 | MX | `reply.triven.ai` | `10 inbound-smtp.<region>.amazonaws.com` | SES inbound receiving |

Replace `<region>` with `SES_REGION` (e.g. `us-east-1`). Records 1–5 make
outbound mail deliverable (SPF+DKIM aligned → DMARC pass); record 6 routes
replies back into SES receiving. **No records on root `triven.ai` change.**

## 4. Backend endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /business/mail-setup` | buyer | Current alias + suggested localPart |
| `GET /business/mail-setup/check?localPart=` | buyer | Alias availability |
| `POST /business/mail-setup` | buyer | Create/update alias (localPart, displayName, forwardToEmail, replyHandlingMode) |
| `POST /business/mail-setup/test-email` | buyer | Send a test email from the alias |
| `GET /admin/email-aliases` | admin | List aliases |
| `POST /admin/email-aliases/:id/disable\|archive\|resend-test` | admin | Manage aliases |
| `POST /email/ses/inbound` | SNS (topic-checked) | Inbound email routing + forward |
| `POST /email/ses/bounce-complaint` | SNS (topic-checked) | Bounce/complaint → suppression |

## 5. Safety rules implemented

- Alias localPart: lowercase `a-z0-9.-`, ≤50 chars, globally unique, reserved names blocked (admin, support, abuse, postmaster, security, billing, sales, hello, noreply, no-reply, root).
- Every outbound/inbound message stored in `EmailMessage` (audit trail).
- Recipients that bounce or complain are suppressed from future sends.
- Per-business outbound rate limit (50/hour).
- Inbound HTML is sanitized (scripts/event handlers/javascript: URLs stripped); bodies capped at 100 KB; attachments are not processed.
- Unknown-alias inbound mail is stored unrouted (no business attached) for admin triage — one buyer can never receive another buyer's mail (unique alias lookup).
- Alias changes are logged (audit) and never rewrite old `EmailMessage` history.
