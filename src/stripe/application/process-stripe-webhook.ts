import { randomUUID } from "node:crypto";

import type { Clock } from "../../application/clock.js";
import { IdempotencyPayloadConflict } from "../../application/idempotency.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { ContractNotFoundError } from "../../payments/application/contract-not-found-error.js";
import type { recordPaymentUseCase } from "../../payments/application/record-payment.js";
import { PaymentExceedsOutstandingError } from "../../payments/domain/payment-allocation.js";
import {
  extractStripePaymentIntentId,
  normalizeRetainedStripePaymentEvent,
  STRIPE_PAYMENT_INTENT_SUCCEEDED,
  StripeWebhookPermanentError,
} from "./stripe-webhook-event.js";
import type {
  StripeWebhookEventPersistence,
  StripeWebhookFailureCode,
} from "./stripe-webhook-event-persistence.js";

export interface ProcessStripeWebhookInput {
  readonly verifiedEvent: unknown;
  readonly stripeEventId: string;
  readonly rawPayload: Buffer;
  readonly receivedAt: Date;
}

export type ProcessStripeWebhookResult = {
  readonly outcome: "processed" | "failed" | "busy";
};

function permanentFailureCode(error: unknown): StripeWebhookFailureCode | null {
  if (error instanceof StripeWebhookPermanentError) {
    return error.code;
  }
  if (error instanceof ContractNotFoundError) {
    return "CONTRACT_NOT_FOUND";
  }
  if (error instanceof PaymentExceedsOutstandingError) {
    return "PAYMENT_EXCEEDS_OUTSTANDING";
  }
  if (error instanceof IdempotencyPayloadConflict) {
    return "IDEMPOTENCY_PAYLOAD_CONFLICT";
  }
  if (error instanceof DomainValidationError) {
    if (error.code === "INVALID_ID") {
      return "INVALID_CONTRACT_MAPPING";
    }
    if (error.code === "INVALID_MONEY_CENTS") {
      return "INVALID_AMOUNT";
    }
    if (error.code === "INVALID_PAYMENT_INSTANT") {
      return "INVALID_EVENT";
    }
  }
  return null;
}

export function processStripeWebhookUseCase(dependencies: {
  readonly clock: Clock;
  readonly persistence: StripeWebhookEventPersistence;
  readonly recordPayment: ReturnType<typeof recordPaymentUseCase>;
}) {
  return async (
    input: ProcessStripeWebhookInput,
  ): Promise<ProcessStripeWebhookResult> => {
    const receipt = await dependencies.persistence.storeReceipt({
      stripeEventId: input.stripeEventId,
      eventType: STRIPE_PAYMENT_INTENT_SUCCEEDED,
      stripePaymentIntentId: extractStripePaymentIntentId(input.verifiedEvent),
      rawPayload: Buffer.from(input.rawPayload),
      receivedAt: new Date(input.receivedAt.getTime()),
    });
    const processingToken = randomUUID();
    const claim = await dependencies.persistence.claimForProcessing(
      receipt.event.id,
      processingToken,
    );

    if (claim.outcome !== "claimed") {
      return { outcome: claim.outcome };
    }

    try {
      const normalized = normalizeRetainedStripePaymentEvent(
        claim.event.rawPayload,
      );
      if (
        normalized.stripeEventId !== claim.event.stripeEventId ||
        normalized.stripePaymentIntentId !==
          claim.event.stripePaymentIntentId
      ) {
        throw new StripeWebhookPermanentError("INVALID_EVENT");
      }

      try {
        const payment = await dependencies.recordPayment({
          idempotencyKey: normalized.idempotencyKey,
          contractId: normalized.contractId,
          amountCents: normalized.amountCents,
          receivedAt: normalized.receivedAt,
        });
        await dependencies.persistence.markProcessed({
          eventId: claim.event.id,
          processingToken,
          paymentId: payment.resource.id,
          processedAt: dependencies.clock.now(),
        });
        return { outcome: "processed" };
      } catch (error) {
        const errorCode = permanentFailureCode(error);
        if (errorCode === null) {
          throw error;
        }
        await dependencies.persistence.markFailed({
          eventId: claim.event.id,
          processingToken,
          errorCode,
          processedAt: dependencies.clock.now(),
        });
        return { outcome: "failed" };
      }
    } catch (error) {
      const errorCode = permanentFailureCode(error);
      if (errorCode !== null) {
        try {
          await dependencies.persistence.markFailed({
            eventId: claim.event.id,
            processingToken,
            errorCode,
            processedAt: dependencies.clock.now(),
          });
          return { outcome: "failed" };
        } catch (finalizationError) {
          try {
            await dependencies.persistence.releaseForRetry(
              claim.event.id,
              processingToken,
            );
          } catch {
            // The lease provides recovery when even release cannot be persisted.
          }
          throw finalizationError;
        }
      }

      try {
        await dependencies.persistence.releaseForRetry(
          claim.event.id,
          processingToken,
        );
      } catch {
        // Preserve the original infrastructure failure; the lease remains recoverable.
      }
      throw error;
    }
  };
}
