import type { Clock } from "../../application/clock.js";
import type { CreateCommandResult } from "../../application/create-command-result.js";
import { fingerprintCanonicalPayload, createIdempotencyKey } from "../../application/idempotency.js";
import { validateApplicationInput } from "../../application/input-validation.js";
import { canonicalizeReconciliationRun, fingerprintReconciliationRun, type ReconciliationRun } from "../domain/reconciliation-run.js";
import type { ReconciliationPersistence } from "./reconciliation-persistence.js";

export function runReconciliationUseCase(dependencies: { readonly clock: Clock; readonly persistence: ReconciliationPersistence }) {
  return async (command: { readonly idempotencyKey: string; readonly cutoff: Date }): Promise<CreateCommandResult<ReconciliationRun>> => {
    const validated = validateApplicationInput(() => ({ idempotencyKey: createIdempotencyKey(command.idempotencyKey), canonical: canonicalizeReconciliationRun(command.cutoff), cutoff: new Date(command.cutoff) }));
    const executedAt = dependencies.clock.now();
    if (!(executedAt instanceof Date) || Number.isNaN(executedAt.getTime())) throw new Error("Reconciliation Clock returned an invalid instant");
    return dependencies.persistence.execute({ idempotencyKey: validated.idempotencyKey, requestFingerprint: fingerprintCanonicalPayload(validated.canonical), cutoff: validated.cutoff, runFingerprint: fingerprintReconciliationRun(validated.cutoff), executedAt: new Date(executedAt), createdAt: new Date(executedAt) });
  };
}
