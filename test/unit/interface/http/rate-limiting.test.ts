import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { reconstituteAuditEvent } from "../../../../src/audit/domain/audit-event.js";
import { reconstituteCustomer } from "../../../../src/customers/domain/customer.js";
import { buildApp } from "../../../../src/interface/http/app.js";
import { StripeSignatureVerificationFailed } from "../../../../src/interface/http/stripe-signature-verifier.js";
import type { ReconciliationPersistence } from "../../../../src/reconciliation/application/reconciliation-persistence.js";
import {
  fingerprintReconciliationRun,
  reconstituteReconciliationRun,
} from "../../../../src/reconciliation/domain/reconciliation-run.js";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const CUSTOMER = reconstituteCustomer({
  id: 1,
  displayName: "Rate limit customer",
  createdAt: NOW,
});
const RUN = reconstituteReconciliationRun({
  id: 1,
  scopeType: "global",
  scopeId: null,
  cutoff: NOW,
  ruleSetVersion: "reconciliation-v1",
  runFingerprint: fingerprintReconciliationRun(NOW),
  status: "completed",
  executedAt: NOW,
  createdAt: NOW,
});

const openApps: FastifyInstance[] = [];

function testApp(): FastifyInstance {
  const unexpected = async () => {
    throw new Error("Unexpected route");
  };
  const reconciliationPersistence: ReconciliationPersistence = {
    execute: unexpected,
    getRunById: async () => null,
    listRuns: async () => [],
    getFindingById: async () => null,
    listFindings: async () => [],
  };

  const app = buildApp({
    createCustomer: unexpected,
    getCustomerById: async () => CUSTOMER,
    createContract: unexpected,
    getContractById: unexpected,
    recordPayment: unexpected,
    getPaymentById: unexpected,
    recordRefund: unexpected,
    getRefundById: unexpected,
    processStripeWebhook: unexpected,
    stripeWebhookClock: { now: () => new Date(NOW) },
    verifyStripeSignature: () => {
      throw new StripeSignatureVerificationFailed();
    },
    accessTokenVerifier: {
      verify: async (token) => {
        if (token === "invalid") {
          throw new Error("Invalid token");
        }

        return { subject: token, roles: ["admin"] };
      },
    },
    recordExternalSourceEvent: unexpected,
    getExternalSourceEventById: unexpected,
    runReconciliation: async () => ({ resource: RUN, outcome: "created" }),
    reconciliationPersistence,
    actOnReconciliationFinding: unexpected,
    appendAuditEvent: async (input) =>
      reconstituteAuditEvent({
        id: 1,
        actorType: "user",
        recordedAt: NOW,
        ...input,
        reason: input.reason ?? null,
      }),
  });

  openApps.push(app);
  return app;
}

const authenticatedGet = (app: FastifyInstance, subject: string) =>
  app.inject({
    method: "GET",
    url: "/customers/1",
    headers: { authorization: `Bearer ${subject}` },
  });

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("authenticated principal rate limiting", () => {
  it("allows 60 requests per principal and returns the stable sanitized 429", async () => {
    const app = testApp();

    for (let index = 0; index < 60; index += 1) {
      expect((await authenticatedGet(app, "auth0|principal-a")).statusCode).toBe(200);
    }

    const response = await authenticatedGet(app, "auth0|principal-a");

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
    expect(response.headers["x-ratelimit-limit"]).toBe("60");
    expect(response.headers["x-ratelimit-remaining"]).toBe("0");
    expect(response.headers["x-ratelimit-reset"]).toBeDefined();
    expect(response.headers["retry-after"]).toBeDefined();
    expect(response.body).not.toContain("auth0|principal-a");
    expect(response.body).not.toContain("Bearer");
    expect(response.body).not.toContain("LocalStore");
  });

  it("isolates counters by verified subject", async () => {
    const app = testApp();

    for (let index = 0; index < 61; index += 1) {
      await authenticatedGet(app, "auth0|principal-a");
    }

    expect((await authenticatedGet(app, "auth0|principal-a")).statusCode).toBe(429);
    expect((await authenticatedGet(app, "auth0|principal-b")).statusCode).toBe(200);
  });

  it("preserves authentication failures before rate limiting", async () => {
    const app = testApp();
    const missing = await app.inject({ method: "GET", url: "/customers/1" });
    const invalid = await authenticatedGet(app, "invalid");

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(missing.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
    expect(invalid.json()).toEqual(missing.json());
  });

  it("uses the 10-request reconciliation-run override without double charging", async () => {
    const app = testApp();
    const request = {
      method: "POST" as const,
      url: "/reconciliation/runs",
      headers: {
        authorization: "Bearer auth0|operator",
        "idempotency-key": "run-key",
      },
      payload: { cutoff: NOW.toISOString() },
    };

    for (let index = 0; index < 10; index += 1) {
      expect((await app.inject(request)).statusCode).toBe(201);
    }

    const response = await app.inject(request);
    expect(response.statusCode).toBe(429);
    expect(response.headers["x-ratelimit-limit"]).toBe("10");
    expect(response.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
  });

  it("does not apply authenticated principal limiting to Stripe", async () => {
    const app = testApp();

    for (let index = 0; index < 61; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "invalid-signature",
        },
        payload: "{}",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: {
          code: "INVALID_STRIPE_SIGNATURE",
          message: "Invalid Stripe signature",
        },
      });
    }
  });
});
