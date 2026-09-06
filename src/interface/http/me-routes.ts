import type { FastifyInstance } from "fastify";

import { PublicHttpError } from "./error-handler.js";
import { VIEWER_AUTH_POLICY } from "./security/auth-policies.js";

export function registerMeRoutes(app: FastifyInstance): void {
  app.get("/me", { config: { auth: VIEWER_AUTH_POLICY } }, async (request) => {
    if (request.principal === null) {
      throw new PublicHttpError(401, "UNAUTHORIZED", "Authentication required");
    }

    return {
      subject: request.principal.subject,
      roles: [...request.principal.roles].sort(),
    };
  });
}
