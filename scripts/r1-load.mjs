import { performance } from "node:perf_hooks";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { getFinancialSummaryV1 } from "../dist/analytics/application/analytics-queries.js";
import { PostgresAnalyticsQueries } from "../dist/analytics/persistence/postgres-analytics-queries.js";
import { createContractUseCase } from "../dist/contracts/application/create-contract.js";
import { PostgresContractPersistence } from "../dist/contracts/persistence/postgres-contract-persistence.js";
import { createCustomerUseCase } from "../dist/customers/application/create-customer.js";
import { getCustomerByIdUseCase } from "../dist/customers/application/get-customer-by-id.js";
import { PostgresCustomerPersistence } from "../dist/customers/persistence/postgres-customer-persistence.js";
import { DEMO_PERIOD, seedDemoDataset } from "../dist/demo/demo-dataset.js";
import { resetKnownDemoTables } from "../dist/demo/reset-demo.js";
import { PaymentExceedsOutstandingError } from "../dist/payments/domain/payment-allocation.js";
import { recordPaymentUseCase } from "../dist/payments/application/record-payment.js";
import { PostgresPaymentPersistence } from "../dist/payments/persistence/postgres-payment-persistence.js";
import { createDatabase } from "../dist/persistence/database.js";
import { recordRefundUseCase } from "../dist/refunds/application/record-refund.js";
import { PostgresRefundPersistence } from "../dist/refunds/persistence/postgres-refund-persistence.js";

const operations = positiveInteger("R1_OPERATIONS", 50);
const concurrency = positiveInteger("R1_CONCURRENCY", 8);
const warmup = positiveInteger("R1_WARMUP", 10);
const image = "postgres:18.4";

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function fixed(value) {
  return Number(value.toFixed(2));
}

async function measure(name, count, workers, operation, expectedFailure = () => false) {
  const latencies = [];
  let successes = 0;
  let expectedConflicts = 0;
  let failures = 0;
  let cursor = 0;
  const started = performance.now();

  await Promise.all(Array.from({ length: Math.min(workers, count) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= count) return;
      const operationStarted = performance.now();
      try {
        await operation(index);
        successes += 1;
      } catch (error) {
        if (expectedFailure(error)) expectedConflicts += 1;
        else failures += 1;
      } finally {
        latencies.push(performance.now() - operationStarted);
      }
    }
  }));

  const elapsedMs = performance.now() - started;
  const sorted = latencies.toSorted((left, right) => left - right);
  const result = {
    workload: name,
    count,
    concurrency: workers,
    successes,
    expectedConflicts,
    failures,
    elapsedMs: fixed(elapsedMs),
    operationsPerSecond: fixed(count / (elapsedMs / 1000)),
    latencyMs: {
      p50: fixed(percentile(sorted, 0.50)),
      p95: fixed(percentile(sorted, 0.95)),
      p99: fixed(percentile(sorted, 0.99)),
      max: fixed(sorted.at(-1) ?? 0),
    },
  };
  console.log(JSON.stringify(result));
  return result;
}

function clock() {
  return { now: () => new Date("2026-10-01T12:00:00.000Z") };
}

async function main() {
  console.log(JSON.stringify({
    benchmark: "RIOS R1 local load/resilience evidence",
    node: process.version,
    postgresImage: image,
    operations,
    concurrency,
    warmup,
    scope: "local disposable PostgreSQL; application and persistence paths",
  }));

  const container = await new PostgreSqlContainer(image)
    .withDatabase("rios_r1")
    .start();
  const database = createDatabase({ connectionString: container.getConnectionUri() });

  try {
    await migrate(database.client, { migrationsFolder: "./drizzle" });
    await resetKnownDemoTables(database);
    const demo = await seedDemoDataset(database);

    const customers = new PostgresCustomerPersistence(database);
    const contracts = new PostgresContractPersistence(database);
    const payments = new PostgresPaymentPersistence(database);
    const refunds = new PostgresRefundPersistence(database);
    const createCustomer = createCustomerUseCase({ clock: clock(), persistence: customers });
    const createContract = createContractUseCase({ clock: clock(), persistence: contracts });
    const recordPayment = recordPaymentUseCase({ clock: clock(), persistence: payments });
    const recordRefund = recordRefundUseCase({ clock: clock(), persistence: refunds });
    const getCustomer = getCustomerByIdUseCase(customers);
    const financialSummary = getFinancialSummaryV1(new PostgresAnalyticsQueries(database));

    for (let index = 0; index < warmup; index += 1) {
      await getCustomer(demo.customerIds[0]);
      await financialSummary(DEMO_PERIOD);
    }

    const results = [];
    for (const workers of [...new Set([1, concurrency])]) {
      results.push(await measure("customer_lookup", operations, workers, () => getCustomer(demo.customerIds[0])));
      results.push(await measure("financial_summary", operations, workers, () => financialSummary(DEMO_PERIOD)));
    }

    results.push(await measure("customer_create_independent", operations, concurrency, (index) =>
      createCustomer({ idempotencyKey: `r1-customer-${index}`, displayName: `R1 Customer ${index}` })));

    const owner = await createCustomer({ idempotencyKey: "r1-contract-owner", displayName: "R1 Contract Owner" });
    const independentContracts = await Promise.all(Array.from({ length: operations }, (_, index) =>
      createContract({
        idempotencyKey: `r1-independent-contract-${index}`,
        customerId: owner.resource.id,
        totalAmountCents: 100,
        currency: "EUR",
        installmentCount: 1,
        firstDueDate: "2026-10-01",
      })));
    results.push(await measure("payment_independent_contracts", operations, concurrency, (index) =>
      recordPayment({
        idempotencyKey: `r1-independent-payment-${index}`,
        contractId: independentContracts[index].resource.id,
        amountCents: 100,
        receivedAt: new Date("2026-10-02T12:00:00.000Z"),
      })));

    const shared = await createContract({
      idempotencyKey: "r1-shared-contract",
      customerId: owner.resource.id,
      totalAmountCents: operations * 100,
      currency: "EUR",
      installmentCount: 1,
      firstDueDate: "2026-10-01",
    });
    results.push(await measure("payment_same_contract", operations, concurrency, (index) =>
      recordPayment({
        idempotencyKey: `r1-shared-payment-${index}`,
        contractId: shared.resource.id,
        amountCents: 100,
        receivedAt: new Date("2026-10-02T12:00:00.000Z"),
      })));

    const refundContracts = await Promise.all(Array.from({ length: operations }, (_, index) =>
      createContract({
        idempotencyKey: `r1-refund-contract-${index}`,
        customerId: owner.resource.id,
        totalAmountCents: 100,
        currency: "EUR",
        installmentCount: 1,
        firstDueDate: "2026-10-01",
      })));
    const refundablePayments = await Promise.all(refundContracts.map((contract, index) =>
      recordPayment({
        idempotencyKey: `r1-refund-source-${index}`,
        contractId: contract.resource.id,
        amountCents: 100,
        receivedAt: new Date("2026-10-02T12:00:00.000Z"),
      })));
    results.push(await measure("refund_independent_contracts", operations, concurrency, (index) =>
      recordRefund({
        idempotencyKey: `r1-refund-${index}`,
        paymentId: refundablePayments[index].resource.id,
        amountCents: 40,
        refundedAt: new Date("2026-10-03T12:00:00.000Z"),
      })));

    const limitContract = await createContract({
      idempotencyKey: "r1-limit-contract",
      customerId: owner.resource.id,
      totalAmountCents: 100,
      currency: "EUR",
      installmentCount: 1,
      firstDueDate: "2026-10-01",
    });
    const overpaymentLimit = await measure("payment_same_contract_overpayment_limit", 2, 2, (index) =>
      recordPayment({
        idempotencyKey: `r1-limit-payment-${index}`,
        contractId: limitContract.resource.id,
        amountCents: 70,
        receivedAt: new Date("2026-10-02T12:00:00.000Z"),
      }), (error) => error instanceof PaymentExceedsOutstandingError);
    results.push(overpaymentLimit);
    if (
      overpaymentLimit.successes !== 1 ||
      overpaymentLimit.expectedConflicts !== 1 ||
      overpaymentLimit.failures !== 0
    ) {
      throw new Error(
        "Overpayment contention invariant failed: expected 1 success, 1 expected conflict, and 0 unexpected failures",
      );
    }

    if (results.some((result) => result.failures > 0)) {
      throw new Error("One or more benchmark workloads had unexpected failures");
    }
  } finally {
    await database.close();
    await container.stop();
  }
}

main().catch(() => {
  console.error("R1 benchmark failed");
  process.exitCode = 1;
});
