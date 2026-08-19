# Conceptual data model

The first vertical slice contains exactly three entities:

```text
Customer → Contract → Installment
```

This document describes domain concepts only. It does not define a database schema or implementation technology.

## Customer

### Persisted attributes

| Attribute | Meaning |
|---|---|
| `id` | Stable internal identifier. |
| `display_name` | Human-readable name used to identify the customer. |
| `created_at` | Unambiguous technical creation instant in UTC. |

### Rules

- `display_name` is required and cannot be empty.
- `id` is stable and is not reused.
- `created_at` is a UTC instant.
- Physical deletion is not part of this slice.

## Contract

### Persisted attributes

| Attribute | Meaning |
|---|---|
| `id` | Stable internal identifier. |
| `customer_id` | Identifier of the customer that owns the contract. |
| `total_amount` | Total amount the customer commits to pay, expressed in euro cents. |
| `currency` | Explicit contract currency; only `EUR` is valid in V1. |
| `installment_count` | Number of installments in the financed schedule. |
| `first_due_date` | Civil date anchoring the monthly schedule. |
| `status` | Contract lifecycle state; only `active` exists in this slice. |
| `created_at` | Unambiguous technical creation instant in UTC. |

### Rules

- `id` is stable and is not reused.
- Every contract belongs to one customer.
- `currency` is `EUR`.
- `total_amount` is a positive integer number of cents.
- `installment_count` is a positive integer.
- `installment_count <= total_amount` when `total_amount` is expressed in cents.
- The initial and only state in this slice is `active`.
- `first_due_date` is a civil date and may be in the past, present, or future.
- `total_amount`, `currency`, `installment_count`, `first_due_date`, and the generated schedule are immutable in this slice.
- A contract and its complete schedule are created atomically.
- Physical deletion is not part of this slice.

### Derived data not persisted yet

- Sum of installment amounts.
- Last due date.
- Next installment.
- Average installment amount.
- Outstanding balance.
- Number of generated installments.

## Installment

### Persisted attributes

| Attribute | Meaning |
|---|---|
| `id` | Stable internal identifier. |
| `contract_id` | Identifier of the contract that owns the installment. |
| `position` | Stable ordinal position from 1 through the contract's `installment_count`. |
| `amount` | Positive installment amount in euro cents. |
| `due_date` | Civil due date calculated from the contract anchor and this position. |
| `status` | Installment lifecycle state; only `pending` exists in this slice. |
| `created_at` | Unambiguous technical creation instant in UTC. |

### Rules

- Every installment belongs to exactly one contract.
- `position` is between 1 and the owning contract's `installment_count`.
- The pair `(contract, position)` is conceptually unique.
- `amount` is strictly positive.
- The initial and only state in this slice is `pending`.
- `due_date` is calculated from `first_due_date` and `position`, never from the previous installment.
- An installment inherits `EUR` from its contract; it does not persist a separate currency.
- A complete schedule contains exactly `installment_count` installments.
- The complete schedule preserves `contract.total_amount` exactly.
- The generated schedule is immutable, and physical deletion is not part of this slice.

### Data not persisted yet

- Outstanding balance.
- Paid amount.
- Payment date.
- External payment references.
- Ledger entries.
- Refund or cancellation timestamps.

## Relationships

```text
Customer 1 → N Contract
Contract 1 → N Installment
```

Each contract has exactly one customer. A customer can have multiple contracts. Each installment has exactly one contract, and a financed contract has its complete ordered installment schedule.

No other entities belong to this conceptual slice.

## Internal identifiers

Customer, contract, and installment use sequential integer IDs.

- They are sufficient for the modular monolith and demo data.
- Future external identifiers are separate concepts and do not replace internal IDs.
- Authorization must never depend on an identifier being unpredictable.

## States in this slice

| Entity | State | Meaning |
|---|---|---|
| Contract | `active` | The contract and its complete schedule were created successfully. |
| Installment | `pending` | The installment exists as an unpaid contractual obligation; no payment flow exists yet. |

Payment, overdue, cancellation, default, and refund states will be introduced only when the flows that justify them exist.
