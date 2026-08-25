import Fastify, { type FastifyInstance } from "fastify";

import type { createContractUseCase } from "../../contracts/application/create-contract.js";
import type { getContractByIdUseCase } from "../../contracts/application/get-contract-by-id.js";
import type { createCustomerUseCase } from "../../customers/application/create-customer.js";
import type { getCustomerByIdUseCase } from "../../customers/application/get-customer-by-id.js";
import { registerContractRoutes } from "./contracts-routes.js";
import { registerCustomerRoutes } from "./customers-routes.js";
import { registerPublicErrorHandler } from "./error-handler.js";

export interface HttpUseCases {
  readonly createCustomer: ReturnType<typeof createCustomerUseCase>;
  readonly getCustomerById: ReturnType<typeof getCustomerByIdUseCase>;
  readonly createContract: ReturnType<typeof createContractUseCase>;
  readonly getContractById: ReturnType<typeof getContractByIdUseCase>;
}

export function buildApp(dependencies: HttpUseCases): FastifyInstance {
  const app = Fastify();

  registerPublicErrorHandler(app);
  registerCustomerRoutes(app, dependencies);
  registerContractRoutes(app, dependencies);

  return app;
}
