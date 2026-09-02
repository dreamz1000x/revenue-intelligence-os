import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { IdempotencyPayloadConflict } from "../../../../src/application/idempotency.js";
import { createContractUseCase } from "../../../../src/contracts/application/create-contract.js";
import { CustomerNotFoundError } from "../../../../src/contracts/application/customer-not-found-error.js";
import { reconstituteContract } from "../../../../src/contracts/domain/contract.js";
import { createCustomerId } from "../../../../src/customers/domain/customer-id.js";
import {
  buildApp,
  type HttpUseCases,
} from "../../../../src/interface/http/app.js";
import {
  authenticateTestRequests,
  TEST_ACCESS_TOKEN_VERIFIER,
} from "../../../helpers/http-auth.js";

const FIXED_NOW = new Date("2026-08-25T03:00:00.000Z");

const CONTRACT = reconstituteContract({
  id: 7,
  customerId: 1,
  totalAmountCents: 10_000,
  currency: "EUR",
  installmentCount: 3,
  firstDueDate: "2026-01-31",
  status: "active",
  createdAt: FIXED_NOW,
  installments: [
    {
      id: 21,
      contractId: 7,
      position: 1,
      amountCents: 3_334,
      dueDate: "2026-01-31",
      status: "pending",
      createdAt: FIXED_NOW,
    },
    {
      id: 22,
      contractId: 7,
      position: 2,
      amountCents: 3_333,
      dueDate: "2026-02-28",
      status: "pending",
      createdAt: FIXED_NOW,
    },
    {
      id: 23,
      contractId: 7,
      position: 3,
      amountCents: 3_333,
      dueDate: "2026-03-31",
      status: "pending",
      createdAt: FIXED_NOW,
    },
  ],
});

const openApps: FastifyInstance[] = [];

function testApp(
  overrides: Partial<
    Pick<HttpUseCases, "createContract" | "getContractById">
  > = {},
): FastifyInstance {
  const app = buildApp({
    createCustomer: async () => {
      throw new Error("Customer route must not be called");
    },

    getCustomerById: async () => {
      throw new Error("Customer route must not be called");
    },

    createContract:
      overrides.createContract ??
      (async () => ({
        resource: CONTRACT,
        outcome: "created",
      })),

    getContractById:
      overrides.getContractById ??
      (async () => CONTRACT),

    recordPayment: async () => {
      throw new Error("Payment route must not be called");
    },

    getPaymentById: async () => {
      throw new Error("Payment route must not be called");
    },

    recordRefund: async () => {
      throw new Error("Refund route must not be called");
    },

    getRefundById: async () => {
      throw new Error("Refund route must not be called");
    },

    processStripeWebhook: async () => {
      throw new Error("Stripe route must not be called");
    },

    stripeWebhookClock: {
      now: () => new Date(FIXED_NOW),
    },

    verifyStripeSignature: () => {
      throw new Error("Stripe route must not be called");
    },

    accessTokenVerifier: TEST_ACCESS_TOKEN_VERIFIER,
  });

  authenticateTestRequests(app);

  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(
    openApps.splice(0).map((app) => app.close()),
  );
});

function validContractPayload() {
  return {
    customerId: 1,
    totalAmountCents: 10_000,
    currency: "EUR",
    installmentCount: 3,
    firstDueDate: "2026-01-31",
  };
}

describe("Contract HTTP interface", () => {
  it(
    "creates and explicitly serializes the ordered Contract aggregate",
    async () => {
      const app = testApp();

      const response = await app.inject({
        method: "POST",
        url: "/contracts",
        headers: {
          "idempotency-key": "create-contract",
        },
        payload: validContractPayload(),
      });

      expect(response.statusCode).toBe(201);

      expect(response.json()).toEqual({
        id: 7,
        customerId: 1,
        totalAmountCents: 10_000,
        currency: "EUR",
        installmentCount: 3,
        firstDueDate: "2026-01-31",
        status: "active",
        createdAt: FIXED_NOW.toISOString(),
        installments: [
          {
            id: 21,
            contractId: 7,
            position: 1,
            amountCents: 3_334,
            dueDate: "2026-01-31",
            status: "pending",
            createdAt: FIXED_NOW.toISOString(),
          },
          {
            id: 22,
            contractId: 7,
            position: 2,
            amountCents: 3_333,
            dueDate: "2026-02-28",
            status: "pending",
            createdAt: FIXED_NOW.toISOString(),
          },
          {
            id: 23,
            contractId: 7,
            position: 3,
            amountCents: 3_333,
            dueDate: "2026-03-31",
            status: "pending",
            createdAt: FIXED_NOW.toISOString(),
          },
        ],
      });
    },
  );

  it("returns 200 for a Contract replay", async () => {
    const app = testApp({
      createContract: async () => ({
        resource: CONTRACT,
        outcome: "replayed",
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/contracts",
      headers: {
        "idempotency-key": "contract-replay",
      },
      payload: validContractPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(7);
  });

  it(
    "returns an existing Contract and maps a missing one to 404",
    async () => {
      const existingApp = testApp();

      const existing = await existingApp.inject({
        method: "GET",
        url: "/contracts/7",
      });

      expect(existing.statusCode).toBe(200);

      expect(
        existing
          .json()
          .installments.map(
            (item: { position: number }) => item.position,
          ),
      ).toEqual([1, 2, 3]);

      const missingApp = testApp({
        getContractById: async () => null,
      });

      const missing = await missingApp.inject({
        method: "GET",
        url: "/contracts/999",
      });

      expect(missing.statusCode).toBe(404);

      expect(missing.json()).toEqual({
        error: {
          code: "CONTRACT_NOT_FOUND",
          message: "Contract not found",
        },
      });
    },
  );

  it.each([
    {
      ...validContractPayload(),
      customerId: "1",
    },
    {
      ...validContractPayload(),
      totalAmountCents: 10.5,
    },
    {
      ...validContractPayload(),
      installmentCount: null,
    },
    {
      ...validContractPayload(),
      firstDueDate: "31-01-2026",
    },
    {
      ...validContractPayload(),
      unexpected: true,
    },
  ])(
    "rejects invalid Contract request structure %#",
    async (payload) => {
      const app = testApp();

      const response = await app.inject({
        method: "POST",
        url: "/contracts",
        headers: {
          "idempotency-key": "contract-structure",
        },
        payload,
      });

      expect(response.statusCode).toBe(400);

      expect(response.json()).toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request",
        },
      });
    },
  );

  it.each([
    {
      ...validContractPayload(),
      firstDueDate: "2026-02-30",
    },
    {
      ...validContractPayload(),
      currency: "USD",
    },
  ])(
    "maps Contract domain validation to 422 %#",
    async (payload) => {
      const createContract = createContractUseCase({
        clock: {
          now: () => FIXED_NOW,
        },
        persistence: {
          create: async () => {
            throw new Error(
              "Persistence must not be called",
            );
          },
          getById: async () => null,
        },
      });

      const app = testApp({
        createContract,
      });

      const response = await app.inject({
        method: "POST",
        url: "/contracts",
        headers: {
          "idempotency-key": "invalid-contract",
        },
        payload,
      });

      expect(response.statusCode).toBe(422);

      expect(response.json()).toEqual({
        error: {
          code: "INVALID_INPUT",
          message: "Invalid input",
        },
      });
    },
  );

  it("maps a missing Customer to 404", async () => {
    const app = testApp({
      createContract: async () => {
        throw new CustomerNotFoundError(
          createCustomerId(999),
        );
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/contracts",
      headers: {
        "idempotency-key": "missing-customer",
      },
      payload: validContractPayload(),
    });

    expect(response.statusCode).toBe(404);

    expect(response.json()).toEqual({
      error: {
        code: "CUSTOMER_NOT_FOUND",
        message: "Customer not found",
      },
    });
  });

  it("requires the Idempotency-Key header", async () => {
    const app = testApp();

    const response = await app.inject({
      method: "POST",
      url: "/contracts",
      payload: validContractPayload(),
    });

    expect(response.statusCode).toBe(400);

    expect(response.json().error.code).toBe(
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  });

  it(
    "maps Contract idempotency conflicts to 409",
    async () => {
      const app = testApp({
        createContract: async () => {
          throw new IdempotencyPayloadConflict();
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/contracts",
        headers: {
          "idempotency-key": "contract-conflict",
        },
        payload: validContractPayload(),
      });

      expect(response.statusCode).toBe(409);

      expect(response.json().error.code).toBe(
        "IDEMPOTENCY_PAYLOAD_CONFLICT",
      );
    },
  );
});