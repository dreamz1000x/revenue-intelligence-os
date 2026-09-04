# Revenue Intelligence OS

Revenue Intelligence OS is an evolving backend portfolio project for modelling
financed customer contracts and recording payment and refund effects with
explicit, auditable semantics. The current implementation is a TypeScript modular
monolith backed by PostgreSQL; it is not presented as production-ready.

## What it demonstrates

- Deterministic installment schedules with exact integer-cent conservation.
- PostgreSQL-backed customer and financed-contract persistence.
- Deterministic partial and spanning payment allocation.
- Deterministic partial, full, and repeated refund allocation.
- Idempotent customer, contract, payment, and refund commands.
- An immutable financial-effect ledger coupled transactionally to Payments and
  Refunds.
- Signed Stripe Test Mode webhook ingestion for `payment_intent.succeeded`.
- Byte-for-byte raw webhook evidence retention and duplicate detection.
- Database-backed processing claims, stale-lease recovery, and safe retries.
- Deterministic Reconciliation v1 Runs across contractual, internal-effect,
  Stripe-provider, and simulated external-bank evidence.
- Typed Findings with immutable evidence references and an ordered,
  idempotent operator-resolution history.
- Versioned operational analytics with explicit period and knowledge-time
  semantics, plus a guarded reproducible demo dataset.
- Automated unit, integration, migration, and HTTP-flow tests.

## Current architecture

The application is one modular monolith with one PostgreSQL database. Its main
flow separates four responsibilities:

```text
interface → application → domain → persistence
```

Domain code owns financial and temporal rules. Application use cases coordinate
workflows and transaction boundaries. Persistence uses PostgreSQL at
`READ COMMITTED`; HTTP is exposed through Fastify. See
[ADR-0001](docs/adr/0001-modular-monolith.md) for the deployment decision and
[ADR-0002](docs/adr/0002-immutable-financial-effect-ledger.md) for the current
ledger model.

## Financial guarantees

Money is represented as positive integer euro cents. Installment generation,
payment allocation, and refund reversal are deterministic and conserve every
cent. Payments reject overpayment; Refunds reject amounts beyond the original
Payment's still-reversible amount. Each financial command, its allocations,
installment projection, ledger effect, and idempotency record commit atomically.

PaymentAllocations preserve gross accepted history. RefundAllocations preserve
compensating history without rewriting it. Current installment paid state is
derived as gross PaymentAllocations minus RefundAllocations, so a Refund can
reopen an Installment and a later Payment can repay it. See
[Refund semantics](docs/refund-semantics.md).

A Payment means that the application accepted and durably recorded an assertion
that money was received for one Contract. It does **not** prove Stripe settlement,
bank settlement, revenue recognition, or accounts-receivable accounting.
Reconciliation compares retained evidence; it does not turn a Payment into
settlement proof. See [financial invariants](docs/financial-invariants.md) and
[ledger semantics](docs/ledger-semantics.md).

## Stripe webhook support

`POST /webhooks/stripe` currently accepts signed Stripe Test Mode events. The
endpoint verifies the `Stripe-Signature` header against the exact raw request
buffer. Supported `payment_intent.succeeded` evidence is retained byte-for-byte,
and event identity, processing claims, retry behavior, and terminal states are
coordinated in PostgreSQL.

The current demo mapping reads the Contract ID from
`PaymentIntent.metadata.contract_id`. Other event types are acknowledged without
a financial effect; live-mode events are rejected. See
[Stripe webhook semantics](docs/stripe-webhook-semantics.md) for the precise
boundary and recovery behavior.

## Requirements

- Node.js `24.19.0` (pinned in `.node-version`).
- Corepack with pnpm `11.20.0` (pinned in `package.json`).
- A Docker-compatible runtime for PostgreSQL-backed integration tests.
- For the running application, an accessible PostgreSQL database with the
  committed migrations applied.

## Setup

```sh
corepack enable
corepack pnpm install
```

Copy `.env.example` to the ignored `.env` file and replace its deliberately fake
credentials with local values. The application does not load `.env` by itself;
the running command below uses Node's `--env-file` option.

## Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe CLI or Test Mode webhook signing secret. |
| `AUTH0_ISSUER` | Yes | HTTPS issuer URL for the Auth0 tenant. |
| `AUTH0_AUDIENCE` | Yes | Expected Auth0 API audience. |
| `AUTH0_ROLES_CLAIM` | Yes | Auth0 access-token claim containing RIOS roles. |
| `LOG_LEVEL` | No | Structured log level: `debug`, `info`, `warn`, or `error`; defaults to `info`. |
| `HOST` | No | Listen address; defaults to `0.0.0.0`. |
| `PORT` | No | Listen port; defaults to `3000`. |

Secrets belong in environment configuration and must not be committed. The
repository contains no live credentials; `.env.example` contains placeholders only.

## Database migrations

Schema changes follow this workflow:

```text
TypeScript schema
→ build
→ drizzle-kit generate
→ manual SQL review
→ commit
```

`corepack pnpm db:generate` performs the build and migration generation steps.
Run it only for an intentional schema change and review every generated SQL and
snapshot diff. This repository does not use `drizzle-kit push`. After building,
apply the reviewed, committed migrations to the configured database with:

```sh
corepack pnpm db:migrate
```

## Running

After applying the committed migrations to the database referenced by `.env`,
build and start the service:

```sh
corepack pnpm build
node --env-file=.env dist/main.js
```

The Railway production Start Command is `node dist/main.js`, so the Node process
receives termination signals directly. The package `start` script is an
equivalent convenience command, not the Railway Start Command. Production
configuration is injected by the platform rather than loaded from `.env`.

With the example `HOST` and `PORT`, the service listens on
`http://127.0.0.1:3000`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/customers` | Create a customer. |
| `GET` | `/customers/:customerId` | Retrieve a customer. |
| `POST` | `/contracts` | Create a financed contract and installment schedule. |
| `GET` | `/contracts/:contractId` | Retrieve a contract and ordered installments. |
| `POST` | `/payments` | Record and allocate a payment. |
| `GET` | `/payments/:id` | Retrieve a payment and its allocations. |
| `POST` | `/refunds` | Record and allocate a refund against one Payment. |
| `GET` | `/refunds/:id` | Retrieve a refund and its allocations. |
| `POST` | `/webhooks/stripe` | Receive a signed Stripe webhook. |
| `POST` | `/external-source-events` | Record or replay simulated external evidence. |
| `GET` | `/external-source-events/:id` | Retrieve retained external evidence. |
| `POST` | `/reconciliation/runs` | Execute or replay a global v1 Run at a cutoff. |
| `GET` | `/reconciliation/runs` | List Runs. |
| `GET` | `/reconciliation/runs/:id` | Retrieve one Run. |
| `GET` | `/reconciliation/findings` | List Findings using exact filters. |
| `GET` | `/reconciliation/findings/:id` | Retrieve typed evidence and action history. |
| `POST` | `/reconciliation/findings/:id/actions` | Acknowledge, resolve, or ignore a Finding. |
| `GET` | `/analytics/financial-summary` | Retrieve versioned financial and exposure metrics. |
| `GET` | `/analytics/contracts/:id/timeline` | Retrieve one deterministic Contract timeline. |
| `GET` | `/analytics/reconciliation-summary` | Retrieve counts for an explicit reconciliation Run. |
| `GET` | `/audit/events` | Admin-only filtered AuditEvent history. |

Customer, contract, payment, and refund creation require an `Idempotency-Key`
header. The Stripe endpoint requires exactly one `Stripe-Signature` header.
Reconciliation Run creation and Finding actions also require `Idempotency-Key`.

`POST /refunds` accepts `paymentId`, positive integer `amountCents`, and an
offset-aware `refundedAt` instant. It returns `201` when created and `200` when
the same key and canonical payload are replayed. Missing original Payments,
over-refunds, conflicting idempotency payloads, and invalid application input
use stable public errors; unexpected internal failures are sanitized.

## Verification

```sh
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
```

The test command runs the complete Vitest suite. Integration and migration tests
start disposable PostgreSQL 18.4 containers through Testcontainers, so the
Docker-compatible runtime must be available.

## Documentation

- [Problem definition and implemented boundary](docs/problem.md)
- [Financial invariants](docs/financial-invariants.md)
- [Ledger semantics](docs/ledger-semantics.md)
- [Refund semantics](docs/refund-semantics.md)
- [Stripe webhook semantics](docs/stripe-webhook-semantics.md)
- [Reconciliation semantics](docs/reconciliation-semantics.md)
- [Analytics semantics](docs/analytics-semantics.md)
- [Audit trail semantics](docs/audit-semantics.md)
- [Production deployment, migration, backup, and recovery](docs/deployment.md)
- [Operability](docs/operability.md)
- [Modular monolith ADR](docs/adr/0001-modular-monolith.md)
- [Immutable financial-effect ledger ADR](docs/adr/0002-immutable-financial-effect-ledger.md)

## Current limitations

The Railway project `revenue-intelligence-os` and its `production` environment
have been provisioned with the `api` service, private PostgreSQL service and
volume, public API domain, and required runtime variables. The first production
deployment and migrations have not run, deployment verification and a recovery
drill have not been completed, and RIOS is not production-ready. The current
backend does not implement chargebacks, real bank ingestion, a dashboard, an AI
assistant, or a frontend. Stripe support is deliberately limited to
signed Test Mode `payment_intent.succeeded` ingestion: it does not ingest Stripe
Refund events, initiate provider refunds, create PaymentIntents, or call Stripe
APIs. Recorded Payments and Refunds do not prove provider or bank settlement,
revenue recognition, or automatic remediation. Reconciliation v1 performs exact,
deterministic comparison only; it has no fuzzy matching or AI decision-making.
Analytics v1 does not claim MRR, churn, LTV, recognized revenue, accounting cash
balance, or production readiness.

Railway native IaC was evaluated during O7 but is intentionally deferred:
`railway@3.11.0` cannot represent the required provider-side
`preDeployTimeoutSeconds` setting. The current Railway provider configuration
remains authoritative until the SDK officially supports that field.

## License

Licensed under the [MIT License](LICENSE).
