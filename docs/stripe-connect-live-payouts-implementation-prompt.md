# Stripe Connect Live Payouts — Implementation Prompt

Last reviewed: 18 July 2026

## Purpose

Use this document as the implementation brief for making architect payouts fully operational in live mode. This is a planning and delivery prompt, not application code.

The finished product must let an architect:

- complete the full Stripe identity and business verification flow;
- add and manage a payout bank account securely from the Triven website through Stripe-hosted or Stripe-embedded UI;
- see exactly why a payout account is pending, restricted, or disabled;
- receive automatic payouts according to a supported schedule;
- request a partial or full standard payout;
- request an Instant Payout only when Stripe reports that the account, country, currency, balance, and destination are eligible;
- follow payout progress through processing, paid, failed, canceled, and action-required states;
- correct verification or bank-account problems without support manually editing the database.

Do not mark this work complete merely because a bank account object exists in Stripe. A payout method is ready only when Stripe has completed all relevant onboarding requirements, the connected account can receive transfers, payouts are enabled, a valid external payout account exists, and the intended funds flow is supported for the platform and connected-account countries.

## Required product decision before development

Confirm all of the following with the live Stripe account owner and, where needed, Stripe Support:

1. The country of the Triven Stripe platform account.
2. Every country in which architects may be onboarded at launch.
3. Whether Triven is the merchant of record and is responsible for Stripe fees, refunds, disputes, and negative balances.
4. Whether Stripe has approved the platform for Connect, the intended charge type, cross-border transfers, and Instant Payouts.
5. Whether the existing Express Accounts v1 configuration should remain or Stripe has instructed the platform to use a newer connected-account configuration.
6. Whether architect earnings are transferred from customer payments using destination charges or separate charges and transfers.
7. Who pays standard-payout and Instant-Payout fees, and whether Triven adds its own Instant-Payout fee.
8. The supported settlement currency for each connected-account country.

This decision is a hard release gate. Do not infer country or product eligibility from test mode.

### India-specific release gate

The current application offers both `US` and `IN` accounts, but it must not assume they support the same flow.

- Stripe currently states that its services in India are invite-only and that separate charges and transfers or standalone transfers are not supported for India platforms in the general case. Manual payouts are limited to approved use cases.
- Stripe's published Instant Payout regions do not currently include India.
- Cross-border Connect availability depends on the platform country and Stripe approval. Cross-border Instant Payouts are not supported in Stripe's documented cross-border payout flow.

If the Triven platform account is based in India, pause the existing transfer-based release until Stripe confirms the exact supported architecture in writing. If the platform is US-based and intends to pay Indian architects, confirm approval for cross-border payouts, use the required recipient agreement/configuration, pay out in the supported local currency, and do not offer Instant Payouts to those Indian accounts.

## Current repository audit

The codebase already contains a useful partial implementation:

- Express connected-account creation and Account Links;
- a `transfers` capability request;
- local payout-method and payout records;
- signed Connect webhook handling for account and payout events;
- standard and instant payout request options;
- payout schedule preferences;
- idempotency keys on transfer and payout creation;
- a public Connect webhook route registered before architect authentication;
- bank detail masking and removal of legacy full account credentials after Stripe takes ownership.

Do not rebuild these pieces blindly. Preserve correct behavior, migrate data safely, and close the gaps below.

### Known gaps that must be fixed

1. The current custom bank form sends raw account and routing information through the application backend. Replace it with Stripe-hosted onboarding or Stripe embedded components so Stripe collects identity documents and payout details directly. The Triven database must retain only Stripe identifiers, safe display metadata, and status fields.
2. Adding a bank token does not satisfy identity, business, terms-of-service, tax, bank-ownership, or other KYC requirements. The UI currently calls such accounts unverified but does not provide the complete remediation flow.
3. Payout requests and transfers are hard-coded to USD even though an India payout method is stored as INR. Currency must be derived from the connected account and eligible Stripe balance; never silently convert or mix cents and paise.
4. The saved weekly, bi-weekly, or monthly schedule currently calculates a display date only. No durable scheduled job actually creates payouts.
5. Transfer and payout retries currently occur as a side effect of loading summary or transaction pages. Financial operations must run in a durable queue or scheduled worker, independent of user page visits.
6. A platform transfer is created without linking it to the originating Stripe charge. Define the actual marketplace funds flow. Where supported and appropriate, associate transfers with source transactions or wait for funds to become available. Do not rely on an unrelated platform balance.
7. The application computes available earnings from internal approved sales but does not reconcile that amount with the Stripe platform balance, connected-account balance, refunds, disputes, reversals, fees, reserves, or currency.
8. Failed transfers are not automatically retried by Stripe. The platform needs its own explicit, idempotent retry and operator-remediation process.
9. A payout that fails disables the affected external account. The product must surface that state and send the architect back through Stripe account management before any retry.
10. Verification readiness is currently simplified to `payouts_enabled`, active transfers, a bank object, and no `currently_due` requirements. Persist and display the relevant requirement lists, disabled reason, capability state, bank status, and deadlines without exposing sensitive data.
11. The current primary/backup bank flow is application-managed. Move bank management to Stripe unless Stripe confirms that the platform is permitted and expected to manage external accounts for this account configuration.
12. There is no durable ledger linking each architect earning to the Stripe charge, transfer, transfer reversal, payout, refund, dispute, fee, and currency movement that affected it.
13. Production validation warns about ordinary Stripe keys but does not fail closed when Connect configuration or its webhook signing secret is missing.

## Target Stripe user experience

### 1. Start payout setup

On the architect Payouts page, show one primary action: **Set up payouts with Stripe**.

Before starting, collect only non-sensitive information useful for prefilling, such as account country, legal entity type, display name, and email. Explain that Stripe will verify identity and collect bank information.

Create exactly one connected account per architect per live environment. Store its Stripe account ID immediately and idempotently. Never create a second account because a user refreshes, revisits, or abandons onboarding. Changing country after account creation requires an explicit support/migration flow because a connected account's country cannot be treated as a casual editable preference.

### 2. Complete onboarding inside the website

Preferred experience: use Stripe's embedded Account Onboarding component so the architect remains on Triven while Stripe securely collects legal identity, business details, terms acceptance, documents, tax information, and the external payout account.

Also provide Stripe's Account Management or Notification Banner component for future requirements and remediation. Account management must let architects update payout bank accounts through Stripe without exposing full bank details to Triven.

If embedded components are not approved for the selected Connect configuration, use Stripe-hosted onboarding with fresh, single-use Account Links. Implement both return and refresh behavior correctly:

- returning to Triven means the hosted flow was exited, not that verification succeeded;
- after every return, retrieve the account server-side and render its real status;
- an expired or reused link must be regenerated server-side and redirect back into onboarding;
- live return and refresh URLs must use HTTPS;
- never email, log, or persist an Account Link URL.

### 3. Status and remediation

Display a clear state machine rather than a single `verified` boolean:

- Not started
- Onboarding in progress
- Submitted; verification pending
- More information required
- Restricted soon
- Payouts disabled
- Ready for standard payouts
- Ready for standard and Instant Payouts
- Bank account failed or disabled
- Account rejected or closed

For action-required states, show a **Continue with Stripe** or **Fix with Stripe** action. Display safe explanations derived from Stripe requirements and disabled reasons. Never show raw identity data, document contents, full bank numbers, or unrestricted Stripe error objects.

Do not treat `details_submitted` or a successful return redirect as readiness. Use Stripe's current account and balance state. At minimum consider requested capability status, `payouts_enabled`, relevant requirements and deadlines, disabled reason, external-account status, supported currency, and the Stripe balance available for the chosen payout method.

### 4. Payout method management

Within Triven, show bank name when Stripe provides it, account or debit-card last four digits, currency, country, standard-payout readiness, Instant-Payout eligibility, and whether action is required.

All add, replace, remove, and verification actions must happen in Stripe UI. Triven must not render a normal HTML form for full account numbers, routing numbers, IFSC values, debit-card numbers, identity numbers, or verification documents.

Do not label an external account `verified` merely because Stripe accepted its token. Use Stripe's account and external-account status. A failed payout may disable the destination; require remediation before another payout.

### 5. Standard payout

Allow the architect to choose the amount, up to the truly available amount, or select **Withdraw full available balance**.

Before submission, show:

- gross eligible earnings;
- refunds, disputes, reserves, reversals, and other holds;
- Triven's platform fee already deducted from earnings;
- Stripe payout fee if known;
- payout currency;
- destination last four digits;
- estimated arrival supplied by Stripe where available;
- final amount expected to be sent.

Require a server-side recheck on submission. Use an idempotency key tied to a persistent payout request. Repeated clicks, timeouts, retries, and webhook duplication must never create a second transfer or payout.

### 6. Instant Payout

Instant Payout is an optional capability, not a universal delivery speed.

Only display it when Stripe reports an eligible external destination and eligible instant balance for the connected account's country and currency. Recheck eligibility and amount immediately before creation. Do not hard-code the country list as the only eligibility check; Stripe makes account-level decisions and availability can change.

Show the Stripe fee, any platform fee, net amount, eligible destination, and expected arrival before confirmation. If Triven monetizes Instant Payouts, configure the product in the Stripe Dashboard and clearly disclose the fee.

If the account is ineligible, show standard payout without presenting Instant Payout as a failed option. For India and cross-border recipient accounts, keep Instant Payout hidden unless Stripe explicitly returns eligibility for an approved supported flow.

### 7. Automatic payouts

Choose one source of truth:

- Prefer Stripe-managed automatic payout schedules when the connected-account configuration and desired schedule are supported.
- If Triven requires a schedule Stripe does not provide, such as true bi-weekly cadence, set the account to a compatible manual payout mode only if Stripe permits it and run a Triven-controlled durable scheduler.

Do not maintain a cosmetic schedule in Triven that differs from Stripe's actual payout schedule.

For a Triven-controlled scheduler:

- run independently of API traffic;
- use a database-backed job or established queue;
- lock per architect and payout period;
- enforce the user's threshold;
- use deterministic idempotency keys;
- recheck account readiness, currency, internal ledger balance, Stripe balance, minimums, and pending operations;
- store each attempt and outcome;
- retry only retryable failures with bounded exponential backoff;
- route permanent failures to operator review and notify the architect;
- account for weekends, holidays, time zones, and Stripe's arrival estimate;
- expose pause/resume and an auditable admin override.

## Funds-flow and ledger requirements

Do not create live payouts until the payment-to-earnings funds flow is documented and implemented end to end.

For every marketplace sale, maintain an immutable ledger that records:

- the internal sale and architect earning allocation;
- the Stripe PaymentIntent and Charge IDs;
- gross amount and currency;
- Stripe processing fee and Triven share;
- amount allocated to the architect;
- transfer ID and transfer state;
- transfer reversal IDs and amounts;
- refund and dispute IDs and amounts;
- amount pending, available, reserved, paid, or owed;
- payout request and Stripe payout IDs;
- all timestamps and idempotency keys.

Internal UI balances must come from this ledger and be reconciled against Stripe. Do not define funds as withdrawable solely because an internal admin marked a sale approved. Funds must also be settled, not already committed, not reversed, in the correct currency, and available in the relevant Stripe balance.

Select the Stripe charge type based on the platform's merchant-of-record, liability, geography, and product requirements. For separate charges and transfers, Stripe makes the platform responsible for fees, refunds, disputes, and negative balance exposure. Automatic platform payouts can interfere with transfers that are not linked to a source transaction, so maintain a sufficient platform reserve and use the supported association strategy.

Refund and dispute policy must be explicit. When a previously paid architect earning is reversed, define whether Triven reverses an unsettled transfer, debits future earnings, creates a negative architect balance, or absorbs the loss. Never silently allow the same refunded earning to be withdrawn again.

## Backend responsibilities

Implement bounded services with clear ownership for:

- connected-account creation and lookup;
- Account Session or Account Link creation;
- Stripe account and requirements synchronization;
- Stripe balance retrieval and currency validation;
- platform transfer creation;
- connected-account payout creation where the selected schedule requires it;
- automatic payout scheduling;
- webhook ingestion and asynchronous processing;
- ledger posting and reconciliation;
- notifications;
- admin remediation and audit logs.

Financial writes must be transactional where possible. Where a Stripe API call and a database transaction cannot be atomic, persist an operation record first, make the Stripe call with a stable idempotency key, and reconcile the result. Never infer failure solely from a client timeout.

Do not perform Stripe writes during GET requests or page rendering. Read endpoints may request safe synchronization, but transfer and payout creation belongs in explicit commands or workers.

Use integer minor units with an explicit ISO currency on every amount. Never assume every currency uses two decimal places. Reject currency mismatches rather than converting implicitly.

## Webhooks

Create a dedicated live Connect event destination for connected-account events and use its live signing secret. Continue verifying the signature against the exact raw request body.

At minimum handle and persist relevant changes from:

- connected-account updates and requirement changes;
- external payout-account creation, update, and deletion;
- transfer creation, update, failure, and reversal events relevant to the chosen flow;
- payout creation, update, paid, failed, and canceled events;
- refunds, disputes, and charge state changes that alter architect earnings;
- capability changes and account deauthorization or closure where applicable.

Treat webhook delivery as at-least-once and out of order:

- store Stripe event ID with a unique constraint before processing;
- acknowledge duplicates safely;
- do not let an older event overwrite newer Stripe state;
- return success quickly and process durable work asynchronously;
- retry processing failures without asking Stripe to redeliver forever;
- provide an operator replay tool;
- periodically reconcile open transfers and payouts with Stripe in case a webhook is missed.

On `payout.failed`, store the failure code and safe message, mark the external account as requiring action, stop automatic payout attempts to it, notify the architect, and provide the Stripe remediation UI. Do not automatically create a new payout until the destination is restored and the original payout's final state is known.

## Data model changes

Replace free-form string statuses with enums or a normalized state model. Preserve Stripe as the source of truth while storing enough state to render quickly and audit changes.

Add or confirm storage for:

- connected account ID, livemode, country, default currency, configuration/type, and capability states;
- payouts enabled, details submitted, disabled reason, requirements due, pending verification, past due, errors, and deadlines;
- external account ID, type, bank/card brand or bank name, last four, currency, country, default flag, and payout methods available;
- immutable earning ledger entries;
- transfer and transfer-reversal records;
- payout request, payout attempt, delivery method, amount, fee, currency, destination, arrival estimate, failure details, and final status;
- Stripe event inbox with event ID, account context, creation time, processing state, and error;
- scheduled job state and deterministic period key;
- admin actions and actor identity.

Never store full bank or card numbers, identity document images, verification tokens, Account Link URLs, client secrets, secret keys, or raw unredacted Stripe objects.

## Security and production configuration

- Use live secret keys only on the backend and a live publishable key only where Stripe's frontend SDK requires it.
- Remove any secret key from frontend environment files. A `STRIPE_SECRET_KEY` must never be available to Next.js browser code.
- Rotate every Stripe secret that has existed in a developer file or repository history before launch.
- Use separate webhook signing secrets for the platform payment webhook and Connect webhook.
- Make production startup fail closed if Connect is enabled but required live keys, public HTTPS URLs, or webhook secrets are absent or test-mode values are present.
- Authorize every Account Session, Account Link, payout request, and status lookup against the authenticated architect and their stored connected-account ID.
- Add rate limits and replay protection to payout requests.
- Require recent authentication or step-up authentication before changing payout destinations or requesting a large/instant payout.
- Notify the architect when payout details change and consider a risk-based cooling-off period before the first payout to a new destination.
- Redact Stripe errors and identifiers in client responses and logs where disclosure is unnecessary.
- Put all rollout behavior behind feature flags separated by country, standard payout, automatic payout, and Instant Payout.

## Live Stripe Dashboard checklist

Complete and record evidence for each item:

- Activate the Stripe account and complete the platform business profile.
- Enable and configure Connect for the approved countries and account configuration.
- Accept the applicable Connect and platform agreements.
- Configure platform branding, support contact, terms URL, and privacy URL.
- Confirm the approved charge type and responsibility for fees and negative balances.
- Confirm cross-border payout approval if platform and architect countries differ.
- Configure platform controls and payout schedules if required.
- Enable Instant Payouts and its monetization settings only for approved regions and accounts.
- Create the live Connect event destination for the production HTTPS webhook URL.
- Subscribe to account, external-account, capability, transfer, payout, refund, dispute, and relevant charge events.
- Store the live signing secret in the production secret manager.
- Configure Stripe email/notification behavior for compliance and risk actions.
- Confirm statement descriptors, support details, refund policy, dispute process, reserves, and negative balance handling.
- Confirm tax reporting responsibilities with qualified legal and tax advisers.
- Set monitoring and alerting for webhook failures, payout failures, negative balances, reconciliation differences, and stuck operations.

## Test plan

Use Stripe Sandboxes or test mode first, then conduct a controlled live pilot with real low-value payments and payouts. Test mode can be more permissive than live mode, so test success is not proof of production eligibility.

Cover at least:

1. New architect completes onboarding successfully.
2. Architect abandons and resumes onboarding.
3. Account Link expires or is reused.
4. Identity verification is pending, fails, and requests a document.
5. Bank ownership verification is required.
6. Bank account is replaced.
7. Connected account gains and loses payout capability.
8. Standard payout succeeds.
9. Standard payout fails for no account, closed account, insufficient funds, unauthorized debit, and invalid currency.
10. Instant destination is eligible and payout succeeds.
11. Instant destination is ineligible and the UI falls back to standard payout.
12. Instant payout fails.
13. Partial withdrawal and full withdrawal.
14. Duplicate submission, network timeout, worker retry, and duplicate/out-of-order webhooks produce one financial movement.
15. Transfer waits for funds to become available.
16. Platform balance is insufficient.
17. Refund before transfer, after transfer, and after payout.
18. Dispute before and after payout.
19. Automatic schedule across time zones, weekends, month end, and threshold boundaries.
20. USD and INR are never mixed; unsupported currencies fail safely.
21. Cross-border and India flags hide unsupported functionality.
22. Reconciliation detects a missing webhook and repairs local state without duplicating money movement.
23. The application starts safely when optional payouts are disabled and fails closed when payouts are enabled with incomplete live configuration.

Use Stripe's documented test bank accounts and debit cards for success, failure, ownership verification, and Instant-Payout ineligibility. Do not use test credentials against live connected accounts.

## Rollout plan

Release in stages:

1. Account onboarding and verified payout method display only.
2. Ledger and reconciliation in shadow mode, compared against Stripe.
3. Standard manual payouts for internal staff accounts.
4. Standard manual payouts for a small approved architect cohort with conservative limits.
5. Automatic payouts after scheduler and reconciliation stability is proven.
6. Instant Payouts for an eligible country and cohort only after Stripe approval, fee disclosure, fraud controls, and monitoring are complete.
7. Expand countries one at a time after legal, tax, currency, and Stripe support confirmation.

Include a kill switch that stops new transfers/payouts without hiding historical status or preventing webhook processing and reconciliation.

## Definition of done

This project is complete only when:

- a real architect can finish Stripe-hosted or embedded verification from the Triven site;
- Triven never receives or stores raw bank credentials in the new flow;
- the UI accurately explains pending and failed verification and provides remediation;
- internal available balance reconciles with Stripe and cannot be double-spent;
- standard manual and scheduled payouts work without opening the payouts page;
- partial and full withdrawal work in the connected account's supported currency;
- Instant Payout appears and succeeds only for a Stripe-eligible account/destination/balance;
- webhook duplication, delay, and reordering do not corrupt state;
- payout failures disable retries until the destination is fixed;
- refund, dispute, reversal, and negative-balance behavior is implemented and tested;
- production keys, event destinations, feature flags, alerts, runbooks, and secret rotation are complete;
- a controlled live-mode payout has been received in the intended bank account and reconciled end to end;
- Stripe has confirmed the live platform-country and connected-account-country funds flow.

## Official Stripe references

- [Choose an onboarding configuration](https://docs.stripe.com/connect/onboarding)
- [Express connected accounts and Account Links](https://docs.stripe.com/connect/express-accounts)
- [Account Onboarding embedded component](https://docs.stripe.com/connect/supported-embedded-components/account-onboarding)
- [Account Management embedded component](https://docs.stripe.com/connect/supported-embedded-components/account-management)
- [Payouts embedded component](https://docs.stripe.com/connect/supported-embedded-components/payouts)
- [Pay out to connected accounts](https://docs.stripe.com/connect/marketplace/tasks/payout)
- [Manage payout schedules](https://docs.stripe.com/connect/manage-payout-schedule)
- [Instant Payouts for Connect](https://docs.stripe.com/connect/instant-payouts)
- [Instant Payout supported institutions and regions](https://docs.stripe.com/payouts/instant-payouts-banks)
- [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Connect webhooks](https://docs.stripe.com/connect/webhooks)
- [Testing Stripe Connect](https://docs.stripe.com/connect/testing)
- [Cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts)
- [Stripe India support for marketplaces](https://support.stripe.com/questions/stripe-india-support-for-marketplaces)

Stripe product availability, requirements, and pricing can change. Revalidate the country, account configuration, fees, and capability requirements in the live Stripe Dashboard and with Stripe Support immediately before implementation and again before launch.
