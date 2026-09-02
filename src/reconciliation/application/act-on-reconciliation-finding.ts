import type { Clock } from "../../application/clock.js";
import { canonicalizeReconciliationActionPayload, createIdempotencyKey, fingerprintCanonicalPayload } from "../../application/idempotency.js";
import { validateApplicationInput } from "../../application/input-validation.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createReconciliationFindingId } from "../domain/ids.js";
import type { ReconciliationActionType } from "../domain/reconciliation-vocabulary.js";
import type { ReconciliationActionPersistence } from "./reconciliation-action-persistence.js";

function bounded(value: string, label: string, maximum: number): string { if (typeof value !== "string" || value.length < 1 || value.length > maximum || value.trim() !== value) throw new DomainValidationError("INVALID_RECONCILIATION_ACTION_TEXT", `${label} must be bounded and nonblank`); return value; }
export function actOnReconciliationFindingUseCase(dependencies: { readonly clock: Clock; readonly persistence: ReconciliationActionPersistence }) {
  return async (command: { readonly idempotencyKey: string; readonly findingId: number; readonly actionType: ReconciliationActionType; readonly actorId: string; readonly reason: string; readonly occurredAt: Date }) => {
    const input = validateApplicationInput(() => {
      if (!(["acknowledge", "resolve", "ignore"] as const).includes(command.actionType)) throw new DomainValidationError("INVALID_RECONCILIATION_ACTION", "Unsupported Reconciliation action");
      if (!(command.occurredAt instanceof Date) || Number.isNaN(command.occurredAt.getTime())) throw new DomainValidationError("INVALID_RECONCILIATION_INSTANT", "Action occurredAt must be valid");
      return { idempotencyKey: createIdempotencyKey(command.idempotencyKey), findingId: createReconciliationFindingId(command.findingId), actionType: command.actionType, actorId: bounded(command.actorId, "Actor ID", 128), reason: bounded(command.reason, "Reason", 1000), occurredAt: new Date(command.occurredAt) };
    });
    const recordedAt = dependencies.clock.now(); if (!(recordedAt instanceof Date) || Number.isNaN(recordedAt.getTime())) throw new Error("Reconciliation Clock returned an invalid instant");
    return dependencies.persistence.act({ ...input, requestFingerprint: fingerprintCanonicalPayload(canonicalizeReconciliationActionPayload(input)), recordedAt: new Date(recordedAt) });
  };
}
