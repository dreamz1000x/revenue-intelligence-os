import type { Clock } from "../application/clock.js";
import { createCustomerUseCase } from "../customers/application/create-customer.js";
import { PostgresCustomerPersistence } from "../customers/persistence/postgres-customer-persistence.js";
import { createContractUseCase } from "../contracts/application/create-contract.js";
import { PostgresContractPersistence } from "../contracts/persistence/postgres-contract-persistence.js";
import { recordPaymentUseCase } from "../payments/application/record-payment.js";
import { PostgresPaymentPersistence } from "../payments/persistence/postgres-payment-persistence.js";
import { recordRefundUseCase } from "../refunds/application/record-refund.js";
import { PostgresRefundPersistence } from "../refunds/persistence/postgres-refund-persistence.js";
import { processStripeWebhookUseCase } from "../stripe/application/process-stripe-webhook.js";
import { PostgresStripeWebhookEventPersistence } from "../stripe/persistence/postgres-stripe-webhook-event-persistence.js";
import { recordExternalSourceEventUseCase } from "../reconciliation/application/record-external-source-event.js";
import { runReconciliationUseCase } from "../reconciliation/application/run-reconciliation.js";
import { actOnReconciliationFindingUseCase } from "../reconciliation/application/act-on-reconciliation-finding.js";
import { PostgresExternalSourceEventPersistence } from "../reconciliation/persistence/postgres-external-source-event-persistence.js";
import { PostgresReconciliationPersistence } from "../reconciliation/persistence/postgres-reconciliation-persistence.js";
import { PostgresReconciliationActionPersistence } from "../reconciliation/persistence/postgres-reconciliation-action-persistence.js";
import type { Database } from "../persistence/database.js";

export const DEMO_PERIOD = Object.freeze({
  periodStart: new Date("2026-05-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-01T00:00:00.000Z"),
  asOf: new Date("2026-09-02T00:00:00.000Z"),
  reconciliationCutoff: new Date("2026-08-31T23:59:59.999Z"),
  statusAsOf: new Date("2026-09-02T00:00:00.000Z"),
});

class MutableClock implements Clock {
  constructor(private value: Date) {}
  set(value: string): void { this.value = new Date(value); }
  now(): Date { return new Date(this.value); }
}

function stripeEvent(contractId: number) {
  return {
    id: "evt_demoanalytics1", object: "event", type: "payment_intent.succeeded",
    created: Date.parse("2026-06-01T09:00:00.000Z") / 1000, livemode: false,
    data: { object: { object: "payment_intent", id: "pi_demoanalytics1", livemode: false, amount_received: 12_000, currency: "eur", metadata: { contract_id: String(contractId) } } },
  };
}

export interface DemoDatasetResult {
  readonly customerIds: readonly [number, number, number];
  readonly contractIds: readonly [number, number, number];
  readonly paymentIds: readonly [number, number, number];
  readonly refundId: number;
  readonly runId: number;
}

export async function seedDemoDataset(database: Database): Promise<DemoDatasetResult> {
  const clock = new MutableClock(new Date("2026-05-10T08:00:00.000Z"));
  const customers = new PostgresCustomerPersistence(database);
  const contracts = new PostgresContractPersistence(database);
  const payments = new PostgresPaymentPersistence(database);
  const refunds = new PostgresRefundPersistence(database);
  const stripe = new PostgresStripeWebhookEventPersistence(database);
  const external = new PostgresExternalSourceEventPersistence(database);
  const reconciliation = new PostgresReconciliationPersistence(database);
  const actions = new PostgresReconciliationActionPersistence(database);
  const createCustomer = createCustomerUseCase({ clock, persistence: customers });
  const createContract = createContractUseCase({ clock, persistence: contracts });
  const recordPayment = recordPaymentUseCase({ clock, persistence: payments });
  const recordRefund = recordRefundUseCase({ clock, persistence: refunds });
  const processStripe = processStripeWebhookUseCase({ clock, persistence: stripe, recordPayment });
  const recordExternal = recordExternalSourceEventUseCase({ clock, persistence: external });
  const runReconciliation = runReconciliationUseCase({ clock, persistence: reconciliation });
  const act = actOnReconciliationFindingUseCase({ clock, persistence: actions });

  const customerIds: number[] = [];
  for (const [index, name] of ["Demo Customer One", "Demo Customer Two", "Demo Customer Three"].entries()) {
    clock.set(`2026-05-${String(10 + index).padStart(2, "0")}T08:00:00.000Z`);
    customerIds.push((await createCustomer({ idempotencyKey: `demo-customer-${index + 1}`, displayName: name })).resource.id);
  }
  const contractSpecs = [
    { totalAmountCents: 12_000, installmentCount: 3, firstDueDate: "2026-06-01" },
    { totalAmountCents: 9_000, installmentCount: 3, firstDueDate: "2026-06-05" },
    { totalAmountCents: 6_000, installmentCount: 2, firstDueDate: "2026-06-10" },
  ];
  const contractIds: number[] = [];
  for (const [index, spec] of contractSpecs.entries()) {
    clock.set(`2026-05-${String(13 + index).padStart(2, "0")}T08:00:00.000Z`);
    contractIds.push((await createContract({ idempotencyKey: `demo-contract-${index + 1}`, customerId: customerIds[index]!, currency: "EUR", ...spec })).resource.id);
  }

  clock.set("2026-06-01T09:00:01.000Z");
  const event = stripeEvent(contractIds[0]!);
  const rawPayload = Buffer.from(JSON.stringify(event), "utf8");
  const stripeResult = await processStripe({ verifiedEvent: event, stripeEventId: event.id, rawPayload, receivedAt: new Date("2026-06-01T09:00:01.000Z") });
  if (stripeResult.outcome !== "processed") throw new Error("Demo Stripe Payment was not processed");
  const [stripePayment] = await database.client.query.payments.findMany({ where: (table, { eq }) => eq(table.contractId, contractIds[0]!), limit: 1 });
  if (!stripePayment) throw new Error("Demo Stripe Payment was not persisted");

  clock.set("2026-06-15T10:00:01.000Z");
  const refund = await recordRefund({ idempotencyKey: "demo-refund-1", paymentId: stripePayment.id, amountCents: 3_000, refundedAt: new Date("2026-06-15T10:00:00.000Z") });
  clock.set("2026-06-20T11:00:01.000Z");
  const repayment = await recordPayment({ idempotencyKey: "demo-payment-repayment-1", contractId: contractIds[0]!, amountCents: 3_000, receivedAt: new Date("2026-06-20T11:00:00.000Z") });
  clock.set("2026-06-10T12:00:01.000Z");
  const partial = await recordPayment({ idempotencyKey: "demo-payment-partial-1", contractId: contractIds[1]!, amountCents: 4_000, receivedAt: new Date("2026-06-10T12:00:00.000Z") });

  const externalFacts = [
    { sourceEventId: "demo-bank-settlement-stripe", eventType: "settlement_credit" as const, amountCents: 12_000, occurredAt: "2026-06-02T09:00:00.000Z", externalReference: "demo-statement-1", internalPaymentId: stripePayment.id, internalRefundId: null },
    { sourceEventId: "demo-bank-settlement-mismatch", eventType: "settlement_credit" as const, amountCents: 3_500, occurredAt: "2026-06-11T09:00:00.000Z", externalReference: "demo-statement-2", internalPaymentId: partial.resource.id, internalRefundId: null },
    { sourceEventId: "demo-bank-refund-debit", eventType: "refund_debit" as const, amountCents: 3_000, occurredAt: "2026-06-16T09:00:00.000Z", externalReference: "demo-statement-3", internalPaymentId: null, internalRefundId: refund.resource.id },
    { sourceEventId: "demo-bank-orphan", eventType: "settlement_credit" as const, amountCents: 700, occurredAt: "2026-06-25T09:00:00.000Z", externalReference: "demo-statement-4", internalPaymentId: null, internalRefundId: null },
  ];
  for (const [index, fact] of externalFacts.entries()) {
    clock.set(`2026-07-0${index + 1}T08:00:00.000Z`);
    await recordExternal({ source: "simulated_demo_bank", sourceEventId: fact.sourceEventId, eventType: fact.eventType, amountCents: fact.amountCents, currency: "EUR", occurredAt: new Date(fact.occurredAt), receivedAt: new Date(fact.occurredAt), externalReference: fact.externalReference, internalPaymentId: fact.internalPaymentId, internalRefundId: fact.internalRefundId, providerPaymentReference: null, rawPayload: Buffer.from(JSON.stringify({ id: fact.sourceEventId, amountCents: fact.amountCents })), metadata: { fixture: "analytics-v1" } });
  }

  clock.set("2026-09-01T08:00:00.000Z");
  const run = await runReconciliation({ idempotencyKey: "demo-reconciliation-run-1", cutoff: DEMO_PERIOD.reconciliationCutoff });
  const findings = await reconciliation.listFindings({ runId: run.resource.id, limit: 100 });
  const mismatch = findings.find((item) => item.ruleCode === "BANK_SETTLEMENT_AMOUNT_MISMATCH");
  const orphan = findings.find((item) => item.ruleCode === "ORPHAN_BANK_MOVEMENT");
  if (!mismatch || !orphan) throw new Error("Demo reconciliation Findings were not created");
  clock.set("2026-09-01T09:00:00.000Z");
  await act({ idempotencyKey: "demo-mismatch-ack", findingId: mismatch.id, actionType: "acknowledge", actorId: "demo-operator", reason: "Mismatch accepted for deterministic demo", occurredAt: new Date("2026-09-01T09:00:00.000Z") });
  clock.set("2026-09-01T09:05:00.000Z");
  await act({ idempotencyKey: "demo-mismatch-resolve", findingId: mismatch.id, actionType: "resolve", actorId: "demo-operator", reason: "Mismatch reviewed and resolved", occurredAt: new Date("2026-09-01T09:05:00.000Z") });
  clock.set("2026-09-01T09:10:00.000Z");
  await act({ idempotencyKey: "demo-orphan-ignore", findingId: orphan.id, actionType: "ignore", actorId: "demo-operator", reason: "Known unrelated movement in demo fixture", occurredAt: new Date("2026-09-01T09:10:00.000Z") });

  return { customerIds: customerIds as [number, number, number], contractIds: contractIds as [number, number, number], paymentIds: [stripePayment.id, repayment.resource.id, partial.resource.id], refundId: refund.resource.id, runId: run.resource.id };
}
