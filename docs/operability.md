# Operability

## Purpose

O6 establishes basic runtime operability primitives for RIOS: liveness,
PostgreSQL readiness, and bounded process-local HTTP metrics. O5 owns structured
logging and request correlation. O7 will own deployment, Railway integration,
production probes, external monitoring, alerting, backup and recovery, and the
operational runbook. Production deployment is not complete in O6.

## Liveness

`GET /health` means that the Fastify process is alive and can serve HTTP. It is
public, requires no JWT, bypasses the authenticated-principal rate limiter, and
performs no dependency checks. It returns HTTP 200 with:

```json
{ "status": "ok" }
```

Liveness must not fail merely because PostgreSQL is unavailable.

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
- There is no external monitoring, alerting, or Railway probe configuration.
- Backup/recovery procedures and a deployment runbook remain future O7 work.

## Verification

The final O6 gate records the production dependency audit, typecheck, build,
complete test-suite totals, and Git whitespace check after they run.
