import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type { Clock } from "../../../src/application/clock.js";
import { createContractUseCase } from "../../../src/contracts/application/create-contract.js";
import { PostgresContractPersistence } from "../../../src/contracts/persistence/postgres-contract-persistence.js";
import { createCustomerUseCase } from "../../../src/customers/application/create-customer.js";
import { PostgresCustomerPersistence } from "../../../src/customers/persistence/postgres-customer-persistence.js";
import { ledgerEntries } from "../../../src/ledger/persistence/ledger-schema.js";
import { recordPaymentUseCase } from "../../../src/payments/application/record-payment.js";
import {
  paymentAllocations,
  payments,
} from "../../../src/payments/persistence/payment-schema.js";
import { PostgresPaymentPersistence } from "../../../src/payments/persistence/postgres-payment-persistence.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";
import { processStripeWebhookUseCase } from "../../../src/stripe/application/process-stripe-webhook.js";
import { StripeEventEvidenceConflict } from "../../../src/stripe/application/stripe-webhook-event-persistence.js";
import { PostgresStripeWebhookEventPersistence } from "../../../src/stripe/persistence/postgres-stripe-webhook-event-persistence.js";
import { stripeWebhookEvents } from "../../../src/stripe/persistence/stripe-webhook-event-schema.js";

const POSTGRES_IMAGE = "postgres:18.4";
const APPLICATION_NOW = new Date("2026-08-27T14:00:00.123Z");
const RECEIPT_TIME = new Date("2026-08-27T13:59:59.456Z");
const EVENT_CREATED = 1_777_608_000;

class FixedClock implements Clock {
  now(): Date {
    return new Date(APPLICATION_NOW);
  }
}

function stripeEvent(input: {
  readonly eventId: string;
  readonly paymentIntentId: string;
  readonly contractId: number;
  readonly amountCents: number;
}) {
  return {
    id: input.eventId,
    object: "event",
    type: "payment_intent.succeeded",
    created: EVENT_CREATED,
    livemode: false,
    data: {
      object: {
        object: "payment_intent",
        id: input.paymentIntentId,
        livemode: false,
        amount_received: input.amountCents,
        currency: "eur",
        metadata: { contract_id: String(input.contractId) },
      },
    },
  };
}

describe.sequential("Stripe webhook PostgreSQL ingestion", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let stripePersistence: PostgresStripeWebhookEventPersistence;
  let processStripeWebhook: ReturnType<typeof processStripeWebhookUseCase>;
  let createCustomer: ReturnType<typeof createCustomerUseCase>;
  let createContract: ReturnType<typeof createContractUseCase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    database = createDatabase({ connectionString: container.getConnectionUri() });
    await migrate(database.client, { migrationsFolder: "./drizzle" });

    const clock = new FixedClock();
    const customerPersistence = new PostgresCustomerPersistence(database);
    const contractPersistence = new PostgresContractPersistence(database);
    const paymentPersistence = new PostgresPaymentPersistence(database);
    stripePersistence = new PostgresStripeWebhookEventPersistence(database);
    createCustomer = createCustomerUseCase({ clock, persistence: customerPersistence });
    createContract = createContractUseCase({ clock, persistence: contractPersistence });
    processStripeWebhook = processStripeWebhookUseCase({
      clock,
      persistence: stripePersistence,
      recordPayment: recordPaymentUseCase({ clock, persistence: paymentPersistence }),
    });
  }, 120_000);

  beforeEach(async () => {
    await database.client.execute(sql`
      truncate table stripe_webhook_events, ledger_entries, payment_allocations, payments,
        installments, contracts, idempotency_records, customers
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 30_000);

  async function financedContract(totalAmountCents = 1_000) {
    const customer = await createCustomer({
      idempotencyKey: `stripe-customer-${totalAmountCents}`,
      displayName: "Stripe Customer",
    });
    const contract = await createContract({
      idempotencyKey: `stripe-contract-${totalAmountCents}`,
      customerId: customer.resource.id,
      totalAmountCents,
      currency: "EUR",
      installmentCount: 2,
      firstDueDate: "2026-09-01",
    });
    return contract.resource;
  }

  function inputFor(
    event: ReturnType<typeof stripeEvent>,
    receivedAt = RECEIPT_TIME,
  ) {
    const rawPayload = Buffer.from(JSON.stringify(event), "utf8");
    return {
      verifiedEvent: event,
      stripeEventId: event.id,
      rawPayload,
      receivedAt,
    };
  }

  async function financialCounts() {
    const result = await database.client.execute<{
      payment_count: string;
      allocation_count: string;
      ledger_count: string;
    }>(sql`
      select
        (select count(*) from payments) as payment_count,
        (select count(*) from payment_allocations) as allocation_count,
        (select count(*) from ledger_entries) as ledger_count
    `);
    return result.rows[0]!;
  }

  it("retains exact first-delivery evidence and detects safe replay versus conflict", async () => {
    const event = stripeEvent({
      eventId: "evt_evidence123",
      paymentIntentId: "pi_evidence123",
      contractId: 1,
      amountCents: 100,
    });
    const firstInput = inputFor(event);
    const first = await stripePersistence.storeReceipt({
      stripeEventId: event.id,
      eventType: "payment_intent.succeeded",
      stripePaymentIntentId: event.data.object.id,
      rawPayload: firstInput.rawPayload,
      receivedAt: RECEIPT_TIME,
    });
    const laterReceipt = new Date(RECEIPT_TIME.getTime() + 10_000);
    const replay = await stripePersistence.storeReceipt({
      stripeEventId: event.id,
      eventType: "payment_intent.succeeded",
      stripePaymentIntentId: event.data.object.id,
      rawPayload: firstInput.rawPayload,
      receivedAt: laterReceipt,
    });

    expect(first.outcome).toBe("stored");
    expect(replay.outcome).toBe("replayed");
    expect(replay.event.rawPayload.equals(firstInput.rawPayload)).toBe(true);
    expect(replay.event.receivedAt).toEqual(RECEIPT_TIME);
    const conflictingRaw = Buffer.from(
      JSON.stringify({ ...event, created: event.created + 1 }),
      "utf8",
    );
    await expect(
      stripePersistence.storeReceipt({
        stripeEventId: event.id,
        eventType: "payment_intent.succeeded",
        stripePaymentIntentId: event.data.object.id,
        rawPayload: conflictingRaw,
        receivedAt: laterReceipt,
      }),
    ).rejects.toBeInstanceOf(StripeEventEvidenceConflict);

    const rows = await database.client.select().from(stripeWebhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rawPayload.equals(firstInput.rawPayload)).toBe(true);
  });

  it("uses an atomic token claim, reports active work busy, and replaces only a stale lease", async () => {
    const event = stripeEvent({
      eventId: "evt_claim123",
      paymentIntentId: "pi_claim123",
      contractId: 1,
      amountCents: 100,
    });
    const input = inputFor(event);
    const receipt = await stripePersistence.storeReceipt({
      stripeEventId: event.id,
      eventType: "payment_intent.succeeded",
      stripePaymentIntentId: event.data.object.id,
      rawPayload: input.rawPayload,
      receivedAt: RECEIPT_TIME,
    });

    await expect(
      stripePersistence.claimForProcessing(receipt.event.id, "11111111-1111-4111-8111-111111111111"),
    ).resolves.toMatchObject({ outcome: "claimed" });
    await expect(
      stripePersistence.claimForProcessing(receipt.event.id, "22222222-2222-4222-8222-222222222222"),
    ).resolves.toEqual({ outcome: "busy" });

    await database.client.execute(sql`
      update stripe_webhook_events
      set processing_started_at = clock_timestamp() - interval '61 seconds'
      where id = ${receipt.event.id}
    `);
    const reclaimed = await stripePersistence.claimForProcessing(
      receipt.event.id,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(reclaimed).toMatchObject({ outcome: "claimed" });
    await expect(
      stripePersistence.markFailed({
        eventId: receipt.event.id,
        processingToken: "11111111-1111-4111-8111-111111111111",
        errorCode: "INVALID_EVENT",
        processedAt: APPLICATION_NOW,
      }),
    ).rejects.toThrow();
    await stripePersistence.releaseForRetry(
      receipt.event.id,
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("creates one Payment, its allocations and LedgerEntry, then acknowledges an exact duplicate", async () => {
    const contract = await financedContract();
    const event = stripeEvent({
      eventId: "evt_success123",
      paymentIntentId: "pi_success123",
      contractId: contract.id,
      amountCents: 600,
    });
    const input = inputFor(event);

    await expect(processStripeWebhook(input)).resolves.toEqual({ outcome: "processed" });
    await expect(processStripeWebhook(input)).resolves.toEqual({ outcome: "processed" });

    expect(await financialCounts()).toEqual({
      payment_count: "1",
      allocation_count: "2",
      ledger_count: "1",
    });
    const [retained] = await database.client
      .select()
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.stripeEventId, event.id));
    expect(retained).toMatchObject({
      status: "processed",
      paymentId: 1,
      lastErrorCode: null,
      processingToken: null,
    });
    const [payment] = await database.client.select().from(payments);
    expect(payment?.receivedAt).toEqual(new Date(EVENT_CREATED * 1_000));
  });

  it("persists a bounded terminal business failure and acknowledges its duplicate", async () => {
    const event = stripeEvent({
      eventId: "evt_missingcontract123",
      paymentIntentId: "pi_missingcontract123",
      contractId: 999,
      amountCents: 100,
    });
    const input = inputFor(event);

    await expect(processStripeWebhook(input)).resolves.toEqual({ outcome: "failed" });
    await expect(processStripeWebhook(input)).resolves.toEqual({ outcome: "failed" });

    const [retained] = await database.client.select().from(stripeWebhookEvents);
    expect(retained).toMatchObject({
      status: "failed",
      lastErrorCode: "CONTRACT_NOT_FOUND",
      paymentId: null,
    });
    expect(await financialCounts()).toEqual({
      payment_count: "0",
      allocation_count: "0",
      ledger_count: "0",
    });
  });

  it("releases the claim after a real transient Payment failure", async () => {
    const contract = await financedContract();
    const input = inputFor(
      stripeEvent({
        eventId: "evt_transient123",
        paymentIntentId: "pi_transient123",
        contractId: contract.id,
        amountCents: 100,
      }),
    );

    await database.client.execute(sql.raw(`
      create function fail_test_payment_insert() returns trigger language plpgsql as $$
      begin raise exception 'injected payment failure'; end;
      $$;
      create trigger fail_test_payment_insert
      before insert on payments for each row execute function fail_test_payment_insert();
    `));
    try {
      await expect(processStripeWebhook(input)).rejects.toThrow();
    } finally {
      await database.client.execute(sql.raw(`
        drop trigger if exists fail_test_payment_insert on payments;
        drop function if exists fail_test_payment_insert();
      `));
    }

    const [retained] = await database.client.select().from(stripeWebhookEvents);
    expect(retained).toMatchObject({
      status: "received",
      processingToken: null,
      processingStartedAt: null,
    });
    expect(await financialCounts()).toEqual({
      payment_count: "0",
      allocation_count: "0",
      ledger_count: "0",
    });
  });

  it("creates one financial effect under concurrent duplicate delivery", async () => {
    const contract = await financedContract();
    const input = inputFor(
      stripeEvent({
        eventId: "evt_concurrent123",
        paymentIntentId: "pi_concurrent123",
        contractId: contract.id,
        amountCents: 100,
      }),
    );

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => processStripeWebhook(input)),
    );
    expect(outcomes.some((result) => result.outcome === "processed")).toBe(true);
    expect(await financialCounts()).toEqual({
      payment_count: "1",
      allocation_count: "1",
      ledger_count: "1",
    });
  });

  it("recovers a committed Payment after finalization and release both fail", async () => {
    const contract = await financedContract();
    const input = inputFor(
      stripeEvent({
        eventId: "evt_finalize123",
        paymentIntentId: "pi_finalize123",
        contractId: contract.id,
        amountCents: 100,
      }),
    );

    await database.client.execute(sql.raw(`
      create function fail_test_stripe_finalization() returns trigger language plpgsql as $$
      begin
        if old.status = 'processing' then
          raise exception 'injected finalization and release failure';
        end if;
        return new;
      end;
      $$;
      create trigger fail_test_stripe_finalization
      before update on stripe_webhook_events
      for each row execute function fail_test_stripe_finalization();
    `));
    try {
      await expect(processStripeWebhook(input)).rejects.toThrow();
    } finally {
      await database.client.execute(sql.raw(`
        drop trigger if exists fail_test_stripe_finalization on stripe_webhook_events;
        drop function if exists fail_test_stripe_finalization();
      `));
    }

    expect(await financialCounts()).toEqual({
      payment_count: "1",
      allocation_count: "1",
      ledger_count: "1",
    });
    await database.client.execute(sql`
      update stripe_webhook_events
      set processing_started_at = clock_timestamp() - interval '61 seconds'
    `);
    await expect(processStripeWebhook(input)).resolves.toEqual({ outcome: "processed" });
    expect(await financialCounts()).toEqual({
      payment_count: "1",
      allocation_count: "1",
      ledger_count: "1",
    });
    const [retained] = await database.client.select().from(stripeWebhookEvents);
    expect(retained).toMatchObject({ status: "processed", paymentId: 1 });
  });

  it("rolls back a real receipt failure without retained or financial effects", async () => {
    const input = inputFor(
      stripeEvent({
        eventId: "evt_receiptfailure123",
        paymentIntentId: "pi_receiptfailure123",
        contractId: 1,
        amountCents: 100,
      }),
    );
    await database.client.execute(sql.raw(`
      create function fail_test_stripe_receipt() returns trigger language plpgsql as $$
      begin raise exception 'injected receipt failure'; end;
      $$;
      create trigger fail_test_stripe_receipt
      before insert on stripe_webhook_events
      for each row execute function fail_test_stripe_receipt();
    `));
    try {
      await expect(processStripeWebhook(input)).rejects.toThrow();
    } finally {
      await database.client.execute(sql.raw(`
        drop trigger if exists fail_test_stripe_receipt on stripe_webhook_events;
        drop function if exists fail_test_stripe_receipt();
      `));
    }

    expect(await database.client.select().from(stripeWebhookEvents)).toEqual([]);
    expect(await financialCounts()).toEqual({
      payment_count: "0",
      allocation_count: "0",
      ledger_count: "0",
    });
  });

  it("enforces state consistency and protects immutable evidence against UPDATE and DELETE", async () => {
    const event = stripeEvent({
      eventId: "evt_constraints123",
      paymentIntentId: "pi_constraints123",
      contractId: 1,
      amountCents: 100,
    });
    const input = inputFor(event);
    const receipt = await stripePersistence.storeReceipt({
      stripeEventId: event.id,
      eventType: "payment_intent.succeeded",
      stripePaymentIntentId: event.data.object.id,
      rawPayload: input.rawPayload,
      receivedAt: RECEIPT_TIME,
    });

    const baseInvalidRow = {
      stripeEventId: "evt_invalidstate123",
      eventType: "payment_intent.succeeded",
      stripePaymentIntentId: "pi_invalidstate123",
      rawPayload: Buffer.from("{}", "utf8"),
      receivedAt: RECEIPT_TIME,
      status: "received",
    };
    for (const invalid of [
      { status: "processing" },
      { status: "failed", processedAt: APPLICATION_NOW },
      { status: "received", processingToken: "33333333-3333-4333-8333-333333333333" },
      { rawPayload: Buffer.alloc(0) },
      { stripePaymentIntentId: "invalid" },
    ]) {
      await expect(
        database.client
          .insert(stripeWebhookEvents)
          .values({ ...baseInvalidRow, ...invalid }),
      ).rejects.toThrow();
    }

    await expect(
      database.client
        .update(stripeWebhookEvents)
        .set({ status: "processing" })
        .where(eq(stripeWebhookEvents.id, receipt.event.id)),
    ).rejects.toThrow();
    await expect(
      database.client
        .update(stripeWebhookEvents)
        .set({ rawPayload: Buffer.from("changed", "utf8") })
        .where(eq(stripeWebhookEvents.id, receipt.event.id)),
    ).rejects.toThrow();
    await expect(
      database.client
        .update(stripeWebhookEvents)
        .set({ stripePaymentIntentId: null })
        .where(eq(stripeWebhookEvents.id, receipt.event.id)),
    ).rejects.toThrow();
    await expect(
      database.client
        .delete(stripeWebhookEvents)
        .where(eq(stripeWebhookEvents.id, receipt.event.id)),
    ).rejects.toThrow();
    expect(await database.client.select().from(stripeWebhookEvents)).toHaveLength(1);
  });
});
