# Final portfolio verification

This checklist separates recorded evidence from checks that should be repeated
at final handoff. It does not turn the portfolio deployment into an SLA.

## Previously verified

- Railway API and PostgreSQL services reached active state.
- GET /health and GET /ready returned HTTP 200 after deployment.
- All eight committed migrations appeared in production Drizzle history.
- A real Auth0 admin received 200 and a viewer received 403 from
  GET /audit/events.
- A signed Stripe Test Mode payment_intent.succeeded delivery produced one
  Payment, its allocation, and a paid Installment.
- A provider-independent pg_dump was restored into separate local PostgreSQL
  and validated without changing production.
- The deterministic demo reproduced stable IDs, totals, Findings, and lifecycle
  state on consecutive resets.
- The documented local R1 run had zero unexpected operation failures and one
  expected overpayment conflict.

Detailed evidence and limitations live in
[deployment](deployment.md), [demo](demo.md), and
[load/resilience](load-resilience.md).

## Final manual confirmation

- [ ] Open https://revenue-intelligence-os-nine.vercel.app.
- [ ] Confirm an unauthenticated product route redirects to Auth0 and logout
  clears the application session.
- [ ] Sign in as viewer; confirm reads work, Audit is hidden, and direct Audit
  access is denied.
- [ ] Sign in as admin; confirm Audit and Operations are accessible.
- [ ] Confirm https://api-production-6efe0.up.railway.app/health and
  https://api-production-6efe0.up.railway.app/ready are reachable.
- [ ] Confirm unauthenticated GET /metrics is rejected and admin access works
  without exposing sensitive data.
- [ ] On isolated local *_demo PostgreSQL, follow
  [the deterministic walkthrough](demo.md).
- [ ] In /assistant, run /help, /revenue, /customer 1, /contract 1, /payment 1,
  and /status; verify /audit is admin-only.
- [ ] Confirm the latest GitHub Actions run for main is green.
- [ ] Confirm local main equals origin/main and Git status is clean.
- [ ] Confirm no .env, .vercel, dump, credential, private plan, or local-machine
  artifact is tracked.
- [ ] Confirm every README and documentation-index link resolves.

## Interpretation

A checked item records one bounded observation. It does not establish
continuous monitoring, availability, production capacity, a frontend SLO,
contractual RPO/RTO, or paid Railway backup capability.
