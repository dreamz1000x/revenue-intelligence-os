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
→ refund and deterministic compensating allocations
→ effective installment projection
→ immutable payment/refund financial-effect ledger
→ signed Stripe payment webhook ingestion
→ deterministic reconciliation Runs, Findings, and resolution history
```

The implementation persists customers and financed contracts in PostgreSQL,
generates schedules with exact integer-cent conservation, records idempotent
partial or spanning payments, and writes one immutable `payment_recorded` ledger
effect for each committed Payment. It also records partial, full, and repeated
Refunds against an original Payment, reverses that Payment's allocations in
descending installment position, and writes one immutable `refund_recorded`
compensating effect without rewriting Payment history. Signed Stripe Test Mode
`payment_intent.succeeded` events can supply that payment assertion through a
durable, duplicate-safe ingestion boundary.
Reconciliation v1 compares contractual state, internal financial effects,
retained Stripe evidence, and simulated external-bank evidence using five exact
rules and a knowledge-time cutoff. It preserves historical Runs, typed Finding
evidence, and idempotent operator actions.

## Outside the current boundary

The backend does not yet implement Stripe Refund ingestion, automatic provider
refunds, chargebacks, real bank ingestion, fuzzy or AI-assisted matching,
automatic remediation, analytics, dashboards,
authentication or RBAC, an AI assistant, a frontend, or public deployment. A
Payment or Refund is an accepted and durably recorded internal financial fact;
neither proves provider or bank settlement or revenue recognition.
