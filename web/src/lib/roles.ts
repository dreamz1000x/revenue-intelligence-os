export const roles = ["viewer", "operator", "admin"] as const;
export type Role = (typeof roles)[number];

export function hasRole(actual: readonly string[], required: Role): boolean {
  const rank: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };
  return actual.some((role) => role in rank && rank[role as Role] >= rank[required]);
}
