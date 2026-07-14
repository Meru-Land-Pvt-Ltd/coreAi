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
MAIL_PROVIDER=ses                            # only "ses" is supported
SES_REGION=us-east-1                         # must be an SES region with INBOUND receiving
SES_FROM_DOMAIN=reply.triven.ai
SES_MAIL_FROM_DOMAIN=bounce.reply.triven.ai
SES_INBOUND_BUCKET=triven-ses-inbound-emails # private S3 bucket for raw inbound MIME
SES_INBOUND_TOPIC_ARN=arn:aws:sns:us-east-1:<account-id>:triven-ses-inbound
SES_EVENTS_TOPIC_ARN=arn:aws:sns:us-east-1:<account-id>:triven-ses-events
SES_CONFIGURATION_SET=triven-transactional   # configuration set with the event destination
AWS_ACCESS_KEY_ID=...                        # least-privilege IAM user (see §6)
AWS_SECRET_ACCESS_KEY=...
# SES_DRY_RUN=true                           # dev only: log + store instead of calling SES
# SES_SNS_VERIFY=false                       # dev only: accept unsigned SNS test payloads
```

Behavior when unset: development stores + logs every send as a dry run
(`EmailMessage.metadata.dryRun = true`); production returns a clear
"Email is not configured (SES)" error. AWS secrets are never logged.

**Production always enforces SNS signature verification and topic-ARN
allowlists** — `SES_SNS_VERIFY` and unset topic ARNs only relax checks outside
production.

> Note: SES **inbound receiving** is only available in certain regions
> (us-east-1, us-west-2, eu-west-1, and a few others). Pick one of those.

## 2. SES console setup

1. **Verify the domain identity** `reply.triven.ai` in SES (Verified identities → Create identity → Domain). Do NOT verify root `triven.ai`.
2. Enable **Easy DKIM** (2048-bit) — SES shows 3 CNAME records. Copy the exact
   values from the SES console (they are account-specific tokens; never reuse
   values from documentation).
3. Set the **custom MAIL FROM domain** to `bounce.reply.triven.ai` on the identity.
4. Create a **configuration set** named `triven-transactional` with an **SNS event
   destination** publishing `Send`, `Delivery`, `Bounce`, `Complaint`, `Reject`,
   and `Rendering Failure` to a standard SNS topic `triven-ses-events`.
   Subscribe `POST {BACKEND_URL}/email/ses/events` (HTTPS) to that topic.
5. **Inbound**: create a private S3 bucket `triven-ses-inbound-emails`
   (Block Public Access ON, SSE-S3 encryption) with a bucket policy allowing
   `ses.amazonaws.com` to `s3:PutObject` (condition `aws:Referer` = your account
   id). Then SES → Email receiving → create + activate a **receipt rule set**
   with a rule for domain `reply.triven.ai`:
   - Action 1: deliver raw message to the S3 bucket.
   - Action 2: publish to standard SNS topic `triven-ses-inbound` → subscribe
     `POST {BACKEND_URL}/email/ses/inbound` (HTTPS).
   - The backend verifies the SNS signature, checks the topic ARN, auto-confirms
     the subscription (AWS SNS URLs only), and fetches the raw MIME from S3 when
     it is not inlined (only from `SES_INBOUND_BUCKET`, capped at 2 MB).
6. Request **production access** (leave the SES sandbox) before real buyer traffic.

## 3. DNS records (Hostinger → triven.ai zone)

| # | Type | Name | Value | Purpose |
|---|------|------|-------|---------|
| 1 | CNAME ×3 | `<token1>._domainkey.reply` etc. | `<token1>.dkim.amazonses.com` | Easy DKIM (exact tokens from SES console) |
| 2 | MX | `reply` | `10 inbound-smtp.us-east-1.amazonaws.com` | SES inbound receiving |
| 3 | TXT | `reply` | `"v=spf1 include:amazonses.com ~all"` | SPF for the proxy domain |
| 4 | MX | `bounce.reply` | `10 feedback-smtp.us-east-1.amazonses.com` | Custom MAIL FROM bounce handling |
| 5 | TXT | `bounce.reply` | `"v=spf1 include:amazonses.com ~all"` | SPF for the MAIL FROM domain |
| 6 | TXT | `_dmarc.reply` | `"v=DMARC1; p=quarantine; rua=mailto:dmarc@triven.ai; adkim=r; aspf=r"` | DMARC policy for the subdomain |

Hostinger names are relative to `triven.ai` (enter `reply`, not
`reply.triven.ai`). **Do not touch the root `triven.ai` MX record.**

Verify propagation:

```bash
dig +short MX reply.triven.ai            # expect 10 inbound-smtp.us-east-1.amazonaws.com
dig +short MX bounce.reply.triven.ai     # expect 10 feedback-smtp.us-east-1.amazonses.com
dig +short TXT reply.triven.ai           # expect "v=spf1 include:amazonses.com ~all"
dig +short TXT bounce.reply.triven.ai    # expect "v=spf1 include:amazonses.com ~all"
dig +short TXT _dmarc.reply.triven.ai    # expect the DMARC policy
dig +short CNAME <token1>._domainkey.reply.triven.ai   # expect <token1>.dkim.amazonses.com
```

## 4. Backend endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /business/mail-setup` | buyer | Current alias + suggested localPart |
| `GET /business/mail-setup/check?localPart=` | buyer | Alias availability |
| `POST /business/mail-setup` | buyer | Create/update alias (localPart, displayName, forwardToEmail, replyHandlingMode, customerConfirmationEnabled, internalSummaryEnabled) |
| `POST /business/mail-setup/test-email` | buyer | Send a test email from the alias |
| `GET /admin/email-aliases` | admin | List aliases |
| `GET /admin/email-aliases/:id/activity` | admin | Delivery/bounce/complaint counts + last message |
| `POST /admin/email-aliases/:id/disable\|archive\|resend-test` | admin | Manage aliases |
| `GET /admin/email-suppressions` | admin | Suppressed recipients + reasons |
| `POST /admin/email-suppressions/:id/reactivate` | admin | Unblock a recipient (bounces only — complaints stay locked) |
| `POST /email/ses/inbound` | SNS (signature + topic verified) | Inbound email routing + forward |
| `POST /email/ses/events` | SNS (signature + topic verified) | **Preferred** configuration-set destination: Send/Delivery/Bounce/Complaint/Reject/RenderingFailure |
| `POST /email/ses/bounce-complaint` | SNS (signature + topic verified) | **Deprecated** — kept only for identity-level notification topics subscribed before the configuration set existed. Do not point new AWS config here; the same event arriving on both endpoints is deduped (`eventType + SES messageId`, 15-min window) and all writes are idempotent regardless. |

Status mapping: `QUEUED → SENT → DELIVERED` on success; `BOUNCED`, `COMPLAINED`,
`REJECTED`, `FAILED` on provider events; `SUPPRESSED` when a send was blocked by
the suppression list. `deliveredAt` / `bouncedAt` / `complainedAt` are stamped
from SES events.

## 5. Delivery queue (Redis / BullMQ)

Producers (Vapi webhook tool calls, call summaries) never call SES directly —
they enqueue jobs on the `email-notifications` BullMQ queue and return
immediately, so a booking always succeeds even when email is down. The
standalone `email-worker` docker service (same image as the backend,
`command: node dist/email-worker.js`) consumes the queue:

- 5 attempts with exponential backoff (30s base) for transient AWS/network
  failures (throttling, timeouts, 5xx, connection errors).
- Permanent failures (suppressed/invalid recipient, disabled toggles, missing
  alias/forward-to) complete WITHOUT retry.
- The BullMQ job id is the EmailMessage idempotency key, and
  `sendBusinessEmail` re-checks the unique key on every attempt (a FAILED row
  is reused for the retry), so duplicate jobs or restarts can never double-send.
- Graceful shutdown on SIGTERM (drains in-flight jobs; queued jobs persist in
  Redis appendonly storage) and a queue-depth health log every 60s.
- Without `REDIS_URL` (local dev) jobs dispatch inline — same code path, no queue.

## 6. Safety rules implemented

- Alias localPart: lowercase `a-z0-9.-`, ≤50 chars, globally unique (checked
  inside a transaction; the DB unique constraint is the final arbiter), reserved
  names blocked (admin, support, abuse, postmaster, security, billing, sales,
  hello, help, info, contact, mailer-daemon, noreply, no-reply, notifications,
  triven, root, system).
- Every outbound/inbound message stored in `EmailMessage` (audit trail).
- Outbound idempotency: `EmailMessage.idempotencyKey` is unique; live-call
  emails use `booking_confirmation:<callId>:<email>`,
  `internal_notification:<callId>:<date>:<time>`, and
  `call_summary:<callId>:business-email`, so Vapi webhook retries never send
  twice.
- Permanent bounces and complaints create `EmailSuppression` rows; suppressed
  recipients are blocked pre-send (attempt stored with status `SUPPRESSED`).
  Transient bounces do not suppress. Complaint suppressions cannot be
  reactivated from Admin.
- SNS webhooks verify the message signature (SigningCertURL restricted to
  `sns.<region>.amazonaws.com`, 15-minute timestamp window) and an exact
  topic-ARN allowlist; `SubscribeURL` is only fetched on AWS SNS hosts.
- Buyer toggles: `customerConfirmationEnabled` gates customer
  confirmations/follow-ups; `internalSummaryEnabled` gates team
  summary/lead emails.
- Per-business outbound rate limit (50/hour).
- Inbound HTML is sanitized (scripts/event handlers/javascript: URLs stripped);
  bodies capped at 100 KB; raw MIME fetched only from `SES_INBOUND_BUCKET`
  (2 MB cap); attachments are not processed.
- Unknown-alias inbound mail is stored unrouted (no business attached) for admin
  triage — one buyer can never receive another buyer's mail (unique alias
  lookup). Duplicate SNS deliveries of the same inbound message are ignored.
- Alias changes are logged (audit) and never rewrite old `EmailMessage` history.
- Emails never create or increment billable executions — billing stays keyed to
  the `VapiCall` (one call = one billable interaction).
