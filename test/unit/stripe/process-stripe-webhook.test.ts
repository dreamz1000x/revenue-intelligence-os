import { describe, expect, it, vi } from "vitest";

import { IdempotencyPayloadConflict } from "../../../src/application/idempotency.js";
import { createContractId } from "../../../src/contracts/domain/ids.js";
import { ContractNotFoundError } from "../../../src/payments/application/contract-not-found-error.js";
import { PaymentExceedsOutstandingError } from "../../../src/payments/domain/payment-allocation.js";
import { reconstitutePayment } from "../../../src/payments/domain/payment.js";
import { processStripeWebhookUseCase } from "../../../src/stripe/application/process-stripe-webhook.js";
import type {
  RetainedStripeWebhookEvent,
  StripeWebhookClaimResult,
  StripeWebhookEventPersistence,
} from "../../../src/stripe/application/stripe-webhook-event-persistence.js";

const RECEIVED = new Date("2026-08-27T10:00:00.000Z");
const FINALIZED = new Date("2026-08-27T10:00:01.000Z");

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_process123",
    type: "payment_intent.succeeded",
    created: 1_777_608_000,
    livemode: false,
    data: {
      object: {
        object: "payment_intent",
        id: "pi_process123",
        livemode: false,
        amount_received: 100,
        currency: "eur",
        metadata: { contract_id: "1" },
      },
    },
    ...overrides,
  };
}

function retained(rawPayload: Buffer): RetainedStripeWebhookEvent {
  return {
    id: 9,
    stripeEventId: "evt_process123",
    eventType: "payment_intent.succeeded",
    stripePaymentIntentId: "pi_process123",
    rawPayload,
    receivedAt: RECEIVED,
    status: "received",
    processingToken: null,
    processingStartedAt: null,
    processedAt: null,
    paymentId: null,
    lastErrorCode: null,
  };
}

function harness(claimResult?: StripeWebhookClaimResult) {
  const rawPayload = Buffer.from(JSON.stringify(event()), "utf8");
  const receipt = retained(rawPayload);
  const persistence: StripeWebhookEventPersistence = {
    storeReceipt: vi.fn(async () => ({ event: receipt, outcome: "stored" })),
    claimForProcessing: vi.fn(
      async () =>
        claimResult ?? {
          outcome: "claimed",
          event: { ...receipt, status: "processing" },
        },
    ),
    markProcessed: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    releaseForRetry: vi.fn(async () => undefined),
  };
  const payment = reconstitutePayment({
    id: 5,
    contractId: 1,
    amountCents: 100,
    receivedAt: new Date(1_777_608_000 * 1_000),
    createdAt: FINALIZED,
    allocations: [{ installmentId: 1, position: 1, amountCents: 100 }],
  });
  const recordPayment = vi.fn(async () => ({
    resource: payment,
    outcome: "created" as const,
  }));
  const process = processStripeWebhookUseCase({
    clock: { now: () => new Date(FINALIZED) },
    persistence,
    recordPayment,
  });
  const input = {
    verifiedEvent: event(),
    stripeEventId: "evt_process123",
    rawPayload,
    receivedAt: RECEIVED,
  };
  return { input, persistence, process, recordPayment };
}

describe("Process Stripe webhook", () => {
  it("stores, claims, records the Payment, and finalizes with its ID", async () => {
    const { input, persistence, process, recordPayment } = harness();

    await expect(process(input)).resolves.toEqual({ outcome: "processed" });
    expect(recordPayment).toHaveBeenCalledWith({
      idempotencyKey: expect.stringMatching(/^stripe:payment_intent\.succeeded:[0-9a-f]{64}$/),
      contractId: 1,
      amountCents: 100,
      receivedAt: new Date(1_777_608_000 * 1_000),
    });
    expect(persistence.markProcessed).toHaveBeenCalledWith({
      eventId: 9,
      processingToken: expect.any(String),
      paymentId: 5,
      processedAt: FINALIZED,
    });
  });

  it.each(["processed", "failed", "busy"] as const)(
    "returns the existing %s claim outcome without a financial command",
    async (outcome) => {
      const { input, process, recordPayment } = harness({ outcome });
      await expect(process(input)).resolves.toEqual({ outcome });
      expect(recordPayment).not.toHaveBeenCalled();
    },
  );

  it.each([
    [new ContractNotFoundError(createContractId(1)), "CONTRACT_NOT_FOUND"],
    [new PaymentExceedsOutstandingError(100 as never, 50), "PAYMENT_EXCEEDS_OUTSTANDING"],
    [new IdempotencyPayloadConflict(), "IDEMPOTENCY_PAYLOAD_CONFLICT"],
  ])("persists stable permanent business failure %#", async (error, code) => {
    const { input, persistence, process, recordPayment } = harness();
    recordPayment.mockRejectedValueOnce(error as Error);

    await expect(process(input)).resolves.toEqual({ outcome: "failed" });
    expect(persistence.markFailed).toHaveBeenCalledWith({
      eventId: 9,
      processingToken: expect.any(String),
      errorCode: code,
      processedAt: FINALIZED,
    });
    expect(persistence.releaseForRetry).not.toHaveBeenCalled();
  });

  it("marks malformed retained evidence failed without invoking RecordPayment", async () => {
    const { input, persistence, process, recordPayment } = harness();
    vi.mocked(persistence.claimForProcessing).mockResolvedValueOnce({
      outcome: "claimed",
      event: {
        ...retained(Buffer.from("{}", "utf8")),
        status: "processing",
        stripePaymentIntentId: null,
      },
    });

    await expect(process(input)).resolves.toEqual({ outcome: "failed" });
    expect(recordPayment).not.toHaveBeenCalled();
    expect(persistence.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "INVALID_EVENT" }),
    );
  });

  it("releases the current claim and rethrows an infrastructure failure", async () => {
    const { input, persistence, process, recordPayment } = harness();
    const infrastructureFailure = new Error("database unavailable");
    recordPayment.mockRejectedValueOnce(infrastructureFailure);

    await expect(process(input)).rejects.toBe(infrastructureFailure);
    expect(persistence.releaseForRetry).toHaveBeenCalledWith(
      9,
      expect.any(String),
    );
    expect(persistence.markFailed).not.toHaveBeenCalled();
  });

  it("can finish a retry with the replayed Payment after finalization failed", async () => {
    const { input, persistence, process, recordPayment } = harness();
    vi.mocked(persistence.markProcessed)
      .mockRejectedValueOnce(new Error("finalization failed"))
      .mockResolvedValueOnce(undefined);

    await expect(process(input)).rejects.toThrow("finalization failed");
    recordPayment.mockResolvedValueOnce({
      ...(await recordPayment.mock.results[0]!.value),
      outcome: "replayed",
    });
    await expect(process(input)).resolves.toEqual({ outcome: "processed" });

    expect(recordPayment).toHaveBeenCalledTimes(2);
    expect(recordPayment.mock.calls[1]?.[0]).toEqual(recordPayment.mock.calls[0]?.[0]);
  });
});
