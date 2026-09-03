import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";

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
import { PublicHttpError, registerPublicErrorHandler } from "./error-handler.js";
import { registerPaymentRoutes } from "./payments-routes.js";
import { registerReconciliationRoutes } from "./reconciliation-routes.js";
import { registerRefundRoutes } from "./refunds-routes.js";
import type { AccessTokenVerifier } from "./security/access-token-verifier.js";
import { registerHttpAuth } from "./security/http-auth.js";
import type { StripeSignatureVerifier } from "./stripe-signature-verifier.js";
import { registerStripeWebhookRoutes } from "./stripe-webhook-routes.js";
import type { appendAuditEvent, listAuditEvents } from "../../audit/application/audit-events.js";
import { registerAuditRoutes } from "./audit-routes.js";

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
  readonly appendAuditEvent?: ReturnType<typeof appendAuditEvent>;
  readonly listAuditEvents?: ReturnType<typeof listAuditEvents>;
}

export function buildApp(dependencies: HttpUseCases): FastifyInstance {
  const app = Fastify({
    bodyLimit: 1_048_576,
    requestTimeout: 120_000,
    trustProxy: false,
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    return payload;
  });

  registerPublicErrorHandler(app);
  registerHttpAuth(app, dependencies.accessTokenVerifier);
  app.register(rateLimit, {
    global: true,
    hook: "preHandler",
    max: 60,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      if (request.principal === null) {
        throw new Error("Authenticated principal is required for rate limiting");
      }

      return request.principal.subject;
    },
    errorResponseBuilder: () =>
      new PublicHttpError(429, "RATE_LIMITED", "Too many requests"),
  });

  app.after(() => {
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
    if (dependencies.listAuditEvents) {
      registerAuditRoutes(app, dependencies as Required<HttpUseCases>);
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
  });

  return app;
}
