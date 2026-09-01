import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createIdempotencyKey, type IdempotencyKey, type RequestFingerprint } from "../../application/idempotency.js";
import { createReconciliationActionId, createReconciliationFindingId, type ReconciliationActionId, type ReconciliationFindingId } from "./ids.js";
import { targetStatusForAction, type ReconciliationActionType, type ReconciliationFindingStatus } from "./reconciliation-vocabulary.js";

export interface ReconciliationAction { readonly id: ReconciliationActionId; readonly findingId: ReconciliationFindingId; readonly actionType: ReconciliationActionType; readonly fromStatus: ReconciliationFindingStatus; readonly toStatus: ReconciliationFindingStatus; readonly actorType: "operator"; readonly actorId: string; readonly reason: string; readonly idempotencyKey: IdempotencyKey; readonly requestFingerprint: RequestFingerprint; readonly occurredAt: Date; readonly recordedAt: Date; }

function boundedText(value: string, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || value.trim() !== value) throw new DomainValidationError("INVALID_RECONCILIATION_ACTION_TEXT", `${label} must be bounded and nonblank`);
  return value;
}

export function reconstituteReconciliationAction(input: { readonly id: number; readonly findingId: number; readonly actionType: ReconciliationActionType; readonly fromStatus: ReconciliationFindingStatus; readonly toStatus: ReconciliationFindingStatus; readonly actorType: string; readonly actorId: string; readonly reason: string; readonly idempotencyKey: string; readonly requestFingerprint: string; readonly occurredAt: Date; readonly recordedAt: Date; }): ReconciliationAction {
  const expected = targetStatusForAction(input.fromStatus, input.actionType);
  if (input.toStatus !== expected || input.actorType !== "operator" || !/^[0-9a-f]{64}$/.test(input.requestFingerprint)) throw new DomainValidationError("INVALID_RECONCILIATION_ACTION", "Reconciliation action semantics are invalid");
  if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime()) || !(input.recordedAt instanceof Date) || Number.isNaN(input.recordedAt.getTime())) throw new DomainValidationError("INVALID_RECONCILIATION_INSTANT", "Action timestamps must be valid instants");
  const occurredAt = new Date(input.occurredAt); const recordedAt = new Date(input.recordedAt);
  return Object.freeze({ id: createReconciliationActionId(input.id), findingId: createReconciliationFindingId(input.findingId), actionType: input.actionType, fromStatus: input.fromStatus, toStatus: input.toStatus, actorType: "operator", actorId: boundedText(input.actorId, "Actor ID", 128), reason: boundedText(input.reason, "Action reason", 1000), idempotencyKey: createIdempotencyKey(input.idempotencyKey), requestFingerprint: input.requestFingerprint as RequestFingerprint, get occurredAt(){return new Date(occurredAt);}, get recordedAt(){return new Date(recordedAt);} });
}
