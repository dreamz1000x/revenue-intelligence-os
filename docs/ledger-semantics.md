# Ledger semantics

Revenue Intelligence OS uses an immutable financial-effect ledger. It records the financial effects the application has accepted; it is not a double-entry accounting ledger and makes no accounting claim.

## Payment meaning

A Payment means that the application accepted and durably recorded a caller-supplied assertion that a positive EUR amount was received for one Contract at `receivedAt`, and allocated that amount completely across that Contract's Installments.

A Payment does not prove provider authorization, capture, settlement, bank settlement, revenue recognition, or accounts-receivable accounting.

Contract and Installment creation have no ledger effect. Every committed Payment produces exactly one `payment_recorded` LedgerEntry, regardless of how many Installments receive allocations. PaymentAllocation remains authoritative for that allocation detail.

## Current effect

The LedgerEntry derives only from the persisted Payment:

| LedgerEntry field | Meaning and source |
| --- | --- |
| `paymentId` | Concrete, unique reference to `Payment.id` |
| `effectType` | Fixed as `payment_recorded` |
| `amountCents` | Exact `Payment.amountCents` |
| `currency` | Fixed as `EUR` |
| `eventAt` | `Payment.receivedAt`: when the caller says the money was received |
| `recordedAt` | `Payment.createdAt`: when the application recorded the Payment |

Money is represented only as positive integer cents, bounded by JavaScript's maximum safe integer. Floating-point monetary values are not used.

The Contract is intentionally recovered through LedgerEntry → Payment → Contract. The ledger does not duplicate Contract or Installment allocation identifiers.

## Guarantees

- Referential integrity: the `paymentId` foreign key prevents an orphan LedgerEntry from referring to a missing Payment.
- At-most-one: the unique `paymentId` constraint prevents multiple LedgerEntries for one Payment.
- Existence for new Payments: the authorized RecordPayment transaction inserts Payment, PaymentAllocations, Installment projection, LedgerEntry, and command-idempotency record atomically, so a successfully committed Payment written through that boundary has a LedgerEntry.
- Existence for historical Payments: migration `0003` creates one LedgerEntry for every retained Payment without modifying those Payments.
- Exactly-one: within the supported RecordPayment and migration boundaries, the existence mechanisms above combine with the unique `paymentId` constraint to establish exactly one LedgerEntry per Payment.
- A command replay returns the existing Payment and does not produce another ledger effect.
- Ledger entries are append-only. Application persistence exposes no update or delete operation, and PostgreSQL rejects `UPDATE` and `DELETE` against the table. Administrative `TRUNCATE` is deliberately unaffected.

Financial corrections are represented by future compensating effects, not by rewriting or deleting accepted history. The semantics of those effects must be decided in their own implementation boundary.

## Explicit exclusions

This ledger does not currently model accounts, journals, postings, debit or credit, balances, refunds, chargebacks, provider events, reconciliation, revenue recognition, accounts receivable, accounting dates, or posting dates. It has no query use case or HTTP endpoint in this slice.
