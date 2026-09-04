import type { FastifyInstance } from "fastify";

import type { OperationalMetrics } from "./operational-metrics.js";
import { ADMIN_AUTH_POLICY } from "./security/auth-policies.js";

export function registerMetricsRoutes(
  app: FastifyInstance,
  metrics: OperationalMetrics,
): void {
  app.get(
    "/metrics",
    { config: { auth: ADMIN_AUTH_POLICY } },
    async () => metrics.snapshot(),
  );
}
