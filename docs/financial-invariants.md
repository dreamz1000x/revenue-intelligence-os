# Financial invariants

This document states the financial properties currently enforced by Revenue
Intelligence OS and the boundaries where they apply. An invariant describes what
must remain true; domain validation, PostgreSQL constraints, transactions,
idempotency records, immutable evidence, and tests provide complementary
enforcement.

## 1. Monetary representation

### FIN-01 — Money uses integer minor units

All current financial amounts are integer euro cents. Floating-point monetary
values are not accepted or persisted. Values crossing the TypeScript boundary
must be positive safe integers, and PostgreSQL checks the corresponding upper
bound of `9007199254740991`.

### FIN-02 — Currency meaning is explicit

The current Contract and ledger boundary supports only `EUR`. Installments and
PaymentAllocations inherit their Contract's currency rather than storing a
separate currency. Stripe `eur` maps to internal `EUR`; other provider currencies
are rejected for the supported event.

## 2. Contract and installment schedule

### FIN-03 — Contractual totals are positive and conserved

A Contract total is positive. Every Installment amount is positive, and the sum
of the complete generated schedule equals the Contract total exactly.
`installment_count` is positive and cannot exceed the Contract total expressed
in cents, preventing zero-value Installments.

For total `T` and installment count `N`:

```text
base = T DIV N
remainder = T MOD N
```

Each Installment receives `base`; the first `remainder` positions receive one
additional cent. The result is deterministic and loses or creates no cent.

### FIN-04 — Installment order and dates are stable

Installments use unique positions `1..N`. Monetary distribution and later
payment allocation use ascending position explicitly rather than incidental
database order.

For position `N`:

```text
due_date(N) = first_due_date shifted by N - 1 calendar months
```

The contractual day is preserved where possible and clamped to the target
month's final day otherwise. Each date is derived from `first_due_date`, so a
short month causes no cumulative drift.

`first_due_date` and `due_date` remain civil dates. Technical timestamps such as
`created_at`, `received_at`, and `processed_at` are unambiguous instants stored
with time zone; presentation-zone conversion is outside the persistence model.

### FIN-05 — Contract creation is atomic and contractual terms are immutable

A financed Contract and its complete schedule commit in one transaction or not
at all. Current use cases expose no update or physical-delete operation for the
Contract total, currency, installment count, first due date, or generated
schedule.

### FIN-06 — Installment status is a derived projection

An Installment status is `pending`, `partially_paid`, or `paid`. RecordPayment
and RecordRefund derive this projection from the Installment amount and effective
paid cents:

```text
effective paid = gross PaymentAllocations - RefundAllocations
```

Status is not an independent source of financial truth. A Refund can move status
backward, and a later Payment can repay reopened outstanding.

## 3. Command idempotency

### FIN-07 — Repeating a command does not repeat its effect

`create_customer`, `create_contract`, `record_payment`, and `record_refund` use
a command type, caller-provided or derived idempotency key, and SHA-256
fingerprint of canonical validated input.

- Same command type, same key, same payload: return the existing resource as a
  replay without another effect.
- Same command type, same key, different payload: reject as a conflict.
- Different keys: independent commands, even when payloads are equal.

The idempotency record commits atomically with its resource and dependent
effects. A rollback leaves the command retryable.

Command identity is distinct from Stripe Event identity. Stripe derives the
RecordPayment key from the exact PaymentIntent identity so different Event
deliveries for one PaymentIntent converge on the same financial command.

The canonical RecordRefund payload is
`[paymentId, amountCents, refundedAt.toISOString()]`. Its financial effects and
idempotency record commit atomically.

## 4. Payment and allocation

### FIN-08 — Payment has a narrow, immutable meaning

A Payment means the application accepted and durably recorded an assertion that
a positive EUR amount was received for one Contract at `receivedAt`.

For direct HTTP commands, the caller supplies `receivedAt`. For the supported
Stripe flow, `receivedAt` is the verified Stripe Event `created` timestamp.
The application Clock supplies `createdAt`.

A Payment does not prove provider authorization, capture, Stripe settlement,
bank settlement, revenue recognition, accounts receivable, or reconciliation.
Current application boundaries expose no Payment update or delete operation.

### FIN-09 — Allocation is deterministic and complete

RecordPayment loads Installments and existing allocations for the Contract,
orders Installments by ascending position, skips fully paid Installments, and
allocates against each outstanding amount in order.

The algorithm supports partial payments and payments spanning multiple
Installments. It creates no zero allocation, allocates every Payment cent exactly
once, and rejects an amount greater than the Contract's total outstanding
balance. No unapplied balance is retained.

### FIN-10 — Payments and Refunds against one Contract are serialized

RecordPayment and RecordRefund run at PostgreSQL `READ COMMITTED` and lock the
Contract row with `SELECT ... FOR UPDATE`. The command idempotency record is
checked again after the lock. Allocation is calculated from coherent locked
state before the financial fact, allocations, Installment projections,
LedgerEntry, and idempotency record commit atomically.

This prevents concurrent Payments from allocating the same outstanding cents,
prevents concurrent Refunds from cumulatively exceeding one Payment, and keeps
Payment-after-Refund allocation coherent. PostgreSQL is the coordination
mechanism; no Redis, advisory lock, or distributed lock is used.

## 5. Immutable financial-effect ledger

### FIN-11 — Every supported financial fact has exactly one ledger effect

Each committed Payment written through RecordPayment produces exactly one
LedgerEntry with:

- `effect_type = payment_recorded`;
- the Payment's exact amount;
- `currency = EUR`;
- `event_at = Payment.receivedAt`;
- `recorded_at = Payment.createdAt`.

The Payment foreign key prevents orphan entries, uniqueness on `payment_id`
prevents multiple entries, RecordPayment establishes existence for new Payments,
and migration `0003` backfilled retained historical Payments.

Each committed Refund written through RecordRefund produces exactly one
LedgerEntry with:

- `effect_type = refund_recorded`;
- the Refund's exact positive amount;
- `currency = EUR`;
- `event_at = Refund.refundedAt`;
- `recorded_at = Refund.createdAt`.

Each entry has exactly one concrete source. The Refund foreign key prevents
orphan entries, uniqueness on `refund_id` prevents duplicates, and RecordRefund
establishes existence atomically. A Refund never modifies its original
Payment's ledger entry.

### FIN-12 — Ledger evidence is append-only

Application persistence exposes no update or delete operation for LedgerEntry,
and PostgreSQL rejects `UPDATE` and `DELETE`. Administrative `TRUNCATE` remains
available for controlled test or database administration boundaries.

Corrections use additional compensating effects; accepted history must not be
rewritten. The current ledger is an immutable financial-effect ledger, not
double-entry accounting, and makes no balance, settlement, recognition, or
reconciliation claim.

## 6. Stripe webhook evidence and processing

### FIN-13 — Only verified, supported Test Mode evidence can create an effect

`POST /webhooks/stripe` requires exactly one `Stripe-Signature`. Verification
uses Stripe's verifier over the exact raw Buffer and `STRIPE_WEBHOOK_SECRET`.
Live events are rejected. Signed event types other than
`payment_intent.succeeded` are acknowledged without persistence or financial
effect.

For the supported event, the PaymentIntent must also be Test Mode, use `eur`,
contain a positive safe-integer `amount_received`, and provide a canonical
positive PostgreSQL integer in `metadata.contract_id`.

### FIN-14 — Original supported event evidence is retained immutably

The first supported event for a Stripe Event ID retains its exact signed raw
payload, event type, safely extractable PaymentIntent ID, and receipt time before
financial processing. PostgreSQL prevents deletion and changes to evidence
columns.

A repeated Event ID with identical evidence is a delivery replay. The same Event
ID with different raw bytes, event type, or PaymentIntent identity is an evidence
conflict; the first retained evidence remains authoritative and no new financial
effect is attempted.

External event identity, provider PaymentIntent identity, and RecordPayment
command identity remain separate concepts.

### FIN-15 — Webhook processing has exclusive, recoverable ownership

A retained event moves through `received`, `processing`, and one terminal state:
`processed` or `failed`. Processing ownership is acquired by an atomic
conditional PostgreSQL update using a random UUID token and database-clock start
time.

An active claim is reported busy. A claim older than 60 seconds can be replaced.
Only the current token may finalize or release the event, so a stale worker
cannot overwrite newer ownership.

### FIN-16 — Webhook retry does not duplicate financial effects

Permanent validation or business rejection records a bounded stable error code
and terminates as `failed`. Infrastructure failures attempt to release the
current claim back to `received` and return an error so delivery can be retried.

The webhook claim is not held open as a long-running transaction around
RecordPayment. If Payment and Ledger commit but event finalization fails, a later
claim derives the same PaymentIntent-based command key. RecordPayment replays the
existing Payment, after which the current token can finalize the event link.
This preserves one Payment and one LedgerEntry.

Arbitrary exception messages, stack traces, signing secrets, and raw payloads are
not persisted as failure text by this boundary.

## 7. Refund and reversal

### FIN-17 — Refund allocation is deterministic and bounded

A Refund is a positive immutable fact against exactly one original Payment.
RecordRefund reverses only that Payment's allocations, ordered by Installment
position descending. It skips amounts already reversed by earlier Refunds,
allocates every Refund cent exactly once, and rejects an amount greater than the
Payment's remaining reversible amount.

Partial, full, and multiple Refunds are supported. No negative
PaymentAllocation is created, and historical Payment, PaymentAllocation, and
provider evidence are never rewritten.

### FIN-18 — Effective paid state accounts for Refunds

For each Installment, current effective paid cents equal gross
PaymentAllocations minus RefundAllocations. Refunds may move an Installment from
`paid` to `partially_paid` or `pending`; a later Payment may repay the reopened
outstanding amount. Gross allocation history may therefore exceed the
contractual amount after Refund and repayment while effective paid remains
bounded.

### FIN-19 — Refund recording is atomic and idempotent

RecordRefund commits the Refund, RefundAllocations, effective Installment
projection, one `refund_recorded` LedgerEntry, and its `record_refund`
idempotency record in one transaction. Same key and canonical payload replay the
existing Refund; the same key with a different payload is a conflict.

## 8. Reconciliation

### FIN-20 — Source discrepancies remain visible

When multiple financial sources are introduced, differences between Contracts,
provider evidence, bank records, and internal effects must be represented with
enough evidence to investigate and resolve them. Reconciliation does not silently
select one conflicting value.

### FIN-21 — Runs use immutable knowledge-time snapshots

A global Run evaluates only evidence known by its cutoff. Internal facts use
their recording timestamps, Stripe links become visible at processing time, and
external evidence uses its application `created_at`; an earlier external
`occurred_at` does not backdate system knowledge. Completed Runs and their
Findings remain historical when later evidence arrives.

### FIN-22 — Reconciliation v1 is exact and deterministic

The versioned rule set contains exactly five rules: missing internal Payment for
Stripe success, missing bank settlement for internal Payment, bank settlement
amount mismatch, missing bank outflow for internal Refund, and orphan bank
movement. Matching uses explicit internal IDs or a unique exact provider
reference. No fuzzy matching, tolerance, AI inference, or automatic remediation
is performed.

### FIN-23 — Finding evidence and resolution history are auditable

Every Finding has deterministic identity and typed references to its retained
evidence. Operator actions follow explicit legal transitions and are appended in
stable order. Replaying one action key and payload returns the same action; a
changed payload conflicts.

## 9. Current exclusions

The current invariants do not claim implementation of Stripe Refund ingestion,
automatic provider refunds, chargebacks, real bank ingestion, accounting,
analytics, settlement verification, fuzzy matching, or AI remediation.
