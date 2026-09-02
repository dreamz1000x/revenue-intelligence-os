import { and, eq } from "drizzle-orm";
import type { Database } from "../../persistence/database.js";
import { payments } from "../../payments/persistence/payment-schema.js";
import { refunds } from "../../refunds/persistence/refund-schema.js";
import { reconstituteExternalSourceEvent, type ExternalSourceMetadata } from "../domain/external-source-event.js";
import type { ExternalSourceEventPersistence, RecordExternalSourceEventInput, RecordExternalSourceEventResult } from "../application/external-source-event-persistence.js";
import { ExternalEventEvidenceConflict, ExternalPaymentReferenceNotFoundError, ExternalRefundReferenceNotFoundError } from "../application/external-source-event-persistence.js";
import { externalSourceEvents } from "./reconciliation-schema.js";

type Row = typeof externalSourceEvents.$inferSelect;
function fromRow(row: Row) { return reconstituteExternalSourceEvent({ ...row, eventType: row.eventType as "settlement_credit" | "refund_debit", amountCents: Number(row.amountCents), metadata: row.metadata }); }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}
function matches(row: Row, input: RecordExternalSourceEventInput): boolean {
  return row.eventType === input.eventType && row.amountCents === BigInt(input.amountCents) && row.currency === input.currency && row.occurredAt.getTime() === input.occurredAt.getTime() && row.receivedAt.getTime() === input.receivedAt.getTime() && row.externalReference === input.externalReference && row.internalPaymentId === input.internalPaymentId && row.internalRefundId === input.internalRefundId && row.providerPaymentReference === input.providerPaymentReference && row.rawPayload.equals(input.rawPayload) && canonicalJson(row.metadata) === canonicalJson(input.metadata);
}

export class PostgresExternalSourceEventPersistence implements ExternalSourceEventPersistence {
  constructor(private readonly database: Database) {}
  async record(input: RecordExternalSourceEventInput): Promise<RecordExternalSourceEventResult> {
    return this.database.transaction(async (transaction) => {
      if (input.internalPaymentId !== null) {
        const found = await transaction.select({ id: payments.id }).from(payments).where(eq(payments.id, input.internalPaymentId)).limit(1);
        if (found.length === 0) throw new ExternalPaymentReferenceNotFoundError(input.internalPaymentId);
      }
      if (input.internalRefundId !== null) {
        const found = await transaction.select({ id: refunds.id }).from(refunds).where(eq(refunds.id, input.internalRefundId)).limit(1);
        if (found.length === 0) throw new ExternalRefundReferenceNotFoundError(input.internalRefundId);
      }
      const [inserted] = await transaction.insert(externalSourceEvents).values({ ...input, amountCents: BigInt(input.amountCents), metadata: input.metadata }).onConflictDoNothing({ target: [externalSourceEvents.source, externalSourceEvents.sourceEventId] }).returning();
      const row = inserted ?? (await transaction.select().from(externalSourceEvents).where(and(eq(externalSourceEvents.source, input.source), eq(externalSourceEvents.sourceEventId, input.sourceEventId))).limit(1))[0];
      if (row === undefined) throw new Error("Retained external source event could not be loaded");
      if (!matches(row, input)) throw new ExternalEventEvidenceConflict(input.source, input.sourceEventId);
      return { resource: fromRow(row), outcome: inserted === undefined ? "replayed" : "created" };
    });
  }
  async getById(id: number) { const [row] = await this.database.client.select().from(externalSourceEvents).where(eq(externalSourceEvents.id, id)).limit(1); return row === undefined ? null : fromRow(row); }
}
