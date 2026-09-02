import type { CreateCommandResult } from "../../application/create-command-result.js";
import type { IdempotencyKey, RequestFingerprint } from "../../application/idempotency.js";
import type { ReconciliationFinding } from "../domain/reconciliation-finding.js";
import type { ReconciliationRun } from "../domain/reconciliation-run.js";
import type { ReconciliationAction } from "../domain/reconciliation-action.js";
import type { FindingEvidenceReference } from "./evaluate-reconciliation.js";

export interface ExecuteReconciliationInput { readonly idempotencyKey: IdempotencyKey; readonly requestFingerprint: RequestFingerprint; readonly cutoff: Date; readonly runFingerprint: string; readonly executedAt: Date; readonly createdAt: Date; }
export interface FindingReadModel { readonly finding: ReconciliationFinding; readonly evidence: ReadonlyArray<FindingEvidenceReference>; readonly actions: ReadonlyArray<ReconciliationAction>; }
export interface FindingFilters { readonly runId?: number; readonly status?: string; readonly severity?: string; readonly ruleCode?: string; readonly limit: number; }
export interface ReconciliationPersistence {
  execute(input: ExecuteReconciliationInput): Promise<CreateCommandResult<ReconciliationRun>>;
  getRunById(id: number): Promise<ReconciliationRun | null>;
  listRuns(limit: number): Promise<ReadonlyArray<ReconciliationRun>>;
  getFindingById(id: number): Promise<FindingReadModel | null>;
  listFindings(filters: FindingFilters): Promise<ReadonlyArray<ReconciliationFinding>>;
}
