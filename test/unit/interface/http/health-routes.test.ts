import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../../../src/interface/http/app.js";

const openApps: FastifyInstance[] = [];

function testApp(
  readinessCheck: () => Promise<void>,
  logLines?: string[],
): FastifyInstance {
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
      verify: async () => {
        throw new Error("Authentication must not be required");
      },
    },
  }, {
    readinessCheck,
    ...(logLines
      ? {
          logger: {
            level: "info",
            stream: { write: (line: string) => logLines.push(line) },
          },
        }
      : {}),
  });

  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("health and readiness HTTP interface", () => {
  it("serves liveness publicly without calling readiness or principal limiting", async () => {
    const readinessCheck = vi.fn(async () => undefined);
    const app = testApp(readinessCheck);
    const responses = await Promise.all(
      Array.from({ length: 65 }, () =>
        app.inject({ method: "GET", url: "/health" }),
      ),
    );

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(responses[0]?.json()).toEqual({ status: "ok" });
    expect(readinessCheck).not.toHaveBeenCalled();
    expect(responses[0]?.headers["x-content-type-options"]).toBe("nosniff");
    expect(responses[0]?.headers["referrer-policy"]).toBe("no-referrer");
    expect(responses[0]?.headers["cache-control"]).toBe("no-store");
  });

  it("reports successful PostgreSQL readiness publicly", async () => {
    const readinessCheck = vi.fn(async () => undefined);
    const response = await testApp(readinessCheck).inject({
      method: "GET",
      url: "/ready",
    });

    expect(readinessCheck).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("returns and logs only a safe readiness failure", async () => {
    const logLines: string[] = [];
    const response = await testApp(
      async () => {
        throw new Error("secret-db-host password=secret-password");
      },
      logLines,
    ).inject({ method: "GET", url: "/ready" });
    const output = logLines.join("");
    const records = logLines.flatMap((chunk) =>
      chunk.split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    );

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "not_ready" });
    expect(response.body).not.toContain("secret-db-host");
    expect(output).not.toContain("secret-db-host");
    expect(output).not.toContain("secret-password");
    expect(records).toContainEqual(expect.objectContaining({
      level: 40,
      event: "readiness_check_failed",
    }));
  });
});
