# Problem definition

Revenue Intelligence OS models a financed-product business in which customer,
contract, installment, payment-provider, and banking data can diverge. When those
facts live in separate systems, it becomes difficult to establish what was
contracted, what the application recorded as received, how money was allocated,
and which differences still require investigation.

The broader product aims to make those financial facts exact, traceable,
auditable, and resistant to duplicate operations. It must keep source meanings
explicit rather than treating a provider event, an internal payment record, bank
settlement, revenue recognition, and reconciliation as equivalent facts.

## Current implemented boundary

The backend currently implements this flow:

```text
customer
→ contract
→ deterministic installment schedule
→ payment
→ deterministic allocations
→ immutable financial-effect ledger
→ signed Stripe payment webhook ingestion
```

The implementation persists customers and financed contracts in PostgreSQL,
generates schedules with exact integer-cent conservation, records idempotent
partial or spanning payments, and writes one immutable `payment_recorded` ledger
effect for each committed Payment. Signed Stripe Test Mode
`payment_intent.succeeded` events can supply that payment assertion through a
durable, duplicate-safe ingestion boundary.

## Outside the current boundary

The backend does not yet implement refunds, chargebacks, bank ingestion,
reconciliation, analytics, dashboards, an AI assistant, a frontend, or public
deployment. A Payment is an accepted and durably recorded assertion of money
received for a Contract; it is not proof of provider or bank settlement, revenue
recognition, or reconciliation.
