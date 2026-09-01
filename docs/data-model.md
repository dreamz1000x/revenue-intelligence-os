# Data model

Revenue Intelligence OS stores operational and financial evidence in one
PostgreSQL database. Monetary amounts use positive integer euro cents and are
bounded by JavaScript's maximum safe integer where they cross the application
boundary.

## Relationships

```text
Customer 1 ── N Contract
Contract 1 ── N Installment
Contract 1 ── N Payment
Payment 1 ── N PaymentAllocation
Installment 1 ── N PaymentAllocation
Payment 1 ── N Refund
Refund 1 ── N RefundAllocation
PaymentAllocation 1 ── N RefundAllocation
Payment 1 ── 1 LedgerEntry
Refund 1 ── 1 LedgerEntry
StripeWebhookEvent N ── 0..1 Payment
```

`PaymentAllocation` also carries `contract_id`. Composite foreign keys ensure
that its Payment and Installment belong to the same Contract.

## `customers`

| Column | Meaning |
| --- | --- |
| `id` | Generated integer primary key. |
| `display_name` | Non-blank customer display name. |
| `created_at` | Creation instant with time zone. |

A Customer can own multiple Contracts. Physical deletion is not exposed by the
current application boundary.

## `contracts`

| Column | Meaning |
| --- | --- |
| `id` | Generated integer primary key. |
| `customer_id` | Required foreign key to `customers.id`. |
| `total_amount_cents` | Positive safe-integer contractual total. |
| `currency` | Fixed to `EUR`. |
| `installment_count` | Positive count, no greater than the total in cents. |
| `first_due_date` | Civil date anchoring the schedule. |
| `status` | Fixed to `active` in the current boundary. |
| `created_at` | Creation instant with time zone. |

The contractual total, currency, installment count, first due date, and generated
schedule are immutable through current application use cases. Contract creation
and its complete schedule commit atomically.

## `installments`

| Column | Meaning |
| --- | --- |
| `id` | Generated integer primary key. |
| `contract_id` | Required foreign key to `contracts.id`. |
| `position` | Positive stable order within the Contract. |
| `amount_cents` | Positive safe-integer contractual amount. |
| `due_date` | Civil due date derived from the Contract anchor and position. |
| `status` | Persisted projection: `pending`, `partially_paid`, or `paid`. |
| `created_at` | Creation instant with time zone. |

`(contract_id, position)` is unique. Installment status is derived from effective
paid cents: gross immutable PaymentAllocations minus immutable
RefundAllocations. It is not an independent financial fact.

## `payments`

| Column | Meaning |
| --- | --- |
| `id` | Generated integer primary key. |
| `contract_id` | Required foreign key to `contracts.id`. |
| `amount_cents` | Positive safe-integer amount accepted as received. |
| `received_at` | Caller- or provider-event-supplied receipt assertion instant. |
| `created_at` | Application-clock recording instant. |

A Payment is an immutable financial fact in the current application boundary.
It means the application accepted and durably recorded an assertion that money
was received for one Contract. It does not prove provider authorization,
settlement, bank settlement, revenue recognition, or reconciliation.

Provider identifiers are intentionally not stored on Payment. Stripe delivery
and PaymentIntent identity remain in `stripe_webhook_events`.

## `payment_allocations`

| Column | Meaning |
| --- | --- |
| `payment_id` | Part of the primary key; references a Payment. |
| `installment_id` | Part of the primary key; references an Installment. |
| `contract_id` | Enforces the shared Contract identity. |
| `amount_cents` | Positive safe-integer amount allocated. |

The primary key is `(payment_id, installment_id)`. Allocations are immutable
through current application use cases, contain no zero amounts, and conserve the
complete Payment amount. They preserve gross historical allocation; after a
Refund they are not, by themselves, the current paid balance.

## `refunds`

| Column | Meaning |
| --- | --- |
| `id` | Generated integer primary key. |
| `payment_id` | Required foreign key to the original Payment. |
| `amount_cents` | Positive safe-integer compensating amount. |
| `refunded_at` | Caller-supplied Refund assertion instant. |
| `created_at` | Application-clock recording instant. |

A Refund is immutable and references exactly one original Payment. Partial,
full, and multiple Refunds are supported, but cumulative Refund amounts cannot
exceed that Payment's amount.

## `refund_allocations`

| Column | Meaning |
| --- | --- |
| `refund_id` | Part of the primary key and references the parent Refund. |
| `payment_id` | Carries and enforces the original Payment identity. |
| `installment_id` | Part of the primary key and identifies the compensated Installment. |
| `amount_cents` | Positive safe-integer amount reversed from the original allocation. |

Composite foreign keys require each RefundAllocation to belong to its Refund's
Payment and to reference an existing PaymentAllocation for that same Payment and
Installment. Refund allocation proceeds by descending Installment position and
never creates a negative PaymentAllocation or mutates historical allocations.

## `idempotency_records`

| Column | Meaning |
| --- | --- |
| `command_type` | `create_customer`, `create_contract`, `record_payment`, or `record_refund`. |
| `idempotency_key` | Printable client or derived command key, up to 128 characters. |
| `request_fingerprint` | Lowercase 64-character hexadecimal payload fingerprint. |
| `resource_id` | Identifier of the command result. |
| `created_at` | Recording instant with time zone. |

The primary key is `(command_type, idempotency_key)`. This table provides command
idempotency: the same key and canonical payload returns the existing resource;
the same key with a different payload is a conflict. `resource_id` is interpreted
within its command type and is not a generic database foreign key.

## `ledger_entries`

| Column | Meaning |
| --- | --- |
| `id` | Generated integer primary key. |
| `payment_id` | Nullable unique Payment source; required only for `payment_recorded`. |
| `refund_id` | Nullable unique Refund source; required only for `refund_recorded`. |
| `effect_type` | `payment_recorded` or `refund_recorded`. |
| `amount_cents` | Positive safe-integer amount copied from the source fact. |
| `currency` | Fixed to `EUR`. |
| `event_at` | Payment `received_at` or Refund `refunded_at`, according to effect type. |
| `recorded_at` | Source Payment or Refund `created_at`. |

Source/effect constraints require exactly one source of the correct type. Unique
source foreign keys establish at most one entry per Payment and per Refund.
RecordPayment and RecordRefund establish existence atomically within the
supported boundaries. PostgreSQL rejects `UPDATE` and `DELETE` through the
append-only trigger; administrative `TRUNCATE` remains outside that protection.

This is an immutable financial-effect ledger, not a double-entry accounting
model.

## `stripe_webhook_events`

| Column | Meaning |
| --- | --- |
| `id` | Generated integer primary key. |
| `stripe_event_id` | Unique Stripe Event identity. |
| `event_type` | Fixed to `payment_intent.succeeded`. |
| `stripe_payment_intent_id` | Optional safely extracted PaymentIntent identity. |
| `raw_payload` | Original signed payload as `bytea`, from 1 byte through 1 MiB. |
| `received_at` | Application-clock evidence receipt instant. |
| `status` | `received`, `processing`, `processed`, or `failed`. |
| `processing_token` | UUID ownership token while processing. |
| `processing_started_at` | Database-clock claim start while processing. |
| `processed_at` | Terminal-state instant. |
| `payment_id` | Nullable foreign key to the resulting Payment. |
| `last_error_code` | Bounded stable code for permanent failure. |

The first retained evidence for a Stripe Event ID is authoritative. PostgreSQL
rejects deletion and changes to evidence columns. State-consistency checks tie
nullable fields to the current processing state: a processed event has a Payment
link, while a failed event has no Payment link and retains an error code.

## Current exclusions

There are no persisted models for chargebacks, bank movements, reconciliation
exceptions, analytics, accounting accounts, journals, postings, AI
conversations, or frontend state. Stripe Refund evidence is not ingested.
