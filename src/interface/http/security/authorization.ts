export const AUTH_ROLES = ["viewer", "operator", "admin"] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export interface AuthenticatedPrincipal {
  readonly subject: string;
  readonly roles: readonly AuthRole[];
}

export type RouteAuthPolicy =
  | { readonly public: true }
  | { readonly roles: readonly AuthRole[] };

export function isAuthRole(value: unknown): value is AuthRole {
  return (
    typeof value === "string" &&
    (AUTH_ROLES as readonly string[]).includes(value)
  );
}

export function isAuthorized(
  principal: AuthenticatedPrincipal | null,
  policy: RouteAuthPolicy | undefined,
): boolean {
  if (policy === undefined) {
    return false;
  }

  if ("public" in policy) {
    return policy.public;
  }

  if (principal === null) {
    return false;
  }

  return policy.roles.some((role) => principal.roles.includes(role));
}