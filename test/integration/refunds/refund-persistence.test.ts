import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Clock } from "../../../src/application/clock.js";
import { IdempotencyPayloadConflict } from "../../../src/application/idempotency.js";
import { createContractUseCase } from "../../../src/contracts/application/create-contract.js";
import { installments } from "../../../src/contracts/persistence/contract-schema.js";
import { PostgresContractPersistence } from "../../../src/contracts/persistence/postgres-contract-persistence.js";
import { createCustomerUseCase } from "../../../src/customers/application/create-customer.js";
import { PostgresCustomerPersistence } from "../../../src/customers/persistence/postgres-customer-persistence.js";
import { ledgerEntries } from "../../../src/ledger/persistence/ledger-schema.js";
import { recordPaymentUseCase } from "../../../src/payments/application/record-payment.js";
import { PaymentExceedsOutstandingError } from "../../../src/payments/domain/payment-allocation.js";
import { paymentAllocations, payments } from "../../../src/payments/persistence/payment-schema.js";
import { PostgresPaymentPersistence } from "../../../src/payments/persistence/postgres-payment-persistence.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";
import { idempotencyRecords } from "../../../src/persistence/idempotency-schema.js";
import { getRefundByIdUseCase } from "../../../src/refunds/application/get-refund-by-id.js";
import { OriginalPaymentNotFoundError } from "../../../src/refunds/application/original-payment-not-found-error.js";
import { recordRefundUseCase } from "../../../src/refunds/application/record-refund.js";
import { RefundExceedsReversibleAmountError } from "../../../src/refunds/domain/refund-allocation.js";
import { PostgresRefundPersistence } from "../../../src/refunds/persistence/postgres-refund-persistence.js";
import { refundAllocations, refunds } from "../../../src/refunds/persistence/refund-schema.js";

const POSTGRES_IMAGE = "postgres:18.4";
const CREATED_AT = new Date("2026-08-28T12:00:00.456Z");
const RECEIVED_AT = new Date("2026-08-28T08:00:00.123Z");
const REFUNDED_AT = new Date("2026-08-28T10:00:00.234Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(CREATED_AT);
  }
}

describe.sequential("Refund PostgreSQL persistence", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let recordPayment: ReturnType<typeof recordPaymentUseCase>;
  let recordRefund: ReturnType<typeof recordRefundUseCase>;
  let getRefundById: ReturnType<typeof getRefundByIdUseCase>;
  let createCustomer: ReturnType<typeof createCustomerUseCase>;
  let createContract: ReturnType<typeof createContractUseCase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    database = createDatabase({ connectionString: container.getConnectionUri() });
    await migrate(database.client, { migrationsFolder: "./drizzle" });
    const clock = new FixedClock();
    createCustomer = createCustomerUseCase({
      clock,
      persistence: new PostgresCustomerPersistence(database),
    });
    createContract = createContractUseCase({
      clock,
      persistence: new PostgresContractPersistence(database),
    });
    recordPayment = recordPaymentUseCase({
      clock,
      persistence: new PostgresPaymentPersistence(database),
    });
    const refundPersistence = new PostgresRefundPersistence(database);
    recordRefund = recordRefundUseCase({ clock, persistence: refundPersistence });
    getRefundById = getRefundByIdUseCase(refundPersistence);
  }, 120_000);

  beforeEach(async () => {
    await database.client.execute(sql`
      truncate table stripe_webhook_events, ledger_entries, refund_allocations,
        refunds, payment_allocations, payments, installments, contracts,
        idempotency_records, customers restart identity cascade
    `);
  });

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 30_000);

  async function financedContract(
    totalAmountCents = 100,
    installmentCount = 1,
    suffix = "default",
  ) {
    const customer = await createCustomer({
      idempotencyKey: `refund-customer-${suffix}`,
      displayName: `Refund Customer ${suffix}`,
    });
    const contract = await createContract({
      idempotencyKey: `refund-contract-${suffix}`,
      customerId: customer.resource.id,
      totalAmountCents,
      currency: "EUR",
      installmentCount,
      firstDueDate: "2026-09-01",
    });
    return contract.resource;
  }

  function paymentCommand(contractId: number, amountCents: number, key: string) {
    return { idempotencyKey: key, contractId, amountCents, receivedAt: RECEIVED_AT };
  }

  function refundCommand(paymentId: number, amountCents: number, key: string) {
    return { idempotencyKey: key, paymentId, amountCents, refundedAt: REFUNDED_AT };
  }

  async function statuses(contractId: number) {
    return database.client
      .select({ id: installments.id, status: installments.status })
      .from(installments)
      .where(eq(installments.contractId, contractId))
      .orderBy(installments.position);
  }

  async function counts() {
    const result = await database.client.execute<{
      refund_count: string;
      allocation_count: string;
      refund_ledger_count: string;
      idempotency_count: string;
    }>(sql`
      select
        (select count(*) from refunds) as refund_count,
        (select count(*) from refund_allocations) as allocation_count,
        (select count(*) from ledger_entries where effect_type = 'refund_recorded') as refund_ledger_count,
        (select count(*) from idempotency_records where command_type = 'record_refund') as idempotency_count
    `);
    return result.rows[0]!;
  }

  async function refundTotals(paymentId: number) {
    const result = await database.client.execute<{
      refund_total: string;
      allocation_total: string;
    }>(sql`
      select
        (select coalesce(sum(amount_cents), 0)::text from refunds
          where payment_id = ${paymentId}) as refund_total,
        (select coalesce(sum(amount_cents), 0)::text from refund_allocations
          where payment_id = ${paymentId}) as allocation_total
    `);
    return result.rows[0]!;
  }

  it("records an exact partial Refund, projection, LedgerEntry, and idempotency", async () => {
    const contract = await financedContract(100, 1, "basic");
    const payment = await recordPayment(paymentCommand(contract.id, 100, "basic-payment"));
    const result = await recordRefund(refundCommand(payment.resource.id, 30, "basic-refund"));

    expect(result.outcome).toBe("created");
    expect(result.resource).toMatchObject({
      paymentId: payment.resource.id,
      amountCents: 30,
      allocations: [{ installmentId: contract.installments[0]!.id, amountCents: 30 }],
    });
    expect(result.resource.refundedAt.toISOString()).toBe(REFUNDED_AT.toISOString());
    expect(result.resource.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
    await expect(getRefundById(result.resource.id)).resolves.toEqual(result.resource);
    await expect(getRefundById(999)).resolves.toBeNull();
    expect(await statuses(contract.id)).toEqual([
      { id: contract.installments[0]!.id, status: "partially_paid" },
    ]);
    expect(await database.client.select().from(ledgerEntries).orderBy(ledgerEntries.id)).toEqual([
      expect.objectContaining({
        paymentId: payment.resource.id,
        refundId: null,
        effectType: "payment_recorded",
        amountCents: 100n,
      }),
      expect.objectContaining({
        paymentId: null,
        refundId: result.resource.id,
        effectType: "refund_recorded",
        amountCents: 30n,
        currency: "EUR",
        eventAt: REFUNDED_AT,
        recordedAt: CREATED_AT,
      }),
    ]);
    expect(await counts()).toEqual({
      refund_count: "1",
      allocation_count: "1",
      refund_ledger_count: "1",
      idempotency_count: "1",
    });
  });

  it("moves a fully refunded Installment back to pending", async () => {
    const contract = await financedContract(100, 1, "full");
    const payment = await recordPayment(paymentCommand(contract.id, 100, "full-payment"));
    await recordRefund(refundCommand(payment.resource.id, 100, "full-refund"));
    expect((await statuses(contract.id))[0]?.status).toBe("pending");
  });

  it("allocates a spanning Refund in reverse Installment order", async () => {
    const contract = await financedContract(300, 3, "spanning");
    const payment = await recordPayment(paymentCommand(contract.id, 250, "spanning-payment"));
    const refund = await recordRefund(refundCommand(payment.resource.id, 80, "spanning-refund"));
    expect(refund.resource.allocations).toEqual([
      { installmentId: contract.installments[2]!.id, amountCents: 50 },
      { installmentId: contract.installments[1]!.id, amountCents: 30 },
    ]);
    expect((await statuses(contract.id)).map((row) => row.status)).toEqual([
      "paid",
      "partially_paid",
      "pending",
    ]);
  });

  it("continues reverse allocation exactly across multiple Refunds", async () => {
    const contract = await financedContract(300, 3, "multiple");
    const payment = await recordPayment(paymentCommand(contract.id, 250, "multiple-payment"));
    const first = await recordRefund(refundCommand(payment.resource.id, 80, "multiple-refund-1"));
    const second = await recordRefund(refundCommand(payment.resource.id, 90, "multiple-refund-2"));
    expect(first.resource.allocations.map((row) => row.amountCents)).toEqual([50, 30]);
    expect(second.resource.allocations).toEqual([
      { installmentId: contract.installments[1]!.id, amountCents: 70 },
      { installmentId: contract.installments[0]!.id, amountCents: 20 },
    ]);
    expect(await refundTotals(payment.resource.id)).toEqual({
      refund_total: "170",
      allocation_total: "170",
    });
  });

  it("accepts the cumulative exact limit and rejects one more cent without effect", async () => {
    const contract = await financedContract(100, 1, "limit");
    const payment = await recordPayment(paymentCommand(contract.id, 100, "limit-payment"));
    await recordRefund(refundCommand(payment.resource.id, 40, "limit-refund-1"));
    await recordRefund(refundCommand(payment.resource.id, 60, "limit-refund-2"));
    const before = await counts();
    await expect(
      recordRefund(refundCommand(payment.resource.id, 1, "limit-refund-3")),
    ).rejects.toBeInstanceOf(RefundExceedsReversibleAmountError);
    expect(await counts()).toEqual(before);
    expect((await statuses(contract.id))[0]?.status).toBe("pending");
  });

  it("rejects over-refund after prior history with no new effect", async () => {
    const contract = await financedContract(100, 1, "over-refund");
    const payment = await recordPayment(paymentCommand(contract.id, 100, "over-refund-payment"));
    await recordRefund(refundCommand(payment.resource.id, 80, "over-refund-1"));
    const before = await counts();
    const statusBefore = await statuses(contract.id);
    await expect(
      recordRefund(refundCommand(payment.resource.id, 21, "over-refund-2")),
    ).rejects.toBeInstanceOf(RefundExceedsReversibleAmountError);
    expect(await counts()).toEqual(before);
    expect(await statuses(contract.id)).toEqual(statusBefore);
  });

  it("replays the same payload and conflicts on a different payload", async () => {
    const contract = await financedContract(100, 1, "idempotency");
    const payment = await recordPayment(paymentCommand(contract.id, 100, "idempotency-payment"));
    const original = refundCommand(payment.resource.id, 30, "refund-idempotency");
    const first = await recordRefund(original);
    const replay = await recordRefund(original);
    expect(first.outcome).toBe("created");
    expect(replay).toEqual({ resource: first.resource, outcome: "replayed" });
    await expect(recordRefund({ ...original, amountCents: 31 })).rejects.toBeInstanceOf(
      IdempotencyPayloadConflict,
    );
    expect(await counts()).toEqual({
      refund_count: "1",
      allocation_count: "1",
      refund_ledger_count: "1",
      idempotency_count: "1",
    });
  });

  it("rejects a missing original Payment with a stable error", async () => {
    await expect(recordRefund(refundCommand(999, 1, "missing-payment"))).rejects.toBeInstanceOf(
      OriginalPaymentNotFoundError,
    );
  });

  it("rolls back every Refund effect when Ledger insertion fails", async () => {
    const contract = await financedContract(100, 1, "ledger-rollback");
    const payment = await recordPayment(paymentCommand(contract.id, 100, "ledger-rollback-payment"));
    await database.client.execute(sql.raw(`
      create function fail_refund_ledger_insert()
      returns trigger language plpgsql as $$
      begin
        if new.effect_type = 'refund_recorded' then
          raise exception 'forced refund ledger failure';
        end if;
        return new;
      end; $$
    `));
    await database.client.execute(sql.raw(`
      create trigger fail_refund_ledger_insert before insert on ledger_entries
      for each row execute function fail_refund_ledger_insert()
    `));
    try {
      await expect(
        recordRefund(refundCommand(payment.resource.id, 30, "ledger-rollback-refund")),
      ).rejects.toThrow();
    } finally {
      await database.client.execute(sql.raw(
        "drop trigger if exists fail_refund_ledger_insert on ledger_entries",
      ));
      await database.client.execute(sql.raw("drop function if exists fail_refund_ledger_insert()"));
    }
    expect(await counts()).toEqual({
      refund_count: "0",
      allocation_count: "0",
      refund_ledger_count: "0",
      idempotency_count: "0",
    });
    expect((await statuses(contract.id))[0]?.status).toBe("paid");
  });

  it("rolls back every Refund effect when idempotency insertion fails", async () => {
    const contract = await financedContract(100, 1, "idempotency-rollback");
    const payment = await recordPayment(paymentCommand(contract.id, 100, "idempotency-rollback-payment"));
    await database.client.execute(sql.raw(`
      create function fail_refund_idempotency_insert()
      returns trigger language plpgsql as $$
      begin
        if new.command_type = 'record_refund' then
          raise exception 'forced refund idempotency failure';
        end if;
        return new;
      end; $$
    `));
    await database.client.execute(sql.raw(`
      create trigger fail_refund_idempotency_insert before insert on idempotency_records
      for each row execute function fail_refund_idempotency_insert()
    `));
    try {
      await expect(
        recordRefund(refundCommand(payment.resource.id, 30, "idempotency-rollback-refund")),
      ).rejects.toThrow();
    } finally {
      await database.client.execute(sql.raw(
        "drop trigger if exists fail_refund_idempotency_insert on idempotency_records",
      ));
      await database.client.execute(sql.raw(
        "drop function if exists fail_refund_idempotency_insert()",
      ));
    }
    expect(await counts()).toEqual({
      refund_count: "0",
      allocation_count: "0",
      refund_ledger_count: "0",
      idempotency_count: "0",
    });
    expect((await statuses(contract.id))[0]?.status).toBe("paid");
  });

  it("serializes concurrent excessive Refunds against one Payment", async () => {
    const contract = await financedContract(100, 1, "concurrent-excess");
    const payment = await recordPayment(paymentCommand(contract.id, 100, "concurrent-excess-payment"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const calls = ["a", "b"].map(async (suffix) => {
      await gate;
      return recordRefund(refundCommand(payment.resource.id, 70, `concurrent-excess-${suffix}`));
    });
    release();
    const results = await Promise.allSettled(calls);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await refundTotals(payment.resource.id)).toEqual({
      refund_total: "70",
      allocation_total: "70",
    });
  });

  it("serializes concurrent valid Refunds to the exact Payment limit", async () => {
    const contract = await financedContract(100, 1, "concurrent-valid");
    const payment = await recordPayment(paymentCommand(contract.id, 100, "concurrent-valid-payment"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const calls = [40, 60].map(async (amount, index) => {
      await gate;
      return recordRefund(refundCommand(payment.resource.id, amount, `concurrent-valid-${index}`));
    });
    release();
    await expect(Promise.all(calls)).resolves.toHaveLength(2);
    expect(await refundTotals(payment.resource.id)).toEqual({
      refund_total: "100",
      allocation_total: "100",
    });
  });

  it("serializes Payment and Refund on one Contract into a valid effective state", async () => {
    const contract = await financedContract(100, 1, "payment-refund-race");
    const original = await recordPayment(paymentCommand(contract.id, 100, "payment-refund-original"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const refundCall = (async () => {
      await gate;
      return recordRefund(refundCommand(original.resource.id, 30, "payment-refund-race-refund"));
    })();
    const paymentCall = (async () => {
      await gate;
      return recordPayment(paymentCommand(contract.id, 30, "payment-refund-race-payment"));
    })();
    release();
    const [refundResult, paymentResult] = await Promise.allSettled([refundCall, paymentCall]);
    expect(refundResult.status).toBe("fulfilled");
    if (paymentResult.status === "rejected") {
      expect(paymentResult.reason).toBeInstanceOf(PaymentExceedsOutstandingError);
    }
    const total = await database.client.execute<{ effective: string }>(sql`
      select (
        (select coalesce(sum(amount_cents), 0) from payment_allocations
          where installment_id = ${contract.installments[0]!.id})
        -
        (select coalesce(sum(amount_cents), 0) from refund_allocations
          where installment_id = ${contract.installments[0]!.id})
      )::text as effective
    `);
    expect(["70", "100"]).toContain(total.rows[0]?.effective);
  });

  it("serializes Refunds against different Payments on the same Contract", async () => {
    const contract = await financedContract(100, 1, "same-contract");
    const first = await recordPayment(paymentCommand(contract.id, 50, "same-contract-payment-1"));
    const second = await recordPayment(paymentCommand(contract.id, 50, "same-contract-payment-2"));
    await Promise.all([
      recordRefund(refundCommand(first.resource.id, 20, "same-contract-refund-1")),
      recordRefund(refundCommand(second.resource.id, 20, "same-contract-refund-2")),
    ]);
    expect((await statuses(contract.id))[0]?.status).toBe("partially_paid");
  });

  it("processes Refunds on independent Contracts independently", async () => {
    const firstContract = await financedContract(100, 1, "independent-1");
    const secondContract = await financedContract(100, 1, "independent-2");
    const [firstPayment, secondPayment] = await Promise.all([
      recordPayment(paymentCommand(firstContract.id, 100, "independent-payment-1")),
      recordPayment(paymentCommand(secondContract.id, 100, "independent-payment-2")),
    ]);
    const results = await Promise.all([
      recordRefund(refundCommand(firstPayment.resource.id, 30, "independent-refund-1")),
      recordRefund(refundCommand(secondPayment.resource.id, 40, "independent-refund-2")),
    ]);
    expect(results.map((result) => result.outcome)).toEqual(["created", "created"]);
  });

  it("supports Payment, production Refund, and repayment end to end", async () => {
    const contract = await financedContract(100, 1, "repayment");
    const original = await recordPayment(paymentCommand(contract.id, 100, "repayment-payment-1"));
    await recordRefund(refundCommand(original.resource.id, 30, "repayment-refund"));
    const repayment = await recordPayment(paymentCommand(contract.id, 30, "repayment-payment-2"));
    expect(repayment.resource.allocations).toEqual([
      { installmentId: contract.installments[0]!.id, amountCents: 30 },
    ]);
    expect((await statuses(contract.id))[0]?.status).toBe("paid");
  });
});
