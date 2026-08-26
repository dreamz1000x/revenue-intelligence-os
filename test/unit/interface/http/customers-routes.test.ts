import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { IdempotencyPayloadConflict } from "../../../../src/application/idempotency.js";
import { createCustomerUseCase } from "../../../../src/customers/application/create-customer.js";
import { reconstituteCustomer } from "../../../../src/customers/domain/customer.js";
import {
  buildApp,
  type HttpUseCases,
} from "../../../../src/interface/http/app.js";
import { idempotencyKeyFromRawHeaders } from "../../../../src/interface/http/request-validation.js";

const FIXED_NOW = new Date("2026-08-25T03:00:00.000Z");
const CUSTOMER = reconstituteCustomer({
  id: 1,
  displayName: "Acme",
  createdAt: FIXED_NOW,
});

const openApps: FastifyInstance[] = [];

function testApp(
  overrides: Partial<
    Pick<HttpUseCases, "createCustomer" | "getCustomerById">
  > = {},
): FastifyInstance {
  const app = buildApp({
    createCustomer:
      overrides.createCustomer ??
      (async () => ({ resource: CUSTOMER, outcome: "created" })),
    getCustomerById: overrides.getCustomerById ?? (async () => CUSTOMER),
    createContract: async () => {
      throw new Error("Contract route must not be called");
    },
    getContractById: async () => {
      throw new Error("Contract route must not be called");
    },
    recordPayment: async () => {
      throw new Error("Payment route must not be called");
    },
    getPaymentById: async () => {
      throw new Error("Payment route must not be called");
    },
  });
  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("Customer HTTP interface", () => {
  it("creates a Customer with the exact header value and explicit timestamp", async () => {
    let receivedCommand: Parameters<HttpUseCases["createCustomer"]>[0] | undefined;
    const app = testApp({
      createCustomer: async (command) => {
        receivedCommand = command;
        return { resource: CUSTOMER, outcome: "created" };
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { "IDEMPOTENCY-KEY": "Case-Sensitive_Key!" },
      payload: { displayName: "Acme" },
    });

    expect(response.statusCode).toBe(201);
    expect(receivedCommand).toEqual({
      idempotencyKey: "Case-Sensitive_Key!",
      displayName: "Acme",
    });
    expect(response.json()).toEqual({
      id: 1,
      displayName: "Acme",
      createdAt: FIXED_NOW.toISOString(),
    });
    expect(response.headers.location).toBeUndefined();
  });

  it("returns 200 for an idempotent replay", async () => {
    const app = testApp({
      createCustomer: async () => ({ resource: CUSTOMER, outcome: "replayed" }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { "idempotency-key": "customer-replay" },
      payload: { displayName: "Acme" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(1);
  });

  it("returns an existing Customer and maps a missing one to 404", async () => {
    const existingApp = testApp();
    const existing = await existingApp.inject({
      method: "GET",
      url: "/customers/1",
    });
    expect(existing.statusCode).toBe(200);
    expect(existing.json().createdAt).toBe(FIXED_NOW.toISOString());

    const missingApp = testApp({ getCustomerById: async () => null });
    const missing = await missingApp.inject({
      method: "GET",
      url: "/customers/999",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: { code: "CUSTOMER_NOT_FOUND", message: "Customer not found" },
    });
  });

  it.each([
    undefined,
    null,
    {},
    { displayName: 42 },
    { displayName: "Acme", unexpected: true },
    ["Acme"],
  ])("rejects invalid Customer body structure %#", async (payload) => {
    const app = testApp();
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { "idempotency-key": "customer-structure" },
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid request" },
    });
  });

  it("maps malformed JSON to the stable 400 response", async () => {
    const app = testApp();
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "malformed-json",
      },
      payload: '{"displayName":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid request" },
    });
  });

  it("requires the Idempotency-Key header", async () => {
    const app = testApp();
    const missing = await app.inject({
      method: "POST",
      url: "/customers",
      payload: { displayName: "Acme" },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({
      error: {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required",
      },
    });

  });

  it("rejects duplicate or ambiguous raw Idempotency-Key occurrences", () => {
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

    expect(() =>
      idempotencyKeyFromRawHeaders(["Idempotency-Key"]),
    ).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        code: "INVALID_IDEMPOTENCY_KEY_HEADER",
      }),
    );
  });

  it("maps semantic input validation to 422", async () => {
    const createCustomer = createCustomerUseCase({
      clock: { now: () => FIXED_NOW },
      persistence: {
        create: async () => {
          throw new Error("Persistence must not be called");
        },
        getById: async () => null,
      },
    });
    const app = testApp({ createCustomer });
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { "idempotency-key": "contains space" },
      payload: { displayName: "Acme" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "Invalid input" },
    });
  });

  it("maps idempotency conflicts to 409", async () => {
    const app = testApp({
      createCustomer: async () => {
        throw new IdempotencyPayloadConflict();
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { "idempotency-key": "conflict" },
      payload: { displayName: "Acme" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "IDEMPOTENCY_PAYLOAD_CONFLICT",
        message: "Idempotency key is already associated with a different payload",
      },
    });
  });

  it("does not expose unexpected internal errors", async () => {
    const app = testApp({
      getCustomerById: async () => {
        throw new Error("postgres constraint and C:\\private\\path");
      },
    });
    const response = await app.inject({ method: "GET", url: "/customers/1" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(response.body).not.toContain("postgres");
    expect(response.body).not.toContain("private");
  });
});
