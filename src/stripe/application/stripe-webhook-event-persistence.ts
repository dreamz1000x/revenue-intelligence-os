export type StripeWebhookEventStatus =
  | "received"
  | "processing"
  | "processed"
  | "failed";

export type StripeWebhookFailureCode =
  | "INVALID_EVENT"
  | "INVALID_CONTRACT_MAPPING"
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY"
  | "CONTRACT_NOT_FOUND"
  | "PAYMENT_EXCEEDS_OUTSTANDING"
  | "IDEMPOTENCY_PAYLOAD_CONFLICT";

export interface StoreStripeWebhookReceiptInput {
  readonly stripeEventId: string;
  readonly eventType: "payment_intent.succeeded";
  readonly stripePaymentIntentId: string | null;
  readonly rawPayload: Buffer;
  readonly receivedAt: Date;
}

export interface RetainedStripeWebhookEvent {
  readonly id: number;
  readonly stripeEventId: string;
  readonly eventType: "payment_intent.succeeded";
  readonly stripePaymentIntentId: string | null;
  readonly rawPayload: Buffer;
  readonly receivedAt: Date;
  readonly status: StripeWebhookEventStatus;
  readonly processingToken: string | null;
  readonly processingStartedAt: Date | null;
  readonly processedAt: Date | null;
  readonly paymentId: number | null;
  readonly lastErrorCode: StripeWebhookFailureCode | null;
}

export class StripeEventEvidenceConflict extends Error {
  override readonly name = "StripeEventEvidenceConflict";

  constructor(readonly stripeEventId: string) {
    super(`Stripe Event ${stripeEventId} conflicts with retained evidence`);
  }
}

export class StripeWebhookClaimLostError extends Error {
  override readonly name = "StripeWebhookClaimLostError";

  constructor(readonly eventId: number) {
    super(`Processing ownership for Stripe webhook event ${eventId} was lost`);
  }
}

export type StoreStripeWebhookReceiptResult = {
  readonly event: RetainedStripeWebhookEvent;
  readonly outcome: "stored" | "replayed";
};

export type StripeWebhookClaimResult =
  | { readonly outcome: "claimed"; readonly event: RetainedStripeWebhookEvent }
  | { readonly outcome: "processed" }
  | { readonly outcome: "failed" }
  | { readonly outcome: "busy" };

export interface StripeWebhookEventPersistence {
  storeReceipt(
    input: StoreStripeWebhookReceiptInput,
  ): Promise<StoreStripeWebhookReceiptResult>;
  claimForProcessing(
    eventId: number,
    processingToken: string,
  ): Promise<StripeWebhookClaimResult>;
  markProcessed(input: {
    readonly eventId: number;
    readonly processingToken: string;
    readonly paymentId: number;
    readonly processedAt: Date;
  }): Promise<void>;
  markFailed(input: {
    readonly eventId: number;
    readonly processingToken: string;
    readonly errorCode: StripeWebhookFailureCode;
    readonly processedAt: Date;
  }): Promise<void>;
  releaseForRetry(eventId: number, processingToken: string): Promise<void>;
}
