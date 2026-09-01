# Refund semantics

Revenue Intelligence OS records a Refund as an immutable financial fact against
exactly one original Payment. A Refund means the application accepted and
durably recorded an assertion that a positive EUR amount was refunded at
`refundedAt`. It does not prove that Stripe or a bank initiated or settled that
refund, and it is not an accounting or revenue-recognition event.

## Refund and allocation

A Refund contains a positive safe-integer amount in cents. The caller supplies
`refundedAt`; the application Clock supplies `createdAt`. Partial, full, and
multiple Refunds per Payment are supported, but cumulative Refund amounts cannot
exceed the original Payment amount.

RefundAllocation records which of the original Payment's installment allocations
are compensated. Allocation is deterministic:

1. Load only PaymentAllocations belonging to the original Payment.
2. Order them by Installment `position DESC`.
3. Subtract amounts already reversed by earlier Refunds.
4. Allocate the new Refund across the remaining reversible amounts.

Every Refund cent is allocated exactly once. Allocations are positive and never
refer to an Installment that the original Payment did not fund. Historical
Payment and PaymentAllocation rows are never updated, deleted, or negated.

## Effective installment state

Gross PaymentAllocation history is not the current paid balance after a Refund.
The authoritative projection input is:

```text
effective paid = gross PaymentAllocations - RefundAllocations
```

A Refund can move an Installment from `paid` to `partially_paid`, from
`partially_paid` to `pending`, or from `paid` directly to `pending`. A later
Payment can allocate against the reopened outstanding amount. Consequently,
gross historical PaymentAllocations may exceed an Installment's contractual
amount after a Refund and repayment while effective paid remains bounded by that
amount.

## Transaction and concurrency

RecordRefund uses the original Payment's Contract row as the serialization
boundary, shared with RecordPayment. At PostgreSQL `READ COMMITTED`, it locks the
Contract, rechecks idempotency, loads coherent Payment and Refund allocation
history, applies the deterministic plan, updates Installment projections, and
commits the Refund, RefundAllocations, `refund_recorded` LedgerEntry, and
idempotency record atomically.

This prevents concurrent Refunds from cumulatively exceeding the original
Payment and lets Payment and Refund operations observe one coherent effective
installment state.

## Ledger effect

Each committed Refund produces exactly one positive `refund_recorded`
LedgerEntry whose concrete source is that Refund. Its amount is the exact Refund
amount, `eventAt` is `Refund.refundedAt`, and `recordedAt` is
`Refund.createdAt`. The compensating meaning comes from the effect type, not a
negative amount. The original Payment and its `payment_recorded` entry remain
unchanged.

## Idempotency

RecordRefund uses command type `record_refund`. Its canonical semantic payload
is:

```text
[paymentId, amountCents, refundedAt.toISOString()]
```

- Same key and canonical payload: return the existing Refund as a replay.
- Same key and different payload: reject as an idempotency conflict.
- A rollback leaves the command retryable.

The Refund and all financial effects commit in the same transaction as the
idempotency record.

## HTTP boundary

`POST /refunds` requires `Idempotency-Key` and accepts `paymentId`,
`amountCents`, and an offset-aware `refundedAt`. It returns `201` for a new
Refund and `200` for a replay. `GET /refunds/:id` returns an existing Refund and
its explicit allocations.

Malformed transport input returns `400`. Explicit caller/application validation
returns `422`. Missing original Payments, over-refunds, idempotency conflicts,
and missing Refunds retain dedicated public errors. Persistence,
reconstitution, and other internal validation failures are sanitized as `500`.

## Explicit exclusions

Refunds v1 does not ingest Stripe Refund events, initiate provider refunds,
verify provider or bank settlement, handle chargebacks or disputes, perform
reconciliation, expose update/delete Refund operations, or use asynchronous
queues.
