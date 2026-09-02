import { fingerprintFinding } from "../domain/reconciliation-finding.js";
import { severityForRule, type ReconciliationEvidenceRole, type ReconciliationRuleCode, type ReconciliationSeverity, type ReconciliationSubjectType } from "../domain/reconciliation-vocabulary.js";

export type EvidenceEntityType = "contract" | "installment" | "payment" | "refund" | "ledger_entry" | "stripe_webhook_event" | "external_source_event";
export interface FindingEvidenceReference { readonly entityType: EvidenceEntityType; readonly entityId: number; readonly role: ReconciliationEvidenceRole; }
export interface ReconciliationSnapshot {
  readonly payments: ReadonlyArray<{ readonly id: number; readonly amountCents: number; readonly ledgerEntryId: number }>;
  readonly refunds: ReadonlyArray<{ readonly id: number; readonly paymentId: number; readonly ledgerEntryId: number }>;
  readonly stripeEvents: ReadonlyArray<{ readonly id: number; readonly stripePaymentIntentId: string; readonly paymentId: number | null }>;
  readonly externalEvents: ReadonlyArray<{ readonly id: number; readonly eventType: "settlement_credit" | "refund_debit"; readonly amountCents: number; readonly internalPaymentId: number | null; readonly internalRefundId: number | null; readonly providerPaymentReference: string | null }>;
}
export interface ReconciliationFindingCandidate { readonly ruleCode: ReconciliationRuleCode; readonly ruleVersion: 1; readonly severity: ReconciliationSeverity; readonly subjectType: ReconciliationSubjectType; readonly subjectId: number; readonly amountDeltaCents: number | null; readonly currency: "EUR"; readonly fingerprint: string; readonly evidence: ReadonlyArray<FindingEvidenceReference>; }

const identity = (evidence: FindingEvidenceReference) => `${evidence.entityType}:${evidence.entityId}`;
function candidate(ruleCode: ReconciliationRuleCode, subjectType: ReconciliationSubjectType, subjectId: number, amountDeltaCents: number | null, evidence: FindingEvidenceReference[]): ReconciliationFindingCandidate {
  const sorted = [...evidence].sort((a, b) => identity(a).localeCompare(identity(b)));
  return Object.freeze({ ruleCode, ruleVersion: 1, severity: severityForRule(ruleCode), subjectType, subjectId, amountDeltaCents, currency: "EUR", fingerprint: fingerprintFinding({ ruleCode, subjectType, subjectId, amountDeltaCents, evidenceIdentities: sorted.map(identity) }), evidence: Object.freeze(sorted) });
}

export function evaluateReconciliation(snapshot: ReconciliationSnapshot): ReadonlyArray<ReconciliationFindingCandidate> {
  const payments = new Map(snapshot.payments.map((payment) => [payment.id, payment]));
  const refunds = new Map(snapshot.refunds.map((refund) => [refund.id, refund]));
  const stripeByReference = new Map<string, Array<(typeof snapshot.stripeEvents)[number]>>();
  for (const event of snapshot.stripeEvents) stripeByReference.set(event.stripePaymentIntentId, [...(stripeByReference.get(event.stripePaymentIntentId) ?? []), event]);
  const stripeForPayment = new Map<number, Array<(typeof snapshot.stripeEvents)[number]>>();
  for (const event of snapshot.stripeEvents) if (event.paymentId !== null) stripeForPayment.set(event.paymentId, [...(stripeForPayment.get(event.paymentId) ?? []), event]);
  const settlements = new Map<number, Array<(typeof snapshot.externalEvents)[number]>>();
  const refundDebits = new Map<number, Array<(typeof snapshot.externalEvents)[number]>>();
  const orphaned: Array<(typeof snapshot.externalEvents)[number]> = [];

  for (const event of snapshot.externalEvents) {
    if (event.eventType === "refund_debit") {
      if (event.internalRefundId !== null && refunds.has(event.internalRefundId)) refundDebits.set(event.internalRefundId, [...(refundDebits.get(event.internalRefundId) ?? []), event]); else orphaned.push(event);
      continue;
    }
    let paymentId = event.internalPaymentId !== null && payments.has(event.internalPaymentId) ? event.internalPaymentId : null;
    if (paymentId === null && event.internalPaymentId === null && event.providerPaymentReference !== null) {
      const linked = new Set((stripeByReference.get(event.providerPaymentReference) ?? []).map((stripe) => stripe.paymentId).filter((id): id is number => id !== null && payments.has(id)));
      if (linked.size === 1) paymentId = [...linked][0]!;
    }
    if (paymentId === null) orphaned.push(event); else settlements.set(paymentId, [...(settlements.get(paymentId) ?? []), event]);
  }

  const findings: ReconciliationFindingCandidate[] = [];
  for (const event of snapshot.stripeEvents) if (event.paymentId === null || !payments.has(event.paymentId)) findings.push(candidate("STRIPE_SUCCESS_MISSING_INTERNAL_PAYMENT", "stripe_webhook_event", event.id, null, [{ entityType: "stripe_webhook_event", entityId: event.id, role: "subject" }]));
  for (const payment of snapshot.payments) {
    const external = settlements.get(payment.id) ?? [];
    const base: FindingEvidenceReference[] = [{ entityType: "payment", entityId: payment.id, role: "subject" }, { entityType: "ledger_entry", entityId: payment.ledgerEntryId, role: "internal_effect" }, ...(stripeForPayment.get(payment.id) ?? []).map((event) => ({ entityType: "stripe_webhook_event" as const, entityId: event.id, role: "provider_evidence" as const }))];
    if (external.length === 0) findings.push(candidate("INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT", "payment", payment.id, null, base));
    else {
      const total = external.reduce((sum, event) => sum + event.amountCents, 0);
      if (total !== payment.amountCents) findings.push(candidate("BANK_SETTLEMENT_AMOUNT_MISMATCH", "payment", payment.id, total - payment.amountCents, [...base, ...external.map((event) => ({ entityType: "external_source_event" as const, entityId: event.id, role: "external_evidence" as const }))]));
    }
  }
  for (const refund of snapshot.refunds) if ((refundDebits.get(refund.id) ?? []).length === 0) findings.push(candidate("INTERNAL_REFUND_MISSING_BANK_OUTFLOW", "refund", refund.id, null, [{ entityType: "refund", entityId: refund.id, role: "subject" }, { entityType: "payment", entityId: refund.paymentId, role: "internal_fact" }, { entityType: "ledger_entry", entityId: refund.ledgerEntryId, role: "internal_effect" }]));
  for (const event of orphaned) findings.push(candidate("ORPHAN_BANK_MOVEMENT", "external_source_event", event.id, null, [{ entityType: "external_source_event", entityId: event.id, role: "subject" }]));
  return Object.freeze([...new Map(findings.map((finding) => [finding.fingerprint, finding])).values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)));
}
