import type { Clock } from "./application/clock.js";
import {
  getContractFinancialTimelineV1,
  getFinancialSummaryV1,
  getReconciliationSummaryV1,
} from "./analytics/application/analytics-queries.js";
import { PostgresAnalyticsQueries } from "./analytics/persistence/postgres-analytics-queries.js";
import { createContractUseCase } from "./contracts/application/create-contract.js";
import { getContractByIdUseCase } from "./contracts/application/get-contract-by-id.js";
import { PostgresContractPersistence } from "./contracts/persistence/postgres-contract-persistence.js";
import { createCustomerUseCase } from "./customers/application/create-customer.js";
import { getCustomerByIdUseCase } from "./customers/application/get-customer-by-id.js";
import { PostgresCustomerPersistence } from "./customers/persistence/postgres-customer-persistence.js";
import { buildApp } from "./interface/http/app.js";
import { createAuth0AccessTokenVerifier } from "./interface/http/security/auth0-access-token-verifier.js";
import { createStripeSignatureVerifier } from "./interface/http/stripe-signature-verifier.js";
import { getPaymentByIdUseCase } from "./payments/application/get-payment-by-id.js";
import { recordPaymentUseCase } from "./payments/application/record-payment.js";
import { PostgresPaymentPersistence } from "./payments/persistence/postgres-payment-persistence.js";
import { createDatabase } from "./persistence/database.js";
import { actOnReconciliationFindingUseCase } from "./reconciliation/application/act-on-reconciliation-finding.js";
import { getExternalSourceEventByIdUseCase } from "./reconciliation/application/get-external-source-event-by-id.js";
import { recordExternalSourceEventUseCase } from "./reconciliation/application/record-external-source-event.js";
import { runReconciliationUseCase } from "./reconciliation/application/run-reconciliation.js";
import { PostgresExternalSourceEventPersistence } from "./reconciliation/persistence/postgres-external-source-event-persistence.js";
import { PostgresReconciliationActionPersistence } from "./reconciliation/persistence/postgres-reconciliation-action-persistence.js";
import { PostgresReconciliationPersistence } from "./reconciliation/persistence/postgres-reconciliation-persistence.js";
import { getRefundByIdUseCase } from "./refunds/application/get-refund-by-id.js";
import { recordRefundUseCase } from "./refunds/application/record-refund.js";
import { PostgresRefundPersistence } from "./refunds/persistence/postgres-refund-persistence.js";
import { processStripeWebhookUseCase } from "./stripe/application/process-stripe-webhook.js";
import { PostgresStripeWebhookEventPersistence } from "./stripe/persistence/postgres-stripe-webhook-event-persistence.js";
import { appendAuditEvent, listAuditEvents } from "./audit/application/audit-events.js";
import { PostgresAuditPersistence } from "./audit/persistence/postgres-audit-persistence.js";
import { loadRuntimeConfig } from "./config/runtime-config.js";

const config = loadRuntimeConfig(process.env);

const database = createDatabase({
  connectionString: config.databaseUrl,
});

const clock: Clock = {
  now: () => new Date(),
};

const customerPersistence = new PostgresCustomerPersistence(database);
const contractPersistence = new PostgresContractPersistence(database);
const paymentPersistence = new PostgresPaymentPersistence(database);
const refundPersistence = new PostgresRefundPersistence(database);

const stripeWebhookEventPersistence =
  new PostgresStripeWebhookEventPersistence(database);

const externalSourceEventPersistence =
  new PostgresExternalSourceEventPersistence(database);

const reconciliationPersistence =
  new PostgresReconciliationPersistence(database);

const reconciliationActionPersistence =
  new PostgresReconciliationActionPersistence(database);

const analyticsQueries = new PostgresAnalyticsQueries(database);
const auditPersistence = new PostgresAuditPersistence(database);

const recordPayment = recordPaymentUseCase({
  clock,
  persistence: paymentPersistence,
});

const accessTokenVerifier = createAuth0AccessTokenVerifier({
  issuer: config.auth0Issuer,
  audience: config.auth0Audience,
  rolesClaim: config.auth0RolesClaim,
});

const app = buildApp({
  createCustomer: createCustomerUseCase({
    clock,
    persistence: customerPersistence,
  }),

  getCustomerById: getCustomerByIdUseCase(
    customerPersistence,
  ),

  createContract: createContractUseCase({
    clock,
    persistence: contractPersistence,
  }),

  getContractById: getContractByIdUseCase(
    contractPersistence,
  ),

  recordPayment,

  getPaymentById: getPaymentByIdUseCase(
    paymentPersistence,
  ),

  recordRefund: recordRefundUseCase({
    clock,
    persistence: refundPersistence,
  }),

  getRefundById: getRefundByIdUseCase(
    refundPersistence,
  ),

  processStripeWebhook: processStripeWebhookUseCase({
    clock,
    persistence: stripeWebhookEventPersistence,
    recordPayment,
  }),

  stripeWebhookClock: clock,

  verifyStripeSignature:
    createStripeSignatureVerifier(config.stripeWebhookSecret),

  accessTokenVerifier,

  recordExternalSourceEvent:
    recordExternalSourceEventUseCase({
      clock,
      persistence: externalSourceEventPersistence,
    }),

  getExternalSourceEventById:
    getExternalSourceEventByIdUseCase(
      externalSourceEventPersistence,
    ),

  runReconciliation: runReconciliationUseCase({
    clock,
    persistence: reconciliationPersistence,
  }),

  reconciliationPersistence,

  actOnReconciliationFinding:
    actOnReconciliationFindingUseCase({
      clock,
      persistence: reconciliationActionPersistence,
    }),

  getFinancialSummaryV1:
    getFinancialSummaryV1(analyticsQueries),

  getContractFinancialTimelineV1:
    getContractFinancialTimelineV1(analyticsQueries),

  getReconciliationSummaryV1:
    getReconciliationSummaryV1(analyticsQueries),
  appendAuditEvent: appendAuditEvent({clock,persistence:auditPersistence}),
  listAuditEvents: listAuditEvents(auditPersistence),
}, {
  logger: { level: config.logLevel },
});

app.addHook(
  "onClose",
  async () => database.close(),
);

try {
  await app.listen({
    host: config.host,
    port: config.port,
  });
} catch (error) {
  await app.close();
  throw error;
}
