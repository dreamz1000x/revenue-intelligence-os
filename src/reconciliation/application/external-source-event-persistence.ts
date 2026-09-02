import type { ExternalSourceEvent, ExternalSourceMetadata, ExternalSourceEventType } from "../domain/external-source-event.js";

export interface RecordExternalSourceEventInput {
  readonly source: string; readonly sourceEventId: string; readonly eventType: ExternalSourceEventType;
  readonly amountCents: number; readonly currency: "EUR"; readonly occurredAt: Date; readonly receivedAt: Date;
  readonly externalReference: string; readonly internalPaymentId: number | null; readonly internalRefundId: number | null;
  readonly providerPaymentReference: string | null; readonly rawPayload: Buffer;
  readonly metadata: ExternalSourceMetadata; readonly createdAt: Date;
}
export type RecordExternalSourceEventResult = { readonly resource: ExternalSourceEvent; readonly outcome: "created" | "replayed" };
export interface ExternalSourceEventPersistence {
  record(input: RecordExternalSourceEventInput): Promise<RecordExternalSourceEventResult>;
  getById(id: number): Promise<ExternalSourceEvent | null>;
}
export class ExternalEventEvidenceConflict extends Error { override readonly name = "ExternalEventEvidenceConflict"; constructor(readonly source: string, readonly sourceEventId: string) { super(`External event ${source}/${sourceEventId} conflicts with retained evidence`); } }
export class ExternalPaymentReferenceNotFoundError extends Error { override readonly name = "ExternalPaymentReferenceNotFoundError"; constructor(readonly paymentId: number) { super(`Payment ${paymentId} was not found`); } }
export class ExternalRefundReferenceNotFoundError extends Error { override readonly name = "ExternalRefundReferenceNotFoundError"; constructor(readonly refundId: number) { super(`Refund ${refundId} was not found`); } }
