import type { Clock } from "../../application/clock.js";
import { validateApplicationInput } from "../../application/input-validation.js";
import { reconstituteExternalSourceEvent, type ExternalSourceEventType } from "../domain/external-source-event.js";
import type { ExternalSourceEventPersistence, RecordExternalSourceEventResult } from "./external-source-event-persistence.js";

export interface RecordExternalSourceEventCommand {
  readonly source: string; readonly sourceEventId: string; readonly eventType: ExternalSourceEventType;
  readonly amountCents: number; readonly currency: string; readonly occurredAt: Date; readonly receivedAt: Date;
  readonly externalReference: string; readonly internalPaymentId?: number | null; readonly internalRefundId?: number | null;
  readonly providerPaymentReference?: string | null; readonly rawPayload: Buffer; readonly metadata: unknown;
}

export function recordExternalSourceEventUseCase(dependencies: { readonly clock: Clock; readonly persistence: ExternalSourceEventPersistence }) {
  return async (command: RecordExternalSourceEventCommand): Promise<RecordExternalSourceEventResult> => {
    const validated = validateApplicationInput(() => reconstituteExternalSourceEvent({
      ...command, id: 1, internalPaymentId: command.internalPaymentId ?? null,
      internalRefundId: command.internalRefundId ?? null,
      providerPaymentReference: command.providerPaymentReference ?? null,
      createdAt: new Date(0),
    }));
    const createdAt = dependencies.clock.now();
    reconstituteExternalSourceEvent({
      id: 1, source: validated.source, sourceEventId: validated.sourceEventId,
      eventType: validated.eventType, amountCents: validated.amountCents, currency: validated.currency,
      occurredAt: validated.occurredAt, receivedAt: validated.receivedAt,
      externalReference: validated.externalReference, internalPaymentId: validated.internalPaymentId,
      internalRefundId: validated.internalRefundId, providerPaymentReference: validated.providerPaymentReference,
      rawPayload: validated.rawPayload, metadata: validated.metadata, createdAt,
    });
    return dependencies.persistence.record({
      source: validated.source, sourceEventId: validated.sourceEventId, eventType: validated.eventType,
      amountCents: validated.amountCents, currency: validated.currency, occurredAt: validated.occurredAt,
      receivedAt: validated.receivedAt, externalReference: validated.externalReference,
      internalPaymentId: validated.internalPaymentId, internalRefundId: validated.internalRefundId,
      providerPaymentReference: validated.providerPaymentReference, rawPayload: validated.rawPayload,
      metadata: validated.metadata, createdAt: new Date(createdAt),
    });
  };
}
