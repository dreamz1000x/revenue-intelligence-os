# Architecture

This document describes the architecture currently implemented by Revenue
Intelligence OS. The system is an evolving backend, not a production-ready
platform.

## System shape

Revenue Intelligence OS is a modular monolith running as one Node.js process
against one PostgreSQL database. The process creates one PostgreSQL connection
pool and shares it through the persistence adapters.

The code separates four conceptual responsibilities:

```text
interface → application → domain → persistence
```

- **Interface** validates HTTP input, maps requests and responses, and exposes
  stable public errors.
- **Application** coordinates use cases, idempotency, clocks, persistence, and
  transaction boundaries.
- **Domain** owns monetary, allocation, schedule, identifier, and temporal rules.
- **Persistence** implements PostgreSQL reads, writes, constraints, locks, and
  transaction coordination through Drizzle ORM.

A single deployable process and database remain appropriate because the current
financial operations need strong local transaction boundaries and no implemented
capability requires independent deployment. Module boundaries remain explicit so
future extraction can be driven by demonstrated operational needs.

## Current boundaries

### Customers

The `customers` boundary owns Customer validation, creation, lookup, command
idempotency, PostgreSQL persistence, and the customer HTTP routes.

### Contracts and installments

The `contracts` boundary owns financed Contracts, immutable contractual terms,
deterministic installment schedule generation, civil due dates, persistence, and
contract HTTP routes. A Contract and its complete ordered schedule are created in
one transaction.

### Payments

The `payments` boundary owns Payment and PaymentAllocation, deterministic
allocation across Installments by ascending position, payment command
idempotency, persistence, and payment HTTP routes. Partial payments and payments
spanning multiple Installments are supported; overpayment is rejected.

### Refunds

The `refunds` boundary owns immutable Refund and RefundAllocation facts,
deterministic reversal of one original Payment's allocations by descending
Installment position, cumulative over-refund protection, command idempotency,
PostgreSQL persistence, and Refund HTTP routes. Partial, full, and multiple
Refunds per Payment are supported.

### Ledger

The `ledger` boundary owns immutable financial effects. A Payment creates a
`payment_recorded` effect and a Refund creates a positive `refund_recorded`
compensating effect. Each entry has exactly one concrete source. This is not a
double-entry accounting ledger and makes no settlement, revenue-recognition, or
accounts-receivable claim.

### Stripe webhook ingestion

The `stripe` application and persistence boundary, together with the HTTP
interface, verifies and ingests signed Stripe Test Mode webhook events. It
retains original evidence, coordinates processing ownership, maps supported
events to RecordPayment, and finalizes durable processing state.

## Request and event flows

### Customer creation

```text
POST /customers + Idempotency-Key
→ interface validation
→ command fingerprint and idempotency check
→ Customer persistence
→ idempotency record
→ atomic commit
```

### Contract creation

```text
POST /contracts + Idempotency-Key
→ customer lookup
→ contractual validation
→ deterministic installment schedule
→ Contract + Installments + idempotency record
→ atomic commit
```

### Direct payment

```text
POST /payments + Idempotency-Key
→ canonical payment command
→ lock Contract row
→ recheck idempotency
→ load ordered Installments and existing allocations
→ deterministic allocation
→ Payment + PaymentAllocations
→ Installment status projection
→ payment_recorded LedgerEntry
→ idempotency record
→ atomic commit
```

### Stripe webhook

```text
POST /webhooks/stripe + Stripe-Signature
→ preserve exact raw Buffer
→ verify signature
→ reject live mode / acknowledge unsupported type
→ retain supported event evidence
→ acquire processing token or detect busy/terminal delivery
→ validate PaymentIntent mapping
→ RecordPayment
→ Payment + Allocations + Ledger atomic commit
→ finalize webhook event with Payment link
```

The supported financial event is `payment_intent.succeeded`. The current mapping
uses `PaymentIntent.metadata.contract_id`, `amount_received`, and `eur`. Different
Stripe Event deliveries for the same PaymentIntent converge on the same
RecordPayment command identity.

### Direct refund

```text
POST /refunds + Idempotency-Key
→ validate caller Payment, amount, and refundedAt
→ lock the original Payment's Contract row
→ recheck idempotency
→ load original and previously refunded allocations
→ reverse still-reversible amounts by position DESC
→ Refund + RefundAllocations
→ effective Installment projection
→ refund_recorded LedgerEntry
→ idempotency record
→ atomic commit
```

`GET /refunds/:id` returns the immutable Refund and its explicit allocations.
Stripe remains a separate provider-evidence boundary and currently supplies
Payments only; Stripe Refund events are not ingested.

## Transactions and concurrency

PostgreSQL transactions use `READ COMMITTED`.

RecordPayment and RecordRefund lock the owning Contract row with
`SELECT ... FOR UPDATE`. This is the shared serialization boundary for financial
changes against one Contract. Idempotency is checked again after the lock, each
allocation is calculated from coherent effective state, and the financial fact,
allocations, Installment projections, LedgerEntry, and command idempotency record
commit atomically. Concurrent Refunds therefore cannot cumulatively reverse more
than the original Payment allocated.

Gross PaymentAllocation history is not the current paid balance after a Refund.
The projection input is:

```text
effective paid = PaymentAllocations - RefundAllocations
```

Refunds can move Installments from `paid` to `partially_paid` or `pending`, and a
later Payment can allocate against the reopened outstanding amount.

Webhook processing ownership is separate from the RecordPayment transaction. A
conditional PostgreSQL update assigns a random UUID processing token and a
database-clock start time. An active claim is busy; a claim older than 60 seconds
may be replaced. Only the current token may finalize or release the event. This
avoids holding a webhook-event transaction open while RecordPayment executes.

If the financial transaction commits but webhook finalization fails, a retry
reclaims the event and RecordPayment returns the existing Payment through its
idempotency boundary before finalization is attempted again.

## Public error boundary

Malformed transport input maps to `400 INVALID_REQUEST`. Domain validation is
mapped to `422 INVALID_INPUT` only when an application boundary explicitly
classifies it as caller-controlled. Business and missing-resource errors retain
their dedicated mappings. Raw persistence, aggregate-reconstitution, and other
internal validation failures reach the sanitized `500 INTERNAL_ERROR` response.

## Technology and workflow

- Node.js 24.19.0 and TypeScript 7.0.2.
- Fastify 5.11.3 for HTTP.
- PostgreSQL 18.4 in the verified integration-test environment.
- Drizzle ORM 0.45.2 and Drizzle Kit 0.31.4.
- Stripe SDK 22.5.0 for webhook signature verification.
- Vitest 4.1.10 and Testcontainers 12.1.0.
- pnpm 11.20.0 through Corepack.

Schema changes follow:

```text
TypeScript schema
→ build
→ drizzle-kit generate
→ manual SQL review
→ commit
```

The project does not use `drizzle-kit push`.

## Current non-goals

The current architecture does not implement Stripe Refund ingestion, automatic
provider refunds, chargebacks, bank ingestion, reconciliation, analytics,
authentication or RBAC, an AI assistant, a frontend, Redis, queues, workers,
microservices, or public deployment. Stripe ingestion does not create
PaymentIntents or prove provider or bank settlement.
