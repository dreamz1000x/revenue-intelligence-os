import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ledgerEntries } from "../../../src/ledger/persistence/ledger-schema.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";
import { idempotencyRecords } from "../../../src/persistence/idempotency-schema.js";
import {
  refundAllocations,
  refunds,
} from "../../../src/refunds/persistence/refund-schema.js";

const POSTGRES_IMAGE = "postgres:18.4";
const EVENT_AT = new Date("2026-08-28T10:00:00.123Z");
const RECORDED_AT = new Date("2026-08-28T10:01:00.456Z");

describe.sequential("Refund relational schema", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    database = createDatabase({ connectionString: container.getConnectionUri() });
    await migrate(database.client, { migrationsFolder: "./drizzle" });
  }, 120_000);

  beforeEach(async () => {
    await database.client.execute(sql`
      truncate table stripe_webhook_events, ledger_entries, refund_allocations,
        refunds, payment_allocations, payments, installments, contracts,
        idempotency_records, customers restart identity cascade
    `);
    await database.client.execute(sql`
      insert into customers (id, display_name, created_at)
      values
        (1, 'Refund Customer 1', ${RECORDED_AT}),
        (2, 'Refund Customer 2', ${RECORDED_AT})
    `);
    await database.client.execute(sql`
      insert into contracts (
        id, customer_id, total_amount_cents, currency, installment_count,
        first_due_date, status, created_at
      ) values
        (1, 1, 1000, 'EUR', 1, '2026-09-01', 'active', ${RECORDED_AT}),
        (2, 2, 1000, 'EUR', 1, '2026-09-01', 'active', ${RECORDED_AT})
    `);
    await database.client.execute(sql`
      insert into installments (
        id, contract_id, position, amount_cents, due_date, status, created_at
      ) values
        (11, 1, 1, 1000, '2026-09-01', 'partially_paid', ${RECORDED_AT}),
        (21, 2, 1, 1000, '2026-09-01', 'partially_paid', ${RECORDED_AT})
    `);
    await database.client.execute(sql`
      insert into payments (id, contract_id, amount_cents, received_at, created_at)
      values
        (101, 1, 100, ${EVENT_AT}, ${RECORDED_AT}),
        (102, 2, 100, ${EVENT_AT}, ${RECORDED_AT})
    `);
    await database.client.execute(sql`
      insert into payment_allocations (
        payment_id, installment_id, contract_id, amount_cents
      ) values
        (101, 11, 1, 100),
        (102, 21, 2, 100)
    `);
  });

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 30_000);

  async function insertRefund(paymentId = 101, amountCents = 50n) {
    const [refund] = await database.client
      .insert(refunds)
      .values({ paymentId, amountCents, refundedAt: EVENT_AT, createdAt: RECORDED_AT })
      .returning();
    return refund!;
  }

  it("accepts a valid Refund and enforces its amount and Payment identity", async () => {
    await expect(insertRefund()).resolves.toMatchObject({
      paymentId: 101,
      amountCents: 50n,
    });

    for (const amountCents of [0n, -1n, 9_007_199_254_740_992n]) {
      await expect(insertRefund(101, amountCents)).rejects.toThrow();
    }
    await expect(insertRefund(999)).rejects.toThrow();
  });

  it("accepts a valid RefundAllocation and enforces positive safe money", async () => {
    const refund = await insertRefund();
    await expect(
      database.client.insert(refundAllocations).values({
        refundId: refund.id,
        paymentId: 101,
        installmentId: 11,
        amountCents: 50n,
      }),
    ).resolves.toBeDefined();

    for (const amountCents of [0n, -1n, 9_007_199_254_740_992n]) {
      const otherRefund = await insertRefund();
      await expect(
        database.client.insert(refundAllocations).values({
          refundId: otherRefund.id,
          paymentId: 101,
          installmentId: 11,
          amountCents,
        }),
      ).rejects.toThrow();
    }
  });

  it("proves RefundAllocation belongs to an allocation of its Refund Payment", async () => {
    const refund = await insertRefund(101);

    await expect(
      database.client.insert(refundAllocations).values({
        refundId: 999,
        paymentId: 101,
        installmentId: 11,
        amountCents: 1n,
      }),
    ).rejects.toThrow();
    await expect(
      database.client.insert(refundAllocations).values({
        refundId: refund.id,
        paymentId: 101,
        installmentId: 999,
        amountCents: 1n,
      }),
    ).rejects.toThrow();
    await expect(
      database.client.insert(refundAllocations).values({
        refundId: refund.id,
        paymentId: 102,
        installmentId: 21,
        amountCents: 1n,
      }),
    ).rejects.toThrow();
    await expect(
      database.client.insert(refundAllocations).values({
        refundId: refund.id,
        paymentId: 101,
        installmentId: 21,
        amountCents: 1n,
      }),
    ).rejects.toThrow();
  });

  it("rejects duplicate Refund allocations for one Installment", async () => {
    const refund = await insertRefund();
    const values = {
      refundId: refund.id,
      paymentId: 101,
      installmentId: 11,
      amountCents: 25n,
    };
    await database.client.insert(refundAllocations).values(values);
    await expect(
      database.client.insert(refundAllocations).values(values),
    ).rejects.toThrow();
  });

  it("enforces explicit Ledger source/effect combinations and uniqueness", async () => {
    const refund = await insertRefund();
    const common = {
      amountCents: 50n,
      currency: "EUR",
      eventAt: EVENT_AT,
      recordedAt: RECORDED_AT,
    };
    await database.client.insert(ledgerEntries).values({
      ...common,
      paymentId: 101,
      effectType: "payment_recorded",
    });
    await database.client.insert(ledgerEntries).values({
      ...common,
      refundId: refund.id,
      effectType: "refund_recorded",
    });

    await expect(
      database.client.insert(ledgerEntries).values({
        ...common,
        paymentId: 101,
        effectType: "payment_recorded",
      }),
    ).rejects.toThrow();
    await expect(
      database.client.insert(ledgerEntries).values({
        ...common,
        refundId: refund.id,
        effectType: "refund_recorded",
      }),
    ).rejects.toThrow();

    const invalidFactories = [
      () => ({ paymentId: null, refundId: null, effectType: "payment_recorded" }),
      (refundId: number) => ({
        paymentId: 102,
        refundId,
        effectType: "payment_recorded",
      }),
      (refundId: number) => ({
        paymentId: null,
        refundId,
        effectType: "payment_recorded",
      }),
      () => ({ paymentId: 102, refundId: null, effectType: "refund_recorded" }),
      () => ({ paymentId: null, refundId: null, effectType: "refund_recorded" }),
      () => ({ paymentId: 102, refundId: null, effectType: "unsupported" }),
    ];
    for (const invalidFactory of invalidFactories) {
      const unusedRefund = await insertRefund();
      const invalid = invalidFactory(unusedRefund.id);
      await expect(
        database.client.insert(ledgerEntries).values({ ...common, ...invalid }),
      ).rejects.toThrow();
    }
  });

  it("enforces Ledger money, currency, and append-only behavior", async () => {
    const refund = await insertRefund();
    const [entry] = await database.client
      .insert(ledgerEntries)
      .values({
        refundId: refund.id,
        effectType: "refund_recorded",
        amountCents: 50n,
        currency: "EUR",
        eventAt: EVENT_AT,
        recordedAt: RECORDED_AT,
      })
      .returning();

    for (const invalid of [
      { amountCents: 0n },
      { amountCents: -1n },
      { amountCents: 9_007_199_254_740_992n },
      { currency: "USD" },
    ]) {
      const otherRefund = await insertRefund();
      await expect(
        database.client.insert(ledgerEntries).values({
          refundId: otherRefund.id,
          effectType: "refund_recorded",
          amountCents: 1n,
          currency: "EUR",
          eventAt: EVENT_AT,
          recordedAt: RECORDED_AT,
          ...invalid,
        }),
      ).rejects.toThrow();
    }

    await expect(
      database.client
        .update(ledgerEntries)
        .set({ amountCents: 49n })
        .where(eq(ledgerEntries.id, entry!.id)),
    ).rejects.toThrow();
    await expect(
      database.client.delete(ledgerEntries).where(eq(ledgerEntries.id, entry!.id)),
    ).rejects.toThrow();
  });

  it("admits record_refund idempotency and rejects unsupported commands", async () => {
    const base = {
      idempotencyKey: "refund-schema-key",
      requestFingerprint: "a".repeat(64),
      resourceId: 1,
      createdAt: RECORDED_AT,
    };
    for (const [index, commandType] of [
      "create_customer",
      "create_contract",
      "record_payment",
      "record_refund",
    ].entries()) {
      await expect(
        database.client.insert(idempotencyRecords).values({
          ...base,
          commandType,
          idempotencyKey: `${base.idempotencyKey}-${index}`,
        }),
      ).resolves.toBeDefined();
    }
    await expect(
      database.client.insert(idempotencyRecords).values({
        ...base,
        commandType: "unsupported",
      }),
    ).rejects.toThrow();
  });
});
