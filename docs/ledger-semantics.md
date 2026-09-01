# Ledger semantics

Revenue Intelligence OS uses an immutable financial-effect ledger. It records the financial effects the application has accepted; it is not a double-entry accounting ledger and makes no accounting claim.

## Payment meaning

A Payment means that the application accepted and durably recorded a caller-supplied assertion that a positive EUR amount was received for one Contract at `receivedAt`, and allocated that amount completely across that Contract's Installments.

A Payment does not prove provider authorization, capture, settlement, bank settlement, revenue recognition, or accounts-receivable accounting.

Contract and Installment creation have no ledger effect. Every committed Payment produces exactly one `payment_recorded` LedgerEntry, regardless of how many Installments receive allocations. PaymentAllocation remains authoritative for that allocation detail.

## Refund meaning

A Refund means that the application accepted and durably recorded a positive EUR compensating assertion against one original Payment at `refundedAt`. It does not prove provider initiation, Stripe settlement, bank settlement, revenue recognition, or accounting treatment.

Every committed Refund produces exactly one positive `refund_recorded` LedgerEntry. The effect type communicates compensation; the original Payment and its `payment_recorded` entry remain unchanged. RefundAllocation remains authoritative for Installment-level reversal detail.

## Supported effects

Each LedgerEntry derives from exactly one concrete source:

| LedgerEntry field | `payment_recorded` | `refund_recorded` |
| --- | --- | --- |
| `paymentId` | Unique `Payment.id` | `null` |
| `refundId` | `null` | Unique `Refund.id` |
| `effectType` | `payment_recorded` | `refund_recorded` |
| `amountCents` | Exact `Payment.amountCents` | Exact positive `Refund.amountCents` |
| `currency` | `EUR` | `EUR` |
| `eventAt` | `Payment.receivedAt` | `Refund.refundedAt` |
| `recordedAt` | `Payment.createdAt` | `Refund.createdAt` |

Money is represented only as positive integer cents, bounded by JavaScript's maximum safe integer. Floating-point monetary values are not used.

The Contract is recovered through LedgerEntry → Payment → Contract, or through LedgerEntry → Refund → Payment → Contract. The ledger does not duplicate Contract or Installment allocation identifiers.

## Guarantees

- Referential integrity: concrete `paymentId` and `refundId` foreign keys prevent orphan LedgerEntries.
- Source consistency: each effect has exactly one source of the matching type.
- At-most-one: unique source constraints prevent multiple LedgerEntries for one Payment or Refund.
- Existence for new Payments: the authorized RecordPayment transaction inserts Payment, PaymentAllocations, Installment projection, LedgerEntry, and command-idempotency record atomically, so a successfully committed Payment written through that boundary has a LedgerEntry.
- Existence for historical Payments: migration `0003` creates one LedgerEntry for every retained Payment without modifying those Payments.
- Exactly-one: within the supported RecordPayment and migration boundaries, the existence mechanisms above combine with the unique `paymentId` constraint to establish exactly one LedgerEntry per Payment.
- Refund existence: RecordRefund atomically inserts Refund, RefundAllocations, Installment projection, LedgerEntry, and command-idempotency record, establishing exactly one entry per committed Refund.
- A command replay returns the existing Payment or Refund and does not produce another ledger effect.
- Ledger entries are append-only. Application persistence exposes no update or delete operation, and PostgreSQL rejects `UPDATE` and `DELETE` against the table. Administrative `TRUNCATE` is deliberately unaffected.

Financial corrections are represented by additional compensating effects, not by rewriting or deleting accepted history. Refunds v1 implements the first such effect as `refund_recorded`.

## Explicit exclusions

This ledger does not model accounts, journals, postings, debit or credit, balances, chargebacks, provider events, reconciliation, revenue recognition, accounts receivable, accounting dates, or posting dates. It has no query use case or HTTP endpoint. A `refund_recorded` effect records an internal Refund fact; it does not prove a Stripe or bank refund.
