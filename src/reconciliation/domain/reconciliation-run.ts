import { createHash } from "node:crypto";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createReconciliationRunId, type ReconciliationRunId } from "./ids.js";
import { RECONCILIATION_RULE_SET_VERSION } from "./reconciliation-vocabulary.js";

function validInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new DomainValidationError("INVALID_RECONCILIATION_INSTANT", `${label} must be a valid instant`);
  return new Date(value);
}
export function canonicalizeReconciliationRun(cutoff: Date): string { return JSON.stringify(["global", null, validInstant(cutoff, "Reconciliation cutoff").toISOString(), RECONCILIATION_RULE_SET_VERSION]); }
export function fingerprintReconciliationRun(cutoff: Date): string { return createHash("sha256").update(canonicalizeReconciliationRun(cutoff), "utf8").digest("hex"); }

export interface ReconciliationRun { readonly id: ReconciliationRunId; readonly scopeType: "global"; readonly scopeId: null; readonly cutoff: Date; readonly ruleSetVersion: typeof RECONCILIATION_RULE_SET_VERSION; readonly runFingerprint: string; readonly status: "completed"; readonly executedAt: Date; readonly createdAt: Date; }

export function reconstituteReconciliationRun(input: { readonly id: number; readonly scopeType: string; readonly scopeId: number | null; readonly cutoff: Date; readonly ruleSetVersion: string; readonly runFingerprint: string; readonly status: string; readonly executedAt: Date; readonly createdAt: Date; }): ReconciliationRun {
  const cutoff = validInstant(input.cutoff, "Reconciliation cutoff");
  const executedAt = validInstant(input.executedAt, "Reconciliation executedAt");
  const createdAt = validInstant(input.createdAt, "Reconciliation createdAt");
  if (input.scopeType !== "global" || input.scopeId !== null || input.ruleSetVersion !== RECONCILIATION_RULE_SET_VERSION || input.status !== "completed") throw new DomainValidationError("INVALID_RECONCILIATION_RUN", "Reconciliation Run must use the completed global v1 semantics");
  if (input.runFingerprint !== fingerprintReconciliationRun(cutoff)) throw new DomainValidationError("INVALID_RECONCILIATION_FINGERPRINT", "Reconciliation Run fingerprint does not match its canonical identity");
  return Object.freeze({ id: createReconciliationRunId(input.id), scopeType: "global", scopeId: null, get cutoff(){return new Date(cutoff);}, ruleSetVersion: RECONCILIATION_RULE_SET_VERSION, runFingerprint: input.runFingerprint, status: "completed", get executedAt(){return new Date(executedAt);}, get createdAt(){return new Date(createdAt);} });
}
