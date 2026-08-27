# Revenue Intelligence OS

Revenue Intelligence OS is an evolving backend portfolio project for modelling
financed customer contracts and recording payment effects with explicit,
auditable semantics. The current implementation is a TypeScript modular
monolith backed by PostgreSQL; it is not presented as production-ready.

## What it demonstrates

- Deterministic installment schedules with exact integer-cent conservation.
- PostgreSQL-backed customer and financed-contract persistence.
- Deterministic partial and spanning payment allocation.
- Idempotent customer, contract, and payment commands.
- An immutable financial-effect ledger coupled transactionally to payments.
- Signed Stripe Test Mode webhook ingestion for `payment_intent.succeeded`.
- Byte-for-byte raw webhook evidence retention and duplicate detection.
- Database-backed processing claims, stale-lease recovery, and safe retries.
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

Money is represented as positive integer euro cents. Installment generation and
payment allocation are deterministic, conserve every cent, and reject
overpayment rather than retaining an unapplied balance. A successfully recorded
Payment and its allocations, installment projection, ledger effect, and command
idempotency record commit atomically.

A Payment means that the application accepted and durably recorded an assertion
that money was received for one Contract. It does **not** prove Stripe settlement,
bank settlement, revenue recognition, accounts-receivable accounting, or
reconciliation. See [financial invariants](docs/financial-invariants.md) and
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
| `HOST` | No | Listen address; defaults to `0.0.0.0`. |
| `PORT` | No | Listen port; defaults to `3000`. |

The repository contains no live credentials. `.env.example` contains placeholders
only.

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
snapshot diff. This repository does not use `drizzle-kit push` and currently has
no package script that applies migrations to a database.

## Running

There is no `start` or `dev` package script yet. After applying the committed
migrations to the database referenced by `.env`, build and run the existing
entry point directly:

```sh
corepack pnpm build
node --env-file=.env dist/main.js
```

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
| `POST` | `/webhooks/stripe` | Receive a signed Stripe webhook. |

Customer, contract, and payment creation require an `Idempotency-Key` header.
The Stripe endpoint requires exactly one `Stripe-Signature` header.

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
- [Stripe webhook semantics](docs/stripe-webhook-semantics.md)
- [Modular monolith ADR](docs/adr/0001-modular-monolith.md)
- [Immutable financial-effect ledger ADR](docs/adr/0002-immutable-financial-effect-ledger.md)

## Current limitations

The current backend does not implement refunds, chargebacks, reconciliation,
bank ingestion, analytics, a dashboard, an AI assistant, a frontend, or a public
deployment. Stripe support is deliberately limited to signed Test Mode
`payment_intent.succeeded` ingestion; it does not create PaymentIntents or call
Stripe APIs.

## License

Licensed under the [MIT License](LICENSE).
