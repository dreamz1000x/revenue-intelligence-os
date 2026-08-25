import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";

import { IdempotencyPayloadConflict } from "../../application/idempotency.js";
import { CustomerNotFoundError } from "../../contracts/application/customer-not-found-error.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";

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

    if (error instanceof CustomerNotFoundError) {
      return sendPublicError(
        reply,
        404,
        "CUSTOMER_NOT_FOUND",
        "Customer not found",
      );
    }

    request.log.error(error);
    return sendPublicError(reply, 500, "INTERNAL_ERROR", "Internal server error");
  });
}
