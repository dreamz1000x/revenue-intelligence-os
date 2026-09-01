import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createPaymentId, type PaymentId } from "../../payments/domain/ids.js";
import { createRefundId, type RefundId } from "../../refunds/domain/ids.js";
import { createExternalSourceEventId, type ExternalSourceEventId } from "./ids.js";

export type ExternalSourceEventType = "settlement_credit" | "refund_debit";
export type ExternalSourceMetadata = Readonly<Record<string, unknown>>;

export interface ExternalSourceEvent {
  readonly id: ExternalSourceEventId; readonly source: string; readonly sourceEventId: string;
  readonly eventType: ExternalSourceEventType; readonly amountCents: number; readonly currency: "EUR";
  readonly occurredAt: Date; readonly receivedAt: Date; readonly externalReference: string;
  readonly internalPaymentId: PaymentId | null; readonly internalRefundId: RefundId | null;
  readonly providerPaymentReference: string | null; readonly rawPayload: Buffer;
  readonly metadata: ExternalSourceMetadata; readonly createdAt: Date;
}

const SECRET_KEY = /(?:authorization|password|secret|token|api[_-]?key|credential)/i;

function boundedVisible(value: string, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || value.trim() !== value || !/^[\x20-\x7e]+$/.test(value)) throw new DomainValidationError("INVALID_EXTERNAL_SOURCE_TEXT", `${label} must be a bounded nonblank visible string`);
  return value;
}

function copyInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new DomainValidationError("INVALID_EXTERNAL_SOURCE_INSTANT", `${label} must be a valid instant`);
  return new Date(value.getTime());
}

function copyMetadata(value: unknown): ExternalSourceMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DomainValidationError("INVALID_EXTERNAL_SOURCE_METADATA", "External source metadata must be an object");
  const json = JSON.stringify(value);
  if (json === undefined || Buffer.byteLength(json, "utf8") > 16_384) throw new DomainValidationError("INVALID_EXTERNAL_SOURCE_METADATA", "External source metadata must be bounded JSON");
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) { candidate.forEach(visit); Object.freeze(candidate); return; }
    if (typeof candidate !== "object" || candidate === null) return;
    for (const [key, nested] of Object.entries(candidate)) {
      if (SECRET_KEY.test(key)) throw new DomainValidationError("SENSITIVE_EXTERNAL_SOURCE_METADATA", "External source metadata must not contain credential fields");
      visit(nested);
    }
    Object.freeze(candidate);
  };
  visit(parsed);
  return parsed;
}

export function reconstituteExternalSourceEvent(input: {
  readonly id: number; readonly source: string; readonly sourceEventId: string;
  readonly eventType: ExternalSourceEventType; readonly amountCents: number; readonly currency: string;
  readonly occurredAt: Date; readonly receivedAt: Date; readonly externalReference: string;
  readonly internalPaymentId: number | null; readonly internalRefundId: number | null;
  readonly providerPaymentReference: string | null; readonly rawPayload: Buffer;
  readonly metadata: unknown; readonly createdAt: Date;
}): ExternalSourceEvent {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) throw new DomainValidationError("INVALID_EXTERNAL_SOURCE_AMOUNT", "External source amount must be a positive safe integer");
  if (input.currency !== "EUR") throw new DomainValidationError("INVALID_CURRENCY", "External source currency must be EUR");
  if (!Buffer.isBuffer(input.rawPayload) || input.rawPayload.length < 1 || input.rawPayload.length > 1_048_576) throw new DomainValidationError("INVALID_EXTERNAL_SOURCE_PAYLOAD", "External source raw payload must contain 1 to 1048576 bytes");
  const paymentId = input.internalPaymentId === null ? null : createPaymentId(input.internalPaymentId);
  const refundId = input.internalRefundId === null ? null : createRefundId(input.internalRefundId);
  const providerReference = input.providerPaymentReference === null ? null : boundedVisible(input.providerPaymentReference, "Provider payment reference", 255);
  if ((input.eventType === "settlement_credit" && refundId !== null) || (input.eventType === "refund_debit" && (paymentId !== null || providerReference !== null)) || (input.eventType !== "settlement_credit" && input.eventType !== "refund_debit")) throw new DomainValidationError("INVALID_EXTERNAL_SOURCE_REFERENCES", "External source references must match the event type");
  const occurredAt = copyInstant(input.occurredAt, "External source occurredAt");
  const receivedAt = copyInstant(input.receivedAt, "External source receivedAt");
  const createdAt = copyInstant(input.createdAt, "External source createdAt");
  const rawPayload = Buffer.from(input.rawPayload);
  const metadata = copyMetadata(input.metadata);
  return Object.freeze({
    id: createExternalSourceEventId(input.id), source: boundedVisible(input.source, "External source", 64), sourceEventId: boundedVisible(input.sourceEventId, "External source event ID", 255), eventType: input.eventType, amountCents: input.amountCents, currency: "EUR",
    get occurredAt() { return new Date(occurredAt); }, get receivedAt() { return new Date(receivedAt); }, externalReference: boundedVisible(input.externalReference, "External reference", 255),
    internalPaymentId: paymentId, internalRefundId: refundId, providerPaymentReference: providerReference,
    get rawPayload() { return Buffer.from(rawPayload); }, metadata, get createdAt() { return new Date(createdAt); },
  });
}
