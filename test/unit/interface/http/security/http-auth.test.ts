import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerPublicErrorHandler } from "../../../../../src/interface/http/error-handler.js";
import { registerHttpAuth } from "../../../../../src/interface/http/security/http-auth.js";
import type { AccessTokenVerifier } from "../../../../../src/interface/http/security/access-token-verifier.js";

const openApps: FastifyInstance[] = [];

function buildTestApp(
  verifier: AccessTokenVerifier,
): FastifyInstance {
  const app = Fastify();

  registerPublicErrorHandler(app);
  registerHttpAuth(app, verifier);

  app.get(
    "/public",
    {
      config: {
        auth: { public: true },
      },
    },
    async () => ({ ok: true }),
  );

  app.get(
    "/viewer",
    {
      config: {
        auth: {
          roles: ["viewer", "operator", "admin"],
        },
      },
    },
    async (request) => ({
      subject: request.principal?.subject,
    }),
  );

  app.post(
    "/operator",
    {
      config: {
        auth: {
          roles: ["operator", "admin"],
        },
      },
    },
    async () => ({ ok: true }),
  );

  app.get("/unclassified", async () => ({ ok: true }));

  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("HTTP authentication and authorization", () => {
  it("allows an explicitly public route without a token", async () => {
    const app = buildTestApp({
      verify: async () => {
        throw new Error("Verifier must not be called");
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/public",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("denies a route with no explicit auth policy", async () => {
    const app = buildTestApp({
      verify: async () => ({
        subject: "auth0|admin",
        roles: ["admin"],
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/unclassified",
      headers: {
        authorization: "Bearer valid-token",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Forbidden",
      },
    });
  });

  it("returns 401 when a protected route has no bearer token", async () => {
    const app = buildTestApp({
      verify: async () => {
        throw new Error("Verifier must not be called");
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/viewer",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
      },
    });
  });

  it("returns 401 when token verification fails", async () => {
    const app = buildTestApp({
      verify: async () => {
        throw new Error("Invalid token");
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/viewer",
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("allows a viewer on a viewer route and exposes the principal", async () => {
    const app = buildTestApp({
      verify: async () => ({
        subject: "auth0|viewer",
        roles: ["viewer"],
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/viewer",
      headers: {
        authorization: "Bearer valid-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subject: "auth0|viewer",
    });
  });

  it("returns 403 when a viewer calls an operator route", async () => {
    const app = buildTestApp({
      verify: async () => ({
        subject: "auth0|viewer",
        roles: ["viewer"],
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/operator",
      headers: {
        authorization: "Bearer valid-token",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Forbidden",
      },
    });
  });

  it("allows an admin on an operator route", async () => {
    const app = buildTestApp({
      verify: async () => ({
        subject: "auth0|admin",
        roles: ["admin"],
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/operator",
      headers: {
        authorization: "Bearer valid-token",
      },
    });

    expect(response.statusCode).toBe(200);
  });
});