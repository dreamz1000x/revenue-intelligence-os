import { DomainValidationError } from "../../domain/domain-validation-error.js";

export const RECONCILIATION_RULE_SET_VERSION = "reconciliation-v1" as const;
export const RECONCILIATION_RULE_VERSION = 1 as const;
export const RECONCILIATION_RULE_CODES = ["STRIPE_SUCCESS_MISSING_INTERNAL_PAYMENT", "INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT", "BANK_SETTLEMENT_AMOUNT_MISMATCH", "INTERNAL_REFUND_MISSING_BANK_OUTFLOW", "ORPHAN_BANK_MOVEMENT"] as const;
export type ReconciliationRuleCode = (typeof RECONCILIATION_RULE_CODES)[number];
export type ReconciliationSeverity = "warning" | "critical";
export type ReconciliationSubjectType = "payment" | "refund" | "stripe_webhook_event" | "external_source_event";
export type ReconciliationFindingStatus = "open" | "acknowledged" | "resolved" | "ignored";
export type ReconciliationActionType = "acknowledge" | "resolve" | "ignore";
export type ReconciliationEvidenceRole = "subject" | "internal_fact" | "internal_effect" | "provider_evidence" | "external_evidence" | "contract_context";

const SEVERITY_BY_RULE: Readonly<Record<ReconciliationRuleCode, ReconciliationSeverity>> = {
  STRIPE_SUCCESS_MISSING_INTERNAL_PAYMENT: "critical",
  INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT: "warning",
  BANK_SETTLEMENT_AMOUNT_MISMATCH: "critical",
  INTERNAL_REFUND_MISSING_BANK_OUTFLOW: "warning",
  ORPHAN_BANK_MOVEMENT: "warning",
};
const SUBJECT_BY_RULE: Readonly<Record<ReconciliationRuleCode, ReconciliationSubjectType>> = {
  STRIPE_SUCCESS_MISSING_INTERNAL_PAYMENT: "stripe_webhook_event",
  INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT: "payment",
  BANK_SETTLEMENT_AMOUNT_MISMATCH: "payment",
  INTERNAL_REFUND_MISSING_BANK_OUTFLOW: "refund",
  ORPHAN_BANK_MOVEMENT: "external_source_event",
};

export function severityForRule(ruleCode: ReconciliationRuleCode): ReconciliationSeverity { return SEVERITY_BY_RULE[ruleCode]; }

export function assertRuleSeverity(ruleCode: ReconciliationRuleCode, severity: ReconciliationSeverity): void {
  if (severityForRule(ruleCode) !== severity) throw new DomainValidationError("INVALID_RECONCILIATION_SEVERITY", "Reconciliation severity must match the v1 rule mapping");
}

export function assertRuleSubject(ruleCode: ReconciliationRuleCode, subjectType: ReconciliationSubjectType): void {
  if (SUBJECT_BY_RULE[ruleCode] !== subjectType) throw new DomainValidationError("INVALID_RECONCILIATION_SUBJECT", "Reconciliation subject must match the v1 rule mapping");
}

export function targetStatusForAction(current: ReconciliationFindingStatus, action: ReconciliationActionType): ReconciliationFindingStatus {
  const target = action === "acknowledge" ? "acknowledged" : action === "resolve" ? "resolved" : "ignored";
  const allowed = (current === "open" && (target === "acknowledged" || target === "resolved" || target === "ignored")) || (current === "acknowledged" && (target === "resolved" || target === "ignored"));
  if (!allowed) throw new DomainValidationError("ILLEGAL_RECONCILIATION_TRANSITION", `Cannot ${action} a Finding with status ${current}`);
  return target;
}
