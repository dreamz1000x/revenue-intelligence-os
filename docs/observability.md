# Observability

## Purpose

O5 establishes basic operational traceability for the single-process RIOS
backend. Structured logs answer what happened technically during a request;
the O3 `AuditEvent` history separately records which authenticated actor
performed an accountable mutation. O6 owns health, readiness, and metrics.
O7 owns production deployment, edge configuration, and any log-retention
decisions.

## Logging architecture

RIOS uses Fastify's built-in Pino integration and emits structured JSON to the
process standard output and error streams. `LOG_LEVEL` accepts `debug`, `info`,
`warn`, or `error` and defaults to `info`. O5 does not configure centralized log
storage or retention.

## Request identity and correlation

Fastify's `genReqId` generates a UUID for every HTTP request using Node's
`crypto.randomUUID()`. Logs expose it as `requestId`. Incoming `request-id`,
`x-request-id`, and `x-correlation-id` headers do not control this value.

`requestId` is the sole synchronous correlation identifier in RIOS v1. A
separate trace or correlation ID would add no useful boundary while the system
runs as one process without queues, workers, or microservices.

## Safe serialization

Request lifecycle logs contain only the HTTP method, the URL path without its
query string, and `requestId`. Response lifecycle logs contain only the status
code and `requestId`.

Logs do not intentionally serialize request headers, query values, parameter
objects, bodies, raw bodies, principal objects, roles, response headers, or
response bodies.

## Redaction policy

Logging first avoids serializing sensitive data. Pino redaction then removes
known dangerous fields as defense in depth, including Authorization, cookies,
`Stripe-Signature`, `Set-Cookie`, tokens, access tokens, passwords, secrets,
`stripeWebhookSecret`, `databaseUrl`, and `rawPayload` where applicable.

This policy does not automatically protect arbitrary future field names. New
logs must continue to use explicit safe-field allowlists and minimization.

## Error logging

O4's sanitized public error responses remain unchanged. An unexpected
non-Stripe technical failure emits an ERROR event named `request_failed` with
`INTERNAL_ERROR` and a safe error type. It does not serialize an arbitrary
error message, cause, custom properties, or the complete Error object. Stripe
unexpected-error logging remains fixed and payload-free.

## Operational events

### Stripe

`stripe_webhook_processed` records only the provider name, provider event ID,
provider event type, and one of these outcomes:

- `processed` at INFO;
- `ignored` at INFO;
- `busy` at WARN.

### Reconciliation

`reconciliation_run_completed` records at INFO only the safe run identifier and
the coarse outcome already returned by the application operation.

Authenticated mutations are not all logged separately. `AuditEvent` already
owns actor accountability, and broad mutation logging would duplicate those
semantics and add noise.

## Severity conventions

- DEBUG: diagnostic detail.
- INFO: normal request, business, or provider operational completion.
- WARN: retryable or degraded conditions, such as rate limiting or Stripe busy,
  where logged.
- ERROR: unexpected technical failure.

## Security boundaries

Logs do not intentionally contain JWTs, Authorization values, Stripe
signatures, raw provider payloads, database URLs or credentials, application
secrets, request-body content, or PII by default. Future logging additions must
preserve the same allowlist and minimization approach.

## Accepted limitations

O5 intentionally provides no distributed tracing, `traceparent` or W3C trace
context propagation, external log aggregation, retention policy, alerting,
metrics, health or readiness endpoints, AsyncLocalStorage context layer, or
global provider-call instrumentation. Request correlation ends at the current
synchronous process boundary. These concerns belong to later operability and
deployment evolution.

## Verification

The final O5 gate verifies the production dependency audit, typecheck, build,
complete test suite, and Git whitespace check. The resulting counts and status
are recorded in the O5 review rather than duplicated here as a value that can
become stale.
