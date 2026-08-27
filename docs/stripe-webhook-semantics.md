# Stripe webhook semantics

## Selected event and environment

The Stripe ingestion boundary supports only the signed `payment_intent.succeeded` event. It records that Stripe reported a successful PaymentIntent; it does not claim bank settlement or reconciliation. The slice deliberately accepts Test Mode events only (`livemode: false`). Signed unsupported event types are acknowledged without persistence or financial effect, while live events are rejected before persistence.

The Payment `receivedAt` instant is `Event.created` converted from Unix seconds. It means the time Stripe created the signed success event, not the PaymentIntent creation time, settlement time, bank receipt time, local webhook receipt time, or reconciliation time.

## Signature and raw evidence

`POST /webhooks/stripe` requires exactly one `Stripe-Signature` header. Verification uses Stripe's webhook verifier over the exact raw request bytes and `STRIPE_WEBHOOK_SECRET`; no authenticated Stripe API client or API key is involved. The endpoint accepts at most 1 MiB and changes no global JSON parsing behavior.

For a supported Test Mode event, the first verified raw payload is retained byte-for-byte with its Event ID, event type, safely extractable PaymentIntent ID, and application-clock receipt time. A repeated Event ID with identical retained evidence is a delivery replay. A repeated Event ID with different event type, raw bytes, or PaymentIntent ID is a conflict: the first evidence remains authoritative and no financial effect is attempted.

The database rejects deletion of retained webhook events and rejects changes to the evidence columns. Processing-state columns remain mutable. A malformed supported event may retain a null PaymentIntent ID; that evidence is never enriched later.

## Identity and financial mapping

Stripe Event ID identifies the external delivery evidence. The financial command uses a different identity:

`stripe:payment_intent.succeeded:<sha256(payment_intent_id)>`

The hash is lowercase hexadecimal over the exact UTF-8 PaymentIntent ID. This makes different Stripe Event deliveries for the same PaymentIntent converge on the existing `RecordPayment` idempotency boundary without changing its fingerprint.

The current Contract mapping is `PaymentIntent.metadata.contract_id`. It must be a canonical positive PostgreSQL integer with no leading zeroes. `amount_received` is used directly as a positive safe integer in cents, and provider currency `eur` maps to the existing internal `EUR`. This metadata convention is an explicit demo limitation, not a general provider-reference model.

## Durable processing states

A retained event moves through `received`, `processing`, and one terminal state: `processed` or `failed`. Processing ownership is acquired with one atomic conditional database update, a random UUID token, and a database-clock lease. A current claim is busy; a claim older than 60 seconds can be replaced. Only the current token may finalize or release the event, so a stale worker cannot overwrite newer ownership.

No webhook-event transaction remains open while `RecordPayment` runs. `RecordPayment` retains its existing Contract row lock, `READ COMMITTED` transaction, allocation behavior, financial fingerprint, Payment persistence, and immutable Ledger effect.

Permanent validation or business rejection stores only a bounded stable error code and ends in `failed`; duplicates are then acknowledged without another financial attempt. Infrastructure failures attempt to release the current claim to `received` and return an internal failure so delivery can be retried. Arbitrary error messages, stack traces, and raw payloads are not logged or persisted as failure text.

If Payment and Ledger commit but webhook finalization fails, those financial records remain committed. A later claim derives the same PaymentIntent command key and payload, `RecordPayment` returns the original Payment as a replay, and the current token can complete the event-to-Payment link. This preserves one Payment and one LedgerEntry.

## Synchronous demo tradeoff and evolution

This slice processes the durable receipt synchronously during the HTTP request. That keeps the portfolio boundary observable and small, but makes response latency depend on database work. A production evolution can separate durable ingestion from reliable asynchronous processing while preserving the same evidence, claim, idempotency, and terminal-state semantics.

## Explicit exclusions

This slice does not create PaymentIntents, call Stripe APIs, synchronize Stripe customers, handle refunds, subscriptions, Checkout, additional event types, reconciliation, queues, workers, Redis, or an outbox. It does not introduce a generic provider abstraction or expose a Ledger HTTP API.

## Manual Test Mode acceptance

With a valid local Contract already present, set `DATABASE_URL` and the Stripe CLI forwarding secret as `STRIPE_WEBHOOK_SECRET`, run the local service, and forward Stripe Test Mode events to `POST /webhooks/stripe`. Trigger `payment_intent.succeeded` with `metadata.contract_id` set to that Contract ID and an `eur` positive amount. The expected response is `200 {"received":true}`. The expected database result is one immutable processed webhook event linked to one Payment, its deterministic allocations, and exactly one `payment_recorded` LedgerEntry. This manual check remains separate from deterministic automated tests and requires locally available Stripe credentials and Stripe CLI.
