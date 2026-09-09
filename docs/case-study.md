# RIOS v1 engineering case study

## Problem

Financed-contract operations accumulate facts in different systems:
contractual schedules, internal payment assertions, provider events, refunds,
and bank movements. Treating those facts as interchangeable hides
discrepancies. RIOS keeps their meanings separate, preserves evidence, and
makes exact differences investigable.

## Architecture and constraints

RIOS v1 is a TypeScript modular monolith with one PostgreSQL database. Fastify
exposes the API on Railway; a Next.js BFF on Vercel holds Auth0 sessions
server-side and calls the API with access tokens the browser never receives.
Stripe Test Mode sends signed webhooks to the API.

    Browser -> Vercel / Next.js BFF -> Railway / Fastify API -> PostgreSQL
                             <-> Auth0
    Stripe Test Mode -> signed webhook -> Railway / Fastify API

Auth0 is the identity provider, not an API request hop: Next.js uses it for the
session and token acquisition, then calls Railway directly with the bearer
token.

The backend retains explicit interface, application, domain, and persistence
boundaries. A monolith keeps financial transactions local and observable.
Redis, queues, workers, replicas, microservices, and a warehouse were excluded
because no measured v1 requirement justified their coordination cost.

## Hard engineering problems

### Financial correctness

All money uses positive integer EUR cents. Contract schedules conserve the
contract total exactly. Payments allocate by Installment position and reject
unapplied overpayment. Refunds append compensating facts, reverse only the
original Payment's allocations in deterministic reverse order, and can reopen
Installments for repayment.

The immutable financial-effect ledger records one effect for every committed
Payment or Refund. It is intentionally not double-entry accounting and does not
claim settlement, revenue recognition, or accounts receivable.

### Idempotency and concurrency

Commands fingerprint canonical validated inputs. Same key and payload replay;
same key with different payload conflicts. The idempotency record commits with
the business effect.

Payment and Refund transactions use PostgreSQL READ COMMITTED and lock the
owning Contract row. Rechecking idempotency after the lock prevents duplicate
or incoherent allocation. Tests prove same-key convergence, competing
overpayment rejection, bounded concurrent Refunds, and coherent Payment/Refund
races.

### Stripe ingestion

The webhook boundary verifies Stripe-Signature against the exact raw bytes,
accepts only Test Mode payment_intent.succeeded, and preserves original
evidence. PostgreSQL-backed processing claims have stale-lease recovery and
token-guarded finalization. Stripe Event identity remains separate from the
PaymentIntent-derived financial command identity, so delivery replay does not
duplicate money.

### Reconciliation and auditability

Reconciliation compares contractual state, internal financial effects, Stripe
evidence, and simulated bank evidence using five versioned exact rules.
Knowledge-time cutoffs produce immutable Runs with typed Finding evidence.
Operators append acknowledge, resolve, or ignore actions.

Authenticated mutations append a separate AuditEvent derived from the verified
Auth0 subject. Audit events, ledger effects, Stripe provenance, reconciliation
evidence, and operational logs remain distinct records.

## Security, operations, and recovery

Auth0 roles enforce viewer, operator, and admin API policies. Transport
validation is strict, unexpected errors are sanitized, sensitive log fields are
redacted, request IDs are server-generated, bodies are bounded, and
authenticated traffic is rate-limited. Public liveness and database readiness
are separate; metrics are admin-only and bounded.

Railway pre-deploy applies committed Drizzle migrations. Node receives
termination signals directly and Fastify closes the PostgreSQL pool once.
Production migration history, health/readiness, Auth0 RBAC, and a signed Stripe
Test Mode flow were verified during deployment.

Railway-native PITR and volume backups require a paid plan. Under the zero-cost
rule, recovery evidence instead uses a custom-format pg_dump, an isolated local
PostgreSQL restore, and migration, fact, constraint, and trigger validation. No
contractual RPO or RTO is claimed.

## Reproducible evidence

The guarded demo reset accepts only an explicitly confirmed disposable database
whose name ends in _demo. Fixed clocks, IDs, keys, evidence, and actions
reproduce exact financial totals and three known Findings.

The R1 harness measures representative reads, writes, Payment/Refund paths, and
same-Contract contention against local disposable PostgreSQL. Its documented
run had no unexpected failures and showed the cost of Contract serialization.
Those results are not production capacity claims.

The Assistant is a deterministic command interface over explicit API reads. It
has no LLM, RAG, embedding store, arbitrary route, SQL, or financial
interpretation. Authority and RBAC remain in the API.

## Tradeoffs

- Contract locking favors coherent cent allocation over hot-aggregate writes.
- Synchronous Stripe processing is simple but includes database work in webhook
  latency.
- One process and database simplify transactions but provide no HA.
- Process metrics are bounded and cheap but reset on restart.
- Exact reconciliation is explainable but deliberately omits fuzzy matching.
- The deterministic Assistant is safe and testable but not free-form.

## Deliberate exclusions

RIOS has no real bank ingestion, Stripe Refund ingestion, automatic provider
refunds, chargebacks, double-entry accounting, revenue recognition,
MRR/churn/LTV, fuzzy or AI remediation, local passwords, HA, queues, workers, or
production SLOs. The fixed demo and zero-cost deployment demonstrate
engineering decisions; they do not imply customers, revenue, scale, uptime, or
production readiness.

## What it demonstrates

RIOS demonstrates precise domain modeling, integer-money invariants,
transactional persistence, idempotent APIs, concurrency control, durable
provider evidence, deterministic reconciliation, RBAC, append-only auditing,
safe observability, migrations and recovery, reproducible data, measured local
resilience, and a deployed full-stack boundary with honest limitations.
