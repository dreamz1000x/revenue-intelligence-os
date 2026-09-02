import type { IdempotencyKey, RequestFingerprint } from "../../application/idempotency.js";
import type { ReconciliationAction } from "../domain/reconciliation-action.js";
import type { ReconciliationActionType } from "../domain/reconciliation-vocabulary.js";
export interface ActOnFindingInput { readonly idempotencyKey: IdempotencyKey; readonly requestFingerprint: RequestFingerprint; readonly findingId: number; readonly actionType: ReconciliationActionType; readonly actorId: string; readonly reason: string; readonly occurredAt: Date; readonly recordedAt: Date; }
export type ActOnFindingResult = { readonly resource: ReconciliationAction; readonly outcome: "created" | "replayed" };
export interface ReconciliationActionPersistence { act(input: ActOnFindingInput): Promise<ActOnFindingResult>; }
export class ReconciliationFindingNotFoundError extends Error { override readonly name = "ReconciliationFindingNotFoundError"; constructor(readonly findingId: number) { super(`Reconciliation Finding ${findingId} was not found`); } }
export class IllegalReconciliationTransition extends Error { override readonly name = "IllegalReconciliationTransition"; constructor(readonly findingId: number, readonly status: string, readonly action: string) { super(`Cannot ${action} Finding ${findingId} from ${status}`); } }
