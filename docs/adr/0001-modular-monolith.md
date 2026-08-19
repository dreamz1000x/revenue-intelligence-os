# ADR-0001: Start with a Modular Monolith

Status: Accepted

## Context

Revenue Intelligence OS is being built during a short portfolio sprint. Its planned domain will grow toward payments, ledger, reconciliation, analytics, and AI, but none of those future areas currently has an operational boundary that requires an independently deployed service.

The governing plan explicitly prefers a small core and rejects accidental complexity. Starting with distributed services would add coordination costs before the product has demonstrated its first financial flow.

## Decision

We will begin with:

- One deployable application.
- Explicit internal domain modules.
- One shared PostgreSQL database.
- Clear internal boundaries between interface, application, domain, and persistence responsibilities.
- Future service extraction only when a demonstrated operational reason justifies it.

The first slice contains the `customers` and `contracts` modules. Module boundaries are part of the architecture even though deployment and persistence are shared.

## Consequences

Benefits:

- Lower initial complexity.
- Simpler financial transactions.
- A straightforward deployment unit.
- More direct debugging.
- Faster implementation during the sprint.

Costs:

- Internal boundaries require deliberate discipline.
- Poorly designed modules could become coupled through shared implementation details.
- Extracting a service later will require explicit design and migration work.

## Alternatives considered

### Microservices from day one

Rejected because there are not yet sufficient operational boundaries. This option would introduce networking, multiple deployments, service coordination, distributed observability, and distributed consistency before those costs solve a demonstrated problem.

### Unstructured monolith

Rejected because a single deployable application does not justify mixing responsibilities. Explicit domain boundaries are required to protect financial rules, keep dependencies understandable, and make future change possible.
