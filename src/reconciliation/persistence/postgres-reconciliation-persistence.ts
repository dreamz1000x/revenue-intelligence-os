import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { IdempotencyPayloadConflict, RUN_RECONCILIATION_COMMAND } from "../../application/idempotency.js";
import { ledgerEntries } from "../../ledger/persistence/ledger-schema.js";
import { payments } from "../../payments/persistence/payment-schema.js";
import type { Database, TransactionClient } from "../../persistence/database.js";
import { idempotencyRecords } from "../../persistence/idempotency-schema.js";
import { refunds } from "../../refunds/persistence/refund-schema.js";
import { stripeWebhookEvents } from "../../stripe/persistence/stripe-webhook-event-schema.js";
import { evaluateReconciliation, type EvidenceEntityType, type FindingEvidenceReference } from "../application/evaluate-reconciliation.js";
import type { ExecuteReconciliationInput, FindingFilters, FindingReadModel, ReconciliationPersistence } from "../application/reconciliation-persistence.js";
import { reconstituteReconciliationFinding, type ReconciliationFinding } from "../domain/reconciliation-finding.js";
import { reconstituteReconciliationRun, type ReconciliationRun } from "../domain/reconciliation-run.js";
import { externalSourceEvents, reconciliationFindingEvidence, reconciliationFindings, reconciliationRuns } from "./reconciliation-schema.js";

class RunRaceLost extends Error {}
function isSerializationFailure(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && typeof candidate === "object" && candidate !== null; depth += 1) {
    if ((candidate as { code?: unknown }).code === "40001") return true;
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}
type RunRow = typeof reconciliationRuns.$inferSelect;
const fromRun = (row: RunRow): ReconciliationRun => reconstituteReconciliationRun(row);
const fromFinding = (row: typeof reconciliationFindings.$inferSelect): ReconciliationFinding => reconstituteReconciliationFinding({ ...row, ruleCode: row.ruleCode as never, ruleVersion: 1, severity: row.severity as never, subjectType: row.subjectType as never, amountDeltaCents: row.amountDeltaCents === null ? null : Number(row.amountDeltaCents), currency: "EUR", status: row.status as never });

async function findIdempotent(client: TransactionClient, input: ExecuteReconciliationInput) {
  const [record] = await client.select().from(idempotencyRecords).where(and(eq(idempotencyRecords.commandType, RUN_RECONCILIATION_COMMAND), eq(idempotencyRecords.idempotencyKey, input.idempotencyKey))).limit(1);
  if (record === undefined) return null;
  if (record.requestFingerprint !== input.requestFingerprint) throw new IdempotencyPayloadConflict();
  const [run] = await client.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, record.resourceId)).limit(1);
  if (run === undefined) throw new Error("Reconciliation idempotency record refers to a missing Run");
  return fromRun(run);
}

const evidenceValues = (findingId: number, evidence: FindingEvidenceReference, createdAt: Date) => ({ findingId, role: evidence.role, contractId: evidence.entityType === "contract" ? evidence.entityId : null, installmentId: evidence.entityType === "installment" ? evidence.entityId : null, paymentId: evidence.entityType === "payment" ? evidence.entityId : null, refundId: evidence.entityType === "refund" ? evidence.entityId : null, ledgerEntryId: evidence.entityType === "ledger_entry" ? evidence.entityId : null, stripeWebhookEventId: evidence.entityType === "stripe_webhook_event" ? evidence.entityId : null, externalSourceEventId: evidence.entityType === "external_source_event" ? evidence.entityId : null, createdAt });

export class PostgresReconciliationPersistence implements ReconciliationPersistence {
  constructor(private readonly database: Database, private readonly fault?: (stage: "run" | "finding" | "evidence") => void) {}
  async execute(input: ExecuteReconciliationInput) {
    try {
      return await this.database.repeatableReadTransaction(async (transaction) => {
        const replay = await findIdempotent(transaction, input); if (replay) return { resource: replay, outcome: "replayed" as const };
        const [existing] = await transaction.select().from(reconciliationRuns).where(eq(reconciliationRuns.runFingerprint, input.runFingerprint)).limit(1);
        if (existing) { await this.insertIdempotency(transaction, input, existing.id); return { resource: fromRun(existing), outcome: "replayed" as const }; }
        const paymentRows = await transaction.select({ id: payments.id, amountCents: payments.amountCents, ledgerEntryId: ledgerEntries.id }).from(payments).innerJoin(ledgerEntries, eq(ledgerEntries.paymentId, payments.id)).where(and(lte(payments.createdAt, input.cutoff), lte(ledgerEntries.recordedAt, input.cutoff)));
        const refundRows = await transaction.select({ id: refunds.id, paymentId: refunds.paymentId, ledgerEntryId: ledgerEntries.id }).from(refunds).innerJoin(ledgerEntries, eq(ledgerEntries.refundId, refunds.id)).where(and(lte(refunds.createdAt, input.cutoff), lte(ledgerEntries.recordedAt, input.cutoff)));
        const stripeRows = await transaction.select({ id: stripeWebhookEvents.id, stripePaymentIntentId: stripeWebhookEvents.stripePaymentIntentId, paymentId: sql<number | null>`case when ${stripeWebhookEvents.processedAt} is not null and ${stripeWebhookEvents.processedAt} <= ${input.cutoff} then ${stripeWebhookEvents.paymentId} else null end` }).from(stripeWebhookEvents).where(lte(stripeWebhookEvents.receivedAt, input.cutoff));
        const externalRows = await transaction.select().from(externalSourceEvents).where(lte(externalSourceEvents.createdAt, input.cutoff));
        const candidates = evaluateReconciliation({ payments: paymentRows.map((row) => ({ ...row, amountCents: Number(row.amountCents) })), refunds: refundRows, stripeEvents: stripeRows.filter((row): row is typeof row & { stripePaymentIntentId: string } => row.stripePaymentIntentId !== null), externalEvents: externalRows.map((row) => ({ id: row.id, eventType: row.eventType as "settlement_credit" | "refund_debit", amountCents: Number(row.amountCents), internalPaymentId: row.internalPaymentId, internalRefundId: row.internalRefundId, providerPaymentReference: row.providerPaymentReference })) });
        const [inserted] = await transaction.insert(reconciliationRuns).values({ scopeType: "global", scopeId: null, cutoff: input.cutoff, ruleSetVersion: "reconciliation-v1", runFingerprint: input.runFingerprint, status: "completed", executedAt: input.executedAt, createdAt: input.createdAt }).onConflictDoNothing({ target: reconciliationRuns.runFingerprint }).returning();
        if (!inserted) throw new RunRaceLost(); this.fault?.("run");
        for (const candidate of candidates) {
          const [finding] = await transaction.insert(reconciliationFindings).values({ runId: inserted.id, ruleCode: candidate.ruleCode, ruleVersion: 1, severity: candidate.severity, subjectType: candidate.subjectType, subjectId: candidate.subjectId, amountDeltaCents: candidate.amountDeltaCents === null ? null : BigInt(candidate.amountDeltaCents), currency: "EUR", status: "open", fingerprint: candidate.fingerprint, createdAt: input.createdAt, statusUpdatedAt: input.createdAt }).returning({ id: reconciliationFindings.id });
          if (!finding) throw new Error("Finding insert failed"); this.fault?.("finding");
          if (candidate.evidence.length > 0) await transaction.insert(reconciliationFindingEvidence).values(candidate.evidence.map((evidence) => evidenceValues(finding.id, evidence, input.createdAt)));
          this.fault?.("evidence");
        }
        await this.insertIdempotency(transaction, input, inserted.id);
        return { resource: fromRun(inserted), outcome: "created" as const };
      });
    } catch (error) {
      if (!(error instanceof RunRaceLost) && !isSerializationFailure(error)) throw error;
      return this.database.repeatableReadTransaction(async (transaction) => {
        const [winner] = await transaction.select().from(reconciliationRuns).where(eq(reconciliationRuns.runFingerprint, input.runFingerprint)).limit(1);
        if (!winner) throw new Error("Concurrent Reconciliation winner was not found");
        await this.insertIdempotency(transaction, input, winner.id);
        return { resource: fromRun(winner), outcome: "replayed" as const };
      });
    }
  }
  private async insertIdempotency(transaction: TransactionClient, input: ExecuteReconciliationInput, runId: number) {
    const inserted = await transaction.insert(idempotencyRecords).values({ commandType: RUN_RECONCILIATION_COMMAND, idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint, resourceId: runId, createdAt: input.createdAt }).onConflictDoNothing({ target: [idempotencyRecords.commandType, idempotencyRecords.idempotencyKey] }).returning({ resourceId: idempotencyRecords.resourceId, requestFingerprint: idempotencyRecords.requestFingerprint });
    if (inserted.length === 0) { const replay = await findIdempotent(transaction, input); if (!replay || replay.id !== runId) throw new IdempotencyPayloadConflict(); }
  }
  async getRunById(id: number) { const [row] = await this.database.client.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, id)).limit(1); return row ? fromRun(row) : null; }
  async listRuns(limit: number) { return (await this.database.client.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.createdAt), desc(reconciliationRuns.id)).limit(limit)).map(fromRun); }
  async getFindingById(id: number): Promise<FindingReadModel | null> { const [row] = await this.database.client.select().from(reconciliationFindings).where(eq(reconciliationFindings.id, id)).limit(1); if (!row) return null; const evidence = await this.database.client.select().from(reconciliationFindingEvidence).where(eq(reconciliationFindingEvidence.findingId, id)).orderBy(asc(reconciliationFindingEvidence.id)); return { finding: fromFinding(row), evidence: evidence.map((item) => { const pairs: Array<[EvidenceEntityType, number | null]> = [["contract", item.contractId], ["installment", item.installmentId], ["payment", item.paymentId], ["refund", item.refundId], ["ledger_entry", item.ledgerEntryId], ["stripe_webhook_event", item.stripeWebhookEventId], ["external_source_event", item.externalSourceEventId]]; const [entityType, entityId] = pairs.find(([, value]) => value !== null)!; return { entityType, entityId: entityId!, role: item.role as never }; }) }; }
  async listFindings(filters: FindingFilters) { const conditions = [filters.runId === undefined ? undefined : eq(reconciliationFindings.runId, filters.runId), filters.status === undefined ? undefined : eq(reconciliationFindings.status, filters.status), filters.severity === undefined ? undefined : eq(reconciliationFindings.severity, filters.severity), filters.ruleCode === undefined ? undefined : eq(reconciliationFindings.ruleCode, filters.ruleCode)].filter((value) => value !== undefined); return (await this.database.client.select().from(reconciliationFindings).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(reconciliationFindings.createdAt), desc(reconciliationFindings.id)).limit(filters.limit)).map(fromFinding); }
}
