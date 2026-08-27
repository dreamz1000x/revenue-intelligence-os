import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reconstituteCustomer } from "../../../../src/customers/domain/customer.js";
import {
  buildApp,
  type HttpUseCases,
} from "../../../../src/interface/http/app.js";
import { stripeSignatureFromRawHeaders } from "../../../../src/interface/http/request-validation.js";
import { createStripeSignatureVerifier } from "../../../../src/interface/http/stripe-signature-verifier.js";
import { STRIPE_WEBHOOK_BODY_LIMIT } from "../../../../src/interface/http/stripe-webhook-routes.js";
import { StripeEventEvidenceConflict } from "../../../../src/stripe/application/stripe-webhook-event-persistence.js";

const SIGNING_SECRET = "whsec_unit_test_secret";
const RECEIVED_AT = new Date("2026-08-27T12:00:00.000Z");
const CUSTOMER = reconstituteCustomer({
  id: 1,
  displayName: "JSON remains parsed",
  createdAt: RECEIVED_AT,
});
const openApps: FastifyInstance[] = [];

function stripeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_http123",
    object: "event",
    type: "payment_intent.succeeded",
    created: 1_777_608_000,
    livemode: false,
    data: {
      object: {
        object: "payment_intent",
        id: "pi_http123",
        livemode: false,
        amount_received: 100,
        currency: "eur",
        metadata: { contract_id: "1" },
      },
    },
    ...overrides,
  };
}

function signedRequest(rawPayload: Buffer) {
  return {
    method: "POST" as const,
    url: "/webhooks/stripe",
    headers: {
      "content-type": "application/json",
      "stripe-signature": Stripe.webhooks.generateTestHeaderString({
        payload: rawPayload.toString("utf8"),
        secret: SIGNING_SECRET,
      }),
    },
    payload: rawPayload,
  };
}

function testApp(overrides: Partial<HttpUseCases> = {}) {
  const dependencies: HttpUseCases = {
    createCustomer: async () => ({ resource: CUSTOMER, outcome: "created" }),
    getCustomerById: async () => CUSTOMER,
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
    processStripeWebhook: vi.fn(async () => ({ outcome: "processed" })),
    stripeWebhookClock: { now: () => new Date(RECEIVED_AT) },
    verifyStripeSignature: createStripeSignatureVerifier(SIGNING_SECRET),
    ...overrides,
  };
  const app = buildApp(dependencies);
  openApps.push(app);
  return { app, dependencies };
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("Stripe webhook HTTP interface", () => {
  it("delivers the exact signed Buffer and receipt time to the orchestrator", async () => {
    const rawPayload = Buffer.from(JSON.stringify(stripeEvent()), "utf8");
    const { app, dependencies } = testApp();

    const response = await app.inject(signedRequest(rawPayload));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(dependencies.processStripeWebhook).toHaveBeenCalledWith({
      verifiedEvent: expect.objectContaining({ id: "evt_http123" }),
      stripeEventId: "evt_http123",
      rawPayload,
      receivedAt: RECEIVED_AT,
    });
  });

  it("keeps ordinary Customer JSON parsing unchanged outside the Stripe scope", async () => {
    const { app } = testApp();
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { "idempotency-key": "json-scope" },
      payload: { displayName: "JSON remains parsed" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().displayName).toBe("JSON remains parsed");
  });

  it("enforces the isolated one-MiB Stripe body limit", async () => {
    const { app, dependencies } = testApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "not-reached",
      },
      payload: Buffer.alloc(STRIPE_WEBHOOK_BODY_LIMIT + 1, 0x20),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Payload too large" },
    });
    expect(dependencies.processStripeWebhook).not.toHaveBeenCalled();
  });

  it("requires exactly one unnormalized Stripe-Signature occurrence", async () => {
    const { app } = testApp();
    const missing = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: Buffer.from("{}"),
    });

    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("STRIPE_SIGNATURE_REQUIRED");
    expect(() =>
      stripeSignatureFromRawHeaders([
        "Stripe-Signature",
        "first",
        "stripe-signature",
        "second",
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_STRIPE_SIGNATURE_HEADER" }),
    );
    expect(stripeSignatureFromRawHeaders(["Stripe-Signature", " value "])).toBe(
      " value ",
    );
  });

  it("maps invalid signatures generically without leaking Stripe details", async () => {
    const rawPayload = Buffer.from(JSON.stringify(stripeEvent()), "utf8");
    const { app } = testApp();
    const response = await app.inject({
      ...signedRequest(rawPayload),
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=secret-cryptographic-detail",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_STRIPE_SIGNATURE",
        message: "Invalid Stripe signature",
      },
    });
    expect(response.body).not.toContain("cryptographic-detail");
    expect(response.body).not.toContain("signature verification");
  });

  it("rejects a one-byte payload change against an otherwise valid signature", async () => {
    const rawPayload = Buffer.from(JSON.stringify(stripeEvent()), "utf8");
    const request = signedRequest(rawPayload);
    const changed = Buffer.from(rawPayload);
    changed[changed.length - 2] = 0x20;
    const { app } = testApp();

    const response = await app.inject({ ...request, payload: changed });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_STRIPE_SIGNATURE");
  });

  it.each([
    [Buffer.from('{"id":', "utf8"), "INVALID_STRIPE_EVENT"],
    [Buffer.from(JSON.stringify({ id: "bad", type: "x", livemode: false })), "INVALID_STRIPE_EVENT"],
  ])("rejects signed unusable JSON or envelopes", async (rawPayload, code) => {
    const { app } = testApp();
    const response = await app.inject(signedRequest(rawPayload));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe(code);
  });

  it("acknowledges a valid signed unsupported event without persistence", async () => {
    const rawPayload = Buffer.from(
      JSON.stringify(stripeEvent({ type: "customer.created" })),
      "utf8",
    );
    const { app, dependencies } = testApp();
    const response = await app.inject(signedRequest(rawPayload));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(dependencies.processStripeWebhook).not.toHaveBeenCalled();
  });

  it("rejects live-mode events before persistence", async () => {
    const rawPayload = Buffer.from(
      JSON.stringify(stripeEvent({ livemode: true })),
      "utf8",
    );
    const { app, dependencies } = testApp();
    const response = await app.inject(signedRequest(rawPayload));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("LIVE_STRIPE_EVENT_NOT_ALLOWED");
    expect(dependencies.processStripeWebhook).not.toHaveBeenCalled();
  });

  it("maps an active claim to the bounded 503 response", async () => {
    const rawPayload = Buffer.from(JSON.stringify(stripeEvent()), "utf8");
    const { app } = testApp({
      processStripeWebhook: async () => ({ outcome: "busy" }),
    });
    const response = await app.inject(signedRequest(rawPayload));

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "STRIPE_EVENT_PROCESSING",
        message: "Stripe event is already being processed",
      },
    });
  });

  it("maps conflicting retained evidence to the bounded 409 response", async () => {
    const rawPayload = Buffer.from(JSON.stringify(stripeEvent()), "utf8");
    const { app } = testApp({
      processStripeWebhook: async () => {
        throw new StripeEventEvidenceConflict("evt_http123");
      },
    });
    const response = await app.inject(signedRequest(rawPayload));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "STRIPE_EVENT_EVIDENCE_CONFLICT",
        message: "Stripe event conflicts with retained evidence",
      },
    });
  });

  it("logs unexpected failures without payload or signature evidence", async () => {
    const payloadMarker = "STRIPE_PAYLOAD_MUST_NOT_APPEAR_7F3A";
    const rawPayload = Buffer.from(
      JSON.stringify(stripeEvent({ evidence_marker: payloadMarker })),
      "utf8",
    );
    const request = signedRequest(rawPayload);
    const signature = request.headers["stripe-signature"];
    const dangerousError = new Error(
      `Failed query: insert receipt\nparams: ${rawPayload.toString("utf8")}`,
    ) as Error & { cause?: unknown };
    dangerousError.cause = new Error(
      `nested cause with signature ${signature} and ${payloadMarker}`,
    );
    const { app } = testApp({
      processStripeWebhook: async () => {
        throw dangerousError;
      },
    });
    const logError = vi.spyOn(app.log, "error");

    const response = await app.inject(request);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(logError).toHaveBeenCalledWith(
      { code: "UNEXPECTED_STRIPE_WEBHOOK_ERROR" },
      "Unexpected Stripe webhook error",
    );
    const logged = JSON.stringify(logError.mock.calls);
    expect(logged).not.toContain(payloadMarker);
    expect(logged).not.toContain(rawPayload.toString("utf8"));
    expect(logged).not.toContain(signature);
    expect(logged).not.toContain("Failed query");
    expect(logged).not.toContain("params:");
    expect(logged).not.toContain("nested cause");
  });

  it.each(["processed", "failed"] as const)(
    "acknowledges the terminal %s outcome without internal details",
    async (outcome) => {
      const rawPayload = Buffer.from(JSON.stringify(stripeEvent()), "utf8");
      const { app } = testApp({
        processStripeWebhook: async () => ({ outcome }),
      });
      const response = await app.inject(signedRequest(rawPayload));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });
    },
  );
});
