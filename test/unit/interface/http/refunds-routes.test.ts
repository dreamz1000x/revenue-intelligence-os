import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { IdempotencyPayloadConflict } from "../../../../src/application/idempotency.js";
import { createMoneyCents } from "../../../../src/contracts/domain/money-cents.js";
import { DomainValidationError } from "../../../../src/domain/domain-validation-error.js";
import { buildApp, type HttpUseCases } from "../../../../src/interface/http/app.js";
import { OriginalPaymentNotFoundError } from "../../../../src/refunds/application/original-payment-not-found-error.js";
import { getRefundByIdUseCase } from "../../../../src/refunds/application/get-refund-by-id.js";
import { RefundExceedsReversibleAmountError } from "../../../../src/refunds/domain/refund-allocation.js";
import { reconstituteRefund } from "../../../../src/refunds/domain/refund.js";
import { createPaymentId } from "../../../../src/payments/domain/ids.js";

const REFUNDED_AT = new Date("2026-09-01T08:30:00.000Z");
const CREATED_AT = new Date("2026-09-01T08:30:01.000Z");
const REFUND = reconstituteRefund({
  id: 9,
  paymentId: 7,
  amountCents: 1_500,
  refundedAt: REFUNDED_AT,
  createdAt: CREATED_AT,
  allocations: [
    { installmentId: 13, position: 3, amountCents: 500 },
    { installmentId: 12, position: 2, amountCents: 1_000 },
  ],
});

const openApps: FastifyInstance[] = [];

function testApp(
  overrides: Partial<Pick<HttpUseCases, "recordRefund" | "getRefundById">> = {},
) {
  const app = buildApp({
    createCustomer: async () => { throw new Error("Unexpected route"); },
    getCustomerById: async () => { throw new Error("Unexpected route"); },
    createContract: async () => { throw new Error("Unexpected route"); },
    getContractById: async () => { throw new Error("Unexpected route"); },
    recordPayment: async () => { throw new Error("Unexpected route"); },
    getPaymentById: async () => { throw new Error("Unexpected route"); },
    recordRefund:
      overrides.recordRefund ??
      (async () => ({ resource: REFUND, outcome: "created" })),
    getRefundById: overrides.getRefundById ?? (async () => REFUND),
    processStripeWebhook: async () => { throw new Error("Unexpected route"); },
    stripeWebhookClock: { now: () => new Date(CREATED_AT) },
    verifyStripeSignature: () => { throw new Error("Unexpected route"); },
  });
  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function validPayload(refundedAt = "2026-09-01T10:30:00+02:00") {
  return { paymentId: 7, amountCents: 1_500, refundedAt };
}

function serializedRefund() {
  return {
    id: 9,
    paymentId: 7,
    amountCents: 1_500,
    refundedAt: REFUNDED_AT.toISOString(),
    createdAt: CREATED_AT.toISOString(),
    allocations: [
      { installmentId: 13, amountCents: 500 },
      { installmentId: 12, amountCents: 1_000 },
    ],
  };
}

describe("Refund HTTP interface", () => {
  it("records a Refund with the exact command and explicit serialization", async () => {
    let command: Parameters<HttpUseCases["recordRefund"]>[0] | undefined;
    const app = testApp({
      recordRefund: async (input) => {
        command = input;
        return { resource: REFUND, outcome: "created" };
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { "IDEMPOTENCY-KEY": "Refund-Key_1!" },
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(command).toMatchObject({
      idempotencyKey: "Refund-Key_1!",
      paymentId: 7,
      amountCents: 1_500,
    });
    expect(command?.refundedAt.toISOString()).toBe(REFUNDED_AT.toISOString());
    expect(response.json()).toEqual(serializedRefund());
  });

  it("returns 200 and the stable representation for replay", async () => {
    const app = testApp({
      recordRefund: async () => ({ resource: REFUND, outcome: "replayed" }),
    });
    const response = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { "idempotency-key": "refund-replay" },
      payload: validPayload(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(serializedRefund());
  });

  it.each([
    ["paymentId", { paymentId: 0 }],
    ["amount zero", { amountCents: 0 }],
    ["amount negative", { amountCents: -1 }],
    ["amount decimal", { amountCents: 1.5 }],
    ["amount unsafe", { amountCents: Number.MAX_SAFE_INTEGER + 1 }],
    ["amount wrong type", { amountCents: "1500" }],
    ["refundedAt", { refundedAt: "not-an-instant" }],
  ])("rejects malformed %s before application", async (_label, override) => {
    let called = false;
    const app = testApp({
      recordRefund: async () => {
        called = true;
        throw new Error("Must not be called");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { "idempotency-key": "invalid-refund" },
      payload: { ...validPayload(), ...override },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid request" },
    });
    expect(called).toBe(false);
  });

  it("requires Idempotency-Key", async () => {
    const response = await testApp().inject({
      method: "POST",
      url: "/refunds",
      payload: validPayload(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it.each([
    [
      new OriginalPaymentNotFoundError(createPaymentId(999)),
      404,
      "ORIGINAL_PAYMENT_NOT_FOUND",
    ],
    [
      new RefundExceedsReversibleAmountError(createMoneyCents(31), 30),
      422,
      "REFUND_EXCEEDS_REVERSIBLE_AMOUNT",
    ],
    [new IdempotencyPayloadConflict(), 409, "IDEMPOTENCY_PAYLOAD_CONFLICT"],
  ])("maps Refund application errors", async (error, statusCode, code) => {
    const app = testApp({ recordRefund: async () => { throw error; } });
    const response = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { "idempotency-key": "refund-error" },
      payload: validPayload(),
    });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json().error.code).toBe(code);
  });

  it("returns and explicitly serializes an existing Refund", async () => {
    const response = await testApp().inject({ method: "GET", url: "/refunds/9" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(serializedRefund());
  });

  it("maps a missing Refund to REFUND_NOT_FOUND", async () => {
    const response = await testApp({ getRefundById: async () => null }).inject({
      method: "GET",
      url: "/refunds/999",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "REFUND_NOT_FOUND", message: "Refund not found" },
    });
  });

  it("maps caller-originated INVALID_ID validation to INVALID_INPUT", async () => {
    const getRefundById = getRefundByIdUseCase({
      record: async () => { throw new Error("Record Refund must not be called"); },
      getById: async () => null,
    });
    const response = await testApp({ getRefundById }).inject({
      method: "GET",
      url: "/refunds/0",
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "Invalid input" },
    });
  });

  it("sanitizes raw internal INVALID_ID validation as an internal error", async () => {
    const internalDetail = "persisted Refund ID is invalid";
    const getRefundById = getRefundByIdUseCase({
      record: async () => { throw new Error("Record Refund must not be called"); },
      getById: async () => {
        throw new DomainValidationError("INVALID_ID", internalDetail);
      },
    });
    const app = testApp({ getRefundById });
    const response = await app.inject({ method: "GET", url: "/refunds/9" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(response.body).not.toContain(internalDetail);
    expect(response.body).not.toContain("INVALID_ID");
  });

  it("sanitizes persisted Refund invariant failures as internal errors", async () => {
    const internalDetail = "persisted Refund allocations are incoherent";
    const app = testApp({
      getRefundById: async () => {
        throw new DomainValidationError(
          "INCOHERENT_REFUND_ALLOCATION",
          internalDetail,
        );
      },
    });
    const response = await app.inject({ method: "GET", url: "/refunds/9" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(response.body).not.toContain(internalDetail);
    expect(response.body).not.toContain("INCOHERENT_REFUND_ALLOCATION");
  });

  it.each(["9suffix", "not-an-id"])("rejects invalid Refund ID %s", async (id) => {
    const response = await testApp().inject({ method: "GET", url: `/refunds/${id}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });
});
