import {
  generateKeyPair,
  SignJWT,
} from "jose";
import { describe, expect, it } from "vitest";

import { createAuth0AccessTokenVerifier } from "../../../../../src/interface/http/security/auth0-access-token-verifier.js";
import { InvalidAccessTokenError } from "../../../../../src/interface/http/security/access-token-verifier.js";

const ISSUER = "https://rios-test.eu.auth0.com/";
const AUDIENCE = "https://api.rios.test";
const ROLES_CLAIM = "https://rios.dev/roles";

async function createSigningFixture() {
  const { privateKey, publicKey } =
    await generateKeyPair("RS256");

  return {
    privateKey,
    keyResolver: async () => publicKey,
  };
}

async function signToken(
  privateKey: Awaited<
    ReturnType<typeof createSigningFixture>
  >["privateKey"],
  overrides: {
    subject?: string;
    issuer?: string;
    audience?: string;
    roles?: unknown;
    expirationTime?: string | number;
  } = {},
): Promise<string> {
  const payload: Record<string, unknown> = {
    [ROLES_CLAIM]:
      overrides.roles ?? ["viewer"],
  };

  return new SignJWT(payload)
    .setProtectedHeader({
      alg: "RS256",
      kid: "test-key",
    })
    .setSubject(
      overrides.subject ?? "auth0|123",
    )
    .setIssuer(
      overrides.issuer ?? ISSUER,
    )
    .setAudience(
      overrides.audience ?? AUDIENCE,
    )
    .setIssuedAt()
    .setExpirationTime(
      overrides.expirationTime ?? "5m",
    )
    .sign(privateKey);
}

describe("Auth0 access token verifier", () => {
  it(
    "verifies signature, issuer, audience, subject, and supported roles",
    async () => {
      const fixture =
        await createSigningFixture();

      const verifier =
        createAuth0AccessTokenVerifier(
          {
            issuer: ISSUER,
            audience: AUDIENCE,
            rolesClaim: ROLES_CLAIM,
          },
          fixture.keyResolver,
        );

      const token = await signToken(
        fixture.privateKey,
        {
          roles: [
            "viewer",
            "admin",
            "unsupported-role",
          ],
        },
      );

      await expect(
        verifier.verify(token),
      ).resolves.toEqual({
        subject: "auth0|123",
        roles: ["viewer", "admin"],
      });
    },
  );

  it(
    "returns no roles when the roles claim is malformed",
    async () => {
      const fixture =
        await createSigningFixture();

      const verifier =
        createAuth0AccessTokenVerifier(
          {
            issuer: ISSUER,
            audience: AUDIENCE,
            rolesClaim: ROLES_CLAIM,
          },
          fixture.keyResolver,
        );

      const token = await signToken(
        fixture.privateKey,
        {
          roles: "viewer",
        },
      );

      await expect(
        verifier.verify(token),
      ).resolves.toEqual({
        subject: "auth0|123",
        roles: [],
      });
    },
  );

  it(
    "rejects a token with the wrong issuer",
    async () => {
      const fixture =
        await createSigningFixture();

      const verifier =
        createAuth0AccessTokenVerifier(
          {
            issuer: ISSUER,
            audience: AUDIENCE,
            rolesClaim: ROLES_CLAIM,
          },
          fixture.keyResolver,
        );

      const token = await signToken(
        fixture.privateKey,
        {
          issuer:
            "https://evil.example.com/",
        },
      );

      await expect(
        verifier.verify(token),
      ).rejects.toBeInstanceOf(
        InvalidAccessTokenError,
      );
    },
  );

  it(
    "rejects a token with the wrong audience",
    async () => {
      const fixture =
        await createSigningFixture();

      const verifier =
        createAuth0AccessTokenVerifier(
          {
            issuer: ISSUER,
            audience: AUDIENCE,
            rolesClaim: ROLES_CLAIM,
          },
          fixture.keyResolver,
        );

      const token = await signToken(
        fixture.privateKey,
        {
          audience:
            "https://wrong.example.com",
        },
      );

      await expect(
        verifier.verify(token),
      ).rejects.toBeInstanceOf(
        InvalidAccessTokenError,
      );
    },
  );

  it(
    "rejects an expired token",
    async () => {
      const fixture =
        await createSigningFixture();

      const verifier =
        createAuth0AccessTokenVerifier(
          {
            issuer: ISSUER,
            audience: AUDIENCE,
            rolesClaim: ROLES_CLAIM,
          },
          fixture.keyResolver,
        );

      const token = await signToken(
        fixture.privateKey,
        {
          expirationTime: 1,
        },
      );

      await expect(
        verifier.verify(token),
      ).rejects.toBeInstanceOf(
        InvalidAccessTokenError,
      );
    },
  );

  it(
  "rejects a token without an expiration claim",
  async () => {
    const fixture =
      await createSigningFixture();

    const verifier =
      createAuth0AccessTokenVerifier(
        {
          issuer: ISSUER,
          audience: AUDIENCE,
          rolesClaim: ROLES_CLAIM,
        },
        fixture.keyResolver,
      );

    const token = await new SignJWT({
      [ROLES_CLAIM]: ["viewer"],
    })
      .setProtectedHeader({
        alg: "RS256",
        kid: "test-key",
      })
      .setSubject("auth0|123")
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .sign(fixture.privateKey);

    await expect(
      verifier.verify(token),
    ).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  },
);

  it(
    "rejects a token signed by an untrusted key",
    async () => {
      const trusted =
        await createSigningFixture();

      const attacker =
        await createSigningFixture();

      const verifier =
        createAuth0AccessTokenVerifier(
          {
            issuer: ISSUER,
            audience: AUDIENCE,
            rolesClaim: ROLES_CLAIM,
          },
          trusted.keyResolver,
        );

      const token = await signToken(
        attacker.privateKey,
      );

      await expect(
        verifier.verify(token),
      ).rejects.toBeInstanceOf(
        InvalidAccessTokenError,
      );
    },
  );
});