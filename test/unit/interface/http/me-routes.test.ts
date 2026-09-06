import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerMeRoutes } from "../../../../src/interface/http/me-routes.js";

const apps: FastifyInstance[] = [];

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("GET /me", () => {
  it("returns only the verified subject and deterministically ordered roles", async () => {
    const app = Fastify();
    app.decorateRequest("principal", null);
    app.addHook("preHandler", async (request) => {
      request.principal = {
        subject: "auth0|operator",
        roles: ["operator", "viewer"],
      };
    });
    registerMeRoutes(app);
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/me" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subject: "auth0|operator",
      roles: ["operator", "viewer"],
    });
    expect(response.body).not.toContain("token");
  });
});
