import type { FastifyInstance } from "fastify";

import { PUBLIC_AUTH_POLICY } from "./security/auth-policies.js";

export interface HealthRouteDependencies {
  readonly readinessCheck: () => Promise<void>;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  dependencies: HealthRouteDependencies,
): void {
  app.get(
    "/health",
    {
      config: {
        auth: PUBLIC_AUTH_POLICY,
        rateLimit: false,
      },
    },
    async () => ({ status: "ok" }),
  );

  app.get(
    "/ready",
    {
      config: {
        auth: PUBLIC_AUTH_POLICY,
        rateLimit: false,
      },
      handlerTimeout: 3000,
    },
    async (request, reply) => {
      try {
        await dependencies.readinessCheck();
        return { status: "ready" };
      } catch {
        request.log.warn(
          { event: "readiness_check_failed" },
          "Readiness check failed",
        );
        return reply.status(503).send({ status: "not_ready" });
      }
    },
  );
}
