import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { IdempotencyPayloadConflict } from "../../../../src/application/idempotency.js";
import { createContractId } from "../../../../src/contracts/domain/ids.js";
import { createMoneyCents } from "../../../../src/contracts/domain/money-cents.js";
import {
  buildApp,
  type HttpUseCases,
} from "../../../../src/interface/http/app.js";
import { idempotencyKeyFromRawHeaders } from "../../../../src/interface/http/request-validation.js";
import { getPaymentByIdUseCase } from "../../../../src/payments/application/get-payment-by-id.js";
import { ContractNotFoundError } from "../../../../src/payments/application/contract-not-found-error.js";
import { recordPaymentUseCase } from "../../../../src/payments/application/record-payment.js";
import { PaymentExceedsOutstandingError } from "../../../../src/payments/domain/payment-allocation.js";
import { reconstitutePayment } from "../../../../src/payments/domain/payment.js";

const RECEIVED_AT = new Date("2026-08-25T04:00:00.000Z");
const CREATED_AT = new Date("2026-08-25T04:00:01.000Z");
const PAYMENT = reconstitutePayment({
  id: 7,
  contractId: 1,
  amountCents: 5_000,
  receivedAt: RECEIVED_AT,
  createdAt: CREATED_AT,
  allocations: [
    { installmentId: 12, position: 2, amountCents: 1_666 },
    { installmentId: 11, position: 1, amountCents: 3_334 },
  ],
});

const openApps: FastifyInstance[] = [];

function testApp(
  overrides: Partial<Pick<HttpUseCases, "recordPayment" | "getPaymentById">> = {},
): FastifyInstance {
  const app = buildApp({
    createCustomer: async () => {
      throw new Error("Customer route must not be called");
    },
    getCustomerById: async () => {
      throw new Error("Customer route must not be called");
    },
    createContract: async () => {
      throw new Error("Contract route must not be called");
    },
    getContractById: async () => {
      throw new Error("Contract route must not be called");
    },
    recordPayment:
      overrides.recordPayment ??
      (async () => ({ resource: PAYMENT, outcome: "created" })),
    getPaymentById: overrides.getPaymentById ?? (async () => PAYMENT),
    processStripeWebhook: async () => {
      throw new Error("Stripe route must not be called");
    },
    stripeWebhookClock: { now: () => new Date(CREATED_AT) },
    verifyStripeSignature: () => {
      throw new Error("Stripe route must not be called");
    },
  });
  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function validPaymentPayload(receivedAt = RECEIVED_AT.toISOString()) {
  return {
    contractId: 1,
    amountCents: 5_000,
    receivedAt,
  };
}

function serializedPayment() {
  return {
    id: 7,
    contractId: 1,
    amountCents: 5_000,
    receivedAt: RECEIVED_AT.toISOString(),
    createdAt: CREATED_AT.toISOString(),
    allocations: [
      { installmentId: 11, amountCents: 3_334 },
      { installmentId: 12, amountCents: 1_666 },
    ],
  };
}

describe("Payment HTTP interface", () => {
  it("records a Payment with the exact command and explicit ordered serialization", async () => {
    let receivedCommand: Parameters<HttpUseCases["recordPayment"]>[0] | undefined;
    const app = testApp({
      recordPayment: async (command) => {
        receivedCommand = command;
        return { resource: PAYMENT, outcome: "created" };
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { "IDEMPOTENCY-KEY": "Payment-Key_1!" },
      payload: validPaymentPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(receivedCommand).toMatchObject({
      idempotencyKey: "Payment-Key_1!",
      contractId: 1,
      amountCents: 5_000,
    });
    expect(receivedCommand?.receivedAt).toBeInstanceOf(Date);
    expect(receivedCommand?.receivedAt.toISOString()).toBe(RECEIVED_AT.toISOString());
    expect(response.json()).toEqual(serializedPayment());
    expect(response.headers.location).toBeUndefined();
  });

  it("returns 200 for an idempotent Payment replay", async () => {
    const app = testApp({
      recordPayment: async () => ({ resource: PAYMENT, outcome: "replayed" }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { "idempotency-key": "payment-replay" },
      payload: validPaymentPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(serializedPayment());
  });

  it("maps malformed JSON to the stable structural error", async () => {
    const app = testApp();
    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "malformed-payment",
      },
      payload: '{"contractId":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid request" },
    });
  });

  it("rejects unknown Payment request fields", async () => {
    const app = testApp();
    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { "idempotency-key": "unknown-payment-field" },
      payload: { ...validPaymentPayload(), unexpected: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it.each([
    "not-an-instant",
    "2026-02-30T04:00:00.000Z",
    "2026-08-25T04:00:00",
  ])("rejects structurally invalid receivedAt %s", async (receivedAt) => {
    const app = testApp();
    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { "idempotency-key": "invalid-payment-instant" },
      payload: validPaymentPayload(receivedAt),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("requires exactly one Idempotency-Key header", async () => {
    const app = testApp();
    const missing = await app.inject({
      method: "POST",
      url: "/payments",
      payload: validPaymentPayload(),
    });

    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(() =>
      idempotencyKeyFromRawHeaders([
        "Idempotency-Key",
        "first",
        "idempotency-key",
        "second",
      ]),
    ).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        code: "INVALID_IDEMPOTENCY_KEY_HEADER",
      }),
    );
  });

  it("maps domain-invalid Payment amounts to 422", async () => {
    const recordPayment = recordPaymentUseCase({
      clock: { now: () => CREATED_AT },
      persistence: {
        record: async () => {
          throw new Error("Persistence must not be called");
        },
        getById: async () => null,
      },
    });
    const app = testApp({ recordPayment });
    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { "idempotency-key": "invalid-payment-amount" },
      payload: { ...validPaymentPayload(), amountCents: 0 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "Invalid input" },
    });
  });

  it("maps a missing Contract to CONTRACT_NOT_FOUND", async () => {
    const app = testApp({
      recordPayment: async () => {
        throw new ContractNotFoundError(createContractId(999));
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { "idempotency-key": "missing-payment-contract" },
      payload: validPaymentPayload(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "CONTRACT_NOT_FOUND", message: "Contract not found" },
    });
  });

  it("maps overpayment to PAYMENT_EXCEEDS_OUTSTANDING", async () => {
    const app = testApp({
      recordPayment: async () => {
        throw new PaymentExceedsOutstandingError(createMoneyCents(5_001), 5_000);
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { "idempotency-key": "payment-overpayment" },
      payload: validPaymentPayload(),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: {
        code: "PAYMENT_EXCEEDS_OUTSTANDING",
        message: "Payment exceeds outstanding amount",
      },
    });
  });

  it("maps Payment idempotency conflicts to 409", async () => {
    const app = testApp({
      recordPayment: async () => {
        throw new IdempotencyPayloadConflict();
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { "idempotency-key": "payment-conflict" },
      payload: validPaymentPayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("IDEMPOTENCY_PAYLOAD_CONFLICT");
  });

  it("normalizes equivalent timezone representations to the same instant", async () => {
    const receivedInstants: number[] = [];
    const app = testApp({
      recordPayment: async (command) => {
        receivedInstants.push(command.receivedAt.getTime());
        return { resource: PAYMENT, outcome: "created" };
      },
    });
    const request = {
      method: "POST" as const,
      url: "/payments",
      headers: { "idempotency-key": "equivalent-payment-instant" },
    };

    await app.inject({
      ...request,
      payload: validPaymentPayload("2026-08-25T04:00:00.000Z"),
    });
    await app.inject({
      ...request,
      payload: validPaymentPayload("2026-08-25T06:00:00+02:00"),
    });

    expect(receivedInstants).toEqual([RECEIVED_AT.getTime(), RECEIVED_AT.getTime()]);
  });

  it("returns and explicitly serializes an existing Payment", async () => {
    const app = testApp();
    const response = await app.inject({ method: "GET", url: "/payments/7" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(serializedPayment());
  });

  it("maps a missing Payment to PAYMENT_NOT_FOUND", async () => {
    const app = testApp({ getPaymentById: async () => null });
    const response = await app.inject({ method: "GET", url: "/payments/999" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "PAYMENT_NOT_FOUND", message: "Payment not found" },
    });
  });

  it("rejects invalid Payment path syntax without partial parsing", async () => {
    const app = testApp();
    const response = await app.inject({ method: "GET", url: "/payments/7suffix" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("maps a syntactically valid but domain-invalid Payment ID to 422", async () => {
    const getPaymentById = getPaymentByIdUseCase({
      record: async () => {
        throw new Error("Record Payment must not be called");
      },
      getById: async () => null,
    });
    const app = testApp({ getPaymentById });
    const response = await app.inject({ method: "GET", url: "/payments/0" });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("INVALID_INPUT");
  });
});
