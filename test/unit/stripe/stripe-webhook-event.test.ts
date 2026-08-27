import { describe, expect, it } from "vitest";

import {
  extractStripePaymentIntentId,
  normalizeRetainedStripePaymentEvent,
  parseStripeEventEnvelope,
  stripeRecordPaymentIdempotencyKey,
  StripeWebhookPermanentError,
} from "../../../src/stripe/application/stripe-webhook-event.js";

const CREATED = 1_777_608_000;

function supportedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_supported123",
    type: "payment_intent.succeeded",
    created: CREATED,
    livemode: false,
    data: {
      object: {
        object: "payment_intent",
        id: "pi_123",
        livemode: false,
        amount_received: 5_000,
        currency: "eur",
        metadata: { contract_id: "42" },
        ignored_by_the_application: true,
      },
    },
    ignored_event_field: "tolerated",
    ...overrides,
  };
}

function normalize(event: unknown) {
  return normalizeRetainedStripePaymentEvent(
    Buffer.from(JSON.stringify(event), "utf8"),
  );
}

function expectPermanentCode(work: () => unknown, code: string) {
  expect(work).toThrowError(
    expect.objectContaining({ name: "StripeWebhookPermanentError", code }),
  );
}

describe("Stripe webhook event normalization", () => {
  it("derives the exact PaymentIntent command key with a lowercase SHA-256", () => {
    const key = stripeRecordPaymentIdempotencyKey("pi_123");

    expect(key).toBe(
      "stripe:payment_intent.succeeded:8bbf7c44c84adb6111948a0baed19b14e68260a6a66d35d0a9d2f83450a98fd2",
    );
    expect(key).toHaveLength(96);
  });

  it("normalizes only relied-upon fields and maps Event.created to the Payment instant", () => {
    const normalized = normalize(supportedEvent());

    expect(normalized).toEqual({
      stripeEventId: "evt_supported123",
      stripePaymentIntentId: "pi_123",
      contractId: 42,
      amountCents: 5_000,
      receivedAt: new Date(CREATED * 1_000),
      idempotencyKey: stripeRecordPaymentIdempotencyKey("pi_123"),
    });
  });

  it.each(["01", "0", "2147483648", "", " 42", 42, undefined])(
    "rejects non-canonical or out-of-range Contract mapping %#",
    (contractId) => {
      const event = supportedEvent();
      (event.data.object.metadata as Record<string, unknown>).contract_id =
        contractId;

      expectPermanentCode(
        () => normalize(event),
        "INVALID_CONTRACT_MAPPING",
      );
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid amount_received %#",
    (amountReceived) => {
      const event = supportedEvent();
      event.data.object.amount_received = amountReceived;
      expectPermanentCode(() => normalize(event), "INVALID_AMOUNT");
    },
  );

  it("accepts only the exact eur provider currency", () => {
    const event = supportedEvent();
    event.data.object.currency = "EUR";
    expectPermanentCode(() => normalize(event), "INVALID_CURRENCY");
  });

  it.each([
    { object: "charge" },
    { id: "not_a_payment_intent" },
    { livemode: true },
  ])("rejects an invalid PaymentIntent identity %#", (change) => {
    const event = supportedEvent();
    Object.assign(event.data.object, change);
    expectPermanentCode(() => normalize(event), "INVALID_EVENT");
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid Event.created %#",
    (created) => {
      expectPermanentCode(
        () => normalize(supportedEvent({ created })),
        "INVALID_EVENT",
      );
    },
  );

  it("validates the initial envelope and safely extracts only a valid PaymentIntent ID", () => {
    const event = supportedEvent();
    expect(parseStripeEventEnvelope(event)).toEqual({
      id: "evt_supported123",
      type: "payment_intent.succeeded",
      livemode: false,
    });
    expect(extractStripePaymentIntentId(event)).toBe("pi_123");
    expect(extractStripePaymentIntentId({ data: { object: { id: "bad" } } })).toBeNull();
  });

  it("rejects unusable initial envelopes with a stable error", () => {
    expect(() =>
      parseStripeEventEnvelope({ id: "bad", type: "x", livemode: false }),
    ).toThrowError(StripeWebhookPermanentError);
  });
});
