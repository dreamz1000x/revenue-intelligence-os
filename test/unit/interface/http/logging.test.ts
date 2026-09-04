import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../../src/interface/http/app.js";
import { PUBLIC_AUTH_POLICY } from "../../../../src/interface/http/security/auth-policies.js";
import { StripeSignatureVerificationFailed } from "../../../../src/interface/http/stripe-signature-verifier.js";

const openApps: FastifyInstance[] = [];
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function testApp(logLines?: string[]): FastifyInstance {
  const unexpected = async () => {
    throw new Error("Unexpected route");
  };

  const app = buildApp({
    createCustomer: unexpected,
    getCustomerById: unexpected,
    createContract: unexpected,
    getContractById: unexpected,
    recordPayment: unexpected,
    getPaymentById: unexpected,
    recordRefund: unexpected,
    getRefundById: unexpected,
    processStripeWebhook: unexpected,
    stripeWebhookClock: { now: () => new Date("2026-09-04T00:00:00.000Z") },
    verifyStripeSignature: () => {
      throw new StripeSignatureVerificationFailed();
    },
    accessTokenVerifier: {
      verify: async () => ({ subject: "auth0|test", roles: [] }),
    },
  }, logLines
    ? {
        logger: {
          level: "info",
          stream: { write: (line) => logLines.push(line) },
        },
      }
    : undefined);

  app.post(
    "/test/request-id",
    { config: { auth: PUBLIC_AUTH_POLICY } },
    async (request) => ({ requestId: request.id }),
  );
  app.get(
    "/test/failure",
    { config: { auth: PUBLIC_AUTH_POLICY } },
    async () => {
      const error = new Error("secret-error-message", {
        cause: { password: "secret-error-cause" },
      }) as Error & { databaseUrl?: string };
      error.databaseUrl = "secret-error-property";
      throw error;
    },
  );

  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("structured request logging", () => {
  it("generates a distinct UUID request ID for each request", async () => {
    const app = testApp();
    const first = await app.inject({ method: "POST", url: "/test/request-id" });
    const second = await app.inject({ method: "POST", url: "/test/request-id" });

    expect(first.json().requestId).toMatch(uuidV4);
    expect(second.json().requestId).toMatch(uuidV4);
    expect(second.json().requestId).not.toBe(first.json().requestId);
  });

  it("ignores caller-supplied correlation headers", async () => {
    const supplied = "caller-controlled-request-id";
    const response = await testApp().inject({
      method: "POST",
      url: "/test/request-id?token=secret-query-value",
      headers: {
        "request-id": supplied,
        "x-request-id": supplied,
        "x-correlation-id": supplied,
      },
    });

    expect(response.json().requestId).toMatch(uuidV4);
    expect(response.json().requestId).not.toBe(supplied);
  });

  it("writes correlated JSON lifecycle logs without sensitive request data", async () => {
    const logLines: string[] = [];
    const response = await testApp(logLines).inject({
      method: "POST",
      url: "/test/request-id",
      headers: {
        authorization: "Bearer secret-access-token",
        "stripe-signature": "secret-stripe-signature",
        "content-type": "application/json",
      },
      payload: { privateValue: "secret-request-body" },
    });
    const requestId = response.json().requestId as string;
    const records = logLines.flatMap((chunk) =>
      chunk.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>),
    );
    const lifecycleRecords = records.filter((record) => record.requestId === requestId);
    const incoming = lifecycleRecords[0] as Record<string, unknown>;
    const completed = lifecycleRecords[1] as Record<string, unknown>;

    expect(lifecycleRecords.map((record) => record.msg)).toEqual([
      "incoming request",
      "request completed",
    ]);
    expect(incoming.req).toEqual({
      method: "POST",
      url: "/test/request-id",
    });
    expect(completed.res).toEqual({ statusCode: 200 });
    expect(incoming).not.toHaveProperty("headers");
    expect(incoming).not.toHaveProperty("body");
    expect(incoming).not.toHaveProperty("principal");
    expect(JSON.stringify(records)).not.toContain("secret-access-token");
    expect(JSON.stringify(records)).not.toContain("secret-stripe-signature");
    expect(JSON.stringify(records)).not.toContain("secret-request-body");
    expect(JSON.stringify(records)).not.toContain("secret-query-value");
  });

  it("does not log a Stripe signature or raw payload", async () => {
    const logLines: string[] = [];
    const response = await testApp(logLines).inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: {
        "stripe-signature": "secret-stripe-signature-route",
        "content-type": "application/json",
      },
      payload: "secret-stripe-raw-payload",
    });
    const output = logLines.join("");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_STRIPE_SIGNATURE",
        message: "Invalid Stripe signature",
      },
    });
    expect(output).not.toContain("secret-stripe-signature-route");
    expect(output).not.toContain("secret-stripe-raw-payload");
  });

  it("logs a safe structured event for an unexpected error", async () => {
    const logLines: string[] = [];
    const response = await testApp(logLines).inject({
      method: "GET",
      url: "/test/failure",
    });
    const records = logLines.flatMap((chunk) =>
      chunk.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>),
    );
    const failure = records.find((record) => record.event === "request_failed");

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(failure).toMatchObject({
      level: 50,
      event: "request_failed",
      errorCode: "INTERNAL_ERROR",
      errorType: "Error",
      msg: "Unexpected request error",
    });
    expect(JSON.stringify(records)).not.toContain("secret-error-message");
    expect(JSON.stringify(records)).not.toContain("secret-error-cause");
    expect(JSON.stringify(records)).not.toContain("secret-error-property");
  });
});
