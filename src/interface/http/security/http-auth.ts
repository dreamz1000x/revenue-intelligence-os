import type { FastifyInstance } from "fastify";

import { PublicHttpError } from "../error-handler.js";
import type { AccessTokenVerifier } from "./access-token-verifier.js";
import {
  isAuthorized,
  type AuthenticatedPrincipal,
  type RouteAuthPolicy,
} from "./authorization.js";

declare module "fastify" {
  interface FastifyContextConfig {
    auth?: RouteAuthPolicy;
  }

  interface FastifyRequest {
    principal: AuthenticatedPrincipal | null;
  }
}

function requireBearerToken(authorization: string | undefined): string {
  if (authorization === undefined) {
    throw new PublicHttpError(
      401,
      "UNAUTHORIZED",
      "Authentication required",
    );
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);

  if (match === null) {
    throw new PublicHttpError(
      401,
      "UNAUTHORIZED",
      "Authentication required",
    );
  }

  return match[1]!;
}

export function registerHttpAuth(
  app: FastifyInstance,
  accessTokenVerifier: AccessTokenVerifier,
): void {
  app.decorateRequest("principal", null);

  app.addHook("preHandler", async (request) => {
    const policy = request.routeOptions.config.auth;

    if (policy === undefined) {
      throw new PublicHttpError(
        403,
        "FORBIDDEN",
        "Forbidden",
      );
    }

    if ("public" in policy && policy.public) {
      return;
    }

    const accessToken = requireBearerToken(
      request.headers.authorization,
    );

    let principal: AuthenticatedPrincipal;

    try {
      principal = await accessTokenVerifier.verify(accessToken);
    } catch {
      throw new PublicHttpError(
        401,
        "UNAUTHORIZED",
        "Authentication required",
      );
    }

    request.principal = principal;

    if (!isAuthorized(principal, policy)) {
      throw new PublicHttpError(
        403,
        "FORBIDDEN",
        "Forbidden",
      );
    }
  });
}