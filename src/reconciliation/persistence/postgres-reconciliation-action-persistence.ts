import { and, eq } from "drizzle-orm";
import { ACT_ON_RECONCILIATION_FINDING_COMMAND, IdempotencyPayloadConflict } from "../../application/idempotency.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import type { Database, TransactionClient } from "../../persistence/database.js";
import { idempotencyRecords } from "../../persistence/idempotency-schema.js";
import type { ActOnFindingInput, ReconciliationActionPersistence } from "../application/reconciliation-action-persistence.js";
import { IllegalReconciliationTransition, ReconciliationFindingNotFoundError } from "../application/reconciliation-action-persistence.js";
import { reconstituteReconciliationAction } from "../domain/reconciliation-action.js";
import { targetStatusForAction } from "../domain/reconciliation-vocabulary.js";
import { reconciliationActions, reconciliationFindings } from "./reconciliation-schema.js";

type ActionRow = typeof reconciliationActions.$inferSelect;
const fromRow = (row: ActionRow) => reconstituteReconciliationAction({ ...row, actionType: row.actionType as never, fromStatus: row.fromStatus as never, toStatus: row.toStatus as never });
async function replay(client: TransactionClient, input: ActOnFindingInput) { const [record] = await client.select().from(idempotencyRecords).where(and(eq(idempotencyRecords.commandType, ACT_ON_RECONCILIATION_FINDING_COMMAND), eq(idempotencyRecords.idempotencyKey, input.idempotencyKey))).limit(1); if (!record) return null; if (record.requestFingerprint !== input.requestFingerprint) throw new IdempotencyPayloadConflict(); const [action] = await client.select().from(reconciliationActions).where(eq(reconciliationActions.id, record.resourceId)).limit(1); if (!action) throw new Error("Action idempotency record refers to a missing Action"); return fromRow(action); }

export class PostgresReconciliationActionPersistence implements ReconciliationActionPersistence {
  constructor(private readonly database: Database, private readonly fault?: () => void) {}
  async act(input: ActOnFindingInput) {
    return this.database.transaction(async (transaction) => {
      const fast = await replay(transaction, input); if (fast) return { resource: fast, outcome: "replayed" as const };
      const [finding] = await transaction.select({ id: reconciliationFindings.id, status: reconciliationFindings.status }).from(reconciliationFindings).where(eq(reconciliationFindings.id, input.findingId)).for("update");
      if (!finding) throw new ReconciliationFindingNotFoundError(input.findingId);
      const afterLock = await replay(transaction, input); if (afterLock) return { resource: afterLock, outcome: "replayed" as const };
      let toStatus; try { toStatus = targetStatusForAction(finding.status as never, input.actionType); } catch (error) { if (error instanceof DomainValidationError && error.code === "ILLEGAL_RECONCILIATION_TRANSITION") throw new IllegalReconciliationTransition(finding.id, finding.status, input.actionType); throw error; }
      const [inserted] = await transaction.insert(reconciliationActions).values({ findingId: finding.id, actionType: input.actionType, fromStatus: finding.status, toStatus, actorType: "operator", actorId: input.actorId, reason: input.reason, idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint, occurredAt: input.occurredAt, recordedAt: input.recordedAt }).returning();
      if (!inserted) throw new Error("Action insert failed");
      await transaction.update(reconciliationFindings).set({ status: toStatus, statusUpdatedAt: input.recordedAt }).where(eq(reconciliationFindings.id, finding.id));
      this.fault?.();
      const record = await transaction.insert(idempotencyRecords).values({ commandType: ACT_ON_RECONCILIATION_FINDING_COMMAND, idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint, resourceId: inserted.id, createdAt: input.recordedAt }).onConflictDoNothing({ target: [idempotencyRecords.commandType, idempotencyRecords.idempotencyKey] }).returning({ resourceId: idempotencyRecords.resourceId });
      if (record.length === 0) {
        const winner = await replay(transaction, input);
        if (winner !== null) throw new Error("Unexpected identical Action race outside the Finding lock");
        throw new Error("Concurrent Action idempotency winner was not found");
      }
      return { resource: fromRow(inserted), outcome: "created" as const };
    });
  }
}
