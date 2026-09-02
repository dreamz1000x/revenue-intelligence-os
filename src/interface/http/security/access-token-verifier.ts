import type { AuthenticatedPrincipal } from "./authorization.js";

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<AuthenticatedPrincipal>;
}

export class InvalidAccessTokenError extends Error {
  override readonly name = "InvalidAccessTokenError";

  constructor() {
    super("Invalid access token");
  }
}