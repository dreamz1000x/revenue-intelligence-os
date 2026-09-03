import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Contract } from "../../contracts/domain/contract.js";
import type { HttpUseCases } from "./app.js";
import { PublicHttpError } from "./error-handler.js";
import { requireIdempotencyKey } from "./request-validation.js";
import {
  OPERATOR_AUTH_POLICY,
  VIEWER_AUTH_POLICY,
} from "./security/auth-policies.js";
import { auditIdempotentMutation } from "./audit-support.js";

const createContractBodySchema = z.strictObject({
  customerId: z.number().int(),
  totalAmountCents: z.number().int(),
  currency: z.string(),
  installmentCount: z.number().int(),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const contractParamsSchema = z.strictObject({
  contractId: z.string().regex(/^-?\d+$/),
});

function serializeContract(contract: Contract) {
  return {
    id: contract.id,
    customerId: contract.customerId,
    totalAmountCents: contract.totalAmountCents,
    currency: contract.currency,
    installmentCount: contract.installmentCount,
    firstDueDate: contract.firstDueDate,
    status: contract.status,
    createdAt: contract.createdAt.toISOString(),
    installments: contract.installments.map((installment) => ({
      id: installment.id,
      contractId: installment.contractId,
      position: installment.position,
      amountCents: installment.amountCents,
      dueDate: installment.dueDate,
      status: installment.status,
      createdAt: installment.createdAt.toISOString(),
    })),
  };
}

export function registerContractRoutes(
  app: FastifyInstance,
  dependencies: Pick<HttpUseCases, "createContract" | "getContractById" | "appendAuditEvent">,
): void {
  app.post(
    "/contracts",
    {
      config: {
        auth: OPERATOR_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(request);
      const body = createContractBodySchema.parse(request.body);
      const result = await dependencies.createContract({
        idempotencyKey,
        customerId: body.customerId,
        totalAmountCents: body.totalAmountCents,
        currency: body.currency,
        installmentCount: body.installmentCount,
        firstDueDate: body.firstDueDate,
      });
      await auditIdempotentMutation(dependencies,request,{action:"contract.create",resourceType:"contract",resourceId:result.resource.id,outcome:result.outcome,idempotencyKey});

      return reply
        .status(result.outcome === "created" ? 201 : 200)
        .send(serializeContract(result.resource));
    },
  );

  app.get(
    "/contracts/:contractId",
    {
      config: {
        auth: VIEWER_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const params = contractParamsSchema.parse(request.params);
      const contract = await dependencies.getContractById(
        Number(params.contractId),
      );

      if (contract === null) {
        throw new PublicHttpError(
          404,
          "CONTRACT_NOT_FOUND",
          "Contract not found",
        );
      }

      return reply.status(200).send(serializeContract(contract));
    },
  );
}
