# ADR 0002 — Immutable financial-effect ledger

## Context

Payments must leave durable, auditable evidence of the financial effect accepted by Revenue Intelligence OS. That evidence must remain consistent with Payment persistence and command idempotency, while the project does not yet claim to provide accounting, provider settlement, refunds, or reconciliation.

## Decision

Adopt an immutable financial-effect ledger rather than a double-entry accounting ledger.

Each committed Payment creates exactly one `payment_recorded` LedgerEntry in the existing RecordPayment PostgreSQL transaction. The entry uses a concrete, unique foreign key to Payment and derives its amount and timestamps from the persisted Payment. PostgreSQL rejects ledger updates and deletes through an append-only trigger.

## Alternatives considered

### Double-entry accounting

Rejected because the current product boundary has not defined accounts, debit/credit rules, recognition, settlement, or balances. Adding those concepts would imply accounting semantics the system does not yet possess.

### Generic `source_type` / `source_id`

Rejected because Payment is the only approved financial-effect source. A polymorphic reference would weaken referential integrity and introduce abstraction without a second concrete use case.

### Post-commit asynchronous ledger production

Rejected because it would permit a committed Payment to exist temporarily or permanently without its required ledger evidence. It would also require recovery infrastructure beyond this slice.

## Consequences

- The Payment foreign key prevents orphan LedgerEntries; uniqueness prevents multiple entries per Payment; the transactional writer and migration backfill establish existence within the supported boundaries.
- Payment and its ledger evidence are transactionally coupled and cannot commit independently.
- The ledger deliberately duplicates immutable effect evidence derived from Payment to support auditability.
- The database enforces append-only behavior for `UPDATE` and `DELETE`; administrative `TRUNCATE` remains available.
- The system makes no double-entry, revenue-recognition, settlement, or accounts-receivable claim.
- Adding Refund as a distinct source may require a future schema migration and a separately approved effect model; the present design does not pre-empt that decision.
