import type { RouteAuthPolicy } from "./authorization.js";

export const PUBLIC_AUTH_POLICY = {
  public: true,
} as const satisfies RouteAuthPolicy;

export const VIEWER_AUTH_POLICY = {
  roles: ["viewer", "operator", "admin"],
} as const satisfies RouteAuthPolicy;

export const OPERATOR_AUTH_POLICY = {
  roles: ["operator", "admin"],
} as const satisfies RouteAuthPolicy;

export const ADMIN_AUTH_POLICY = {
  roles: ["admin"],
} as const satisfies RouteAuthPolicy;