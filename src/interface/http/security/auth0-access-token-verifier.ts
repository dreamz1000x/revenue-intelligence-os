import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

import {
  isAuthRole,
  type AuthenticatedPrincipal,
} from "./authorization.js";
import {
  InvalidAccessTokenError,
  type AccessTokenVerifier,
} from "./access-token-verifier.js";

export interface Auth0AccessTokenVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly rolesClaim: string;
}

function normalizeIssuer(issuer: string): string {
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

function parseRoles(
  payload: JWTPayload,
  rolesClaim: string,
): AuthenticatedPrincipal["roles"] {
  const rawRoles = payload[rolesClaim];

  if (!Array.isArray(rawRoles)) {
    return [];
  }

  return rawRoles.filter(isAuthRole);
}

export function createAuth0AccessTokenVerifier(
  config: Auth0AccessTokenVerifierConfig,
  keyResolver?: JWTVerifyGetKey,
): AccessTokenVerifier {
  const issuer = normalizeIssuer(config.issuer);

  const jwks =
    keyResolver ??
    createRemoteJWKSet(
      new URL(`${issuer}.well-known/jwks.json`),
    );

  return {
    async verify(accessToken: string): Promise<AuthenticatedPrincipal> {
      try {
        const { payload } = await jwtVerify(accessToken, jwks, {
          issuer,
          audience: config.audience,
          algorithms: ["RS256"],
          requiredClaims: ["exp"],
        });

        if (
          typeof payload.sub !== "string" ||
          payload.sub.length === 0
        ) {
          throw new InvalidAccessTokenError();
        }

        return {
          subject: payload.sub,
          roles: parseRoles(payload, config.rolesClaim),
        };
      } catch (error) {
        if (error instanceof InvalidAccessTokenError) {
          throw error;
        }

        throw new InvalidAccessTokenError();
      }
    },
  };
}