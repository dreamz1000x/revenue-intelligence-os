# Security hardening

## 1. Purpose

O4 closes the remaining backend HTTP and baseline production-security controls
before operational exposure. O2 owns Auth0 authentication, role-based access,
and deny-by-default authorization. O3 owns the append-only accountability trail
for authenticated mutations. O4 owns HTTP/API hardening, bounded authenticated
abuse controls, runtime-configuration validation, and the dependency-security
gate. O5 owns structured logging, redaction, and request identifiers. O7 owns
Railway deployment, TLS and edge controls, migrations, and recovery operations.

## 2. Protected assets

Protected assets are financial and domain data, authenticated identities and
authorization boundaries, the immutable financial ledger, the append-only
AuditEvent accountability trail, Stripe webhook evidence and raw-payload
provenance, PostgreSQL data, runtime secrets and configuration, and API
availability.

## 3. Actors

The API recognizes viewer, operator, and admin principals. External actors are
the Stripe webhook sender, the Auth0 identity provider, unauthenticated Internet
clients or attackers, and the application operator or developer responsible for
runtime configuration.

## 4. Trust boundaries and entry points

The principal application path is:

```text
Internet -> Railway edge -> Fastify API -> application/domain -> PostgreSQL
```

Railway edge and TLS behavior are not claimed here; they require O7 evidence.
Auth0 crosses a separate identity boundary at signed JWT verification. Stripe
crosses a provider boundary at exact raw-body signature verification. Entry
points are the authenticated JSON API and the public `POST /webhooks/stripe`
endpoint.

## 5. Implemented controls

Auth0 access tokens are cryptographically verified before a principal is
created. Routes declare viewer, operator, admin, or explicit public policy;
missing policy is denied. Stripe is JWT-independent and authenticates exact raw
bytes with `Stripe-Signature`.

Fastify has an explicit 1 MiB global body limit, a 120-second request receive
timeout, and `trustProxy: false`. Malformed JSON, oversized bodies, unsupported
media types, rate-limit exhaustion, and unexpected failures produce sanitized
400, 413, 415, 429, and 500 responses respectively. Responses include
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and
`Cache-Control: no-store`.

Authenticated routes use a local in-memory limiter keyed only by the verified
Auth0 `subject`: 60 requests per minute generally and 10 per minute for
`POST /reconciliation/runs`. Stripe is excluded from this principal limiter.

Startup configuration is validated before database or application
construction. Required values are the PostgreSQL URL, Stripe webhook secret,
and Auth0 issuer, audience, and roles claim. PostgreSQL URLs require a
`postgres:` or `postgresql:` protocol, and the Auth0 issuer requires HTTPS.
Validation errors identify the variable without exposing its value. `.env` is
ignored, and the tracked example contains no real secret.

The O4 gate audits production dependencies without opportunistic upgrades.
AuditEvent accountability, immutable LedgerEntry financial effects, and Stripe
provider provenance remain separate records with separate meanings.

## 6. CORS posture

CORS is disabled. There is no wildcard origin and no frontend origin yet. An
exact allowlist will be closed immediately before or with the real frontend
boundary. CORS is not an authentication control.

## 7. Accepted v1 risks and limitations

- The in-memory limiter resets on process restart and does not share counters
  between processes. This is acceptable only under the closed single-process
  v1 architecture.
- Stripe is not subject to authenticated-principal rate limiting. Signature
  verification and the body limit remain, while ingress volumetric protection
  is an O7 edge responsibility.
- `trustProxy: false` deliberately ignores forwarded client-IP headers. Railway
  proxy trust semantics require an O7 decision and evidence.
- A business mutation commit and its AuditEvent append are not one atomic
  transaction. The accepted O3 crash window remains documented separately.
- Public errors are sanitized, but future operational logs of unexpected
  non-Stripe errors may contain internal details. Structured logging and
  redaction belong to O5.
- TLS, HSTS, and other deployment-edge controls are not owned by Fastify O4 and
  belong to O7.
- No browser cross-origin allowlist exists until a real frontend origin is
  known.

These are limitations, not implemented mitigations.

## 8. Out of scope

O4 does not add Redis or distributed limiting, WAF or gateway architecture,
deep network security, structured logging or request IDs, health/readiness or
metrics, Railway production configuration, backup/restore, frontend, AI, or
microservices.

## 9. Verification

The final O4 gate ran the production dependency audit, focused security tests,
the TypeScript typecheck, the production build, the complete test suite, and the
Git whitespace check. The production audit found no known vulnerabilities;
typecheck and build passed; and the complete suite passed with 57 files and 520
tests. The Git whitespace check also passed.
