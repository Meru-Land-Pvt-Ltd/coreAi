# Architect Payouts — Architecture Decision & Flow

Last updated: 2026-07-18

## Charge model decision

**Triven uses Stripe "separate charges and transfers".** This was the existing
valid model and is preserved:

- Buyers pay the **platform** with a plain PaymentIntent (`/payments/purchase`,
  `chargeAgentOnce`). No `transfer_data`, `application_fee_amount`, or
  `on_behalf_of` is ever used, and no direct connected-account charges exist.
- The architect's share is later moved with `stripe.transfers.create` from the
  platform balance to the architect's **Express connected account**.
- The architect withdraws with `stripe.payouts.create` executed **on the
  connected account** (standard or Instant when eligible).

Do not mix models: never add `transfer_data` to buyer PaymentIntents, and never
create a second transfer for a purchase that already transferred its share.

## Money flow

```
Buyer PaymentIntent (platform)                    payments/routes.ts
  → payment_intent.succeeded / response path      purchase-finalize.ts (advisory-locked, idempotent)
  → ArchitectEarning row (immutable settlement)   payouts/settlements.ts   status: HELD
  → hold expires + admin approves the sale        payouts/settlements.ts   → AVAILABLE_FOR_TRANSFER
  → one transfer PER EARNING                      payouts/transfer-service.ts → TRANSFERRED
      idempotency: architect-transfer:{earningId}:{settlementVersion}
      transfer_group: marketplace-payment:{paymentId}
  → connected-account available balance           payouts/balance-service.ts (always fresh before mutation)
  → manual payout request (reservation + payouts.create on the connected account)
      idempotency: architect-payout:{architectId}:{clientRequestId}:{method}
  → payout.paid / payout.failed webhooks          payouts/connect-webhook.ts (authoritative final status)
```

Transfers happen at payout-request time by default. Set
`ARCHITECT_AUTO_TRANSFER_ENABLED=true` to let the hourly release worker
(`payouts/release-worker.ts`) transfer released earnings unattended.

## Commission (versioned)

`payouts/settlement-calculator.ts` — CALCULATION_VERSION 1:
- Architect share **70.00%** (7000 basis points), integer floor; platform keeps
  the exact remainder. Stripe processing fees are absorbed by the platform.
- The version is stored on every `ArchitectEarning`; changing the split later
  means shipping CALCULATION_VERSION 2 — historic rows are never recomputed.
- `PLATFORM_COMMISSION_PERCENT` in env is **dead configuration** (was never
  read); it is documented as deprecated in `.env.example`.

## State machines (payouts/state-machine.ts)

- Earnings: `PAYMENT_PENDING → PAYMENT_SUCCEEDED → HELD →
  AVAILABLE_FOR_TRANSFER → TRANSFER_PROCESSING → TRANSFERRED` with refund /
  dispute / reversal branches. Transitions are validated; illegal regressions
  are rejected and logged.
- Payouts: `RESERVED → PROCESSING → IN_TRANSIT → PAID` (+ FAILED / CANCELED /
  REVERSED; legacy `PENDING`/`COMPLETED` kept for historic rows). Terminal
  success is never overwritten by stale webhooks (event.created guard +
  transition table).

## Ledger invariants

- One `ArchitectEarning` per Payment (`paymentId` unique). Gross/commission are
  immutable after creation.
- All post-settlement money changes are **append-only** `ArchitectLedgerEntry`
  rows; the `(entryType, sourceId, earningId)` unique key makes duplicate
  webhook deliveries no-ops. Bounded adjustment columns
  (`refundCents`/`disputeCents`/`reversalCents`/`adjustmentCents`) roll up into
  `architectNetCents`.
- Refunds use Stripe's cumulative `amount_refunded`, so deliveries are
  idempotent and order-independent; reversal amounts can never exceed the
  transferred amount.

## Webhooks

- Platform endpoint `POST /business/billing/webhook` (secret:
  `STRIPE_WEBHOOK_SECRET`): purchases, refunds (`charge.refunded`), disputes
  (`charge.dispute.created/closed`), external `transfer.reversed`.
- Connect endpoint `POST /architect/payouts/stripe/webhook` (secret:
  `STRIPE_CONNECT_WEBHOOK_SECRET`): `account.updated`,
  `account.external_account.*`, `payout.*` (upserts automatic payouts by
  `stripePayoutId`, classifies MANUAL vs AUTOMATIC).
- Both verify signatures on the raw body and claim every event id in
  `StripeWebhookEvent` (exactly-once; FAILED events re-claimable on retry).

## Mode isolation

Every payout-domain row carries `livemode` (derived from the secret key
prefix). Mutations verify the stored mode matches the configured key; a
mismatch returns `STRIPE_MODE_MISMATCH` and requires an explicit repair — a
second account is never silently created.

## Sensitive data

Raw bank account / routing numbers are no longer accepted by the backend
(`PUT /architect/payouts/method` → 410 `PAYOUT_METHOD_DIRECT_ENTRY_DISABLED`).
Stripe collects external-account details via hosted onboarding
(`/connect/onboarding`) and the Express dashboard (`/connect/dashboard-link`).
Locally stored: last4, bank name, country, currency, verification state only.

## Operational commands

```
npm run backfill:architect-earnings -- --apply   # one-time historic settlement backfill
npm run reconcile:payouts -- --mode=report       # drift report (default)
npm run reconcile:payouts -- --mode=repair       # DB-only fixes; never creates Stripe money movement
```

## Known limitations

- Non-USD (e.g. IN/INR) connected accounts receive cross-currency transfers;
  manual payout requests for them sweep the full available balance in the
  account currency instead of an exact USD-entered amount.
- Display dashboards still derive "sales" lists from Payment rows; the ledger
  is authoritative for money movement, and `reconcile:payouts` reports drift.
- The in-process rate limiter and release worker assume the current
  single-process deployment.
