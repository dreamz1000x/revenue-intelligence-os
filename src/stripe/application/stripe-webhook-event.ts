import { createHash } from "node:crypto";

export const STRIPE_PAYMENT_INTENT_SUCCEEDED =
  "payment_intent.succeeded" as const;

export type StripeWebhookPermanentErrorCode =
  | "INVALID_EVENT"
  | "INVALID_CONTRACT_MAPPING"
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY";

export class StripeWebhookPermanentError extends Error {
  override readonly name = "StripeWebhookPermanentError";

  constructor(readonly code: StripeWebhookPermanentErrorCode) {
    super(code);
  }
}

export interface StripeEventEnvelope {
  readonly id: string;
  readonly type: string;
  readonly livemode: boolean;
}

export interface NormalizedStripePaymentEvent {
  readonly stripeEventId: string;
  readonly stripePaymentIntentId: string;
  readonly contractId: number;
  readonly amountCents: number;
  readonly receivedAt: Date;
  readonly idempotencyKey: string;
}

const STRIPE_EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]+$/;
const STRIPE_PAYMENT_INTENT_ID_PATTERN = /^pi_[A-Za-z0-9]+$/;
const CONTRACT_ID_PATTERN = /^[1-9][0-9]*$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStripeIdentifier(
  value: unknown,
  pattern: RegExp,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= 255 &&
    pattern.test(value)
  );
}

export function parseStripeEventEnvelope(event: unknown): StripeEventEnvelope {
  if (
    !isRecord(event) ||
    !isStripeIdentifier(event.id, STRIPE_EVENT_ID_PATTERN) ||
    typeof event.type !== "string" ||
    event.type.length === 0 ||
    typeof event.livemode !== "boolean"
  ) {
    throw new StripeWebhookPermanentError("INVALID_EVENT");
  }

  return {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
  };
}

export function extractStripePaymentIntentId(event: unknown): string | null {
  if (!isRecord(event) || !isRecord(event.data) || !isRecord(event.data.object)) {
    return null;
  }

  return isStripeIdentifier(
    event.data.object.id,
    STRIPE_PAYMENT_INTENT_ID_PATTERN,
  )
    ? event.data.object.id
    : null;
}

export function stripeRecordPaymentIdempotencyKey(
  stripePaymentIntentId: string,
): string {
  const digest = createHash("sha256")
    .update(stripePaymentIntentId, "utf8")
    .digest("hex");
  return `stripe:${STRIPE_PAYMENT_INTENT_SUCCEEDED}:${digest}`;
}

function parseContractId(value: unknown): number {
  if (typeof value !== "string" || !CONTRACT_ID_PATTERN.test(value)) {
    throw new StripeWebhookPermanentError("INVALID_CONTRACT_MAPPING");
  }

  const contractId = Number(value);
  if (
    !Number.isSafeInteger(contractId) ||
    contractId < 1 ||
    contractId > POSTGRES_INTEGER_MAX
  ) {
    throw new StripeWebhookPermanentError("INVALID_CONTRACT_MAPPING");
  }

  return contractId;
}

function parseRetainedJson(rawPayload: Buffer): unknown {
  try {
    return JSON.parse(rawPayload.toString("utf8"));
  } catch {
    throw new StripeWebhookPermanentError("INVALID_EVENT");
  }
}

export function normalizeRetainedStripePaymentEvent(
  rawPayload: Buffer,
): NormalizedStripePaymentEvent {
  const event = parseRetainedJson(rawPayload);
  const envelope = parseStripeEventEnvelope(event);
  if (
    envelope.type !== STRIPE_PAYMENT_INTENT_SUCCEEDED ||
    envelope.livemode ||
    !isRecord(event) ||
    !Number.isSafeInteger(event.created) ||
    (event.created as number) < 1 ||
    !isRecord(event.data) ||
    !isRecord(event.data.object)
  ) {
    throw new StripeWebhookPermanentError("INVALID_EVENT");
  }

  const paymentIntent = event.data.object;
  if (
    paymentIntent.object !== "payment_intent" ||
    !isStripeIdentifier(paymentIntent.id, STRIPE_PAYMENT_INTENT_ID_PATTERN) ||
    paymentIntent.livemode !== false
  ) {
    throw new StripeWebhookPermanentError("INVALID_EVENT");
  }

  if (
    !Number.isSafeInteger(paymentIntent.amount_received) ||
    (paymentIntent.amount_received as number) < 1
  ) {
    throw new StripeWebhookPermanentError("INVALID_AMOUNT");
  }
  if (paymentIntent.currency !== "eur") {
    throw new StripeWebhookPermanentError("INVALID_CURRENCY");
  }
  if (!isRecord(paymentIntent.metadata)) {
    throw new StripeWebhookPermanentError("INVALID_CONTRACT_MAPPING");
  }

  const receivedAt = new Date((event.created as number) * 1_000);
  if (Number.isNaN(receivedAt.getTime())) {
    throw new StripeWebhookPermanentError("INVALID_EVENT");
  }

  return {
    stripeEventId: envelope.id,
    stripePaymentIntentId: paymentIntent.id,
    contractId: parseContractId(paymentIntent.metadata.contract_id),
    amountCents: paymentIntent.amount_received as number,
    receivedAt,
    idempotencyKey: stripeRecordPaymentIdempotencyKey(paymentIntent.id),
  };
}
