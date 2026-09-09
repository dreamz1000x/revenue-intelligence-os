# Deterministic public demo

The RIOS demo is a reproducible financial-operations fixture for reviewers. It
creates a small, fixed set of contractual, internal-payment, Stripe-provider,
refund, simulated-bank, and reconciliation evidence so the system can be
inspected without inventing records by hand.

It is a demonstration dataset, not production data and not a connection to a
real bank or payment provider.

## Safe reset

The reset command is deliberately destructive and accepts only an explicitly
approved demo target. It requires:

- `RIOS_DEMO_RESET=YES`;
- a PostgreSQL database name ending in `_demo`;
- a local host (`localhost`, `127.0.0.1`, or `::1`), unless a separately
  disposable host is explicitly approved with
  `RIOS_DEMO_DISPOSABLE_HOST=YES`.

For a local disposable database, after applying the committed migrations:

```powershell
$env:DATABASE_URL = "postgresql://demo_user:demo_password@127.0.0.1:5432/rios_demo"
$env:RIOS_DEMO_RESET = "YES"
corepack pnpm demo:reset
```

The credentials above are illustrative placeholders. **Never point
`demo:reset` at production or at a database containing data that must be
retained.** The command truncates only the known RIOS tables with
`RESTART IDENTITY CASCADE`, then rebuilds the fixture through application use
cases. It never runs automatically.

## Stable fixture

After a reset, PostgreSQL identities and the returned fixture identifiers are
stable:

| Record | ID | Deterministic facts |
| --- | ---: | --- |
| Demo Customer One | Customer 1 | Contract 1 |
| Demo Customer Two | Customer 2 | Contract 2 |
| Demo Customer Three | Customer 3 | Contract 3 |
| Contract 1 | 1 | €120.00, three €40.00 installments |
| Contract 2 | 2 | €90.00, three €30.00 installments |
| Contract 3 | 3 | €60.00, two €30.00 installments |
| Stripe-backed Payment | 1 | €120.00 against Contract 1 |
| Repayment after Refund | 2 | €30.00 against Contract 1 |
| Direct partial Payment | 3 | €40.00 against Contract 2 |
| Refund | 1 | €30.00 against Payment 1 |
| Reconciliation Run | 1 | cutoff `2026-08-31T23:59:59.999Z` |

Contract 1 is fully funded by retained Stripe success evidence, refunded by
€30.00, and then repaid by €30.00. Contract 2 receives a direct €40.00 Payment.
Contract 3 remains unpaid. The simulated bank evidence contains a matching
€120.00 settlement, a €35.00 settlement linked to the €40.00 Payment, a €30.00
refund debit, and an unrelated €7.00 movement.

The fixture uses fixed clocks, timestamps, source IDs, Stripe Test Mode IDs,
idempotency keys, actor IDs, and reasons. Resetting and seeding twice produces
the same returned IDs and the same tested results.

## Golden financial truth

Analytics v1 evaluates the fixture over the fixed demo period
`[2026-05-01T00:00:00.000Z, 2026-09-01T00:00:00.000Z)`, with knowledge
`asOf=2026-09-02T00:00:00.000Z`.

| Metric | Cents | Euros |
| --- | ---: | ---: |
| Contracted | 27,000 | €270.00 |
| Scheduled due | 27,000 | €270.00 |
| Gross recorded Payments | 19,000 | €190.00 |
| Refunds | 3,000 | €30.00 |
| Net recorded Payments | 16,000 | €160.00 |
| Bank-settled gross | 15,500 | €155.00 |
| Bank refund outflows | 3,000 | €30.00 |
| Bank-settled net | 12,500 | €125.00 |
| Outstanding exposure | 11,000 | €110.00 |
| Overdue exposure | 11,000 | €110.00 |

Refunds remain a positive gross metric and are subtracted only in net/effective
metrics. Outstanding and overdue exposure are operational projections, not
accounts receivable or recognized revenue.

## Reconciliation result

The final Run contains exactly three Findings:

| Rule | Evidence result | Final status |
| --- | --- | --- |
| `BANK_SETTLEMENT_AMOUNT_MISMATCH` | linked bank credit is €5.00 below Payment; delta `-500` cents | `resolved` after acknowledge → resolve |
| `INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT` | the €30.00 repayment has no bank settlement evidence | `open` |
| `ORPHAN_BANK_MOVEMENT` | the €7.00 bank movement has no internal fact | `ignored` |

The other two Reconciliation v1 rules have zero Findings. Resolution history is
append-only and uses the fixed actor `demo-operator` with deterministic times
and reasons.

## Reviewer walkthrough

1. **Customer — `/customers?id=1`.** Inspect Customer 1. This proves durable
   customer identity without broad CRUD.
2. **Contract and Installments — `/contracts?id=1`.** Inspect Contract 1 and
   its three ordered €40.00 installments. This proves exact cent conservation
   and the backend-owned schedule.
3. **Payment — `/payments?id=1`.** Inspect the €120.00 Payment and allocations.
   This proves an immutable internal Payment assertion and deterministic
   allocation; it does not by itself prove provider or bank settlement.
4. **Refund — `/refunds?id=1`.** Inspect the €30.00 compensating fact and its
   reverse allocation. Payment 2 then repays the reopened amount without
   rewriting Payment 1.
5. **External-bank discrepancy — inspect Payment 3 and the Run’s mismatch
   Finding.** The internal Payment is €40.00 while its linked simulated bank
   credit is €35.00. This proves that bank evidence is distinct from the
   Payment assertion.
6. **Reconciliation — `/reconciliation?runId=1`.** Review all three exact,
   deterministic Findings. Select the mismatch Finding by its displayed ID to
   inspect typed evidence.
7. **Operator resolution — Finding detail.** Review the ordered acknowledge and
   resolve actions for the mismatch and the ignore action for the orphan. This
   proves retained resolution history; the seeded lifecycle is already final,
   so no new action is required.
8. **Audit — `/audit` as an admin.** The Audit surface records successful
   authenticated HTTP mutations. Demo seeding calls application use cases
   directly, so seed operations and their prebuilt resolution actions are not
   presented as HTTP AuditEvents. Perform a separate supported UI mutation only
   if an audit demonstration is desired, accepting that it changes the reset
   fixture until the next reset.
9. **Dashboard — `/dashboard`.** During the fixture’s 2026 period, compare its
   headline figures with the golden table above and inspect recent Run 1. This
   proves that the presentation reads backend-owned analytics rather than
   calculating financial truth in the browser.
10. **Assistant — `/assistant`.** Run `/customer 1`, `/contract 1`,
    `/payment 1`, `/revenue`, and `/status`; an admin may also run
    `/audit`. This proves that a fixed grammar maps to the same authoritative
    APIs without an LLM, arbitrary route, or browser-owned financial calculation.

## Evidence boundaries

- A **Payment** is RIOS’s durable assertion that money was received.
- **Stripe evidence** is a retained signed Test Mode provider event; it is not a
  bank statement.
- **Bank settlement evidence** is simulated external evidence linked by exact
  identifiers; there is no real bank integration.
- **Reconciliation** compares retained evidence and records Findings. It does
  not move money, certify settlement, repair facts, or use fuzzy/AI matching.

## Limits

The fixture is fixed to EUR and 2026 timestamps. It does not demonstrate real
bank ingestion, Stripe Refund ingestion, chargebacks, accounting cash,
recognized revenue, MRR, churn, LTV, AI remediation, or production readiness.
The frontend provides inspectors and bounded operator controls; the database
and API remain authoritative. Reproducibility is guaranteed for a freshly
reset, migrated, isolated demo database—not for a database subsequently changed
through operator actions.
