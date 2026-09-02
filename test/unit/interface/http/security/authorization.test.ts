import { describe, expect, it } from "vitest";

import {
  isAuthorized,
  isAuthRole,
  type AuthenticatedPrincipal,
} from "../../../../../src/interface/http/security/authorization.js";

const VIEWER: AuthenticatedPrincipal = {
  subject: "auth0|viewer",
  roles: ["viewer"],
};

const OPERATOR: AuthenticatedPrincipal = {
  subject: "auth0|operator",
  roles: ["operator"],
};

const ADMIN: AuthenticatedPrincipal = {
  subject: "auth0|admin",
  roles: ["admin"],
};

describe("HTTP authorization", () => {
  it("recognizes only supported roles", () => {
    expect(isAuthRole("viewer")).toBe(true);
    expect(isAuthRole("operator")).toBe(true);
    expect(isAuthRole("admin")).toBe(true);

    expect(isAuthRole("owner")).toBe(false);
    expect(isAuthRole("")).toBe(false);
    expect(isAuthRole(null)).toBe(false);
  });

  it("denies a route with no explicit policy", () => {
    expect(isAuthorized(ADMIN, undefined)).toBe(false);
  });

  it("allows an explicitly public route without a principal", () => {
    expect(isAuthorized(null, { public: true })).toBe(true);
  });

  it("denies a protected route without a principal", () => {
    expect(
      isAuthorized(null, {
        roles: ["viewer", "operator", "admin"],
      }),
    ).toBe(false);
  });

  it("allows only roles explicitly listed by the route", () => {
    const viewerPolicy = {
      roles: ["viewer", "operator", "admin"] as const,
    };

    expect(isAuthorized(VIEWER, viewerPolicy)).toBe(true);
    expect(isAuthorized(OPERATOR, viewerPolicy)).toBe(true);
    expect(isAuthorized(ADMIN, viewerPolicy)).toBe(true);

    const operatorPolicy = {
      roles: ["operator", "admin"] as const,
    };

    expect(isAuthorized(VIEWER, operatorPolicy)).toBe(false);
    expect(isAuthorized(OPERATOR, operatorPolicy)).toBe(true);
    expect(isAuthorized(ADMIN, operatorPolicy)).toBe(true);
  });
});