import type { FastifyRequest } from "fastify";

import { PublicHttpError } from "./error-handler.js";

const IDEMPOTENCY_HEADER_NAME = "idempotency-key";
const STRIPE_SIGNATURE_HEADER_NAME = "stripe-signature";

export function idempotencyKeyFromRawHeaders(
  rawHeaders: ReadonlyArray<string>,
): string {
  const values: string[] = [];

  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];

    if (name?.toLowerCase() === IDEMPOTENCY_HEADER_NAME) {
      if (value === undefined) {
        throw new PublicHttpError(
          400,
          "INVALID_IDEMPOTENCY_KEY_HEADER",
          "Idempotency-Key header must occur exactly once",
        );
      }
      values.push(value);
    }
  }

  if (values.length === 0) {
    throw new PublicHttpError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key header is required",
    );
  }

  if (values.length !== 1) {
    throw new PublicHttpError(
      400,
      "INVALID_IDEMPOTENCY_KEY_HEADER",
      "Idempotency-Key header must occur exactly once",
    );
  }

  return values[0]!;
}

export function requireIdempotencyKey(request: FastifyRequest): string {
  return idempotencyKeyFromRawHeaders(request.raw.rawHeaders);
}

export function stripeSignatureFromRawHeaders(
  rawHeaders: ReadonlyArray<string>,
): string {
  const values: string[] = [];

  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];

    if (name?.toLowerCase() === STRIPE_SIGNATURE_HEADER_NAME) {
      if (value === undefined) {
        throw new PublicHttpError(
          400,
          "INVALID_STRIPE_SIGNATURE_HEADER",
          "Stripe-Signature header must occur exactly once",
        );
      }
      values.push(value);
    }
  }

  if (values.length === 0) {
    throw new PublicHttpError(
      400,
      "STRIPE_SIGNATURE_REQUIRED",
      "Stripe-Signature header is required",
    );
  }
  if (values.length !== 1) {
    throw new PublicHttpError(
      400,
      "INVALID_STRIPE_SIGNATURE_HEADER",
      "Stripe-Signature header must occur exactly once",
    );
  }

  return values[0]!;
}

export function requireStripeSignature(request: FastifyRequest): string {
  return stripeSignatureFromRawHeaders(request.raw.rawHeaders);
}
