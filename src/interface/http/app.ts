import Fastify, { type FastifyInstance } from "fastify";

import type { Clock } from "../../application/clock.js";
import type {
  getContractFinancialTimelineV1,
  getFinancialSummaryV1,
  getReconciliationSummaryV1,
} from "../../analytics/application/analytics-queries.js";
import type { createContractUseCase } from "../../contracts/application/create-contract.js";
import type { getContractByIdUseCase } from "../../contracts/application/get-contract-by-id.js";
import type { createCustomerUseCase } from "../../customers/application/create-customer.js";
import type { getCustomerByIdUseCase } from "../../customers/application/get-customer-by-id.js";
import type { getPaymentByIdUseCase } from "../../payments/application/get-payment-by-id.js";
import type { recordPaymentUseCase } from "../../payments/application/record-payment.js";
import type { actOnReconciliationFindingUseCase } from "../../reconciliation/application/act-on-reconciliation-finding.js";
import type { getExternalSourceEventByIdUseCase } from "../../reconciliation/application/get-external-source-event-by-id.js";
import type { ReconciliationPersistence } from "../../reconciliation/application/reconciliation-persistence.js";
import type { recordExternalSourceEventUseCase } from "../../reconciliation/application/record-external-source-event.js";
import type { runReconciliationUseCase } from "../../reconciliation/application/run-reconciliation.js";
import type { getRefundByIdUseCase } from "../../refunds/application/get-refund-by-id.js";
import type { recordRefundUseCase } from "../../refunds/application/record-refund.js";
import type { processStripeWebhookUseCase } from "../../stripe/application/process-stripe-webhook.js";
import { registerAnalyticsRoutes } from "./analytics-routes.js";
import { registerContractRoutes } from "./contracts-routes.js";
import { registerCustomerRoutes } from "./customers-routes.js";
import { registerPublicErrorHandler } from "./error-handler.js";
import { registerPaymentRoutes } from "./payments-routes.js";
import { registerReconciliationRoutes } from "./reconciliation-routes.js";
import { registerRefundRoutes } from "./refunds-routes.js";
import type { AccessTokenVerifier } from "./security/access-token-verifier.js";
import { registerHttpAuth } from "./security/http-auth.js";
import type { StripeSignatureVerifier } from "./stripe-signature-verifier.js";
import { registerStripeWebhookRoutes } from "./stripe-webhook-routes.js";

export interface HttpUseCases {
  readonly createCustomer: ReturnType<typeof createCustomerUseCase>;
  readonly getCustomerById: ReturnType<typeof getCustomerByIdUseCase>;
  readonly createContract: ReturnType<typeof createContractUseCase>;
  readonly getContractById: ReturnType<typeof getContractByIdUseCase>;
  readonly recordPayment: ReturnType<typeof recordPaymentUseCase>;
  readonly getPaymentById: ReturnType<typeof getPaymentByIdUseCase>;
  readonly recordRefund: ReturnType<typeof recordRefundUseCase>;
  readonly getRefundById: ReturnType<typeof getRefundByIdUseCase>;
  readonly processStripeWebhook: ReturnType<typeof processStripeWebhookUseCase>;
  readonly stripeWebhookClock: Clock;
  readonly verifyStripeSignature: StripeSignatureVerifier;
  readonly accessTokenVerifier: AccessTokenVerifier;
  readonly recordExternalSourceEvent?: ReturnType<
    typeof recordExternalSourceEventUseCase
  >;
  readonly getExternalSourceEventById?: ReturnType<
    typeof getExternalSourceEventByIdUseCase
  >;
  readonly runReconciliation?: ReturnType<typeof runReconciliationUseCase>;
  readonly reconciliationPersistence?: ReconciliationPersistence;
  readonly actOnReconciliationFinding?: ReturnType<
    typeof actOnReconciliationFindingUseCase
  >;
  readonly getFinancialSummaryV1?: ReturnType<typeof getFinancialSummaryV1>;
  readonly getContractFinancialTimelineV1?: ReturnType<
    typeof getContractFinancialTimelineV1
  >;
  readonly getReconciliationSummaryV1?: ReturnType<
    typeof getReconciliationSummaryV1
  >;
}

export function buildApp(dependencies: HttpUseCases): FastifyInstance {
  const app = Fastify();

  registerPublicErrorHandler(app);
  registerHttpAuth(app, dependencies.accessTokenVerifier);

  registerCustomerRoutes(app, dependencies);
  registerContractRoutes(app, dependencies);
  registerPaymentRoutes(app, dependencies);
  registerRefundRoutes(app, dependencies);
  registerStripeWebhookRoutes(app, dependencies);

  if (
    dependencies.recordExternalSourceEvent &&
    dependencies.getExternalSourceEventById &&
    dependencies.runReconciliation &&
    dependencies.reconciliationPersistence &&
    dependencies.actOnReconciliationFinding
  ) {
    registerReconciliationRoutes(
      app,
      dependencies as Required<HttpUseCases>,
    );
  }

  if (
    dependencies.getFinancialSummaryV1 &&
    dependencies.getContractFinancialTimelineV1 &&
    dependencies.getReconciliationSummaryV1
  ) {
    registerAnalyticsRoutes(
      app,
      dependencies as Required<HttpUseCases>,
    );
  }

  return app;
}