# ADR 0003 — Next.js BFF frontend

## Context

RIOS needs a professional browser interface over its existing financial and
operational API. It does not need another business backend, browser-held bearer
tokens, a repository-wide restructure, or a deep realtime frontend platform.

## Decision

Add a standalone Next.js App Router package under `web/` while leaving the
Fastify backend at the repository root. Vercel is the intended frontend host;
Railway continues to host the API and PostgreSQL.

Auth0 uses a dedicated Regular Web Application named `RIOS Web`. The official
Auth0 Next.js SDK owns an encrypted HTTP-only session. Server Components and
Server Actions obtain the API access token server-side and call explicit RIOS
API paths. Tokens, client secrets, database credentials, and Stripe secrets are
never exposed to browser code.

The frontend reads authoritative roles from protected `GET /me`. Role-aware
navigation and controls improve UX, but Fastify policies remain the security
boundary. Financial calculations remain backend-owned; the frontend formats
integer cents and UTC timestamps without recreating business semantics.

## Alternatives considered

### Browser SPA with local token storage

Rejected because it expands the token-exposure surface and duplicates session
management already provided by the official server SDK.

### Move the backend into a monorepo workspace

Rejected because the current root build is Railway's verified production
contract. The independent `web/` package and lockfile avoid coupling the API
deployment to the frontend build.

### Rich client state and component frameworks

Rejected because server rendering, native forms, CSS, and a small component set
cover the bounded operational workflow without Redux, Tailwind, or a large UI
dependency surface.

## Consequences

- Vercel requires provider-side Auth0 and environment configuration before a
  real browser login smoke test can close the external gate.
- The UI intentionally uses lookup/inspector workflows where the API has no
  list endpoint; it does not add broad CRUD solely for presentation.
- Mutations generate fresh idempotency keys on the Next.js server and are never
  retried automatically.
- Frontend CI is explicit and does not change Railway's root `pnpm build`.
