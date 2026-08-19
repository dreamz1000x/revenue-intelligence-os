# Financial invariants

This document states the financial properties that Revenue Intelligence OS must preserve. An invariant describes what must remain true; constraints, idempotency keys, state machines, ledgers, reconciliation, and tests are possible enforcement mechanisms rather than the invariant itself.

## A. General invariants

### INV-01 — Monetary precision

**Rule:** Financial amounts and calculations must be exact and reproducible.

**Why it exists:** It prevents rounding drift and unexplained differences between contracts, installments, payments, and financial records.

**Correct example:** Two installments of 5,000 cents sum exactly to a contractual total of 10,000 cents.

**Violation example:** A calculation produces an approximation that compares differently with the contractual total.

**Future enforcement:** Domain money type, exact persistence representation, explicit rounding rules, and unit tests.

**Phase:** Applies now to `customer → contract → installment`.

### INV-02 — External events have effects at most once

**Rule:** Receiving the same external event more than once must not duplicate money, state changes, or derived effects.

**Why it exists:** External systems and queues can deliver the same event repeatedly.

**Correct example:** A duplicated payment event is recognized, while its financial effect is applied once.

**Violation example:** The duplicate creates a second payment or financial entry.

**Future enforcement:** Stable event identity, idempotency key, uniqueness constraint, idempotent handler, and integration tests.

**Phase:** Later, when external financial events are introduced.

### INV-03 — Original events are retained

**Rule:** Every accepted financial event must be preserved in its original form before its effects are applied to the domain.

**Why it exists:** The original evidence is needed to diagnose failures, retry processing, and audit what was received.

**Correct example:** An event payload is retained even if its later normalization fails.

**Violation example:** Processing fails and no original event remains for investigation or retry.

**Future enforcement:** Immutable event persistence, processing status, queue and retry controls, and integration tests.

**Phase:** Later, with event ingestion.

### INV-04 — State transitions are valid

**Rule:** A financial entity may change state only through an allowed transition justified by a recorded fact.

**Why it exists:** It prevents contradictory states and unexplained lifecycle changes.

**Correct example:** A future state change follows an explicit transition rule and records its cause.

**Violation example:** An entity is edited directly into a state incompatible with its prior state or financial history.

**Future enforcement:** Domain rules, state machine, audit history, and transition tests.

**Phase:** Applies now in its minimal form; this slice has no state transitions after creation.

### INV-05 — Refunds preserve history

**Rule:** A refund must compensate the original financial effect without deleting or rewriting that history.

**Why it exists:** Destructive changes make audit, reconciliation, and historical reporting unreliable.

**Correct example:** A refund adds a compensating entry linked to the retained original payment.

**Violation example:** Refunding deletes the original payment and its evidence.

**Future enforcement:** Immutable ledger, compensating entries, audit relationships, and tests.

**Phase:** Later, when payments, ledger, and refunds exist.

### INV-06 — Source discrepancies remain visible

**Rule:** A difference between financial sources must be exposed with enough evidence to understand and resolve it; it must not be silently hidden in a consolidated figure.

**Why it exists:** Contracts, payment providers, bank records, and internal data can diverge.

**Correct example:** A payment present in one source but absent internally produces a traceable exception.

**Violation example:** The system selects one conflicting figure without disclosing the disagreement.

**Future enforcement:** Reconciliation rules, exception records, evidence by source, resolution history, and tests.

**Phase:** Later, when multiple financial sources exist.

### INV-07 — Repeated commands do not repeat effects

**Rule:** Retrying the same logical command must not repeat its effect.

**Why it exists:** A caller can retry after a timeout without knowing whether the first execution completed.

**Correct example:** A repeated `create financed contract` command returns the contract associated with the original execution without creating a second contract or installment schedule.

**Violation example:** A response is lost after commit, and retrying the request creates duplicate domain records.

**Enforcement:** Client-provided idempotency key, deterministic request fingerprint, persistent idempotency record, uniqueness controls, one transaction containing the idempotency record and command effects, and automated tests.

**Phase:** Applies now to `create customer` and `create financed contract`.

#### Operation identity

Every logical operation uses an `Idempotency-Key` supplied by the client. Its conceptual identity is:

```text
(command_type, idempotency_key)
```

The same key string may be used for different command types without identifying the same operation.

#### Retry semantics

For the same command type, key, and canonical payload:

- The effect is not repeated.
- The resource associated with the original successful execution is returned.

For the same command type and key with a different canonical payload:

- The request is rejected.
- The key cannot be reassigned to a different intent.
- No additional resource is created.

Different keys represent different logical operations even when their payloads are identical. Business data is not used for automatic deduplication. For example, two `create customer` commands with `display_name = "John Smith"` and different keys may create two different customers.

#### Request fingerprint

The validated request has a deterministic fingerprint. Its only purpose is to verify that a key continues to represent the same command and canonical payload. It must not be used to infer business duplicates.

#### Atomicity

The idempotency record and the effect of its command share one transaction boundary:

```text
create customer:
idempotency record + customer

create financed contract:
idempotency record + contract + complete installment schedule
```

Either the complete operation is committed or nothing is persisted. A failure before commit cannot leave a successful key. If commit succeeds but the HTTP response is lost, a retry returns the same resource without duplicating effects.

#### Minimal conceptual persistence

V1 retains only:

- Key.
- Command type.
- Request fingerprint.
- Resource or result identifier.
- `created_at`.

V1 has no expiration, stored HTTP response bodies, Redis coordination, distributed locks, or complex execution states. This section defines concepts only and does not define a persistence schema.

#### Relationship to event invariants

- `INV-07` covers retries of commands initiated by clients.
- `INV-02` covers duplicate external events.
- `INV-10` covers deliberate replay of historical events.

They remain separate because their sources, identities, and execution boundaries differ.

### INV-08 — Temporal meaning is unambiguous

**Rule:** Technical instants must be stored in UTC, presentation zones must be explicit, and civil business dates must remain dates rather than ambiguous timestamps.

**Why it exists:** It prevents lifecycle, audit, and due-date errors caused by implicit zones or daylight-saving changes.

**Correct example:** `created_at` is an unambiguous UTC instant while `due_date` is the civil date `2026-09-15`.

**Violation example:** `2026-09-15 00:00` is stored without a zone and interpreted differently by two processes.

**Future enforcement:** Domain temporal types, UTC storage for technical timestamps, explicit presentation conversion, and boundary tests.

**Phase:** Applies now.

### INV-09 — Partial payments are allocated deterministically

**Rule:** Given the same contract, pending installments, and partial payment, allocation must always produce the same result.

**Why it exists:** It prevents retries or different processes from distributing one payment inconsistently.

**Correct example:** Repeating an allocation with identical inputs assigns the same amounts to the same installments.

**Violation example:** Allocation changes because installments were returned in an incidental order.

**Future enforcement:** Explicit allocation rule and ordering, domain operation, ledger, transaction boundary, and unit tests.

**Phase:** Later, when payments are introduced.

### INV-10 — Reprocessing is safe

**Rule:** Reprocessing an original event must not duplicate, erase, or silently alter financial effects already applied correctly.

**Why it exists:** Replay is necessary for recovery but can corrupt figures when handlers repeat effects.

**Correct example:** Replaying an applied event recognizes the existing outcome and creates no second effect.

**Violation example:** Replaying one event creates another payment or ledger entry.

**Future enforcement:** Immutable original event, idempotent handler, processing record, uniqueness controls, safe replay, and integration tests.

**Phase:** Later, with event processing and recovery operations.

### INV-11 — An active financed contract has a coherent schedule

**Rule:** An active financed contract must always have its complete, ordered installment schedule, and that schedule must preserve the contractual total.

**Why it exists:** A missing or partial schedule makes expected, due, and collected amounts impossible to establish reliably.

**Correct example:** An active three-installment contract exists together with all three ordered installments whose amounts sum to its total.

**Violation example:** An active contract exists with no installments or only part of its schedule.

**Future enforcement:** Atomic domain operation, validation, persistence constraints where appropriate, reconciliation, and tests.

**Phase:** Applies now.

## B. V1 monetary invariants

### MON-01 — Explicit single currency

Every V1 contract explicitly uses `EUR`. Every installment inherits its contract's currency, and no other currency is valid in this slice.

### MON-02 — Integer minor units

Every amount is an integer number of euro cents, where 100 cents equals 1 euro. Financial values and calculations must never use `float`.

### MON-03 — Positive contractual total

`contract.total_amount` must be strictly greater than zero.

### MON-04 — Positive installment amounts

Every `installment.amount` must be strictly greater than zero.

### MON-05 — Valid installment count

`installment_count` must be a positive integer and must satisfy:

```text
installment_count <= contract.total_amount
```

In this comparison, `contract.total_amount` is expressed in cents. This prevents generation of zero-value installments.

### MON-06 — Exact conservation of the contractual total

For every financed contract:

```text
SUM(installment.amount) == contract.total_amount
```

Schedule generation cannot create or lose a cent.

### MON-07 — Deterministic remainder distribution

For total amount `T` and installment count `N`:

```text
base = T DIV N
remainder = T MOD N
```

Every installment initially receives `base`. The first `remainder` installments, determined by their stable position, receive one additional cent.

Example:

```text
10000 / 3 → [3334, 3333, 3333]
```

### MON-08 — Stable installment order

Installments have explicit positions `1, 2, 3, ... N`. Monetary distribution depends only on the contractual total, installment count, and this stable order.

### MON-09 — Unique meaning of the contractual total

`contract.total_amount` is the total amount the customer contractually commits to pay. V1 does not separately model interest, financing fees, taxes, down payments, balloon payments, or external financial adjustments.

## C. Temporal rule

For an installment at position `N`:

```text
due_date(N) = first_due_date shifted by N - 1 calendar months
```

The contractual day of month is preserved when it exists in the target month. If it does not exist, the due date is the last day of that month. Every due date is calculated from `first_due_date`, never from the preceding installment, so a shortened month does not cause cumulative drift.

Examples:

```text
2026-01-31 → 2026-02-28 → 2026-03-31
2024-01-31 → 2024-02-29
```

The rule must handle February and leap years deterministically. `due_date` and `first_due_date` are civil dates. Technical timestamps such as `created_at` are unambiguous UTC instants.

The first due date may be in the past, present, or future so that V1 can load historical contracts.

## D. V1 atomicity and immutability

- Creating a financed contract and its complete installment schedule is one atomic operation: either the contract and every installment are created, or none of them are.
- An active financed contract cannot exist with a missing or partial schedule.
- Once created, `total_amount`, `currency`, `installment_count`, `first_due_date`, and the generated schedule are immutable in this slice.
- V1 provides no physical deletion of customers, contracts, or installments.
- V1 does not introduce versioning, soft deletion, or update events for these rules.
