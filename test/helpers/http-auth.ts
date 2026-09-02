import type { FastifyInstance } from "fastify";

import type { AccessTokenVerifier } from "../../src/interface/http/security/access-token-verifier.js";
import type { AuthenticatedPrincipal } from "../../src/interface/http/security/authorization.js";

export const TEST_ADMIN_PRINCIPAL: AuthenticatedPrincipal = {
  subject: "auth0|test-admin",
  roles: ["admin"],
};

export const TEST_ACCESS_TOKEN_VERIFIER: AccessTokenVerifier = {
  async verify(accessToken) {
    if (accessToken !== "test-token") {
      throw new Error("Unexpected test access token");
    }

    return TEST_ADMIN_PRINCIPAL;
  },
};

export function authenticateTestRequests(
  app: FastifyInstance,
): void {
  app.addHook("onRequest", async (request) => {
    if (request.headers.authorization === undefined) {
      request.headers.authorization = "Bearer test-token";
    }
  });
}