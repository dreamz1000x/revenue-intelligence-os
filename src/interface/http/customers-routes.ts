import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Customer } from "../../customers/domain/customer.js";
import type { HttpUseCases } from "./app.js";
import { PublicHttpError } from "./error-handler.js";
import { requireIdempotencyKey } from "./request-validation.js";
import {
  OPERATOR_AUTH_POLICY,
  VIEWER_AUTH_POLICY,
} from "./security/auth-policies.js";
import { auditIdempotentMutation } from "./audit-support.js";

const createCustomerBodySchema = z.strictObject({
  displayName: z.string(),
});

const customerParamsSchema = z.strictObject({
  customerId: z.string().regex(/^-?\d+$/),
});

function serializeCustomer(customer: Customer) {
  return {
    id: customer.id,
    displayName: customer.displayName,
    createdAt: customer.createdAt.toISOString(),
  };
}

export function registerCustomerRoutes(
  app: FastifyInstance,
  dependencies: Pick<HttpUseCases, "createCustomer" | "getCustomerById" | "appendAuditEvent">,
): void {
  app.post(
    "/customers",
    {
      config: {
        auth: OPERATOR_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(request);
      const body = createCustomerBodySchema.parse(request.body);
      const result = await dependencies.createCustomer({
        idempotencyKey,
        displayName: body.displayName,
      });
      await auditIdempotentMutation(dependencies,request,{action:"customer.create",resourceType:"customer",resourceId:result.resource.id,outcome:result.outcome,idempotencyKey});

      return reply
        .status(result.outcome === "created" ? 201 : 200)
        .send(serializeCustomer(result.resource));
    },
  );

  app.get(
    "/customers/:customerId",
    {
      config: {
        auth: VIEWER_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const params = customerParamsSchema.parse(request.params);
      const customer = await dependencies.getCustomerById(
        Number(params.customerId),
      );

      if (customer === null) {
        throw new PublicHttpError(
          404,
          "CUSTOMER_NOT_FOUND",
          "Customer not found",
        );
      }

      return reply.status(200).send(serializeCustomer(customer));
    },
  );
}
