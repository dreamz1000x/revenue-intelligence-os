import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Clock } from "../../../src/application/clock.js";
import {
  createIdempotencyKey,
  IdempotencyPayloadConflict,
  type RequestFingerprint,
} from "../../../src/application/idempotency.js";
import { createContractUseCase } from "../../../src/contracts/application/create-contract.js";
import { createContractId } from "../../../src/contracts/domain/ids.js";
import { createMoneyCents } from "../../../src/contracts/domain/money-cents.js";
import { installments } from "../../../src/contracts/persistence/contract-schema.js";
import { PostgresContractPersistence } from "../../../src/contracts/persistence/postgres-contract-persistence.js";
import { createCustomerUseCase } from "../../../src/customers/application/create-customer.js";
import { PostgresCustomerPersistence } from "../../../src/customers/persistence/postgres-customer-persistence.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";
import { idempotencyRecords } from "../../../src/persistence/idempotency-schema.js";
import { getPaymentByIdUseCase } from "../../../src/payments/application/get-payment-by-id.js";
import { recordPaymentUseCase } from "../../../src/payments/application/record-payment.js";
import { PaymentExceedsOutstandingError } from "../../../src/payments/domain/payment-allocation.js";
import { paymentAllocations, payments } from "../../../src/payments/persistence/payment-schema.js";
import { PostgresPaymentPersistence } from "../../../src/payments/persistence/postgres-payment-persistence.js";

const POSTGRES_IMAGE = "postgres:18.4";
const CREATED_AT = new Date("2026-08-25T12:00:00.456Z");
const RECEIVED_AT = new Date("2026-08-25T08:00:00.123Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(CREATED_AT);
  }
}

describe.sequential("Payment PostgreSQL persistence", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let paymentPersistence: PostgresPaymentPersistence;
  let recordPayment: ReturnType<typeof recordPaymentUseCase>;
  let getPaymentById: ReturnType<typeof getPaymentByIdUseCase>;
  let createCustomer: ReturnType<typeof createCustomerUseCase>;
  let createContract: ReturnType<typeof createContractUseCase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    database = createDatabase({ connectionString: container.getConnectionUri() });
    await migrate(database.client, { migrationsFolder: "./drizzle" });

    const clock = new FixedClock();
    const customerPersistence = new PostgresCustomerPersistence(database);
    const contractPersistence = new PostgresContractPersistence(database);
    paymentPersistence = new PostgresPaymentPersistence(database);
    createCustomer = createCustomerUseCase({ clock, persistence: customerPersistence });
    createContract = createContractUseCase({ clock, persistence: contractPersistence });
    recordPayment = recordPaymentUseCase({ clock, persistence: paymentPersistence });
    getPaymentById = getPaymentByIdUseCase(paymentPersistence);
  }, 120_000);

  beforeEach(async () => {
    await database.client.execute(sql`
      truncate table payment_allocations, payments, installments, contracts,
        idempotency_records, customers
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 30_000);

  async function financedContract(
    totalAmountCents = 10_000,
    installmentCount = 3,
    keySuffix = "default",
  ) {
    const customer = await createCustomer({
      idempotencyKey: `payment-customer-${keySuffix}`,
      displayName: `Payment Customer ${keySuffix}`,
    });
    const contract = await createContract({
      idempotencyKey: `payment-contract-${keySuffix}`,
      customerId: customer.resource.id,
      totalAmountCents,
      currency: "EUR",
      installmentCount,
      firstDueDate: "2026-01-31",
    });
    return contract.resource;
  }

  function command(
    contractId: number,
    amountCents: number,
    idempotencyKey: string,
    receivedAt = RECEIVED_AT,
  ) {
    return { idempotencyKey, contractId, amountCents, receivedAt };
  }

  async function statuses(contractId: number) {
    return database.client
      .select({ id: installments.id, status: installments.status })
      .from(installments)
      .where(eq(installments.contractId, contractId))
      .orderBy(installments.position);
  }

  async function financialCounts() {
    const result = await database.client.execute<{
      payment_count: string;
      allocation_count: string;
      idempotency_count: string;
    }>(sql`
      select
        (select count(*) from payments) as payment_count,
        (select count(*) from payment_allocations) as allocation_count,
        (select count(*) from idempotency_records where command_type = 'record_payment') as idempotency_count
    `);
    return result.rows[0]!;
  }

  it("records an exact Payment and marks the Installment paid", async () => {
    const contract = await financedContract(100, 1, "exact");
    const result = await recordPayment(command(contract.id, 100, "exact-payment"));

    expect(result.outcome).toBe("created");
    expect(result.resource).toMatchObject({
      id: 1,
      contractId: contract.id,
      amountCents: 100,
      allocations: [{ installmentId: contract.installments[0]!.id, amountCents: 100 }],
    });
    expect(result.resource.receivedAt.toISOString()).toBe(RECEIVED_AT.toISOString());
    expect(result.resource.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
    expect(await statuses(contract.id)).toEqual([
      { id: contract.installments[0]!.id, status: "paid" },
    ]);
  });

  it("records a partial Payment and marks only the affected Installment", async () => {
    const contract = await financedContract(100, 1, "partial");
    const result = await recordPayment(command(contract.id, 40, "partial-payment"));

    expect(result.resource.allocations).toEqual([
      { installmentId: contract.installments[0]!.id, amountCents: 40 },
    ]);
    expect(await statuses(contract.id)).toEqual([
      { id: contract.installments[0]!.id, status: "partially_paid" },
    ]);
  });

  it("spans Installments in position order", async () => {
    const contract = await financedContract(10_000, 3, "spanning");
    const result = await recordPayment(command(contract.id, 5_000, "spanning-payment"));

    expect(result.resource.allocations).toEqual([
      { installmentId: contract.installments[0]!.id, amountCents: 3_334 },
      { installmentId: contract.installments[1]!.id, amountCents: 1_666 },
    ]);
    expect((await statuses(contract.id)).map((item) => item.status)).toEqual([
      "paid",
      "partially_paid",
      "pending",
    ]);
  });

  it("derives a second Payment from prior immutable allocations", async () => {
    const contract = await financedContract(10_000, 3, "prior");
    await recordPayment(command(contract.id, 1_000, "prior-payment-1"));
    const second = await recordPayment(command(contract.id, 3_000, "prior-payment-2"));

    expect(second.resource.allocations).toEqual([
      { installmentId: contract.installments[0]!.id, amountCents: 2_334 },
      { installmentId: contract.installments[1]!.id, amountCents: 666 },
    ]);
    expect((await statuses(contract.id)).map((item) => item.status)).toEqual([
      "paid",
      "partially_paid",
      "pending",
    ]);
  });

  it("rejects overpayment without any new financial effect", async () => {
    const contract = await financedContract(100, 1, "overpayment");

    await expect(
      recordPayment(command(contract.id, 101, "overpayment")),
    ).rejects.toBeInstanceOf(PaymentExceedsOutstandingError);
    expect(await financialCounts()).toEqual({
      payment_count: "0",
      allocation_count: "0",
      idempotency_count: "0",
    });
    expect((await statuses(contract.id))[0]?.status).toBe("pending");
  });

  it("retrieves the identical Payment aggregate with ordered allocations", async () => {
    const contract = await financedContract(10_000, 3, "retrieval");
    const created = await recordPayment(command(contract.id, 5_000, "retrieval"));

    await expect(getPaymentById(created.resource.id)).resolves.toEqual(
      created.resource,
    );
    await expect(getPaymentById(999)).resolves.toBeNull();
  });

  it("replays one Payment and rejects a conflicting payload", async () => {
    const contract = await financedContract(10_000, 3, "idempotency");
    const original = command(contract.id, 1_000, "payment-idempotency");
    const first = await recordPayment(original);
    const replay = await recordPayment(original);

    expect(first.outcome).toBe("created");
    expect(replay.outcome).toBe("replayed");
    expect(replay.resource).toEqual(first.resource);
    await expect(
      recordPayment({ ...original, amountCents: 1_001 }),
    ).rejects.toBeInstanceOf(IdempotencyPayloadConflict);
    expect(await financialCounts()).toEqual({
      payment_count: "1",
      allocation_count: "1",
      idempotency_count: "1",
    });
  });

  it("rolls back Payment, allocation, projection, and idempotency together", async () => {
    const contract = await financedContract(100, 1, "rollback");

    await expect(
      paymentPersistence.record({
        idempotencyKey: createIdempotencyKey("rollback-payment"),
        requestFingerprint: "invalid" as RequestFingerprint,
        contractId: createContractId(contract.id),
        amountCents: createMoneyCents(40),
        receivedAt: RECEIVED_AT,
        createdAt: CREATED_AT,
      }),
    ).rejects.toThrow();

    expect(await financialCounts()).toEqual({
      payment_count: "0",
      allocation_count: "0",
      idempotency_count: "0",
    });
    expect((await statuses(contract.id))[0]?.status).toBe("pending");
  });

  it("serializes concurrent different-key Payments against one Contract", async () => {
    const contract = await financedContract(100, 1, "concurrent-different");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = ["different-1", "different-2"].map(async (key) => {
      await gate;
      return recordPayment(command(contract.id, 60, key));
    });
    release();

    const results = await Promise.allSettled(calls);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: expect.any(PaymentExceedsOutstandingError) });
    const totals = await database.client.execute<{ total: string }>(sql`
      select coalesce(sum(amount_cents), 0)::text as total from payment_allocations
    `);
    expect(totals.rows[0]?.total).toBe("60");
  });

  it("converges concurrent same-key calls on one Payment", async () => {
    const contract = await financedContract(100, 1, "concurrent-same");
    const paymentCommand = command(contract.id, 100, "concurrent-same-payment");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = Array.from({ length: 8 }, async () => {
      await gate;
      return recordPayment(paymentCommand);
    });
    release();

    const results = await Promise.all(calls);
    expect(new Set(results.map((result) => result.resource.id)).size).toBe(1);
    expect(results.filter((result) => result.outcome === "created")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "replayed")).toHaveLength(7);
    expect(await financialCounts()).toEqual({
      payment_count: "1",
      allocation_count: "1",
      idempotency_count: "1",
    });
  });

  it("records Payments for independent Contracts independently", async () => {
    const firstContract = await financedContract(100, 1, "independent-1");
    const secondContract = await financedContract(100, 1, "independent-2");

    const results = await Promise.all([
      recordPayment(command(firstContract.id, 40, "independent-payment-1")),
      recordPayment(command(secondContract.id, 60, "independent-payment-2")),
    ]);
    expect(results.map((result) => result.outcome)).toEqual(["created", "created"]);
    expect(new Set(results.map((result) => result.resource.contractId))).toEqual(
      new Set([firstContract.id, secondContract.id]),
    );
  });

  it("enforces Payment and Allocation database constraints", async () => {
    const firstContract = await financedContract(100, 1, "constraints-1");
    const secondContract = await financedContract(100, 1, "constraints-2");

    await expect(
      database.client.insert(payments).values({
        contractId: 999,
        amountCents: 1n,
        receivedAt: RECEIVED_AT,
        createdAt: CREATED_AT,
      }),
    ).rejects.toThrow();
    await expect(
      database.client.insert(payments).values({
        contractId: firstContract.id,
        amountCents: 0n,
        receivedAt: RECEIVED_AT,
        createdAt: CREATED_AT,
      }),
    ).rejects.toThrow();

    const [rawPayment] = await database.client
      .insert(payments)
      .values({
        contractId: firstContract.id,
        amountCents: 1n,
        receivedAt: RECEIVED_AT,
        createdAt: CREATED_AT,
      })
      .returning({ id: payments.id });
    expect(rawPayment).toBeDefined();
    await expect(
      database.client.insert(paymentAllocations).values({
        paymentId: rawPayment!.id,
        installmentId: secondContract.installments[0]!.id,
        contractId: firstContract.id,
        amountCents: 1n,
      }),
    ).rejects.toThrow();

    await database.client.insert(paymentAllocations).values({
      paymentId: rawPayment!.id,
      installmentId: firstContract.installments[0]!.id,
      contractId: firstContract.id,
      amountCents: 1n,
    });
    await expect(
      database.client.insert(paymentAllocations).values({
        paymentId: rawPayment!.id,
        installmentId: firstContract.installments[0]!.id,
        contractId: firstContract.id,
        amountCents: 1n,
      }),
    ).rejects.toThrow();
    await expect(
      database.client
        .update(installments)
        .set({ status: "overdue" })
        .where(eq(installments.id, firstContract.installments[0]!.id)),
    ).rejects.toThrow();
  });
});
