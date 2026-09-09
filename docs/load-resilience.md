# Local load and resilience evidence

## Purpose and scope

R1 provides reproducible local evidence for the concurrency and reliability
properties already implemented by RIOS. It exercises application and PostgreSQL
persistence paths against a disposable database. It does not benchmark Railway,
Vercel, Auth0, Stripe, network transit, or browser rendering, and it is not a
production capacity claim.

The harness uses Node built-ins and existing repository dependencies. No load
testing framework, service, infrastructure, or financial rule is added.

## Why application and persistence paths

Authenticated HTTP routes require real Auth0 access tokens and are globally
limited to 60 requests per minute per verified principal. Disabling either
control would measure a configuration that RIOS does not run. Direct
application/persistence execution preserves validation, idempotency,
transactions, allocation, ledger writes, PostgreSQL constraints, and
`SELECT ... FOR UPDATE` behavior while excluding authentication, rate-limit,
HTTP serialization, and network latency.

Public `/health` and `/ready` are unsuitable throughput representatives:
`/health` intentionally performs no dependency work and `/ready` is a
bounded availability probe rather than an application read.

## Reproduction

Prerequisites are the normal repository toolchain plus a running
Docker-compatible runtime. The harness starts `postgres:18.4`, creates the
`rios_r1` disposable database, applies all committed migrations, seeds the
deterministic demo, runs the matrix, closes the pool, and removes the container.
No connection string or credential is printed.

```powershell
corepack pnpm r1:load
```

Optional positive integers tune the bounded run:

```powershell
$env:R1_OPERATIONS = "40"
$env:R1_CONCURRENCY = "8"
$env:R1_WARMUP = "10"
corepack pnpm r1:load
```

Defaults are 50 operations, concurrency 8, and 10 read warmups. Setup records
needed by a workload are created outside its timed interval. Console output is
newline-delimited JSON with count, concurrency, successes, expected conflicts,
unexpected failures, elapsed time, operations/second, and p50/p95/p99/maximum
per-operation latency. The process exits non-zero for setup or unexpected
workload failures; an explicitly classified business rejection is evidence, not
an infrastructure failure.

## Recorded environment

Measurements below were captured on 2026-09-09 with:

- Windows 11 Home;
- Intel Core i7-1165G7, 4 cores / 8 logical processors;
- 15.8 GiB visible memory;
- Node.js 24.19.0 and pnpm 11.20.0;
- Docker Desktop 4.87.0, Docker Engine 29.7.2 under WSL2;
- disposable PostgreSQL image `postgres:18.4`;
- RIOS commit `6e1c9a7`;
- 40 operations, concurrency 8, and 10 warmups.

This is one local-machine observation, not a statistically rigorous multi-run
benchmark.

## Workloads and results

| Workload | Concurrency | Count | Success | Expected conflict | Unexpected failure | Ops/s | p50 ms | p95 ms | p99 ms | Max ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Customer lookup | 1 | 40 | 40 | 0 | 0 | 1,725.95 | 0.50 | 1.11 | 1.33 | 1.33 |
| Financial summary | 1 | 40 | 40 | 0 | 0 | 284.51 | 3.25 | 4.52 | 5.39 | 5.39 |
| Customer lookup | 8 | 40 | 40 | 0 | 0 | 1,601.76 | 1.95 | 20.00 | 21.76 | 21.76 |
| Financial summary | 8 | 40 | 40 | 0 | 0 | 964.49 | 7.19 | 13.34 | 15.92 | 15.92 |
| Independent Customer creation | 8 | 40 | 40 | 0 | 0 | 764.43 | 10.16 | 12.87 | 13.19 | 13.19 |
| Payments on independent Contracts | 8 | 40 | 40 | 0 | 0 | 297.23 | 26.93 | 28.29 | 29.14 | 29.14 |
| Payments on one shared Contract | 8 | 40 | 40 | 0 | 0 | 101.35 | 73.29 | 88.22 | 91.79 | 91.79 |
| Refunds on independent Contracts | 8 | 40 | 40 | 0 | 0 | 218.12 | 37.11 | 38.74 | 38.86 | 38.86 |
| Competing €0.70 Payments against €1.00 outstanding | 2 | 2 | 1 | 1 | 0 | 116.51 | 12.93 | 17.00 | 17.00 | 17.00 |

Observed unexpected error rate was 0% across 322 timed operations. The final
workload deliberately submits two different-key €0.70 Payments to the same
€1.00 Contract. PostgreSQL serializes them: one commits and the other is
correctly rejected as `PaymentExceedsOutstandingError`. It creates no
over-allocation merely to improve throughput.

## Interpretation

Customer lookup is the lightest path. The financial summary performs several
bounded aggregate queries and costs more per operation, although this small
local dataset benefits from cache and low network distance.

Independent financial mutations can use separate Contract locks. Payments
against one Contract share its row lock and therefore serialize as designed.
In this run, shared-Contract throughput was about 34% of independent-Contract
throughput, while p50 latency rose from 26.93 ms to 73.29 ms. That difference is
expected evidence of the aggregate-level consistency boundary, not a deadlock
or lost-update failure. The shared workload also reads a growing retained
allocation history, so the result must not be attributed to lock waiting alone.

The Refund workload covers original-Payment lookup, Contract locking,
descending reverse allocation, Installment projection, ledger append, and
idempotency persistence. All independent Refunds committed without
infrastructure failure. Existing focused integration tests separately prove
that concurrent Refunds on one Payment cannot exceed its reversible amount and
that Payment/Refund races leave coherent effective paid state.

## Bottlenecks and limits

- One Contract is the intentional serialization unit for Payment and Refund
  mutations; hot Contracts trade throughput for coherent cent allocation.
- Financial mutations reload retained allocation history. Very long-lived,
  high-activity Contracts were not characterized by this small run.
- PostgreSQL pool sizing uses the `pg` default because RIOS does not tune it.
- Results include local Docker/WSL2 scheduling and a warm local database cache.
- The operation count is intentionally small and reports no sustained-load,
  soak, memory-growth, connection-exhaustion, failover, or recovery behavior.
- Percentiles over 40 samples are descriptive only. Repeat runs and larger
  samples would be needed for capacity planning.
- The harness does not measure Auth0 verification, the 60/minute HTTP
  principal limit, audit append latency, TLS, provider/network latency, or
  frontend behavior.
- No PostgreSQL outage is injected. Readiness failure behavior and transactional
  rollback are covered by focused tests rather than artificial benchmark
  infrastructure.

## Conclusion

The observed local run supports the existing claim that independent aggregates
can progress concurrently while Payment and Refund mutations on the same
Contract are serialized. The expected overpayment conflict remained bounded,
and no unexpected operation failed. These measurements are local development
evidence only; they do not establish production throughput, latency objectives,
availability, RPO/RTO, or a contractual service level.
