import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../../src/interface/http/app.js";
import { createOperationalMetrics } from "../../../../src/interface/http/operational-metrics.js";

const openApps: FastifyInstance[] = [];

function testApp(role: "viewer" | "operator" | "admin" = "admin"): FastifyInstance {
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
    stripeWebhookClock: { now: () => new Date("2026-09-05T00:00:00.000Z") },
    verifyStripeSignature: () => {
      throw new Error("Unexpected route");
    },
    accessTokenVerifier: {
      verify: async () => ({ subject: `auth0|${role}`, roles: [role] }),
    },
  }, {
    readinessCheck: async () => undefined,
  });

  openApps.push(app);
  return app;
}

const authenticatedMetricsRequest = {
  method: "GET" as const,
  url: "/metrics",
  headers: { authorization: "Bearer test-token" },
};

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("operational metrics", () => {
  it("classifies completed responses into fixed status buckets", () => {
    const metrics = createOperationalMetrics();

    for (const status of [200, 299, 302, 400, 401, 404, 500, 503, 199, 600]) {
      metrics.recordResponse(status);
    }

    expect(metrics.snapshot().http).toEqual({
      completedRequestsTotal: 10,
      responsesByStatusClass: {
        "2xx": 2,
        "3xx": 1,
        "4xx": 3,
        "5xx": 2,
        other: 2,
      },
    });
    expect(metrics.snapshot().uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(metrics.snapshot().uptimeSeconds)).toBe(true);
  });

  it("returns defensive snapshots", () => {
    const metrics = createOperationalMetrics();
    const first = metrics.snapshot();
    metrics.recordResponse(200);

    expect(first.http.completedRequestsTotal).toBe(0);
    expect(first.http.responsesByStatusClass["2xx"]).toBe(0);
  });

  it.each([
    [undefined, 401],
    ["viewer", 403],
    ["operator", 403],
    ["admin", 200],
  ] as const)("enforces ADMIN metrics access for %s", async (role, statusCode) => {
    const app = testApp(role ?? "admin");
    const response = await app.inject({
      ...authenticatedMetricsRequest,
      ...(role === undefined ? { headers: {} } : {}),
    });

    expect(response.statusCode).toBe(statusCode);
    if (statusCode === 200) {
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("counts completed requests in subsequent metrics snapshots", async () => {
    const app = testApp();
    const before = (await app.inject(authenticatedMetricsRequest)).json();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const after = (await app.inject(authenticatedMetricsRequest)).json();

    expect(after.http.completedRequestsTotal - before.http.completedRequestsTotal).toBe(2);
    expect(
      after.http.responsesByStatusClass["2xx"] -
        before.http.responsesByStatusClass["2xx"],
    ).toBe(2);
    expect(Number.isInteger(after.uptimeSeconds)).toBe(true);
    expect(after.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("keeps counters isolated between app instances", async () => {
    const first = testApp();
    const second = testApp();

    await first.inject({ method: "GET", url: "/health" });
    const firstSnapshot = (await first.inject(authenticatedMetricsRequest)).json();
    const secondSnapshot = (await second.inject(authenticatedMetricsRequest)).json();

    expect(firstSnapshot.http.completedRequestsTotal).toBe(1);
    expect(secondSnapshot.http.completedRequestsTotal).toBe(0);
  });
});
