# ADR 0002 — Immutable financial-effect ledger

## Context

Payments must leave durable, auditable evidence of the financial effect accepted by Revenue Intelligence OS. That evidence must remain consistent with Payment persistence and command idempotency, while the project does not claim to provide accounting, provider settlement, or reconciliation.

## Decision

Adopt an immutable financial-effect ledger rather than a double-entry accounting ledger.

Each committed Payment creates exactly one `payment_recorded` LedgerEntry in the existing RecordPayment PostgreSQL transaction. Refunds v1 extends the same decision: each committed Refund creates exactly one positive `refund_recorded` compensating LedgerEntry in RecordRefund. Each effect has exactly one concrete, unique source foreign key. PostgreSQL rejects ledger updates and deletes through an append-only trigger.

## Alternatives considered

### Double-entry accounting

Rejected because the current product boundary has not defined accounts, debit/credit rules, recognition, settlement, or balances. Adding those concepts would imply accounting semantics the system does not yet possess.

### Generic `source_type` / `source_id`

Rejected initially because Payment was then the only approved source. Refunds v1 did not introduce a polymorphic reference: it added a second concrete nullable foreign key plus a source/effect consistency constraint, preserving relational integrity for both source types.

### Post-commit asynchronous ledger production

Rejected because it would permit a committed Payment to exist temporarily or permanently without its required ledger evidence. It would also require recovery infrastructure beyond this slice.

## Consequences

- Concrete Payment and Refund foreign keys prevent orphan LedgerEntries; uniqueness prevents multiple entries per source; transactional writers and migration backfill establish existence within supported boundaries.
- Payment or Refund and its ledger evidence are transactionally coupled and cannot commit independently.
- The ledger deliberately duplicates immutable effect evidence derived from each source to support auditability.
- The database enforces append-only behavior for `UPDATE` and `DELETE`; administrative `TRUNCATE` remains available.
- The system makes no double-entry, revenue-recognition, settlement, or accounts-receivable claim.
- Refunds compensate accepted Payment history through a new effect; they never modify the original `payment_recorded` entry.
