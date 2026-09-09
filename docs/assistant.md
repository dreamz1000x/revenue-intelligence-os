# Deterministic operations assistant

The RIOS Assistant is a deterministic operations assistant backed by explicit
RIOS API commands. It is a compact command interface inside the authenticated
web dashboard, not an AI chatbot.

It performs no natural-language inference, probabilistic generation, financial
calculation, arbitrary SQL, or arbitrary code execution. It uses no LLM, RAG,
embedding model, vector database, agent framework, or external AI service.

## Commands

| Command | Existing API | Result |
| --- | --- | --- |
| `/help` | None | Exact supported command list |
| `/revenue` | `GET /analytics/financial-summary` | Backend-calculated current UTC-year metrics |
| `/customer <id>` | `GET /customers/:customerId` | One Customer |
| `/contract <id>` | `GET /contracts/:contractId` | One Contract and ordered Installments |
| `/payment <id>` | `GET /payments/:id` | One Payment and allocations |
| `/status` | `GET /health` and `GET /ready` | Bounded liveness and PostgreSQL readiness |
| `/audit` | `GET /audit/events?limit=100` | Recent authenticated mutation audit events |

Commands are trimmed and case-normalized, must start with `/`, and accept only
the documented shape. Record identifiers must be canonical positive safe
integers: zero, negative numbers, decimals, leading zeros, additional
arguments, and out-of-range values are rejected. There are no aliases or fuzzy
matches. Unknown input returns bounded guidance to use `/help`.

## Execution and authority

The parser selects from a closed command union. A Next.js Server Action maps
that command to one fixed API path. Authenticated reads use the existing
`riosFetch` boundary. The `/status` command uses bounded, unauthenticated
server-side requests to the existing public `/health` and `/ready` probes so
it can distinguish the backend's explicit `503 not_ready` response from a
transport failure. The Assistant page itself remains session-protected. The
browser cannot supply an arbitrary backend route and never receives the RIOS
access token. Auth0 session handling, safe public errors, and the backend’s
financial semantics remain unchanged.

`/revenue` displays only metrics returned by Analytics v1. It does not infer
meaning, forecast results, or recompute cents in the browser. `/status` uses
the public operational probes and deliberately does not expose admin metrics.

## RBAC

The Assistant route is inside the existing authenticated product shell.
Customer, Contract, Payment, revenue, and status reads remain available to the
same authenticated viewer boundary as their underlying APIs.

`/audit` is deny-by-default unless the verified principal has the exact
`admin` role. The Server Action checks that role before requesting audit data,
and the backend independently retains its ADMIN policy. Viewer and operator
roles receive a bounded denial and no audit records.

## Presentation boundary

Results reuse the existing RIOS record and table primitives. At most 20 results
are retained in in-memory page state; refreshing clears them. There is no
assistant conversation persistence, typing simulation, generated “thinking,”
bot persona, or decorative avatar.

## Why v1 has no LLM

The supported tasks already map exactly to authoritative read APIs. A
deterministic grammar is easier to test, cannot invent unsupported operations,
and keeps authorization and financial truth at their existing boundaries.
Adding a model, retrieval layer, or agent framework would introduce ambiguity,
data-governance questions, cost, and infrastructure without solving a current
operational requirement.

## Limitations

The command set is intentionally read-only and fixed. It cannot create or
modify financial records, execute reconciliation actions, query arbitrary
filters, interpret free-form language, explain financial results, or suggest
remediation. It does not replace the normal product pages or backend
authorization. API/provider availability and the current Auth0 session still
govern execution.
