import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";

import { IdempotencyPayloadConflict } from "../../application/idempotency.js";
import { CustomerNotFoundError } from "../../contracts/application/customer-not-found-error.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { ContractNotFoundError } from "../../payments/application/contract-not-found-error.js";
import { PaymentExceedsOutstandingError } from "../../payments/domain/payment-allocation.js";
import { StripeEventEvidenceConflict } from "../../stripe/application/stripe-webhook-event-persistence.js";

export class PublicHttpError extends Error {
  override readonly name = "PublicHttpError";

  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

function sendPublicError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
) {
  return reply.status(statusCode).send({ error: { code, message } });
}

function isMalformedJsonError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { readonly code?: unknown; readonly statusCode?: unknown };
  return (
    candidate.statusCode === 400 &&
    candidate.code === "FST_ERR_CTP_INVALID_JSON_BODY"
  );
}

function isPayloadTooLargeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly code?: unknown }).code ===
      "FST_ERR_CTP_BODY_TOO_LARGE"
  );
}

function isStripeWebhookUrl(url: string): boolean {
  return url.split("?", 1)[0] === "/webhooks/stripe";
}

export function registerPublicErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PublicHttpError) {
      return sendPublicError(
        reply,
        error.statusCode,
        error.code,
        error.publicMessage,
      );
    }

    if (
      isPayloadTooLargeError(error) &&
      isStripeWebhookUrl(request.url)
    ) {
      return sendPublicError(
        reply,
        413,
        "PAYLOAD_TOO_LARGE",
        "Payload too large",
      );
    }

    if (
      error instanceof ZodError ||
      isMalformedJsonError(error)
    ) {
      return sendPublicError(reply, 400, "INVALID_REQUEST", "Invalid request");
    }

    if (error instanceof DomainValidationError) {
      return sendPublicError(reply, 422, "INVALID_INPUT", "Invalid input");
    }

    if (error instanceof IdempotencyPayloadConflict) {
      return sendPublicError(
        reply,
        409,
        "IDEMPOTENCY_PAYLOAD_CONFLICT",
        "Idempotency key is already associated with a different payload",
      );
    }

    if (error instanceof StripeEventEvidenceConflict) {
      return sendPublicError(
        reply,
        409,
        "STRIPE_EVENT_EVIDENCE_CONFLICT",
        "Stripe event conflicts with retained evidence",
      );
    }

    if (error instanceof CustomerNotFoundError) {
      return sendPublicError(
        reply,
        404,
        "CUSTOMER_NOT_FOUND",
        "Customer not found",
      );
    }

    if (error instanceof ContractNotFoundError) {
      return sendPublicError(
        reply,
        404,
        "CONTRACT_NOT_FOUND",
        "Contract not found",
      );
    }

    if (error instanceof PaymentExceedsOutstandingError) {
      return sendPublicError(
        reply,
        422,
        "PAYMENT_EXCEEDS_OUTSTANDING",
        "Payment exceeds outstanding amount",
      );
    }

    if (isStripeWebhookUrl(request.url)) {
      request.log.error(
        { code: "UNEXPECTED_STRIPE_WEBHOOK_ERROR" },
        "Unexpected Stripe webhook error",
      );
    } else {
      request.log.error(error);
    }
    return sendPublicError(reply, 500, "INTERNAL_ERROR", "Internal server error");
  });
}
