import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../../src/interface/http/app.js";
import { PUBLIC_AUTH_POLICY } from "../../../../src/interface/http/security/auth-policies.js";

const openApps: FastifyInstance[] = [];

function testApp(): FastifyInstance {
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
    stripeWebhookClock: { now: () => new Date("2026-09-03T00:00:00.000Z") },
    verifyStripeSignature: () => {
      throw new Error("Unexpected route");
    },
    accessTokenVerifier: {
      verify: async () => ({ subject: "auth0|test", roles: [] }),
    },
  });

  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("HTTP request and parser hardening", () => {
  it("uses the explicit request limits and does not trust forwarded addresses", async () => {
    const app = testApp();

    app.get(
      "/test/request-security",
      { config: { auth: PUBLIC_AUTH_POLICY } },
      async (request) => ({ ip: request.ip }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/test/request-security",
      headers: { "x-forwarded-for": "203.0.113.10" },
      remoteAddress: "127.0.0.1",
    });

    expect(app.initialConfig.bodyLimit).toBe(1_048_576);
    expect(app.initialConfig.requestTimeout).toBe(120_000);
    expect(response.json()).toEqual({ ip: "127.0.0.1" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns a sanitized 413 for an oversized ordinary JSON body", async () => {
    const response = await testApp().inject({
      method: "POST",
      url: "/customers",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": "test",
      },
      payload: JSON.stringify({ displayName: "x".repeat(1_048_576) }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Payload too large",
      },
    });
    expect(response.body).not.toContain("FST_ERR_CTP_BODY_TOO_LARGE");
  });

  it("returns a sanitized 415 for an unsupported content type", async () => {
    const response = await testApp().inject({
      method: "POST",
      url: "/customers",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/xml",
        "idempotency-key": "test",
      },
      payload: "<customer />",
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Unsupported media type",
      },
    });
    expect(response.body).not.toContain("application/xml");
    expect(response.body).not.toContain("FST_ERR_CTP_INVALID_MEDIA_TYPE");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
