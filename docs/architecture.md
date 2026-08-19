# Architecture

This document describes the planned architecture for the first vertical slice. The technologies named here have not been installed yet.

## Purpose

The first slice must demonstrate that Revenue Intelligence OS can turn approved financial rules into a small, executable, and verifiable flow:

```text
customer → contract → installment
```

The result must protect the financial invariants in the domain, persist a complete financed schedule atomically, and expose the outcome through a minimal HTTP API and automated tests.

## Scope

The slice includes only:

- Creating a customer.
- Creating a financed contract for an existing customer.
- Validating the approved contractual and financial invariants.
- Generating every installment in the contract schedule.
- Distributing the contractual amount deterministically.
- Calculating monthly civil due dates.
- Persisting the contract and its complete schedule atomically.
- Retrieving a contract with its installments ordered by position.
- Verifying the flow through automated tests and a minimal HTTP API.

The slice does not include a visual frontend, payments, webhooks, external financial sources, asynchronous processing, ledger, reconciliation, analytics, AI, or operational infrastructure beyond what this flow needs.

## Runtime architecture

```text
HTTP request
    ↓
Interface validation
    ↓
Application use case
    ↓
Domain rules
    ↓
Transaction
    ↓
Persistence
    ↓
PostgreSQL
    ↓
Response
```

### HTTP request

Accepts external input for customer creation, financed contract creation, or contract retrieval. Input is untrusted at this boundary.

### Interface validation

Checks the shape and primitive types of the request, including required fields, integer inputs, identifiers, and valid civil-date syntax. It translates transport errors but does not implement financial calculations.

### Application use case

Coordinates the operation. It retrieves the customer when required, invokes domain behavior, establishes the transaction boundary, calls persistence, and returns the completed result.

### Domain rules

Validate the financial terms and generate the complete schedule: installment amounts, remainder distribution, positions, due dates, initial states, and exact preservation of the contractual total. These rules do not depend on HTTP or PostgreSQL.

### Transaction

Defines the atomic boundary for financed contract creation. Any failure before the complete schedule is persisted causes the entire operation to fail.

### Persistence

Writes and retrieves customers, contracts, and installments while preserving their relationships and stable ordering. It does not contain the schedule-generation formulas.

### PostgreSQL

Stores the data, enforces structural constraints, and commits or rolls back the atomic operation.

### Response

Returns only after a successful commit. Contract retrieval returns the contract and its complete installments ordered by position.

## Modular boundaries

The current modular monolith contains two business modules.

### `customers`

Responsibilities:

- The `Customer` concept.
- Validation of `display_name`.
- Customer creation.
- Customer retrieval.
- Customer persistence.

It does not generate contracts, calculate schedules, or own installment rules.

### `contracts`

Responsibilities:

- The `Contract` and `Installment` concepts.
- Validation of contractual and financial terms.
- Complete schedule generation.
- Deterministic monetary distribution.
- Monthly due-date calculation.
- Atomic creation of a contract and its schedule.
- Retrieval of the ordered schedule.

`billing` is not a separate module yet. In this slice, an installment is part of the contractual schedule and has no independent payment behavior. A billing boundary becomes justified only when payments, allocation, collection state, or other operational responsibilities exist.

## Layering

The architecture separates four conceptual responsibilities:

```text
interface
application
domain
persistence
```

- **Interface** owns HTTP-specific validation, request mapping, response mapping, and transport errors.
- **Application** coordinates use cases, dependencies, and transaction boundaries.
- **Domain** owns pure financial and temporal rules and the meaning of the model.
- **Persistence** implements PostgreSQL reads and writes and exposes database failures to the application in a controlled form.

Application and domain are different responsibilities: application coordinates a workflow; domain determines whether that workflow is financially valid. This distinction does not require an artificial proliferation of classes, interfaces, or pass-through abstractions.

Financial rules must be testable without HTTP or PostgreSQL. Transactions belong to application and persistence coordination, not to pure schedule-generation functions.

## Technology decisions

These are planned choices; exact versions remain open.

### Node.js and TypeScript

Node.js provides the runtime for the primary API described by the governing plan. TypeScript makes domain inputs, results, and boundaries explicit while keeping the first application in one language and process.

### Fastify

Fastify provides a small HTTP surface, schema-based request handling, testable request injection, and plugin encapsulation without imposing a large application framework. It keeps the runtime flow visible and is proportionate to the short sprint.

### PostgreSQL

PostgreSQL provides relational integrity, constraints, and the transaction required to create a contract and its complete schedule as one unit.

### Drizzle

Drizzle is the planned query and schema layer because it provides TypeScript-aware access while keeping the relational model, constraints, transactions, and generated migrations visible. The exact package version and migration workflow are not yet selected.

## PostgreSQL responsibilities

PostgreSQL will protect the structural integrity of this slice through:

- Primary keys for customer, contract, and installment.
- Foreign keys from contract to customer and installment to contract.
- `NOT NULL` requirements for mandatory data.
- Uniqueness of `(contract_id, position)`.
- Simple constraints for positive values and the permitted currency and states.
- One atomic transaction for contract and schedule creation.

The domain remains primarily responsible for:

- Generating the complete schedule.
- Preserving the exact contractual total.
- Distributing the remainder deterministically.
- Calculating monthly due dates without cumulative drift.
- Producing the complete sequence of positions from `1` through `installment_count`.

The application validates these properties before persistence, while PostgreSQL provides complementary structural defenses. This slice will not introduce complex database triggers for cross-row financial rules.

## Testing strategy for this slice

The tests derive from the rules in [financial-invariants.md](financial-invariants.md).

### Unit

Unit tests cover pure domain behavior, including input rules, monetary distribution, total preservation, stable positions, and civil due-date generation.

### Integration

Integration tests use real PostgreSQL behavior to verify primary and foreign keys, uniqueness, simple constraints, reads, transaction commit, and rollback after a deliberate failure.

### End-to-end

End-to-end tests exercise the complete HTTP flow: create a customer, create a financed contract, and retrieve the contract with its ordered schedule.

## Deferred architecture

The following components are deliberately postponed:

- Frontend.
- Python service.
- Redis.
- Workers.
- Queues.
- Stripe.
- Ledger.
- Reconciliation.
- Analytics.
- AI assistant.
- External observability.
- Microservices.

They will be introduced only when the implemented behavior creates a real operational boundary or requirement. Their presence in the long-term plan does not justify adding them to the first slice.

## Command idempotency

Both `create customer` and `create financed contract` require a client-provided `Idempotency-Key`. The operation identity is scoped by command type, and a deterministic fingerprint of the canonical validated input detects reuse of a key for a different request.

```text
HTTP request
+ Idempotency-Key
        ↓
interface validation
        ↓
canonical validated input
        ↓
fingerprint
        ↓
application use case
        ↓
idempotency lookup / conflict detection
        ↓
domain rules
        ↓
single PostgreSQL transaction
        ├── idempotency record
        ├── resource
        └── dependent resources
        ↓
commit
        ↓
response
```

For customer creation, the transaction contains the idempotency record and customer. For financed contract creation, it contains the idempotency record, contract, and complete installment schedule. A completed idempotency record cannot be committed without its complete result, and a committed result cannot lose its idempotency association.

PostgreSQL is the only persistent coordination mechanism for this slice. The design does not introduce Redis, distributed locks, queues, or a generic idempotency framework.

### HTTP semantics

- Initial successful creation: `201 Created`.
- Successful retry with the same command type, key, and canonical payload: `200 OK`, returning the associated resource without another effect.
- Same command type and key with a different canonical payload: `409 Conflict`.
- Missing required `Idempotency-Key`: `400 Bad Request`.
- Input that is structurally valid but violates domain rules: `422 Unprocessable Content`.
- Missing customer when creating a contract: `404 Not Found`.

The exact JSON error representation remains outside the current decision.

### Testing implications

The implementation must demonstrate:

- Repeating the same customer command creates one customer.
- Repeating the same contract command creates one contract and one complete schedule.
- Reusing a key with a different payload produces a conflict and no additional resource.
- Different keys with identical payloads remain independent operations.
- A complete rollback leaves the operation retryable.
- A successful commit followed by a lost response can be retried without duplication.
- Concurrent requests with the same key produce one confirmed effect.

## Open implementation decisions

- Exact Node.js version.
- Package manager.
- Exact Fastify and Drizzle versions.
- Schema validation library.
- Migration workflow.
- Test runner.
- PostgreSQL provisioning for integration tests.
- HTTP error contract.
- Permitted format and maximum length of `Idempotency-Key`.
- Exact canonical request representation.
- Fingerprint hash algorithm.
- Precise behavior of a concurrent retry while the first transaction remains open.
- Technical mapping from uniqueness conflicts to the committed result.
