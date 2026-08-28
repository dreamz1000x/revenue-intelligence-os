import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ledgerEntries } from "../../../src/ledger/persistence/ledger-schema.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";

const POSTGRES_IMAGE = "postgres:18.4";
const RECEIVED_AT = "2026-08-20T09:15:30.123Z";
const CREATED_AT = "2026-08-20T09:16:00.456Z";

describe.sequential("Ledger migration", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  async function applyMigration(migration: MigrationMeta): Promise<void> {
    await database.transaction(async (transaction) => {
      for (const statement of migration.sql) {
        if (statement.trim().length > 0) {
          await transaction.execute(sql.raw(statement));
        }
      }
    });
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    database = createDatabase({ connectionString: container.getConnectionUri() });
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 30_000);

  it("backfills one exact immutable LedgerEntry per historical Payment", async () => {
    const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
    expect(migrations).toHaveLength(6);

    for (const migration of migrations.slice(0, 3)) {
      await applyMigration(migration);
    }

    const beforeLedgerMigration = await database.client.execute<{
      relation: string | null;
    }>(sql`select to_regclass('public.ledger_entries')::text as relation`);
    expect(beforeLedgerMigration.rows[0]?.relation).toBeNull();

    await database.client.execute(sql`
      insert into customers (display_name, created_at)
      values ('Historical Customer', ${CREATED_AT}::timestamptz)
    `);
    await database.client.execute(sql`
      insert into contracts (
        customer_id,
        total_amount_cents,
        currency,
        installment_count,
        first_due_date,
        status,
        created_at
      ) values (1, 1250, 'EUR', 1, '2026-09-01', 'active', ${CREATED_AT}::timestamptz)
    `);
    await database.client.execute(sql`
      insert into payments (contract_id, amount_cents, received_at, created_at)
      values (1, 1250, ${RECEIVED_AT}::timestamptz, ${CREATED_AT}::timestamptz)
    `);

    const historicalPaymentBefore = await database.client.execute(sql`
      select id, contract_id, amount_cents::text, received_at, created_at
      from payments
    `);

    await applyMigration(migrations[3]!);

    const historicalPaymentAfter = await database.client.execute(sql`
      select id, contract_id, amount_cents::text, received_at, created_at
      from payments
    `);
    expect(historicalPaymentAfter.rows).toEqual(historicalPaymentBefore.rows);

    const historicalLedgerBeforeRefundMigration = await database.client.execute(sql`
      select id, payment_id, effect_type, amount_cents::text, currency,
        event_at, recorded_at
      from ledger_entries
    `);

    await applyMigration(migrations[4]!);
    await applyMigration(migrations[5]!);

    const historicalLedgerAfterRefundMigration = await database.client.execute(sql`
      select id, payment_id, effect_type, amount_cents::text, currency,
        event_at, recorded_at
      from ledger_entries
    `);
    expect(historicalLedgerAfterRefundMigration.rows).toEqual(
      historicalLedgerBeforeRefundMigration.rows,
    );

    const ledger = await database.client.select().from(ledgerEntries);
    expect(ledger).toEqual([
      {
        id: 1,
        paymentId: 1,
        refundId: null,
        effectType: "payment_recorded",
        amountCents: 1250n,
        currency: "EUR",
        eventAt: new Date(RECEIVED_AT),
        recordedAt: new Date(CREATED_AT),
      },
    ]);

    await expect(
      database.client.execute(sql`update ledger_entries set amount_cents = 1`),
    ).rejects.toThrow();
    await expect(
      database.client.execute(sql`delete from ledger_entries`),
    ).rejects.toThrow();
  });
});
