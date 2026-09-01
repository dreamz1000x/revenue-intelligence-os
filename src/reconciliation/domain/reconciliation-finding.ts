import { createHash } from "node:crypto";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { validateIntegerId } from "../../domain/integer-id.js";
import { createReconciliationFindingId, createReconciliationRunId, type ReconciliationFindingId, type ReconciliationRunId } from "./ids.js";
import { assertRuleSeverity, assertRuleSubject, RECONCILIATION_RULE_VERSION, type ReconciliationFindingStatus, type ReconciliationRuleCode, type ReconciliationSeverity, type ReconciliationSubjectType } from "./reconciliation-vocabulary.js";

export interface FindingFingerprintInput { readonly ruleCode: ReconciliationRuleCode; readonly subjectType: ReconciliationSubjectType; readonly subjectId: number; readonly amountDeltaCents: number | null; readonly evidenceIdentities: ReadonlyArray<string>; }

export function canonicalizeFindingFingerprint(input: FindingFingerprintInput): string {
  validateIntegerId(input.subjectId, "Reconciliation subject ID");
  if (input.amountDeltaCents !== null && !Number.isSafeInteger(input.amountDeltaCents)) throw new DomainValidationError("INVALID_RECONCILIATION_DELTA", "Finding amount delta must be a signed safe integer");
  const evidence = [...input.evidenceIdentities];
  if (evidence.some((identity) => typeof identity !== "string" || identity.length < 1 || identity.length > 320)) throw new DomainValidationError("INVALID_RECONCILIATION_EVIDENCE_IDENTITY", "Evidence identities must be bounded nonblank strings");
  evidence.sort();
  return JSON.stringify([input.ruleCode, RECONCILIATION_RULE_VERSION, input.subjectType, input.subjectId, input.amountDeltaCents, "EUR", evidence]);
}
export function fingerprintFinding(input: FindingFingerprintInput): string { return createHash("sha256").update(canonicalizeFindingFingerprint(input), "utf8").digest("hex"); }

export interface ReconciliationFinding { readonly id: ReconciliationFindingId; readonly runId: ReconciliationRunId; readonly ruleCode: ReconciliationRuleCode; readonly ruleVersion: 1; readonly severity: ReconciliationSeverity; readonly subjectType: ReconciliationSubjectType; readonly subjectId: number; readonly amountDeltaCents: number | null; readonly currency: "EUR"; readonly status: ReconciliationFindingStatus; readonly fingerprint: string; readonly createdAt: Date; readonly statusUpdatedAt: Date; }

export function reconstituteReconciliationFinding(input: Omit<ReconciliationFinding, "id" | "runId"> & { readonly id: number; readonly runId: number }): ReconciliationFinding {
  assertRuleSeverity(input.ruleCode, input.severity);
  assertRuleSubject(input.ruleCode, input.subjectType);
  validateIntegerId(input.subjectId, "Reconciliation subject ID");
  if (input.ruleVersion !== 1 || input.currency !== "EUR" || !["open", "acknowledged", "resolved", "ignored"].includes(input.status) || !/^[0-9a-f]{64}$/.test(input.fingerprint)) throw new DomainValidationError("INVALID_RECONCILIATION_FINDING", "Finding vocabulary or fingerprint is invalid");
  if (input.amountDeltaCents !== null && !Number.isSafeInteger(input.amountDeltaCents)) throw new DomainValidationError("INVALID_RECONCILIATION_DELTA", "Finding amount delta must be a signed safe integer");
  if (!(input.createdAt instanceof Date) || Number.isNaN(input.createdAt.getTime()) || !(input.statusUpdatedAt instanceof Date) || Number.isNaN(input.statusUpdatedAt.getTime())) throw new DomainValidationError("INVALID_RECONCILIATION_INSTANT", "Finding timestamps must be valid instants");
  const createdAt = new Date(input.createdAt); const statusUpdatedAt = new Date(input.statusUpdatedAt);
  return Object.freeze({ ...input, id: createReconciliationFindingId(input.id), runId: createReconciliationRunId(input.runId), get createdAt(){return new Date(createdAt);}, get statusUpdatedAt(){return new Date(statusUpdatedAt);} });
}
