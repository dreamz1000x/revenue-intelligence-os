import { describe, expect, it } from "vitest";
import { evaluateReconciliation, type ReconciliationSnapshot } from "../../../../src/reconciliation/application/evaluate-reconciliation.js";

const payment = { id: 1, amountCents: 10_000, ledgerEntryId: 11 };
const refund = { id: 2, paymentId: 1, ledgerEntryId: 12 };
const settlement = { id: 21, eventType: "settlement_credit" as const, amountCents: 10_000, internalPaymentId: 1, internalRefundId: null, providerPaymentReference: null };
const debit = { id: 22, eventType: "refund_debit" as const, amountCents: 1_000, internalPaymentId: null, internalRefundId: 2, providerPaymentReference: null };
const stripe = { id: 31, stripePaymentIntentId: "pi_one", paymentId: 1 };
const base = (overrides: Partial<ReconciliationSnapshot> = {}): ReconciliationSnapshot => ({ payments: [payment], refunds: [], stripeEvents: [], externalEvents: [settlement], ...overrides });
const codes = (snapshot: ReconciliationSnapshot) => evaluateReconciliation(snapshot).map((finding) => finding.ruleCode);

describe("deterministic reconciliation evaluation", () => {
  it("produces no Finding for a fully reconciled Payment", () => expect(evaluateReconciliation(base())).toEqual([]));
  it("finds Stripe success without a visible Payment", () => expect(codes(base({ payments: [], externalEvents: [], stripeEvents: [{ ...stripe, paymentId: null }] }))).toEqual(["STRIPE_SUCCESS_MISSING_INTERNAL_PAYMENT"]));
  it("finds a Payment with no settlement", () => expect(codes(base({ externalEvents: [] }))).toEqual(["INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT"]));
  it.each([[9_500, -500], [10_500, 500]])("finds settlement mismatch %s with delta %s", (amountCents, delta) => { const findings = evaluateReconciliation(base({ externalEvents: [{ ...settlement, amountCents }] })); expect(findings).toMatchObject([{ ruleCode: "BANK_SETTLEMENT_AMOUNT_MISMATCH", amountDeltaCents: delta }]); });
  it("sums multiple exact settlement events", () => expect(evaluateReconciliation(base({ externalEvents: [{ ...settlement, amountCents: 4_000 }, { ...settlement, id: 23, amountCents: 6_000 }] }))).toEqual([]));
  it("uses refund-debit existence without amount comparison", () => { expect(codes(base({ refunds: [refund], externalEvents: [settlement, debit] }))).toEqual([]); expect(codes(base({ refunds: [refund], externalEvents: [settlement] }))).toContain("INTERNAL_REFUND_MISSING_BANK_OUTFLOW"); });
  it("creates orphan Findings for unmatched settlement and refund debit", () => { const findings = evaluateReconciliation(base({ payments: [], externalEvents: [{ ...settlement, internalPaymentId: null }, { ...debit, internalRefundId: null }] })); expect(findings.filter((finding) => finding.ruleCode === "ORPHAN_BANK_MOVEMENT")).toHaveLength(2); });
  it("resolves provider reference only through a linked Stripe PaymentIntent", () => { const providerEvent = { ...settlement, internalPaymentId: null, providerPaymentReference: "pi_one" }; expect(evaluateReconciliation(base({ stripeEvents: [stripe], externalEvents: [providerEvent] }))).toEqual([]); expect(codes(base({ stripeEvents: [{ ...stripe, paymentId: null }], externalEvents: [providerEvent] }))).toContain("ORPHAN_BANK_MOVEMENT"); });
  it("never fuzzy-matches equal amount and time", () => expect(codes(base({ externalEvents: [{ ...settlement, internalPaymentId: null }] }))).toEqual(expect.arrayContaining(["INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT", "ORPHAN_BANK_MOVEMENT"])));
  it("is fingerprint-stable across source ordering and emits no duplicates", () => { const one = evaluateReconciliation(base({ externalEvents: [{ ...settlement, amountCents: 4_000 }, { ...settlement, id: 23, amountCents: 5_000 }] })); const two = evaluateReconciliation(base({ externalEvents: [{ ...settlement, id: 23, amountCents: 5_000 }, { ...settlement, amountCents: 4_000 }] })); expect(one.map((finding) => finding.fingerprint)).toEqual(two.map((finding) => finding.fingerprint)); expect(new Set(one.map((finding) => finding.fingerprint)).size).toBe(one.length); });
});
