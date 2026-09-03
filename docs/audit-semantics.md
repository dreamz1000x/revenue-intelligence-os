# Audit trail semantics

O3 adds a durable append-only trail for successful authenticated mutation
commands. An AuditEvent records the verified Auth0 subject, semantic action,
resource type and identifier, first observed command outcome, optional bounded
reason, opaque deduplication digest, and server-clock recording instant.

The audited scope is Customer and Contract creation, Payment and Refund
recording, external-source evidence recording, Reconciliation Run execution,
and acknowledge/resolve/ignore Finding actions. GET requests are not audited.
Stripe webhooks remain public JWT-exempt provider provenance in
`stripe_webhook_events`; their financial effects remain in the financial ledger.
Neither system is replaced by the audit trail.

Actor identity always comes from `request.principal.subject` after Auth0 token
verification and RBAC. It is never accepted from a request body. The audit trail
does not store JWTs, Authorization or Stripe-signature headers, secrets, raw HTTP
bodies, external raw payloads, arbitrary metadata, or plaintext idempotency keys.

For idempotent commands, SHA-256 covers action, actor and the existing command
key. External evidence uses action, actor, source and source-event identity. Only
the lowercase hexadecimal digest is retained. A retry converges on the first
AuditEvent; incompatible immutable semantics under the same digest fail.

PostgreSQL rejects AuditEvent UPDATE and DELETE. `GET /audit/events` is admin-only,
newest-first, and supports bounded exact filters.

O3 intentionally does not claim atomic business-and-audit persistence. The
business adapter commits first and audit append follows before the HTTP response,
leaving a small crash window. Audit failure is propagated. Existing command
idempotency plus audit deduplication makes a client retry safe and able to fill
that missing audit event.
