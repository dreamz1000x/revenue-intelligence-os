# Reconciliation v1 semantics

Reconciliation v1 is an auditable, deterministic comparison of retained
evidence. It does not certify settlement, initiate money movement, or repair data
automatically.

## Evidence domains

Each Run compares four domains:

1. contractual state: Contracts and Installments;
2. internal financial effects: Payments, Refunds, allocations, and LedgerEntries;
3. provider evidence: retained Stripe `payment_intent.succeeded` events;
4. external evidence: simulated bank settlement credits and refund debits.

The external-source API is a portfolio/demo ingestion boundary, not a connection
to a real bank. Evidence identity is `(source, sourceEventId)`: identical delivery
replays, while conflicting delivery is rejected. Raw payloads are retained as
UTF-8 bytes and metadata rejects credential-like fields.

## Exact rule set

The fixed `reconciliation-v1` rule set has exactly five rules:

| Rule | Meaning |
| --- | --- |
| `STRIPE_SUCCESS_MISSING_INTERNAL_PAYMENT` | Retained Stripe success has no visible internal Payment link. |
| `INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT` | Internal Payment has no exact settlement evidence. |
| `BANK_SETTLEMENT_AMOUNT_MISMATCH` | Exact settlement total differs from Payment cents. |
| `INTERNAL_REFUND_MISSING_BANK_OUTFLOW` | Internal Refund has no exact refund-debit evidence. |
| `ORPHAN_BANK_MOVEMENT` | External movement cannot be tied to a retained internal fact. |

Matching uses an explicit internal identifier or a unique exact Stripe
PaymentIntent reference. Amounts are integer EUR cents. There are no tolerances,
heuristics, fuzzy matching, AI decisions, or a sixth catch-all rule.

## Knowledge-time cutoff and immutable Runs

The Run cutoff answers “what did the system know by this instant?” Internal facts
use recording timestamps; a Stripe-to-Payment link is visible only after its
`processedAt`; external evidence is visible by its application `createdAt`, not
backdated by `occurredAt`. A Run evaluates one repeatable-read snapshot and
atomically stores its Findings and evidence references.

The canonical global scope, cutoff, and rule-set version identify a logical Run.
The same idempotency key and payload replay it; different keys for the same
logical Run converge. Later evidence produces a later Run and never rewrites an
older Run.

## Findings and resolution history

A Finding records its rule, fixed severity, subject, optional signed cent delta,
status, and deterministic fingerprint. Evidence rows carry typed references and
roles such as subject, internal effect, provider evidence, or external evidence.

An operator may acknowledge, resolve, or ignore an open Finding; an acknowledged
Finding may then be resolved or ignored. Resolved and ignored states are
terminal. Actions append actor, reason, occurred time, recorded time, transition,
and idempotency identity. Reads return actions ordered by occurrence and stable
identifier.

Reconciliation v1 does not ingest Stripe Refund events, connect to a bank,
perform fuzzy matching, use AI remediation, or change financial facts.
