import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Refund } from "../../refunds/domain/refund.js";
import type { HttpUseCases } from "./app.js";
import { PublicHttpError } from "./error-handler.js";
import { requireIdempotencyKey } from "./request-validation.js";
import {
  OPERATOR_AUTH_POLICY,
  VIEWER_AUTH_POLICY,
} from "./security/auth-policies.js";
import { auditIdempotentMutation } from "./audit-support.js";

const recordRefundBodySchema = z.strictObject({
  paymentId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  refundedAt: z.iso.datetime({ offset: true }),
});

const refundParamsSchema = z.strictObject({
  id: z.string().regex(/^-?\d+$/),
});

function serializeRefund(refund: Refund) {
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    amountCents: refund.amountCents,
    refundedAt: refund.refundedAt.toISOString(),
    createdAt: refund.createdAt.toISOString(),
    allocations: refund.allocations.map((allocation) => ({
      installmentId: allocation.installmentId,
      amountCents: allocation.amountCents,
    })),
  };
}

export function registerRefundRoutes(
  app: FastifyInstance,
  dependencies: Pick<HttpUseCases, "recordRefund" | "getRefundById" | "appendAuditEvent">,
): void {
  app.post(
    "/refunds",
    {
      config: {
        auth: OPERATOR_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(request);
      const body = recordRefundBodySchema.parse(request.body);
      const result = await dependencies.recordRefund({
        idempotencyKey,
        paymentId: body.paymentId,
        amountCents: body.amountCents,
        refundedAt: new Date(body.refundedAt),
      });
      await auditIdempotentMutation(dependencies,request,{action:"refund.record",resourceType:"refund",resourceId:result.resource.id,outcome:result.outcome,idempotencyKey});

      return reply
        .status(result.outcome === "created" ? 201 : 200)
        .send(serializeRefund(result.resource));
    },
  );

  app.get(
    "/refunds/:id",
    {
      config: {
        auth: VIEWER_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const params = refundParamsSchema.parse(request.params);
      const refund = await dependencies.getRefundById(Number(params.id));

      if (refund === null) {
        throw new PublicHttpError(
          404,
          "REFUND_NOT_FOUND",
          "Refund not found",
        );
      }

      return reply.status(200).send(serializeRefund(refund));
    },
  );
}
