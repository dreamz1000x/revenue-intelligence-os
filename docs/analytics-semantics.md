# Analytics v1 semantics

Analytics v1 exposes deterministic operational read models over the existing
PostgreSQL facts. It adds no analytical persistence, warehouse, materialized
view, dbt project, accounting model, or revenue-recognition model.

Periods are half-open `[periodStart, periodEnd)`. Offset-aware inputs are
normalized to UTC. Contract, Payment, Refund, and external-bank totals use their
business event timestamp and are limited to facts known by `asOf`. Installment
due dates are civil dates compared against the period's UTC dates.

Refunds are reported as a positive gross metric. Net recorded Payments subtract
Refunds from gross recorded Payments. Bank-settled net subtracts exact linked
refund debits from exact linked settlement credits. Orphan movements are not
presented as settled money.

Outstanding exposure is contractual Installment cents less effective paid cents
known by `asOf`; effective paid is gross PaymentAllocations minus
RefundAllocations. Overdue exposure includes only outstanding Installments with
`dueDate` before the UTC civil date of `asOf`. Neither metric is accounting
accounts receivable.

Reconciliation summaries require an explicit Run and reconstruct Finding status
from action history known at `statusAsOf`. Counts include zeros for every v1
rule, severity, and status. There is no implicit latest Run.

The API intentionally does not publish MRR, churn, LTV, recognized revenue,
profit, accounting cash balance, or production-readiness claims.
