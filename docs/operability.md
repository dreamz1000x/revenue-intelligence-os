# Operability

## Purpose

O6 establishes basic runtime operability primitives for RIOS: liveness,
PostgreSQL readiness, and bounded process-local HTTP metrics. O5 owns structured
logging and request correlation. O7 defines the production deployment,
migration, shutdown, backup, recovery, and operator contract in
[Production deployment and recovery](deployment.md). The base Railway resources
are provisioned, while the first deployment and recovery validation remain
pending.
Native IaC is intentionally deferred because `railway@3.11.0` cannot represent
the required provider-side `preDeployTimeoutSeconds` setting; current provider
configuration remains authoritative.

## Liveness

`GET /health` means that the Fastify process is alive and can serve HTTP. It is
public, requires no JWT, bypasses the authenticated-principal rate limiter, and
performs no dependency checks. It returns HTTP 200 with:

```json
{ "status": "ok" }
```

Liveness must not fail merely because PostgreSQL is unavailable.

Railway should use `/ready`, not `/health`, to gate activation of a deployment.

## Readiness

`GET /ready` means that the instance can serve PostgreSQL-dependent application
traffic. It is public, requires no JWT, and bypasses the authenticated-principal
rate limiter. The route has a 3000 ms handler timeout and performs `SELECT 1`
through the existing PostgreSQL pool.

Success returns HTTP 200 with `{ "status": "ready" }`. Failure returns HTTP 503
with `{ "status": "not_ready" }` and emits the safe WARN event
`readiness_check_failed`. Neither the response nor that event exposes the SQL
error, database hostname or name, credentials, URL, or stack. O6 does not claim
query-cancellation guarantees.

## Why Auth0 and Stripe are not readiness dependencies

PostgreSQL is the critical internal runtime dependency for core RIOS traffic.
Auth0 provider availability is not actively probed during local token
verification. Stripe is an inbound integration and readiness must not call it.

## Startup and graceful shutdown

Startup validates runtime configuration, creates dependencies, and begins
listening without an eager PostgreSQL ping. `/ready` is the admission check for
database-dependent traffic.

Both `SIGTERM` and `SIGINT` request the same graceful shutdown. `app.close()` is
invoked exactly once even if more than one signal arrives, and Fastify's
`onClose` lifecycle closes the PostgreSQL pool. Successful shutdown exits
naturally. If closing fails, only the fixed `graceful_shutdown_failed` event is
emitted and the process exit code becomes 1; arbitrary error objects are not
logged.

## Metrics

`GET /metrics` is an ADMIN-only, normally rate-limited JSON endpoint. It returns:

```json
{
  "uptimeSeconds": 0,
  "http": {
    "completedRequestsTotal": 0,
    "responsesByStatusClass": {
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
      "other": 0
    }
  }
}
```

Values shown are illustrative non-negative integers. Metrics are process-local,
reset on restart, and are neither accounting records nor AuditEvents. They are
not persisted.

## Cardinality discipline

The only response-status buckets are `2xx`, `3xx`, `4xx`, `5xx`, and `other`.
O6 deliberately creates no dynamic labels or keys from routes, customers,
users, principals, request IDs, payment IDs, provider event IDs, or arbitrary
HTTP status codes. This keeps cardinality bounded.

## Counter lifecycle semantics

Counters increment in Fastify's `onResponse` hook. Every completed HTTP response
counts, including health, readiness, and metrics responses. A metrics request is
recorded after its response snapshot is produced, so that scrape appears in a
later snapshot. O6 does not count request starts.

## Security posture

Health and readiness are public so infrastructure probes do not depend on
Auth0, and both explicitly bypass authenticated-principal limiting. Metrics
remain ADMIN-only because no private monitoring network or scraper has been
established. Operational endpoints expose no secrets, user information,
financial values, database or provider details, or request IDs. Existing O4
security headers apply and CORS remains absent.

## Accepted limitations

- Metrics reset on process restart and are not shared between processes.
- There is no distributed aggregation or Prometheus endpoint.
- There are no latency histograms, database-pool metrics, or business/financial
  metrics.
- There is no external monitoring or alerting.
- Railway deployment health/readiness settings are configured but remain
  unverified until the first deployment. Backups and recovery have a documented
  operator contract but are not yet validated against the real project.

## Verification

The final O6 gate records the production dependency audit, typecheck, build,
complete test-suite totals, and Git whitespace check after they run.
