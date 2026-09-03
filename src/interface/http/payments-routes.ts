import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Payment } from "../../payments/domain/payment.js";
import type { HttpUseCases } from "./app.js";
import { PublicHttpError } from "./error-handler.js";
import { requireIdempotencyKey } from "./request-validation.js";
import {
  OPERATOR_AUTH_POLICY,
  VIEWER_AUTH_POLICY,
} from "./security/auth-policies.js";
import { auditIdempotentMutation } from "./audit-support.js";

const recordPaymentBodySchema = z.strictObject({
  contractId: z.number().int(),
  amountCents: z.number().int(),
  receivedAt: z.iso.datetime({ offset: true }),
});

const paymentParamsSchema = z.strictObject({
  id: z.string().regex(/^-?\d+$/),
});

function serializePayment(payment: Payment) {
  return {
    id: payment.id,
    contractId: payment.contractId,
    amountCents: payment.amountCents,
    receivedAt: payment.receivedAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    allocations: payment.allocations.map((allocation) => ({
      installmentId: allocation.installmentId,
      amountCents: allocation.amountCents,
    })),
  };
}

export function registerPaymentRoutes(
  app: FastifyInstance,
  dependencies: Pick<HttpUseCases, "recordPayment" | "getPaymentById" | "appendAuditEvent">,
): void {
  app.post(
    "/payments",
    {
      config: {
        auth: OPERATOR_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(request);
      const body = recordPaymentBodySchema.parse(request.body);
      const result = await dependencies.recordPayment({
        idempotencyKey,
        contractId: body.contractId,
        amountCents: body.amountCents,
        receivedAt: new Date(body.receivedAt),
      });
      await auditIdempotentMutation(dependencies,request,{action:"payment.record",resourceType:"payment",resourceId:result.resource.id,outcome:result.outcome,idempotencyKey});

      return reply
        .status(result.outcome === "created" ? 201 : 200)
        .send(serializePayment(result.resource));
    },
  );

  app.get(
    "/payments/:id",
    {
      config: {
        auth: VIEWER_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const params = paymentParamsSchema.parse(request.params);
      const payment = await dependencies.getPaymentById(Number(params.id));

      if (payment === null) {
        throw new PublicHttpError(
          404,
          "PAYMENT_NOT_FOUND",
          "Payment not found",
        );
      }

      return reply.status(200).send(serializePayment(payment));
    },
  );
}
